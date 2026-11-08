package com.frf.music;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.SocketTimeoutException;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Network pieces for casting to a TV. The cast protocols themselves (Google
 * Cast's JSON messages, DLNA's SOAP requests) live in the web layer
 * (src/utils/cast/); this plugin gives it what a web page cannot do: find
 * devices with multicast, hold the TLS connection to a Cast device, and serve
 * the song to the TV from this phone.
 */
@CapacitorPlugin(name = "FrfCast")
public class CastPlugin extends Plugin {
    private final ExecutorService worker = Executors.newCachedThreadPool();
    private final Map<Integer, CastSocket> sockets = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);

    @PluginMethod
    public void lanInfo(PluginCall call) {
        worker.execute(() -> {
            JSObject r = new JSObject();
            r.put("address", LanMediaServer.lanAddress());
            call.resolve(r);
        });
    }

    /**
     * Sends one UDP datagram (an SSDP or mDNS query) and collects the answers
     * for waitMs. With listenMulticast the answers sent to the multicast group
     * are heard too (mDNS responders often answer that way).
     */
    @PluginMethod
    public void udpQuery(PluginCall call) {
        final String host = call.getString("host", "239.255.255.250");
        final int port = call.getInt("port", 1900);
        final String data = call.getString("data", "");
        final int waitMs = Math.max(300, Math.min(10000, call.getInt("waitMs", 2500)));
        final boolean listen = Boolean.TRUE.equals(call.getBoolean("listenMulticast", false));
        worker.execute(() -> {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock lock = null;
            DatagramSocket a = null;
            MulticastSocket b = null;
            JSArray replies = new JSArray();
            try {
                if (wifi != null) {
                    lock = wifi.createMulticastLock("frf-cast");
                    lock.setReferenceCounted(false);
                    lock.acquire();
                }
                InetAddress group = InetAddress.getByName(host);
                byte[] payload = Base64.decode(data, Base64.DEFAULT);
                a = new DatagramSocket();
                a.setSoTimeout(100);
                if (listen) {
                    try {
                        b = new MulticastSocket(null);
                        b.setReuseAddress(true);
                        b.bind(new InetSocketAddress(port));
                        b.joinGroup(group);
                        b.setSoTimeout(100);
                    } catch (Exception e) {
                        if (b != null) b.close();
                        b = null;
                    }
                }
                DatagramPacket out = new DatagramPacket(payload, payload.length, group, port);
                a.send(out);
                if (b != null) b.send(out);
                long deadline = System.currentTimeMillis() + waitMs;
                long resendAt = System.currentTimeMillis() + 700;
                byte[] buf = new byte[9000];
                Set<String> seen = new HashSet<>();
                while (System.currentTimeMillis() < deadline) {
                    if (resendAt > 0 && System.currentTimeMillis() >= resendAt) {
                        // UDP gets lost on busy Wi-Fi; ask once more.
                        a.send(out);
                        resendAt = 0;
                    }
                    for (DatagramSocket s : new DatagramSocket[] {a, b}) {
                        if (s == null) continue;
                        DatagramPacket p = new DatagramPacket(buf, buf.length);
                        try {
                            s.receive(p);
                        } catch (SocketTimeoutException e) {
                            continue;
                        }
                        String b64 = Base64.encodeToString(p.getData(), p.getOffset(), p.getLength(), Base64.NO_WRAP);
                        String addr = p.getAddress().getHostAddress();
                        if (!seen.add(addr + "|" + b64)) continue;
                        JSObject r = new JSObject();
                        r.put("address", addr);
                        r.put("data", b64);
                        replies.put(r);
                    }
                }
                JSObject res = new JSObject();
                res.put("replies", replies);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Discovery failed: " + e.getMessage());
            } finally {
                if (a != null) a.close();
                if (b != null) b.close();
                if (lock != null) {
                    try {
                        lock.release();
                    } catch (Exception ignored) {}
                }
            }
        });
    }

    @PluginMethod
    public void castOpen(PluginCall call) {
        final String host = call.getString("host", "");
        final int port = call.getInt("port", 8009);
        worker.execute(() -> {
            try {
                CastSocket s = new CastSocket(host, port);
                int id = nextId.getAndIncrement();
                sockets.put(id, s);
                JSObject r = new JSObject();
                r.put("id", id);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not connect to the TV: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void castSend(PluginCall call) {
        final CastSocket s = sockets.get(call.getInt("id", -1));
        if (s == null || s.isClosed()) {
            call.reject("closed");
            return;
        }
        final String ns = call.getString("namespace", "");
        final String src = call.getString("source", "sender-0");
        final String dst = call.getString("destination", "receiver-0");
        final String data = call.getString("data", "{}");
        worker.execute(() -> {
            try {
                s.send(ns, src, dst, data);
                call.resolve();
            } catch (Exception e) {
                call.reject("send failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void castRecv(PluginCall call) {
        CastSocket s = sockets.get(call.getInt("id", -1));
        JSObject r = new JSObject();
        JSArray list = new JSArray();
        if (s != null) {
            for (CastSocket.Message m : s.drain()) {
                JSObject o = new JSObject();
                o.put("namespace", m.namespace);
                o.put("source", m.source);
                o.put("destination", m.destination);
                o.put("data", m.data);
                list.put(o);
            }
        }
        r.put("messages", list);
        r.put("closed", s == null || s.isClosed());
        call.resolve(r);
    }

    @PluginMethod
    public void castClose(PluginCall call) {
        CastSocket s = sockets.remove(call.getInt("id", -1));
        if (s != null) worker.execute(s::close);
        call.resolve();
    }

    /** Makes a stream URL, a local file or a cover reachable for the TV. */
    @PluginMethod
    public void mediaServe(PluginCall call) {
        final String url = call.getString("url", "");
        final String path = call.getString("path", "");
        final String type = call.getString("contentType", "audio/mp4");
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("url", LanMediaServer.serve(url, path, type));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Could not share the song with the TV");
            }
        });
    }
}
