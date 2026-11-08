package com.frf.music;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * One connection to a Google Cast device (Chromecast, Google TV, TVs with
 * Chromecast built in). Cast devices talk TLS on port 8009 with their own
 * self-signed certificate, so the certificate is not checked; the connection
 * stays on the local network. Each message is a length-prefixed protobuf
 * "CastMessage" whose payload is JSON. The web layer sends and reads the JSON;
 * this class only frames it and answers the keep-alive pings itself, so the
 * connection survives while the web layer is busy or asleep.
 */
final class CastSocket {
    static final String HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat";

    static final class Message {
        final String namespace, source, destination, data;

        Message(String namespace, String source, String destination, String data) {
            this.namespace = namespace;
            this.source = source;
            this.destination = destination;
            this.data = data;
        }
    }

    private final SSLSocket socket;
    private final OutputStream out;
    private final ConcurrentLinkedQueue<Message> inbox = new ConcurrentLinkedQueue<>();
    private final ScheduledExecutorService pinger = Executors.newSingleThreadScheduledExecutor();
    private volatile boolean closed;

    CastSocket(String host, int port) throws Exception {
        TrustManager[] trustAll = new TrustManager[] {new X509TrustManager() {
            public void checkClientTrusted(X509Certificate[] c, String a) {}
            public void checkServerTrusted(X509Certificate[] c, String a) {}
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        }};
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(null, trustAll, null);
        java.net.Socket raw = new java.net.Socket();
        raw.connect(new InetSocketAddress(host, port), 6000);
        socket = (SSLSocket) ctx.getSocketFactory().createSocket(raw, host, port, true);
        socket.startHandshake();
        out = socket.getOutputStream();
        Thread reader = new Thread(this::readLoop, "frf-cast-read");
        reader.setDaemon(true);
        reader.start();
        pinger.scheduleAtFixedRate(() -> {
            try {
                send(HEARTBEAT, "sender-0", "receiver-0", "{\"type\":\"PING\"}");
            } catch (Exception e) {
                close();
            }
        }, 5, 5, TimeUnit.SECONDS);
    }

    boolean isClosed() {
        return closed;
    }

    List<Message> drain() {
        List<Message> list = new ArrayList<>();
        Message m;
        while ((m = inbox.poll()) != null) list.add(m);
        return list;
    }

    synchronized void send(String namespace, String source, String destination, String data) throws IOException {
        if (closed) throw new IOException("closed");
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        writeVarintField(b, 1, 0); // protocol_version CASTV2_1_0
        writeStringField(b, 2, source);
        writeStringField(b, 3, destination);
        writeStringField(b, 4, namespace);
        writeVarintField(b, 5, 0); // payload_type STRING
        writeStringField(b, 6, data);
        byte[] body = b.toByteArray();
        int n = body.length;
        out.write(new byte[] {(byte) (n >>> 24), (byte) (n >>> 16), (byte) (n >>> 8), (byte) n});
        out.write(body);
        out.flush();
    }

    void close() {
        if (closed) return;
        closed = true;
        pinger.shutdownNow();
        try {
            socket.close();
        } catch (Exception ignored) {}
    }

    private void readLoop() {
        try {
            DataInputStream in = new DataInputStream(socket.getInputStream());
            while (!closed) {
                int len = in.readInt();
                if (len < 0 || len > 1 << 20) throw new IOException("bad length");
                byte[] buf = new byte[len];
                in.readFully(buf);
                Message m = decode(buf);
                if (m == null) continue;
                if (HEARTBEAT.equals(m.namespace)) {
                    if (m.data.contains("\"PING\"")) send(HEARTBEAT, m.destination, m.source, "{\"type\":\"PONG\"}");
                    continue;
                }
                inbox.add(m);
                // Nobody reads a stuck connection's backlog; keep it bounded.
                while (inbox.size() > 200) inbox.poll();
            }
        } catch (Exception ignored) {
        } finally {
            close();
        }
    }

    private static Message decode(byte[] b) {
        String ns = "", src = "", dst = "", data = "";
        int[] pos = {0};
        while (pos[0] < b.length) {
            long key = readVarint(b, pos);
            int field = (int) (key >>> 3);
            int wire = (int) (key & 7);
            if (wire == 0) {
                readVarint(b, pos);
            } else if (wire == 2) {
                int len = (int) readVarint(b, pos);
                if (len < 0 || pos[0] + len > b.length) return null;
                String s = new String(b, pos[0], len, StandardCharsets.UTF_8);
                pos[0] += len;
                if (field == 2) src = s;
                else if (field == 3) dst = s;
                else if (field == 4) ns = s;
                else if (field == 6) data = s;
            } else if (wire == 1) {
                pos[0] += 8;
            } else if (wire == 5) {
                pos[0] += 4;
            } else {
                return null;
            }
        }
        return new Message(ns, src, dst, data);
    }

    private static long readVarint(byte[] b, int[] pos) {
        long v = 0;
        int shift = 0;
        while (pos[0] < b.length) {
            int x = b[pos[0]++] & 0xff;
            v |= (long) (x & 0x7f) << shift;
            if ((x & 0x80) == 0) break;
            shift += 7;
        }
        return v;
    }

    private static void writeVarint(ByteArrayOutputStream b, long v) {
        while ((v & ~0x7fL) != 0) {
            b.write((int) ((v & 0x7f) | 0x80));
            v >>>= 7;
        }
        b.write((int) v);
    }

    private static void writeVarintField(ByteArrayOutputStream b, int field, long v) {
        writeVarint(b, ((long) field << 3));
        writeVarint(b, v);
    }

    private static void writeStringField(ByteArrayOutputStream b, int field, String s) {
        byte[] bytes = s.getBytes(StandardCharsets.UTF_8);
        writeVarint(b, ((long) field << 3) | 2);
        writeVarint(b, bytes.length);
        b.write(bytes, 0, bytes.length);
    }
}
