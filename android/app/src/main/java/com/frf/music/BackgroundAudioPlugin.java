package com.frf.music;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.chromium.net.CronetEngine;
import org.chromium.net.CronetException;
import org.chromium.net.UrlRequest;
import org.chromium.net.UrlResponseInfo;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
        name = "BackgroundAudio",
        permissions = {
            @Permission(alias = "audioMedia", strings = {"android.permission.READ_MEDIA_AUDIO"}),
            @Permission(alias = "audioStorage", strings = {"android.permission.READ_EXTERNAL_STORAGE"})
        })
public class BackgroundAudioPlugin extends Plugin {

    public static volatile BackgroundAudioPlugin instance;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private OutputDevices outputDevices;

    @Override
    public void load() {
        super.load();
        instance = this;
        PlaybackService.bridgeRef = getBridge();
        try {
            outputDevices = new OutputDevices(getContext());
            outputDevices.listen(() -> notifyListeners("outputDeviceChanged", outputDevices.current()));
        } catch (Throwable ignored) {
            outputDevices = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (outputDevices != null) outputDevices.stop();
        super.handleOnDestroy();
    }

    // Where the sound goes now: a Bluetooth headset (by name), wired, USB or the speaker.
    @PluginMethod
    public void getOutputDevice(PluginCall call) {
        if (outputDevices == null) {
            call.reject("unavailable");
            return;
        }
        call.resolve(outputDevices.current());
    }

    public static void sendEvent(String eventName, JSObject data) {
        BackgroundAudioPlugin plugin = instance;
        if (plugin != null) {
            try {
                plugin.notifyListeners(eventName, data != null ? data : new JSObject());
            } catch (Exception ignored) {}
        }
    }

    @PluginMethod
    public void playUrl(PluginCall call) {
        PlaybackService.bridgeRef = getBridge();
        Intent intent = new Intent(getContext(), PlaybackService.class);
        intent.setAction(PlaybackService.ACTION_PLAY_URL);

        String url = call.getString("url", "");
        String filePath = call.getString("filePath", "");
        // A new track replaces BOTH source slots. Otherwise a previous local
        // file wins over the new stream in PlaybackService.currentSource().
        intent.putExtra(PlaybackService.EXTRA_STREAM_URL, url);
        intent.putExtra(PlaybackService.EXTRA_FILE_PATH, filePath);

        intent.putExtra(PlaybackService.EXTRA_TITLE, call.getString("title", "FRF Music"));
        intent.putExtra(PlaybackService.EXTRA_ARTIST, call.getString("artist", ""));
        intent.putExtra(PlaybackService.EXTRA_PLAYING, true);

        String cover = call.getString("coverUrl");
        if (cover != null) intent.putExtra(PlaybackService.EXTRA_COVER, cover);

        Float startTime = call.getFloat("startTime", 0f);
        intent.putExtra(PlaybackService.EXTRA_POSITION, startTime != null ? startTime : 0f);

        Float duration = call.getFloat("duration", 0f);
        if (duration != null) intent.putExtra(PlaybackService.EXTRA_DURATION, duration);

        Float gainDb = call.getFloat("gainDb", 0f);
        intent.putExtra(PlaybackService.EXTRA_GAIN_DB, gainDb != null ? gainDb : 0f);

        launchService(intent, call);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        Intent intent = new Intent(getContext(), PlaybackService.class);
        intent.setAction(PlaybackService.ACTION_PAUSE);
        launchService(intent, call);
    }

    @PluginMethod
    public void resume(PluginCall call) {
        Intent intent = new Intent(getContext(), PlaybackService.class);
        intent.setAction(PlaybackService.ACTION_RESUME);
        launchService(intent, call);
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Float position = call.getFloat("position", 0f);
        Intent intent = new Intent(getContext(), PlaybackService.class);
        intent.setAction(PlaybackService.ACTION_SEEK);
        intent.putExtra(PlaybackService.EXTRA_POSITION, position != null ? position : 0f);
        launchService(intent, call);
    }

    @PluginMethod
    public void start(PluginCall call) {
        PlaybackService.bridgeRef = getBridge();
        Intent intent = createIntentWithExtras(call, PlaybackService.ACTION_UPDATE);
        launchService(intent, call);
    }

    @PluginMethod
    public void update(PluginCall call) {
        PlaybackService.bridgeRef = getBridge();
        Intent intent = createIntentWithExtras(call, PlaybackService.ACTION_UPDATE);
        launchService(intent, call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), PlaybackService.class);
        intent.setAction(PlaybackService.ACTION_STOP);
        launchService(intent, call);
    }

    @PluginMethod
    public void takeOver(PluginCall call) {
        PlaybackService.bridgeRef = getBridge();
        Intent intent = createIntentWithExtras(call, PlaybackService.ACTION_TAKE_OVER);
        launchService(intent, call);
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Float level = call.getFloat("volume", 1f);
        PlaybackService svc = PlaybackService.instance;
        if (svc != null) svc.setVolumeLevel(level != null ? level : 1f);
        call.resolve();
    }

    @PluginMethod
    public void setSpeed(PluginCall call) {
        Float rate = call.getFloat("speed", 1f);
        PlaybackService svc = PlaybackService.instance;
        if (svc != null) svc.setSpeed(rate != null ? rate : 1f);
        call.resolve();
    }

    @PluginMethod
    public void setEqualizer(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        int bassBoostLevel = call.getInt("bassBoost", 0) != null ? call.getInt("bassBoost", 0) : 0;
        int surroundLevel = call.getInt("surround", 0) != null ? call.getInt("surround", 0) : 0;

        int[] bands = new int[] {0, 0, 0, 0, 0};
        try {
            com.getcapacitor.JSArray arr = call.getArray("bands");
            if (arr != null) {
                for (int i = 0; i < bands.length && i < arr.length(); i++) {
                    Integer v = arr.getInt(i);
                    bands[i] = v != null ? v : 0;
                }
            }
        } catch (Exception ignored) {}

        // Stored globally, so it applies even before the player exists and to every
        // player created later.
        AudioEffects.get().set(enabled, bands, bassBoostLevel, surroundLevel);
        call.resolve();
    }

    @PluginMethod
    public void setVisualizerEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        AudioEffects.get().setVisualizerEnabled(enabled);
        call.resolve();
    }

    @PluginMethod
    public void setWebAudible(PluginCall call) {
        boolean audible = Boolean.TRUE.equals(call.getBoolean("audible", false));
        PlaybackService svc = PlaybackService.instance;
        if (svc != null) svc.setWebAudible(audible);
        call.resolve();
    }

    @PluginMethod
    public void handoverNow(PluginCall call) {
        PlaybackService.bridgeRef = getBridge();
        PlaybackService svc = PlaybackService.instance;
        if (svc != null) {
            svc.handoverNow(
                    call.getString("title", "FRF Music"),
                    call.getString("artist", ""),
                    call.getString("coverUrl", ""),
                    call.getString("streamUrl", ""),
                    call.getString("filePath", ""),
                    call.getFloat("position", 0f),
                    call.getFloat("duration", 0f));
            call.resolve();
        } else {
            // Service died with the process or was never started: deliver an
            // intent so onStartCommand rebuilds state from the same extras.
            Intent intent = createIntentWithExtras(call, PlaybackService.ACTION_TAKE_OVER);
            launchService(intent, call);
        }
    }

    @PluginMethod
    public void getPlaybackStatus(PluginCall call) {
        mainHandler.post(() -> {
            PlaybackService svc = PlaybackService.instance;
            if (svc != null) {
                call.resolve(svc.getPlaybackStatus());
                return;
            }
            JSObject result = new JSObject();
            result.put("serviceRunning", false);
            result.put("state", "idle");
            result.put("currentPosition", 0);
            result.put("duration", 0);
            result.put("hasSource", false);
            result.put("lastError", "");
            call.resolve(result);
        });
    }

    @PluginMethod
    public void probeStreamUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            int status = -1;
            String contentType = "";
            // null = never determined (transport failure): the caller must fail
            // open. TRUE/FALSE are verdicts based on real response bytes.
            Boolean media = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod("GET");
                // The player's real request is an open-ended range. googlevideo
                // answers tiny probes (bytes=0-0) without a poToken but 403s
                // this exact shape, so validate with what playback will send.
                conn.setRequestProperty("Range", "bytes=0-");
                conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36");
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                status = conn.getResponseCode();
                if (conn.getContentType() != null) contentType = conn.getContentType();
                if (status >= 200 && status < 300) {
                    // Drain a few bytes so the response actually arrives, then
                    // bail — the probe must not download the media. Those bytes
                    // are also the only reliable proof that this is audio:
                    // proxies and anti-bot gates (Anubis, Cloudflare) answer
                    // HTTP 200 with an HTML challenge page, which passes a
                    // status-only check and then dies inside ExoPlayer as
                    // UnrecognizedInputFormatException — silence in the
                    // background, where no WebView engine can take over.
                    InputStream in = conn.getInputStream();
                    if (in != null) {
                        byte[] head = new byte[2048];
                        int read = in.read(head);
                        in.close();
                        media = looksLikeMedia(contentType, head, Math.max(0, read));
                    }
                }
            } catch (Exception e) {
                // status stays -1: transport trouble must fail open, only a
                // definitive HTTP status may reject the URL.
            } finally {
                if (conn != null) conn.disconnect();
            }
            JSObject ret = new JSObject();
            ret.put("status", status);
            ret.put("contentType", contentType);
            if (media != null) ret.put("media", media.booleanValue());
            call.resolve(ret);
        }, "frf-stream-probe").start();
    }

    // A media response either declares an audio/video content type or starts
    // with a recognizable container signature. Anything that announces itself
    // as HTML/JSON, or whose first bytes are markup, is a gate or an error
    // page — never a stream ExoPlayer can decode.
    static boolean looksLikeMedia(String contentType, byte[] head, int len) {
        String type = contentType != null ? contentType.toLowerCase() : "";
        if (type.startsWith("audio/") || type.startsWith("video/")) return true;
        if (type.contains("mpegurl") || type.contains("dash+xml")) return true;
        if (type.contains("html") || type.contains("json") || type.startsWith("text/")) return false;
        if (len <= 0) return false;

        // Container magic: MP4/M4A ("ftyp" at offset 4), Ogg/Opus, WebM/Matroska,
        // MP3 (ID3 tag or a frame sync), ADTS AAC.
        if (len >= 8 && head[4] == 'f' && head[5] == 't' && head[6] == 'y' && head[7] == 'p') return true;
        if (len >= 4 && head[0] == 'O' && head[1] == 'g' && head[2] == 'g' && head[3] == 'S') return true;
        if (len >= 4 && (head[0] & 0xFF) == 0x1A && (head[1] & 0xFF) == 0x45
                && (head[2] & 0xFF) == 0xDF && (head[3] & 0xFF) == 0xA3) return true;
        if (len >= 3 && head[0] == 'I' && head[1] == 'D' && head[2] == '3') return true;
        if (len >= 2 && (head[0] & 0xFF) == 0xFF && (head[1] & 0xE0) == 0xE0) return true;

        // Unlabelled binary (application/octet-stream from a proxy) is accepted
        // only when it is not obviously text: a challenge page always is.
        String start = new String(head, 0, Math.min(len, 64)).trim().toLowerCase();
        return !(start.startsWith("<") || start.startsWith("{") || start.startsWith("error"));
    }

    // Download a resolved stream URL to the app's private files dir using
    // Cronet (Chromium's network stack). googlevideo serves a 403 to the Java
    // HTTP stack (OkHttp / HttpURLConnection) that CapacitorHttp's patched
    // fetch() runs on, but trusts Chromium's TLS fingerprint — so this succeeds
    // where a JS fetch would fail. Returns the absolute file path + byte size.
    @PluginMethod
    public void downloadUrl(PluginCall call) {
        String url = call.getString("url", "");
        String fileName = call.getString("fileName", "download.m4a");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        String safeName = (fileName == null ? "download.m4a" : fileName).replaceAll("[^A-Za-z0-9._-]", "_");
        File dir = new File(getContext().getFilesDir(), "offline");
        if (!dir.exists() && !dir.mkdirs()) {
            call.reject("Could not create offline directory");
            return;
        }
        final File out = new File(dir, safeName);

        new Thread(() -> {
            CronetEngine engine = null;
            ExecutorService executor = Executors.newSingleThreadExecutor();
            final AtomicLong written = new AtomicLong();
            BufferedOutputStream bos = null;
            Exception err = null;
            try {
                engine = new CronetEngine.Builder(getContext())
                        .enableHttp2(true)
                        .enableQuic(true)
                        .enableBrotli(true)
                        .build();
                bos = new BufferedOutputStream(new FileOutputStream(out));

                // googlevideo answers any unbounded GET with HTTP 403 (even with a
                // valid pot / matching UA), but serves the same URL when the byte
                // window is given as a `range=start-end` query parameter. yt-dlp
                // downloads the same way, so fetch googlevideo in fixed chunks.
                if (url.contains("googlevideo.com")) {
                    long clen = -1;
                    java.util.regex.Matcher cm = java.util.regex.Pattern.compile("[?&]clen=(\\d+)").matcher(url);
                    if (cm.find()) clen = Long.parseLong(cm.group(1));
                    final long chunk = 1024L * 1024L; // 1 MiB
                    long start = 0;
                    while (err == null) {
                        long end = start + chunk - 1;
                        if (clen > 0) end = Math.min(end, clen - 1);
                        long before = written.get();
                        String chunkUrl = url + (url.contains("?") ? "&" : "?") + "range=" + start + "-" + end;
                        err = fetchToSink(engine, executor, chunkUrl, bos, written);
                        if (err != null) break;
                        long got = written.get() - before;
                        start += got;
                        if (got == 0) break;
                        if (clen > 0 ? start >= clen : got < chunk) break;
                    }
                } else {
                    err = fetchToSink(engine, executor, url, bos, written);
                }
            } catch (Exception e) {
                err = e;
            } finally {
                if (engine != null) {
                    try { engine.shutdown(); } catch (Exception ignored) {}
                }
                executor.shutdown();
                if (bos != null) {
                    try { bos.close(); } catch (Exception ignored) {}
                }
            }

            if (err != null) {
                if (out.exists()) out.delete();
                call.reject("Download failed: " + err.getMessage());
                return;
            }
            // A real track is megabytes; anything this small is an error page or
            // a truncated stream, not playable audio.
            if (written.get() < 20000) {
                if (out.exists()) out.delete();
                call.reject("Download too small to be audio (" + written.get() + " bytes)");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("path", out.getAbsolutePath());
            ret.put("size", written.get());
            call.resolve(ret);
        }, "frf-cronet-download").start();
    }

    // One Cronet GET streamed into `sink`; blocks until it finishes. Returns null
    // on success or the failure. Does not close the sink so several requests can
    // append to the same file.
    private Exception fetchToSink(CronetEngine engine, ExecutorService executor, String reqUrl,
                                  BufferedOutputStream sink, AtomicLong written) {
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<Exception> error = new AtomicReference<>();
        UrlRequest req = engine.newUrlRequestBuilder(
                reqUrl,
                new UrlRequest.Callback() {
                    @Override
                    public void onRedirectReceived(UrlRequest request, UrlResponseInfo info, String newLocationUrl) {
                        request.followRedirect();
                    }

                    @Override
                    public void onResponseStarted(UrlRequest request, UrlResponseInfo info) {
                        int code = info.getHttpStatusCode();
                        if (code < 200 || code >= 300) {
                            android.util.Log.w("FRFDL", "HTTP " + code + " for " + reqUrl.replaceAll("(signature|sig|lsig|pot)=[^&]+", "$1=…"));
                            error.set(new IOException("HTTP " + code));
                            request.cancel();
                            return;
                        }
                        // A proxy that is rate-limited or behind a bot check answers
                        // 200 with an HTML/JSON challenge page. Saving that as a
                        // ".m4a" produces a corrupt offline file, so reject anything
                        // that is not audio/video and let the caller try the next source.
                        String mime = null;
                        try {
                            for (java.util.Map.Entry<String, java.util.List<String>> h : info.getAllHeaders().entrySet()) {
                                if ("content-type".equalsIgnoreCase(h.getKey()) && h.getValue() != null && !h.getValue().isEmpty()) {
                                    mime = h.getValue().get(0);
                                    break;
                                }
                            }
                        } catch (Exception ignored) {}
                        if (mime != null) {
                            String m = mime.toLowerCase();
                            if (m.contains("html") || m.contains("json") || m.startsWith("text/")) {
                                error.set(new IOException("Not audio (" + m + ")"));
                                request.cancel();
                                return;
                            }
                        }
                        request.read(ByteBuffer.allocateDirect(64 * 1024));
                    }

                    @Override
                    public void onReadCompleted(UrlRequest request, UrlResponseInfo info, ByteBuffer buffer) {
                        try {
                            buffer.flip();
                            byte[] chunk = new byte[buffer.remaining()];
                            buffer.get(chunk);
                            sink.write(chunk);
                            written.addAndGet(chunk.length);
                            request.read(ByteBuffer.allocateDirect(64 * 1024));
                        } catch (Exception e) {
                            error.set(e);
                            request.cancel();
                        }
                    }

                    @Override
                    public void onSucceeded(UrlRequest request, UrlResponseInfo info) {
                        latch.countDown();
                    }

                    @Override
                    public void onFailed(UrlRequest request, UrlResponseInfo info, CronetException exc) {
                        error.set(exc);
                        latch.countDown();
                    }

                    @Override
                    public void onCanceled(UrlRequest request, UrlResponseInfo info) {
                        latch.countDown();
                    }
                },
                executor)
            .addHeader("User-Agent",
                    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36")
            .build();
        req.start();
        try {
            if (!latch.await(180, TimeUnit.SECONDS)) {
                req.cancel();
                error.compareAndSet(null, new IOException("Download timed out"));
            }
        } catch (InterruptedException e) {
            req.cancel();
            error.compareAndSet(null, e);
        }
        return error.get();
    }

    // Delete a previously downloaded offline file. Only touches paths inside
    // the app's private offline directory, so a bad path from JS can't delete
    // anything else.
    // Queue the song to play after the current one; the player rolls into it by itself.
    @PluginMethod
    public void setNext(PluginCall call) {
        PlaybackService svc = PlaybackService.instance;
        if (svc != null) {
            Float dur = call.getFloat("duration", 0f);
            Float gainDb = call.getFloat("gainDb", 0f);
            svc.setNextItem(
                    call.getString("trackId", ""),
                    call.getString("url", ""),
                    call.getString("filePath", ""),
                    call.getString("title", ""),
                    call.getString("artist", ""),
                    call.getString("coverUrl", ""),
                    dur != null ? dur : 0f,
                    gainDb != null ? gainDb : 0f);
        }
        call.resolve();
    }

    // Crossfade length in seconds between songs (0 = off).
    @PluginMethod
    public void setCrossfade(PluginCall call) {
        Double secs = call.getDouble("seconds", 0d);
        double v = secs != null ? secs : 0d;
        PlaybackService.crossfadeMs = (int) Math.round(Math.max(0d, Math.min(12d, v)) * 1000d);
        call.resolve();
    }

    // Volume normalization for the song playing now (dB, 0 or lower).
    @PluginMethod
    public void setNormGain(PluginCall call) {
        Float db = call.getFloat("gainDb", 0f);
        PlaybackService svc = PlaybackService.instance;
        if (svc != null) svc.setNormGainDb(db != null ? db : 0f);
        call.resolve();
    }

    @PluginMethod
    public void clearNext(PluginCall call) {
        PlaybackService svc = PlaybackService.instance;
        if (svc != null) svc.clearNextItem();
        call.resolve();
    }

    // Is the phone online, on Wi-Fi/ethernet, and is the connection metered (mobile data)?
    @PluginMethod
    public void networkStatus(PluginCall call) {
        boolean connected = false;
        boolean unmetered = false;
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager)
                    getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            android.net.Network net = cm.getActiveNetwork();
            android.net.NetworkCapabilities caps = net == null ? null : cm.getNetworkCapabilities(net);
            connected = caps != null
                    && caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET);
            unmetered = connected && !cm.isActiveNetworkMetered();
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("connected", connected);
        ret.put("unmetered", unmetered);
        call.resolve(ret);
    }

    // ---- Music folder copy (downloads that survive an uninstall) ----

    private String musicPermissionAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "audioMedia" : "audioStorage";
    }

    private boolean hasMusicPermission() {
        String perm = Build.VERSION.SDK_INT >= 33
                ? "android.permission.READ_MEDIA_AUDIO"
                : "android.permission.READ_EXTERNAL_STORAGE";
        return ContextCompat.checkSelfPermission(getContext(), perm)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void musicBackupInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", MusicBackup.supported());
        ret.put("granted", hasMusicPermission());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestMusicPermission(PluginCall call) {
        if (hasMusicPermission()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias(musicPermissionAlias(), call, "musicPermissionDone");
    }

    @PermissionCallback
    private void musicPermissionDone(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState(musicPermissionAlias()) == PermissionState.GRANTED);
        call.resolve(ret);
    }

    // Only files inside the app's own offline folder may be exported.
    private File offlineFile(String path) {
        if (path == null || path.isEmpty()) return null;
        try {
            File dir = new File(getContext().getFilesDir(), "offline").getCanonicalFile();
            File f = new File(path).getCanonicalFile();
            return f.getPath().startsWith(dir.getPath() + File.separator) && f.exists() ? f : null;
        } catch (Exception e) {
            return null;
        }
    }

    @PluginMethod
    public void exportToMusic(PluginCall call) {
        final File src = offlineFile(call.getString("path", ""));
        final String title = call.getString("title", "Song");
        final String artist = call.getString("artist", "");
        final String youtubeId = call.getString("youtubeId", "");
        if (src == null || youtubeId == null || youtubeId.isEmpty() || !MusicBackup.supported()) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        new Thread(() -> {
            String name = src.getName();
            int dot = name.lastIndexOf('.');
            String ext = dot >= 0 ? name.substring(dot + 1) : "m4a";
            boolean ok = MusicBackup.export(getContext(), src, title, artist, youtubeId, ext);
            JSObject ret = new JSObject();
            ret.put("ok", ok);
            call.resolve(ret);
        }, "frf-music-export").start();
    }

    @PluginMethod
    public void deleteMusicCopy(PluginCall call) {
        final String youtubeId = call.getString("youtubeId", "");
        new Thread(() -> {
            boolean deleted = youtubeId != null && !youtubeId.isEmpty()
                    && MusicBackup.delete(getContext(), youtubeId);
            JSObject ret = new JSObject();
            ret.put("deleted", deleted);
            call.resolve(ret);
        }, "frf-music-delete").start();
    }

    @PluginMethod
    public void listMusicBackups(PluginCall call) {
        new Thread(() -> {
            JSArray items = new JSArray();
            for (MusicBackup.Item it : MusicBackup.list(getContext())) {
                JSObject o = new JSObject();
                o.put("uri", it.uri);
                o.put("name", it.name);
                o.put("title", it.title);
                o.put("artist", it.artist);
                o.put("duration", it.durationMs / 1000);
                o.put("size", it.size);
                o.put("youtubeId", it.youtubeId);
                items.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("items", items);
            call.resolve(ret);
        }, "frf-music-list").start();
    }

    @PluginMethod
    public void restoreFromMusic(PluginCall call) {
        final String uri = call.getString("uri", "");
        final String fileName = call.getString("fileName", "");
        if (uri == null || uri.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("uri and fileName are required");
            return;
        }
        new Thread(() -> {
            File dir = new File(getContext().getFilesDir(), "offline");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("Could not create offline directory");
                return;
            }
            File dest = new File(dir, fileName.replaceAll("[^A-Za-z0-9._-]", "_"));
            if (MusicBackup.restore(getContext(), Uri.parse(uri), dest)) {
                JSObject ret = new JSObject();
                ret.put("path", dest.getAbsolutePath());
                ret.put("size", dest.length());
                call.resolve(ret);
            } else {
                call.reject("Could not read the file from the Music folder");
            }
        }, "frf-music-restore").start();
    }

    // Save a song's cover art on disk so the notification can show it offline.
    @PluginMethod
    public void cacheCover(PluginCall call) {
        final String url = call.getString("url", "");
        new Thread(() -> {
            boolean ok = CoverCache.ensure(getContext(), url);
            JSObject ret = new JSObject();
            ret.put("cached", ok);
            call.resolve(ret);
        }, "frf-cover-cache").start();
    }

    @PluginMethod
    public void deleteOfflineFile(PluginCall call) {
        String path = call.getString("path", "");
        if (path == null || path.isEmpty()) {
            call.resolve();
            return;
        }
        File offlineDir = new File(getContext().getFilesDir(), "offline").getAbsoluteFile();
        File target = new File(path).getAbsoluteFile();
        try {
            if (target.getPath().startsWith(offlineDir.getPath()) && target.exists()) {
                target.delete();
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void mintPoToken(PluginCall call) {
        String videoId = call.getString("videoId", "");
        if (videoId == null || videoId.isEmpty()) {
            call.reject("videoId is required");
            return;
        }
        NativePoTokenMinter.get().mint(getContext().getApplicationContext(), videoId, json -> {
            if (json != null) {
                try {
                    call.resolve(JSObject.fromJSONObject(new org.json.JSONObject(json)));
                    return;
                } catch (Exception ignored) {}
            }
            JSObject ret = new JSObject();
            ret.put("ok", false);
            call.resolve(ret);
        });
    }

    private Intent createIntentWithExtras(PluginCall call, String action) {
        Intent intent = new Intent(getContext(), PlaybackService.class);
        intent.setAction(action);
        intent.putExtra(PlaybackService.EXTRA_TITLE, call.getString("title", "FRF Music"));
        intent.putExtra(PlaybackService.EXTRA_ARTIST, call.getString("artist", ""));
        intent.putExtra(PlaybackService.EXTRA_PLAYING, call.getBoolean("isPlaying", true));

        String cover = call.getString("coverUrl");
        if (cover != null) intent.putExtra(PlaybackService.EXTRA_COVER, cover);
        String stream = call.getString("streamUrl");
        if (stream != null) intent.putExtra(PlaybackService.EXTRA_STREAM_URL, stream);
        String file = call.getString("filePath");
        if (file != null) intent.putExtra(PlaybackService.EXTRA_FILE_PATH, file);
        Float position = call.getFloat("position");
        if (position != null) intent.putExtra(PlaybackService.EXTRA_POSITION, position);
        Float duration = call.getFloat("duration");
        if (duration != null) intent.putExtra(PlaybackService.EXTRA_DURATION, duration);

        return intent;
    }

    private void launchService(Intent intent, PluginCall call) {
        try {
            if (PlaybackService.instance != null) {
                // Already running in the foreground. Delivering a new intent to a
                // live foreground service is allowed from the background; calling
                // startForegroundService() there throws on Android 12+ and, because
                // the old code swallowed the exception, every metadata refresh
                // after the app was backgrounded was silently lost.
                getContext().startService(intent);
                call.resolve();
                return;
            }
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            try {
                getContext().startService(intent);
                call.resolve();
            } catch (Exception fallbackError) {
                call.reject("Android could not start the audio service ("
                        + fallbackError.getClass().getSimpleName() + ")",
                        "AUDIO_SERVICE_START_FAILED");
            }
        }
    }
}
