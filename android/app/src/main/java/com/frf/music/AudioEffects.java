package com.frf.music;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import com.getcapacitor.JSObject;

/**
 * Equalizer settings and the spectrum visualizer for native playback.
 *
 * The equalizer itself runs in ParametricEq, inside ExoPlayer's audio pipeline
 * (EqAudioProcessor). It used to use android.media.audiofx.Equalizer, but that
 * effect depends on the phone maker's drivers and often never attaches, so the
 * equalizer did nothing. The visualizer measures the same audio (PcmSpectrum).
 */
public class AudioEffects {

    private static final String TAG = "FRFAudioEffects";

    /** Must match the Web Audio analyser's frequencyBinCount (fftSize 128 / 2). */
    private static final int BIN_COUNT = 64;

    private static final long FRAME_INTERVAL_MS = 45; // ~22 fps

    private static final AudioEffects INSTANCE = new AudioEffects();

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean visualizerEnabled = false;
    private boolean wasSilent = false;

    private AudioEffects() {}

    public static AudioEffects get() {
        return INSTANCE;
    }

    /** Kept for the player's audio session callback; the spectrum no longer needs it. */
    public synchronized void attach(int audioSessionId) {}

    /**
     * The visualizer costs an FFT a few times a second, so it only runs while the
     * user actually has a visualizer style selected.
     */
    public synchronized void setVisualizerEnabled(boolean enabled) {
        if (enabled == visualizerEnabled) return;
        visualizerEnabled = enabled;
        PcmSpectrum.enabled = enabled;
        handler.removeCallbacks(frame);
        if (enabled) handler.post(frame);
    }

    private final Runnable frame = new Runnable() {
        @Override
        public void run() {
            if (!visualizerEnabled) return;
            try {
                boolean fresh = PcmSpectrum.fresh();
                // While paused, send one all-zero frame so the bars settle, then stay quiet.
                if (fresh || !wasSilent) {
                    int[] bins = fresh ? PcmSpectrum.bins(BIN_COUNT) : new int[BIN_COUNT];
                    StringBuilder sb = new StringBuilder(BIN_COUNT * 4);
                    for (int b = 0; b < BIN_COUNT; b++) {
                        if (b > 0) sb.append(',');
                        sb.append(bins[b]);
                    }
                    JSObject data = new JSObject();
                    data.put("bins", sb.toString());
                    BackgroundAudioPlugin.sendEvent("visualizerFrame", data);
                    wasSilent = !fresh;
                }
            } catch (Throwable t) {
                Log.w(TAG, "visualizer frame failed: " + t);
            }
            handler.postDelayed(this, FRAME_INTERVAL_MS);
        }
    };

    /** Equalizer settings: band gains in dB, bass boost 0..10, surround 0..10. */
    public void set(boolean enabled, int[] bandsDb, int bassBoostLevel, int surroundLevel) {
        double[] bands = new double[5];
        for (int i = 0; i < bands.length; i++) {
            bands[i] = bandsDb != null && i < bandsDb.length ? bandsDb[i] : 0;
        }
        ParametricEq.setSettings(enabled, bands, bassBoostLevel, surroundLevel);
    }

    /**
     * Called when a player is released (between songs too). The visualizer belongs
     * to the user's setting, not to a player, so it keeps running.
     */
    public synchronized void release() {}
}
