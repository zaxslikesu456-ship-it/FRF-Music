package com.frf.music;

import android.util.Log;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A small HTTP server on the Wi-Fi network that a TV (Chromecast or a DLNA
 * renderer) pulls the current song from. The TV cannot open the googlevideo
 * URL itself: that URL only works from the address that asked YouTube for it.
 * So the TV asks this phone, and the phone fetches the audio from googlevideo
 * in 1 MB pieces (one long download gets throttled) and passes it on.
 *
 * Each song gets a random path, so nothing else on the network can use the
 * server to reach arbitrary URLs or files.
 */
final class LanMediaServer {
    private static final String TAG = "LanMediaServer";
    private static final long CHUNK = 1024L * 1024L;
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36";

    private static final class Item {
        final String url;
        final String path;
        final String type;
        volatile long total = -1;
        volatile byte[] whole; // small files (covers) kept in memory

        Item(String url, String path, String type) {
            this.url = url;
            this.path = path;
            this.type = type;
        }
    }

    private static final Map<String, Item> entries = Collections.synchronizedMap(
            new LinkedHashMap<String, Item>(16, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Item> e) {
                    return size() > 40;
                }
            });
    private static final SecureRandom random = new SecureRandom();
    private static final ExecutorService pool = Executors.newCachedThreadPool();
    private static ServerSocket server;

    private LanMediaServer() {}

    /** This phone's address on the local network, or null when there is none. */
    static String lanAddress() {
        // Asks the system which interface reaches the internet; nothing is sent.
        try (DatagramSocket s = new DatagramSocket()) {
            s.connect(InetAddress.getByName("8.8.8.8"), 80);
            InetAddress a = s.getLocalAddress();
            if (a instanceof Inet4Address && a.isSiteLocalAddress()) return a.getHostAddress();
        } catch (Exception ignored) {}
        String fallback = null;
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    String name = ni.getName().toLowerCase(Locale.ROOT);
                    if (name.startsWith("wlan") || name.startsWith("eth")) return a.getHostAddress();
                    if (fallback == null) fallback = a.getHostAddress();
                }
            }
        } catch (Exception ignored) {}
        return fallback;
    }

    /** Makes a stream URL or a local file reachable for the TV; returns its address. */
    static synchronized String serve(String url, String path, String type) throws IOException {
        String host = lanAddress();
        if (host == null) throw new IOException("Not connected to Wi-Fi");
        start();
        byte[] b = new byte[12];
        random.nextBytes(b);
        StringBuilder token = new StringBuilder();
        for (byte x : b) token.append(String.format(Locale.ROOT, "%02x", x));
        Item e = new Item(url, path, type == null || type.isEmpty() ? "audio/mp4" : type);
        if (path != null && !path.isEmpty()) e.total = new File(path.replace("file://", "")).length();
        entries.put(token.toString(), e);
        String ext = e.type.contains("webm") ? ".webm" : e.type.contains("mpeg") ? ".mp3"
                : e.type.startsWith("image/") ? ".jpg" : ".m4a";
        return "http://" + host + ":" + server.getLocalPort() + "/m/" + token + ext;
    }

    private static void start() throws IOException {
        if (server != null && !server.isClosed()) return;
        server = new ServerSocket();
        server.setReuseAddress(true);
        server.bind(new InetSocketAddress(0));
        final ServerSocket s = server;
        Thread t = new Thread(() -> {
            while (!s.isClosed()) {
                try {
                    Socket c = s.accept();
                    pool.execute(() -> handle(c));
                } catch (IOException e) {
                    break;
                }
            }
        }, "frf-cast-server");
        t.setDaemon(true);
        t.start();
    }

    private static String readHead(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int prev3 = 0, prev2 = 0, prev1 = 0, c;
        while ((c = in.read()) != -1) {
            sb.append((char) c);
            if (prev3 == '\r' && prev2 == '\n' && prev1 == '\r' && c == '\n') break;
            prev3 = prev2;
            prev2 = prev1;
            prev1 = c;
            if (sb.length() > 16384) throw new IOException("header too long");
        }
        return sb.toString();
    }

    private static void handle(Socket c) {
        try (Socket sock = c) {
            sock.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();
            String head = readHead(in);
            String[] lines = head.split("\r\n");
            if (lines.length == 0) return;
            String[] req = lines[0].split(" ");
            if (req.length < 2) return;
            String method = req[0];
            String target = req[1];
            String range = null;
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon > 0 && lines[i].substring(0, colon).trim().equalsIgnoreCase("range")) {
                    range = lines[i].substring(colon + 1).trim();
                }
            }
            String token = target.startsWith("/m/") ? target.substring(3) : "";
            int dot = token.indexOf('.');
            if (dot >= 0) token = token.substring(0, dot);
            int q = token.indexOf('?');
            if (q >= 0) token = token.substring(0, q);
            Item e = entries.get(token);
            if (e == null) {
                writeStatus(out, "404 Not Found");
                return;
            }
            if (method.equals("OPTIONS")) {
                out.write(("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\n"
                        + "Access-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
                return;
            }
            boolean headOnly = method.equals("HEAD");
            if (!headOnly && !method.equals("GET")) {
                writeStatus(out, "405 Method Not Allowed");
                return;
            }
            if (e.type.startsWith("image/")) {
                serveWhole(e, out, headOnly);
                return;
            }
            long total = totalLength(e);
            if (total <= 0) {
                writeStatus(out, "502 Bad Gateway");
                return;
            }
            long start = 0, end = total - 1;
            boolean partial = false;
            if (range != null && range.startsWith("bytes=")) {
                String spec = range.substring(6).split(",")[0].trim();
                int dash = spec.indexOf('-');
                try {
                    if (dash == 0) {
                        long n = Long.parseLong(spec.substring(1));
                        start = Math.max(0, total - n);
                    } else if (dash > 0) {
                        start = Long.parseLong(spec.substring(0, dash));
                        String b = spec.substring(dash + 1);
                        if (!b.isEmpty()) end = Math.min(total - 1, Long.parseLong(b));
                    }
                    partial = true;
                } catch (NumberFormatException ignored) {}
                if (start >= total || start > end) {
                    out.write(("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + total
                            + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
                    return;
                }
            }
            StringBuilder h = new StringBuilder();
            h.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
            h.append("Content-Type: ").append(e.type).append("\r\n");
            h.append("Content-Length: ").append(end - start + 1).append("\r\n");
            if (partial) h.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(total).append("\r\n");
            h.append("Accept-Ranges: bytes\r\n");
            h.append("Access-Control-Allow-Origin: *\r\n");
            h.append("transferMode.dlna.org: Streaming\r\n");
            h.append("contentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\r\n");
            h.append("Connection: close\r\n\r\n");
            out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (headOnly) return;
            if (e.path != null && !e.path.isEmpty()) {
                copyFile(e.path, start, end, out);
            } else {
                copyUrl(e.url, start, end, out);
            }
            out.flush();
        } catch (IOException ignored) {
            // The TV closed the connection (seek, stop, or it has buffered enough).
        } catch (Exception ex) {
            Log.w(TAG, "request failed: " + ex);
        }
    }

    private static void writeStatus(OutputStream out, String status) throws IOException {
        out.write(("HTTP/1.1 " + status + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .getBytes(StandardCharsets.ISO_8859_1));
    }

    private static long totalLength(Item e) {
        if (e.total > 0) return e.total;
        // googlevideo URLs carry the size in the "clen" parameter.
        try {
            String clen = android.net.Uri.parse(e.url).getQueryParameter("clen");
            if (clen != null) {
                e.total = Long.parseLong(clen);
                return e.total;
            }
        } catch (Exception ignored) {}
        HttpURLConnection conn = null;
        try {
            conn = open(e.url, 0, 0);
            String cr = conn.getHeaderField("Content-Range");
            if (cr != null && cr.contains("/")) {
                e.total = Long.parseLong(cr.substring(cr.lastIndexOf('/') + 1).trim());
            } else if (conn.getResponseCode() == 200) {
                e.total = conn.getContentLengthLong();
            }
        } catch (Exception ex) {
            Log.w(TAG, "size probe failed: " + ex);
        } finally {
            if (conn != null) conn.disconnect();
        }
        return e.total;
    }

    private static HttpURLConnection open(String url, long from, long to) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent", UA);
        conn.setRequestProperty("Range", "bytes=" + from + "-" + to);
        return conn;
    }

    private static void copyUrl(String url, long start, long end, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        long pos = start;
        while (pos <= end) {
            long to = Math.min(end, pos + CHUNK - 1);
            HttpURLConnection conn = open(url, pos, to);
            try {
                int code = conn.getResponseCode();
                if (code != 206 && code != 200) throw new IOException("upstream " + code);
                try (InputStream in = conn.getInputStream()) {
                    if (code == 200 && pos > 0) {
                        // No range support: skip to where we are.
                        long skip = pos;
                        while (skip > 0) {
                            long s = in.skip(skip);
                            if (s <= 0) throw new IOException("short skip");
                            skip -= s;
                        }
                    }
                    long want = to - pos + 1;
                    int n;
                    while (want > 0 && (n = in.read(buf, 0, (int) Math.min(buf.length, want))) != -1) {
                        out.write(buf, 0, n);
                        want -= n;
                        pos += n;
                    }
                    if (want > 0) throw new IOException("upstream ended early");
                }
            } finally {
                conn.disconnect();
            }
        }
    }

    private static void copyFile(String path, long start, long end, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        try (FileInputStream in = new FileInputStream(path.replace("file://", ""))) {
            long skip = start;
            while (skip > 0) {
                long s = in.skip(skip);
                if (s <= 0) throw new IOException("short skip");
                skip -= s;
            }
            long want = end - start + 1;
            int n;
            while (want > 0 && (n = in.read(buf, 0, (int) Math.min(buf.length, want))) != -1) {
                out.write(buf, 0, n);
                want -= n;
            }
        }
    }

    private static void serveWhole(Item e, OutputStream out, boolean headOnly) throws IOException {
        byte[] data = e.whole;
        if (data == null) {
            HttpURLConnection conn = (HttpURLConnection) new URL(e.url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("User-Agent", UA);
            try (InputStream in = conn.getInputStream()) {
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) != -1) {
                    bo.write(buf, 0, n);
                    if (bo.size() > 8 * 1024 * 1024) throw new IOException("image too large");
                }
                data = bo.toByteArray();
                e.whole = data;
            } finally {
                conn.disconnect();
            }
        }
        out.write(("HTTP/1.1 200 OK\r\nContent-Type: " + e.type + "\r\nContent-Length: " + data.length
                + "\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
        if (!headOnly) out.write(data);
        out.flush();
    }
}
