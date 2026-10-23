package com.frf.music;

import android.media.audiofx.Visualizer;
import android.os.SystemClock;
import android.util.Log;
import com.getcapacitor.JSObject;

/**
 * Equalizer settings and the spectrum visualizer for native playback.
 *
 * The equalizer itself runs in ParametricEq, inside ExoPlayer's audio pipeline
 * (EqAudioProcessor). It used to use android.media.audiofx.Equalizer, but that
 * effect depends on the phone maker's drivers and often never attaches, so the
 * equalizer did nothing. Only the visualizer still uses a platform effect.
 */
public class AudioEffects {

    private static final String TAG = "FRFAudioEffects";

    /** Must match the Web Audio analyser's frequencyBinCount (fftSize 128 / 2). */
    private static final int BIN_COUNT = 64;

    /** Real/imag pairs peak at sqrt(128^2 + 128^2) ~= 181. */
    private static final double MAX_MAGNITUDE = 181.0;

    private static final long MIN_FRAME_INTERVAL_MS = 45; // ~22 fps

    private static final AudioEffects INSTANCE = new AudioEffects();

    private Visualizer visualizer;
    private boolean visualizerEnabled = false;
    private long lastFrameSentAt = 0;

    private int sessionId = 0;

    private AudioEffects() {}

    public static AudioEffects get() {
        return INSTANCE;
    }

    /** Called with ExoPlayer's audio session id once it opens an audio track. */
    public synchronized void attach(int audioSessionId) {
        if (audioSessionId == sessionId) return;
        releaseVisualizer();
        sessionId = 0;
        if (audioSessionId <= 0) return;
        sessionId = audioSessionId;
        applyVisualizer();
    }

    /**
     * The visualizer costs a continuous capture callback, so it is only wired up
     * while the user actually has a visualizer mode selected.
     */
    public synchronized void setVisualizerEnabled(boolean enabled) {
        visualizerEnabled = enabled;
        applyVisualizer();
    }

    private synchronized void applyVisualizer() {
        if (!visualizerEnabled || sessionId <= 0) {
            releaseVisualizer();
            return;
        }
        if (visualizer != null) return;

        try {
            visualizer = new Visualizer(sessionId);
            int[] sizeRange = Visualizer.getCaptureSizeRange();
            int size = Math.min(1024, Math.max(128, sizeRange != null && sizeRange.length > 1
                    ? sizeRange[1] : 1024));
            visualizer.setCaptureSize(size);
            visualizer.setDataCaptureListener(
                    new Visualizer.OnDataCaptureListener() {
                        @Override
                        public void onWaveFormDataCapture(
                                Visualizer v, byte[] waveform, int samplingRate) {
                            // The wave mode is not driven from native capture; the
                            // component falls back to its flat line there.
                        }

                        @Override
                        public void onFftDataCapture(
                                Visualizer v, byte[] fft, int samplingRate) {
                            emitFft(fft);
                        }
                    },
                    Math.min(20000, Visualizer.getMaxCaptureRate()),
                    false,
                    true);
            visualizer.setEnabled(true);
        } catch (Throwable t) {
            Log.w(TAG, "Visualizer unavailable: " + t.getMessage());
            releaseVisualizer();
        }
    }

    private synchronized void releaseVisualizer() {
        if (visualizer != null) {
            try {
                visualizer.setEnabled(false);
                visualizer.release();
            } catch (Throwable ignored) {}
            visualizer = null;
        }
    }

    private synchronized void emitFft(byte[] fft) {
        long now = SystemClock.elapsedRealtime();
        if (now - lastFrameSentAt < MIN_FRAME_INTERVAL_MS) return;
        lastFrameSentAt = now;

        if (fft == null || fft.length < 4) return;
        int points = fft.length / 2; // real/imag pairs

        StringBuilder sb = new StringBuilder(BIN_COUNT * 4);
        for (int b = 0; b < BIN_COUNT; b++) {
            int start = (int) Math.floor((double) b * points / BIN_COUNT);
            int end = Math.max(start + 1, (int) Math.floor((double) (b + 1) * points / BIN_COUNT));
            if (end > points) end = points;

            double sum = 0;
            for (int i = start; i < end; i++) {
                double re = fft[i * 2];
                double im = fft[i * 2 + 1];
                sum += Math.sqrt(re * re + im * im);
            }
            int v = (int) Math.round((sum / (end - start)) * 255.0 / MAX_MAGNITUDE);
            if (v < 0) v = 0;
            if (v > 255) v = 255;

            if (b > 0) sb.append(',');
            sb.append(v);
        }

        JSObject data = new JSObject();
        data.put("bins", sb.toString());
        BackgroundAudioPlugin.sendEvent("visualizerFrame", data);
    }

    /** Equalizer settings: band gains in dB, bass boost 0..10, surround 0..10. */
    public void set(boolean enabled, int[] bandsDb, int bassBoostLevel, int surroundLevel) {
        double[] bands = new double[5];
        for (int i = 0; i < bands.length; i++) {
            bands[i] = bandsDb != null && i < bandsDb.length ? bandsDb[i] : 0;
        }
        ParametricEq.setSettings(enabled, bands, bassBoostLevel, surroundLevel);
    }

    public synchronized void release() {
        sessionId = 0;
        releaseVisualizer();
    }
}
