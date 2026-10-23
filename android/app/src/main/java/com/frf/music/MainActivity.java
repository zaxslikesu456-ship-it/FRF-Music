package com.frf.music;

import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.webkit.WebSettings;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        super.onCreate(savedInstanceState);

        // Pictures are served from a permanent disk cache (works offline).
        if (getBridge() != null) {
            getBridge().setWebViewClient(new CachingWebViewClient(getBridge(), this));
        }

        // Back minimizes instead of finishing, like other music apps, so music
        // keeps playing. Only closing the app from recents ends playback.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                moveTaskToBack(true);
            }
        });

        // Hold partial WakeLock so CPU doesn't sleep during streaming
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "aura:bg-audio");
                wakeLock.setReferenceCounted(false);
                if (!wakeLock.isHeld()) wakeLock.acquire();
            }
        } catch (Exception ignored) {}

        // Hold WifiLock so wifi doesn't disconnect during streaming
        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "aura:bg-wifi");
                wifiLock.setReferenceCounted(false);
                if (!wifiLock.isHeld()) wifiLock.acquire();
            }
        } catch (Exception ignored) {}



        // WebView config
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings s = getBridge().getWebView().getSettings();
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Hand playback to ExoPlayer before the page can be reported hidden.
        // The embedded YouTube player drops its audio the moment that happens,
        // so waiting until onStop() is too late on devices that hide early.
        if (PlaybackService.instance != null) {
            PlaybackService.instance.takeOver();
        }
        keepWebViewPlaying();
    }

    @Override
    public void onResume() {
        super.onResume();
        keepWebViewPlaying();
    }

    @Override
    public void onStop() {
        super.onStop();
        if (PlaybackService.instance != null) {
            PlaybackService.instance.takeOver();
        }
        keepWebViewPlaying();
    }

    // Keep the WebView's audio engine alive once the Activity leaves the
    // foreground. Capacitor's bridge.onPause()/onStop() pause the WebView and
    // its JS timers; undo that here so the engine keeps running. Page
    // visibility itself is pinned VISIBLE by PlaybackCapacitorWebView, which is
    // what stops the embedded YouTube player from pausing on backgrounding.
    // (Native ExoPlayer can't be the fallback here: Google answers its direct
    // googlevideo fetches with HTTP 403, so the handover would be silent.)
    private void keepWebViewPlaying() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        final android.webkit.WebView webView = getBridge().getWebView();
        try {
            webView.onResume();
            webView.resumeTimers();
        } catch (Exception ignored) {}
        webView.post(() -> {
            try {
                webView.onResume();
                webView.resumeTimers();
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onDestroy() {
        // Closing the app (swiping it away) must end playback. The web layer is
        // kept alive on purpose while the app is merely in the background, so
        // without this the music kept going with no app window.
        final boolean closing = isFinishing();
        if (closing && PlaybackService.instance != null) {
            PlaybackService.instance.shutdownNow();
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            try { wifiLock.release(); } catch (Exception ignored) {}
        }
        super.onDestroy();
        if (closing) {
            // Take the web layer down with it so nothing keeps playing.
            android.os.Process.killProcess(android.os.Process.myPid());
        }
    }
}
