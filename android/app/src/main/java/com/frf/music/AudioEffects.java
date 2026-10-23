package com.frf.music;

import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.Visualizer;
import android.media.audiofx.Virtualizer;
import android.os.SystemClock;
import android.util.Log;
import com.getcapacitor.JSObject;

/**
 * Applies the app's 5-band equalizer to ExoPlayer's output.
 *
 * The Web Audio graph in src/utils/equalizer.ts is wired to the &lt;audio&gt;
 * element, so it does nothing once ExoPlayer owns playback. Android's
 * Equalizer attaches to the player's audio session instead. The app's band
 * layout (60/230/910/3600/14000 Hz) is the standard Android 5-band set, so
 * each Android band is mapped to its nearest app band by centre frequency.
 */
public class AudioEffects {

    private static final String TAG = "FRFAudioEffects";

    /** App band centre frequencies, mirroring EQ_FREQUENCIES in equalizer.ts. */
    private static final int[] APP_BAND_HZ = {60, 230, 910, 3600, 14000};

    /** Must match the Web Audio analyser's frequencyBinCount (fftSize 128 / 2). */
    private static final int BIN_COUNT = 64;

    /** Real/imag pairs peak at sqrt(128^2 + 128^2) ~= 181. */
    private static final double MAX_MAGNITUDE = 181.0;

    private static final long MIN_FRAME_INTERVAL_MS = 45; // ~22 fps

    private static final AudioEffects INSTANCE = new AudioEffects();

    private Equalizer equalizer;
    private BassBoost bassBoost;
    private Virtualizer virtualizer;
    private Visualizer visualizer;
    private boolean visualizerEnabled = false;
    private long lastFrameSentAt = 0;

    private boolean enabled = true;
    private final int[] bandsDb = new int[APP_BAND_HZ.length];
    private int bassBoostLevel = 0;   // app scale 0..10
    private int surroundLevel = 0;    // app scale 0..4

    private int sessionId = 0;

    private AudioEffects() {}

    public static AudioEffects get() {
        return INSTANCE;
    }

    /** Called with ExoPlayer's audio session id once it opens an audio track. */
    public synchronized void attach(int audioSessionId) {
        if (audioSessionId == sessionId && equalizer != null) return;
        release();
        if (audioSessionId <= 0) return;
        sessionId = audioSessionId;

        try {
            equalizer = new Equalizer(0, audioSessionId);
        } catch (Throwable t) {
            Log.w(TAG, "Equalizer unavailable: " + t.getMessage());
            equalizer = null;
        }
        try {
            bassBoost = new BassBoost(0, audioSessionId);
        } catch (Throwable t) {
            bassBoost = null;
        }
        try {
            virtualizer = new Virtualizer(0, audioSessionId);
        } catch (Throwable t) {
            virtualizer = null;
        }
        apply();
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

    public synchronized void set(
            boolean enabled, int[] bandsDb, int bassBoostLevel, int surroundLevel) {
        this.enabled = enabled;
        for (int i = 0; i < this.bandsDb.length; i++) {
            this.bandsDb[i] = bandsDb != null && i < bandsDb.length ? bandsDb[i] : 0;
        }
        this.bassBoostLevel = Math.max(0, bassBoostLevel);
        this.surroundLevel = Math.max(0, surroundLevel);
        apply();
    }

    public synchronized void release() {
        sessionId = 0;
        releaseVisualizer();
        if (equalizer != null) {
            try {
                equalizer.setEnabled(false);
                equalizer.release();
            } catch (Throwable ignored) {}
            equalizer = null;
        }
        if (bassBoost != null) {
            try {
                bassBoost.setEnabled(false);
                bassBoost.release();
            } catch (Throwable ignored) {}
            bassBoost = null;
        }
        if (virtualizer != null) {
            try {
                virtualizer.setEnabled(false);
                virtualizer.release();
            } catch (Throwable ignored) {}
            virtualizer = null;
        }
    }

    private void apply() {
        if (equalizer != null) {
            try {
                equalizer.setEnabled(enabled);
                short bandCount = equalizer.getNumberOfBands();
                short[] range = equalizer.getBandLevelRange();
                short minLevel = range != null && range.length > 0 ? range[0] : -1500;
                short maxLevel = range != null && range.length > 1 ? range[1] : 1500;

                for (short b = 0; b < bandCount; b++) {
                    int centerHz = equalizer.getCenterFreq(b) / 1000; // milliHz -> Hz
                    int nearest = nearestAppBand(centerHz);
                    // App bands are dB; the framework wants millibel.
                    int millibel = bandsDb[nearest] * 100;
                    short level = (short) Math.max(minLevel, Math.min(maxLevel, millibel));
                    equalizer.setBandLevel(b, level);
                }
            } catch (Throwable t) {
                Log.w(TAG, "Failed to apply band levels: " + t.getMessage());
            }
        }

        if (bassBoost != null) {
            try {
                bassBoost.setEnabled(enabled);
                // 0..10 -> 0..1000
                bassBoost.setStrength((short) Math.min(1000, bassBoostLevel * 100));
            } catch (Throwable ignored) {}
        }

        if (virtualizer != null) {
            try {
                virtualizer.setEnabled(enabled);
                // 0..4 -> 0..1000
                virtualizer.setStrength((short) Math.min(1000, surroundLevel * 250));
            } catch (Throwable ignored) {}
        }
    }

    private static int nearestAppBand(int centerHz) {
        int best = 0;
        int bestDelta = Integer.MAX_VALUE;
        for (int i = 0; i < APP_BAND_HZ.length; i++) {
            int delta = Math.abs(APP_BAND_HZ[i] - centerHz);
            if (delta < bestDelta) {
                bestDelta = delta;
                best = i;
            }
        }
        return best;
    }
}
