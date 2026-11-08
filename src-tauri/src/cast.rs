// Network pieces for casting to a TV (the same ones the Android app has in
// CastPlugin.java). The cast protocols themselves, Google Cast's JSON messages
// and DLNA's SOAP requests, live in the web layer (src/utils/cast/). This side
// does what a web page cannot:
//   - find devices with a multicast query (SSDP for DLNA TVs, mDNS for Cast),
//   - hold the TLS connection to a Cast device and answer its keep-alive pings,
//   - serve the song to the TV. The TV cannot open the googlevideo URL itself
//     (it only works from the address that asked YouTube for it), so it asks
//     this PC, which fetches the audio in 1 MB pieces and passes it on.
// Each served song gets a random path, so nothing else on the network can use
// the server to reach other URLs or files.
use std::collections::{HashMap, VecDeque};
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

const CHUNK: u64 = 1024 * 1024;
const HEARTBEAT: &str = "urn:x-cast:com.google.cast.tp.heartbeat";

// ---------------------------------------------------------------- addresses

fn lan_ip() -> Option<Ipv4Addr> {
    // Asks the system which interface reaches the internet; nothing is sent.
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    match s.local_addr().ok()? {
        SocketAddr::V4(a) if !a.ip().is_loopback() && !a.ip().is_unspecified() => Some(*a.ip()),
        _ => None,
    }
}

#[tauri::command]
pub fn cast_lan_info() -> Value {
    json!({ "address": lan_ip().map(|a| a.to_string()) })
}

// ---------------------------------------------------------------- discovery

#[tauri::command]
pub async fn cast_udp_query(
    host: String,
    port: u16,
    data: Vec<u8>,
    wait_ms: Option<u64>,
    listen_multicast: Option<bool>,
) -> Result<Value, String> {
    let wait = Duration::from_millis(wait_ms.unwrap_or(2500).clamp(300, 10_000));
    let listen = listen_multicast.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || udp_query(&host, port, &data, wait, listen))
        .await
        .map_err(|e| e.to_string())?
}

fn udp_query(host: &str, port: u16, data: &[u8], wait: Duration, listen: bool) -> Result<Value, String> {
    use socket2::{Domain, Protocol, Socket, Type};
    let group: Ipv4Addr = host.parse().map_err(|_| "bad address".to_string())?;
    let local = lan_ip().unwrap_or(Ipv4Addr::UNSPECIFIED);

    // Bound to the Wi-Fi/LAN address so the query leaves through that network
    // and not a virtual adapter (WSL, VPN, Hyper-V).
    let a = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)).map_err(|e| e.to_string())?;
    a.bind(&SocketAddr::from((local, 0)).into()).map_err(|e| e.to_string())?;
    if !local.is_unspecified() {
        let _ = a.set_multicast_if_v4(&local);
    }
    let _ = a.set_multicast_ttl_v4(2);
    let a: UdpSocket = a.into();
    a.set_read_timeout(Some(Duration::from_millis(100))).ok();

    let b: Option<UdpSocket> = if listen {
        (|| -> std::io::Result<UdpSocket> {
            let s = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
            s.set_reuse_address(true)?;
            s.bind(&SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)).into())?;
            s.join_multicast_v4(&group, &local)?;
            let s: UdpSocket = s.into();
            s.set_read_timeout(Some(Duration::from_millis(100)))?;
            Ok(s)
        })()
        .ok()
    } else {
        None
    };

    let target = SocketAddr::from((group, port));
    a.send_to(data, target).map_err(|e| e.to_string())?;
    if let Some(b) = &b {
        let _ = b.send_to(data, target);
    }
    let start = Instant::now();
    let mut resent = false;
    let mut seen = std::collections::HashSet::new();
    let mut replies = Vec::new();
    let mut buf = vec![0u8; 9000];
    while start.elapsed() < wait {
        if !resent && start.elapsed() > Duration::from_millis(700) {
            // UDP gets lost on busy Wi-Fi; ask once more.
            let _ = a.send_to(data, target);
            resent = true;
        }
        for s in [Some(&a), b.as_ref()].into_iter().flatten() {
            if let Ok((n, from)) = s.recv_from(&mut buf) {
                let bytes = buf[..n].to_vec();
                let key = (from.ip().to_string(), bytes.clone());
                if seen.insert(key) {
                    replies.push(json!({ "address": from.ip().to_string(), "data": bytes }));
                }
            }
        }
    }
    Ok(json!({ "replies": replies }))
}

// ---------------------------------------------------------------- Google Cast

struct Conn {
    tx: mpsc::UnboundedSender<Vec<u8>>,
    inbox: Arc<Mutex<VecDeque<Value>>>,
    closed: Arc<AtomicBool>,
}

fn conns() -> &'static Mutex<HashMap<u32, Conn>> {
    static C: OnceLock<Mutex<HashMap<u32, Conn>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}
static NEXT_ID: AtomicU32 = AtomicU32::new(1);

// Cast devices use their own self-signed certificate; the connection stays on
// the local network, so it is not checked.
#[derive(Debug)]
struct AcceptAny(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for AcceptAny {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

fn varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8 & 0x7f) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn str_field(out: &mut Vec<u8>, field: u64, s: &str) {
    varint(out, (field << 3) | 2);
    varint(out, s.len() as u64);
    out.extend_from_slice(s.as_bytes());
}

// A length-prefixed protobuf CastMessage with a JSON (string) payload.
fn frame(namespace: &str, source: &str, destination: &str, data: &str) -> Vec<u8> {
    let mut b = Vec::with_capacity(data.len() + 128);
    varint(&mut b, 1 << 3);
    varint(&mut b, 0); // protocol_version CASTV2_1_0
    str_field(&mut b, 2, source);
    str_field(&mut b, 3, destination);
    str_field(&mut b, 4, namespace);
    varint(&mut b, 5 << 3);
    varint(&mut b, 0); // payload_type STRING
    str_field(&mut b, 6, data);
    let mut out = (b.len() as u32).to_be_bytes().to_vec();
    out.extend_from_slice(&b);
    out
}

fn read_varint(b: &[u8], pos: &mut usize) -> Option<u64> {
    let mut v = 0u64;
    let mut shift = 0;
    loop {
        let x = *b.get(*pos)?;
        *pos += 1;
        v |= ((x & 0x7f) as u64) << shift;
        if x & 0x80 == 0 {
            return Some(v);
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
}

fn decode(b: &[u8]) -> Option<(String, String, String, String)> {
    let (mut ns, mut src, mut dst, mut data) = (String::new(), String::new(), String::new(), String::new());
    let mut pos = 0;
    while pos < b.len() {
        let key = read_varint(b, &mut pos)?;
        match key & 7 {
            0 => {
                read_varint(b, &mut pos)?;
            }
            2 => {
                let len = read_varint(b, &mut pos)? as usize;
                let s = String::from_utf8_lossy(b.get(pos..pos + len)?).into_owned();
                pos += len;
                match key >> 3 {
                    2 => src = s,
                    3 => dst = s,
                    4 => ns = s,
                    6 => data = s,
                    _ => {}
                }
            }
            1 => pos += 8,
            5 => pos += 4,
            _ => return None,
        }
    }
    Some((ns, src, dst, data))
}

#[tauri::command]
pub async fn cast_open(host: String, port: Option<u16>) -> Result<Value, String> {
    let port = port.unwrap_or(8009);
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAny(provider)))
        .with_no_client_auth();
    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    let tcp = tokio::time::timeout(Duration::from_secs(6), tokio::net::TcpStream::connect((host.as_str(), port)))
        .await
        .map_err(|_| "Could not connect to the TV (timed out)".to_string())?
        .map_err(|e| format!("Could not connect to the TV: {e}"))?;
    let name = rustls::pki_types::ServerName::try_from(host.clone()).map_err(|e| e.to_string())?;
    let tls = tokio::time::timeout(Duration::from_secs(6), connector.connect(name, tcp))
        .await
        .map_err(|_| "The TV did not answer (timed out)".to_string())?
        .map_err(|e| format!("Could not connect to the TV: {e}"))?;
    let (mut rd, mut wr) = tokio::io::split(tls);

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let inbox = Arc::new(Mutex::new(VecDeque::new()));
    let closed = Arc::new(AtomicBool::new(false));
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);

    // Writer
    {
        let closed = closed.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(bytes) = rx.recv().await {
                if wr.write_all(&bytes).await.is_err() || wr.flush().await.is_err() {
                    break;
                }
            }
            closed.store(true, Ordering::Relaxed);
        });
    }
    // Reader: answers PINGs itself, queues everything else for the web layer.
    {
        let closed = closed.clone();
        let inbox = inbox.clone();
        let tx = tx.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let mut len = [0u8; 4];
                if rd.read_exact(&mut len).await.is_err() {
                    break;
                }
                let n = u32::from_be_bytes(len) as usize;
                if n > 1 << 20 {
                    break;
                }
                let mut buf = vec![0u8; n];
                if rd.read_exact(&mut buf).await.is_err() {
                    break;
                }
                let Some((ns, src, dst, data)) = decode(&buf) else { continue };
                if ns == HEARTBEAT {
                    if data.contains("\"PING\"") {
                        let _ = tx.send(frame(HEARTBEAT, &dst, &src, "{\"type\":\"PONG\"}"));
                    }
                    continue;
                }
                let mut q = inbox.lock().unwrap();
                q.push_back(json!({ "namespace": ns, "source": src, "destination": dst, "data": data }));
                while q.len() > 200 {
                    q.pop_front();
                }
            }
            closed.store(true, Ordering::Relaxed);
        });
    }
    // Keep-alive
    {
        let closed = closed.clone();
        let tx = tx.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;
                if closed.load(Ordering::Relaxed)
                    || tx.send(frame(HEARTBEAT, "sender-0", "receiver-0", "{\"type\":\"PING\"}")).is_err()
                {
                    break;
                }
            }
        });
    }
    conns().lock().unwrap().insert(id, Conn { tx, inbox, closed });
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub fn cast_send(id: u32, namespace: String, source: String, destination: String, data: String) -> Result<(), String> {
    let map = conns().lock().unwrap();
    let c = map.get(&id).ok_or("closed")?;
    if c.closed.load(Ordering::Relaxed) {
        return Err("closed".into());
    }
    c.tx.send(frame(&namespace, &source, &destination, &data)).map_err(|_| "closed".to_string())
}

#[tauri::command]
pub fn cast_recv(id: u32) -> Value {
    let map = conns().lock().unwrap();
    match map.get(&id) {
        Some(c) => {
            let messages: Vec<Value> = c.inbox.lock().unwrap().drain(..).collect();
            json!({ "messages": messages, "closed": c.closed.load(Ordering::Relaxed) })
        }
        None => json!({ "messages": [], "closed": true }),
    }
}

#[tauri::command]
pub fn cast_close(id: u32) {
    if let Some(c) = conns().lock().unwrap().remove(&id) {
        c.closed.store(true, Ordering::Relaxed);
        // Dropping the sender ends the writer, which closes the connection.
    }
}

// ---------------------------------------------------------------- media server

struct Entry {
    url: String,
    path: String,
    content_type: String,
    total: Mutex<Option<u64>>,
    whole: Mutex<Option<Arc<Vec<u8>>>>,
}

struct Server {
    port: u16,
    entries: Mutex<(HashMap<String, Arc<Entry>>, VecDeque<String>)>,
}

static SERVER: tokio::sync::OnceCell<Arc<Server>> = tokio::sync::OnceCell::const_new();

async fn server() -> Result<Arc<Server>, String> {
    SERVER
        .get_or_try_init(|| async {
            let listener = tokio::net::TcpListener::bind("0.0.0.0:0").await.map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let srv = Arc::new(Server { port, entries: Mutex::new((HashMap::new(), VecDeque::new())) });
            let s2 = srv.clone();
            tauri::async_runtime::spawn(async move {
                while let Ok((sock, _)) = listener.accept().await {
                    let s3 = s2.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = handle(s3, sock).await;
                    });
                }
            });
            Ok::<_, String>(srv)
        })
        .await
        .cloned()
}

fn random_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for _ in 0..2 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

#[tauri::command]
pub async fn cast_media_serve(url: Option<String>, path: Option<String>, content_type: Option<String>) -> Result<Value, String> {
    let host = lan_ip().ok_or("Not connected to a network")?;
    let srv = server().await?;
    let url = url.unwrap_or_default();
    let path = path.unwrap_or_default();
    if path.is_empty() && !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Nothing to play".into());
    }
    let ct = content_type.filter(|c| !c.is_empty()).unwrap_or_else(|| "audio/mp4".into());
    let total = if !path.is_empty() { std::fs::metadata(&path).ok().map(|m| m.len()) } else { None };
    let token = random_token();
    let ext = if ct.contains("webm") {
        ".webm"
    } else if ct.contains("mpeg") {
        ".mp3"
    } else if ct.starts_with("image/") {
        ".jpg"
    } else {
        ".m4a"
    };
    {
        let mut e = srv.entries.lock().unwrap();
        e.0.insert(
            token.clone(),
            Arc::new(Entry { url, path, content_type: ct, total: Mutex::new(total), whole: Mutex::new(None) }),
        );
        e.1.push_back(token.clone());
        while e.1.len() > 40 {
            if let Some(old) = e.1.pop_front() {
                e.0.remove(&old);
            }
        }
    }
    Ok(json!({ "url": format!("http://{}:{}/m/{}{}", host, srv.port, token, ext) }))
}

async fn write_status(sock: &mut tokio::net::TcpStream, status: &str) -> std::io::Result<()> {
    sock.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes())
        .await
}

async fn total_length(e: &Entry) -> Option<u64> {
    if let Some(t) = *e.total.lock().unwrap() {
        return Some(t);
    }
    // googlevideo URLs carry the size in the "clen" parameter.
    let mut found = reqwest::Url::parse(&e.url)
        .ok()
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "clen").and_then(|(_, v)| v.parse::<u64>().ok()));
    if found.is_none() {
        if let Ok(r) = crate::audio_proxy::client().get(&e.url).header("Range", "bytes=0-0").send().await {
            found = r
                .headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.rsplit('/').next())
                .and_then(|s| s.trim().parse().ok())
                .or_else(|| if r.status().as_u16() == 200 { r.content_length() } else { None });
        }
    }
    if found.is_some() {
        *e.total.lock().unwrap() = found;
    }
    found
}

async fn handle(srv: Arc<Server>, mut sock: tokio::net::TcpStream) -> std::io::Result<()> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if tokio::time::timeout(Duration::from_secs(30), sock.read(&mut byte)).await.map_err(|_| std::io::ErrorKind::TimedOut)?? == 0 {
            return Ok(());
        }
        head.push(byte[0]);
        if head.len() > 16384 {
            return Ok(());
        }
    }
    let head = String::from_utf8_lossy(&head).into_owned();
    let mut lines = head.split("\r\n");
    let mut req = lines.next().unwrap_or("").split(' ');
    let method = req.next().unwrap_or("").to_string();
    let target = req.next().unwrap_or("").to_string();
    let mut range: Option<String> = None;
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                range = Some(v.trim().to_string());
            }
        }
    }
    let token = target
        .strip_prefix("/m/")
        .unwrap_or("")
        .split(|c| c == '.' || c == '?')
        .next()
        .unwrap_or("")
        .to_string();
    let entry = srv.entries.lock().unwrap().0.get(&token).cloned();
    let Some(e) = entry else { return write_status(&mut sock, "404 Not Found").await };
    if method == "OPTIONS" {
        return sock
            .write_all(b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n")
            .await;
    }
    let head_only = method == "HEAD";
    if !head_only && method != "GET" {
        return write_status(&mut sock, "405 Method Not Allowed").await;
    }

    if e.content_type.starts_with("image/") {
        let cached = e.whole.lock().unwrap().clone();
        let data = match cached {
            Some(d) => d,
            None => {
                let bytes = if !e.path.is_empty() {
                    tokio::fs::read(&e.path).await.ok()
                } else {
                    match crate::audio_proxy::client().get(&e.url).send().await {
                        Ok(r) if r.status().is_success() => r.bytes().await.ok().map(|b| b.to_vec()),
                        _ => None,
                    }
                };
                let Some(bytes) = bytes else { return write_status(&mut sock, "502 Bad Gateway").await };
                let d = Arc::new(bytes);
                *e.whole.lock().unwrap() = Some(d.clone());
                d
            }
        };
        sock.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                e.content_type,
                data.len()
            )
            .as_bytes(),
        )
        .await?;
        if !head_only {
            sock.write_all(&data).await?;
        }
        return sock.flush().await;
    }

    let Some(total) = total_length(&e).await.filter(|t| *t > 0) else {
        return write_status(&mut sock, "502 Bad Gateway").await;
    };
    let (mut start, mut end, mut partial) = (0u64, total - 1, false);
    if let Some(spec) = range.as_deref().and_then(|r| r.strip_prefix("bytes=")) {
        let spec = spec.split(',').next().unwrap_or("").trim();
        if let Some((a, b)) = spec.split_once('-') {
            if a.is_empty() {
                if let Ok(n) = b.parse::<u64>() {
                    start = total.saturating_sub(n);
                    partial = true;
                }
            } else if let Ok(s) = a.parse::<u64>() {
                start = s;
                if let Ok(x) = b.parse::<u64>() {
                    end = x.min(total - 1);
                }
                partial = true;
            }
        }
        if start >= total || start > end {
            return sock
                .write_all(format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes())
                .await;
        }
    }
    let mut h = String::new();
    h.push_str(if partial { "HTTP/1.1 206 Partial Content\r\n" } else { "HTTP/1.1 200 OK\r\n" });
    h.push_str(&format!("Content-Type: {}\r\nContent-Length: {}\r\n", e.content_type, end - start + 1));
    if partial {
        h.push_str(&format!("Content-Range: bytes {start}-{end}/{total}\r\n"));
    }
    h.push_str("Accept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\n");
    h.push_str("transferMode.dlna.org: Streaming\r\n");
    h.push_str("contentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\r\n");
    h.push_str("Connection: close\r\n\r\n");
    sock.write_all(h.as_bytes()).await?;
    if head_only {
        return sock.flush().await;
    }

    if !e.path.is_empty() {
        use tokio::io::AsyncSeekExt;
        let mut f = tokio::fs::File::open(&e.path).await?;
        f.seek(std::io::SeekFrom::Start(start)).await?;
        let mut left = end - start + 1;
        let mut buf = vec![0u8; 64 * 1024];
        while left > 0 {
            let want = left.min(buf.len() as u64) as usize;
            let n = f.read(&mut buf[..want]).await?;
            if n == 0 {
                break;
            }
            sock.write_all(&buf[..n]).await?;
            left -= n as u64;
        }
        return sock.flush().await;
    }

    let mut pos = start;
    while pos <= end {
        let to = end.min(pos + CHUNK - 1);
        let mut r = crate::audio_proxy::client()
            .get(&e.url)
            .header("Range", format!("bytes={pos}-{to}"))
            .send()
            .await
            .map_err(|err| std::io::Error::other(err.to_string()))?;
        let status = r.status().as_u16();
        if status != 206 && !(status == 200 && pos == 0) {
            return Err(std::io::Error::other(format!("upstream {status}")));
        }
        while let Some(chunk) = r.chunk().await.map_err(|err| std::io::Error::other(err.to_string()))? {
            let room = (to - pos + 1) as usize;
            let part = &chunk[..chunk.len().min(room)];
            sock.write_all(part).await?;
            pos += part.len() as u64;
            if pos > to {
                break;
            }
        }
        if pos <= to {
            return Err(std::io::Error::other("upstream ended early"));
        }
    }
    sock.flush().await
}
