// Plays online audio (YouTube's googlevideo streams, mirrors) through the app.
//
// The page can play a googlevideo URL directly, but the browser engine then hides
// the samples from Web Audio (the stream is from another site and googlevideo
// sends no CORS headers), so the equalizer, which runs in Web Audio, gets silence.
// Served from this app's own "frfaudio" scheme with CORS allowed, the same audio
// can go through the equalizer.
//
// The page asks for byte ranges as it plays; each one is fetched from googlevideo
// in a chunk of at most CHUNK bytes. Short range requests also avoid googlevideo's
// throttling of one long download.
use std::sync::OnceLock;
use tauri::http::{header, Request, Response, StatusCode};

const CHUNK: u64 = 1024 * 1024;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(UA)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("http client")
    })
}

fn reply(status: StatusCode, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap()
}

// The googlevideo URL travels percent-encoded in the "u" query parameter.
fn target_url(request: &Request<Vec<u8>>) -> Option<String> {
    let query = request.uri().query()?;
    for pair in query.split('&') {
        if let Some(value) = pair.strip_prefix("u=") {
            let decoded = percent_decode(value)?;
            let parsed = reqwest::Url::parse(&decoded).ok()?;
            let host = parsed.host_str()?.to_ascii_lowercase();
            // Public https audio only (googlevideo, or a mirror's stream); never
            // this machine or the local network.
            let local = host == "localhost"
                || host.ends_with(".localhost")
                || host.ends_with(".local")
                || host.parse::<std::net::IpAddr>().map_or(false, |ip| match ip {
                    std::net::IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local(),
                    std::net::IpAddr::V6(v6) => v6.is_loopback(),
                });
            if parsed.scheme() == "https" && !local {
                return Some(decoded);
            }
            return None;
        }
    }
    None
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

// "bytes=START-" or "bytes=START-END" -> (start, end) limited to one chunk.
fn wanted_range(request: &Request<Vec<u8>>) -> (u64, u64) {
    let mut start = 0u64;
    let mut end: Option<u64> = None;
    if let Some(value) = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()) {
        if let Some(spec) = value.trim().strip_prefix("bytes=") {
            let mut parts = spec.splitn(2, '-');
            start = parts.next().and_then(|p| p.trim().parse().ok()).unwrap_or(0);
            end = parts.next().and_then(|p| p.trim().parse().ok());
        }
    }
    let cap = start + CHUNK - 1;
    (start, end.map_or(cap, |e| e.min(cap)))
}

pub async fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == tauri::http::Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS")
            .body(Vec::new())
            .unwrap();
    }
    let Some(url) = target_url(&request) else {
        return reply(StatusCode::BAD_REQUEST, b"bad audio url".to_vec());
    };
    let (start, end) = wanted_range(&request);

    let upstream = match client()
        .get(&url)
        .header(header::RANGE.as_str(), format!("bytes={}-{}", start, end))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return reply(StatusCode::BAD_GATEWAY, e.to_string().into_bytes()),
    };

    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("audio/mp4")
        .to_string();
    let content_range = upstream
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let body = match upstream.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return reply(StatusCode::BAD_GATEWAY, e.to_string().into_bytes()),
    };
    if !status.is_success() {
        return reply(StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY), body);
    }

    let mut builder = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range, Content-Length, Accept-Ranges")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, body.len().to_string());
    if let Some(range) = content_range {
        builder = builder.status(StatusCode::PARTIAL_CONTENT).header(header::CONTENT_RANGE, range);
    } else {
        builder = builder.status(StatusCode::OK);
    }
    builder.body(body).unwrap()
}
