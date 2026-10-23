package com.frf.music;

/**
 * The app's equalizer, as plain DSP: a 5-band graphic EQ, bass boost, stereo
 * widening ("3D surround") and a soft limiter. It mirrors the Web Audio graph in
 * src/utils/equalizer.ts (same band frequencies, filter types and Q) so the
 * phone, the desktop app and the browser sound the same.
 *
 * It runs inside ExoPlayer's audio pipeline (see EqAudioProcessor) instead of
 * relying on android.media.audiofx.Equalizer: that effect depends on the phone
 * maker's audio drivers, and on many devices (and the emulator) it never
 * attaches, which is why the old equalizer did nothing.
 *
 * Filters are the standard RBJ biquads, the same formulas Web Audio uses.
 */
final class ParametricEq {

    static final int[] BAND_HZ = {60, 230, 910, 3600, 14000};
    static final double PEAK_Q = 1.4;
    static final double BASS_HZ = 80.0;
    /** Bass boost 0..10 maps to 0..18 dB of low shelf. */
    static final double BASS_DB_PER_STEP = 1.8;
    /** Surround 0..10 widens the stereo image: side gain 1.0 .. 2.8. */
    static final double WIDEN_PER_STEP = 0.18;
    static final double MAX_BAND_DB = 15.0;

    private static final int BAND_COUNT = 5;
    private static final int FILTER_COUNT = BAND_COUNT + 1; // + bass shelf
    private static final int BASS = BAND_COUNT;
    private static final double MIN_ACTIVE_DB = 0.05;
    /** Output at or below this passes through untouched; above it is eased in. */
    private static final double LIMIT_KNEE = 0.8;

    // ---------------------------------------------------------------- settings

    /** Immutable snapshot of what the user chose. */
    static final class Settings {
        final boolean enabled;
        final double[] bandsDb;
        final double bass;
        final double surround;

        Settings(boolean enabled, double[] bandsDb, double bass, double surround) {
            this.enabled = enabled;
            this.bandsDb = new double[BAND_COUNT];
            for (int i = 0; i < BAND_COUNT; i++) {
                double v = bandsDb != null && i < bandsDb.length ? bandsDb[i] : 0;
                this.bandsDb[i] = Math.max(-MAX_BAND_DB, Math.min(MAX_BAND_DB, v));
            }
            this.bass = Math.max(0, Math.min(10, bass));
            this.surround = Math.max(0, Math.min(10, surround));
        }

        boolean isFlat() {
            if (bass >= 0.05 || surround >= 0.05) return false;
            for (double b : bandsDb) if (Math.abs(b) >= MIN_ACTIVE_DB) return false;
            return true;
        }
    }

    private static volatile Settings shared = new Settings(true, null, 0, 0);

    /** Shared by every player instance, so it survives players being rebuilt. */
    static void setSettings(boolean enabled, double[] bandsDb, double bass, double surround) {
        shared = new Settings(enabled, bandsDb, bass, surround);
    }

    static Settings settings() {
        return shared;
    }

    // ------------------------------------------------------------------ engine

    private final double[][] coef = new double[FILTER_COUNT][5]; // b0 b1 b2 a1 a2 (a0 = 1)
    private final boolean[] active = new boolean[FILTER_COUNT];
    private double[][][] state = new double[0][][]; // [channel][filter][z1,z2]
    private int sampleRate;
    private int channels;
    private Settings applied;
    private boolean bypass = true;
    private double preGain = 1.0;
    private double sideGain = 1.0;

    void configure(int sampleRate, int channels) {
        this.sampleRate = sampleRate;
        this.channels = channels;
        this.state = new double[channels][FILTER_COUNT][2];
        this.applied = null;
    }

    /** True when the current settings change nothing, so audio can pass through. */
    boolean isBypass() {
        refresh();
        return bypass;
    }

    private void refresh() {
        Settings s = shared;
        if (s == applied) return;
        applied = s;
        if (sampleRate <= 0 || channels <= 0) return;

        if (!s.enabled || s.isFlat()) {
            bypass = true;
            return;
        }
        bypass = false;

        double maxBoost = 0;
        for (int i = 0; i < BAND_COUNT; i++) {
            double db = s.bandsDb[i];
            boolean usable = BAND_HZ[i] < 0.49 * sampleRate; // low sample rates lack the top band
            active[i] = usable && Math.abs(db) >= MIN_ACTIVE_DB;
            if (!active[i]) continue;
            if (i == 0) {
                lowShelf(coef[i], BAND_HZ[i], db);
            } else if (i == BAND_COUNT - 1) {
                highShelf(coef[i], BAND_HZ[i], db);
            } else {
                peaking(coef[i], BAND_HZ[i], PEAK_Q, db);
            }
            maxBoost = Math.max(maxBoost, db);
        }

        double bassDb = s.bass * BASS_DB_PER_STEP;
        active[BASS] = bassDb >= MIN_ACTIVE_DB;
        if (active[BASS]) {
            lowShelf(coef[BASS], BASS_HZ, bassDb);
            maxBoost = Math.max(maxBoost, bassDb);
        }

        // Boosting raises peaks, so give back half of the largest boost up front
        // (capped); the limiter catches whatever is left.
        preGain = Math.pow(10.0, -Math.min(9.0, maxBoost * 0.5) / 20.0);
        sideGain = channels == 2 ? 1.0 + s.surround * WIDEN_PER_STEP : 1.0;

        // A filter that was off kept stale state; clear it so switching it on
        // does not replay old samples as a click.
        for (int c = 0; c < channels; c++) {
            for (int f = 0; f < FILTER_COUNT; f++) {
                if (!active[f]) {
                    state[c][f][0] = 0;
                    state[c][f][1] = 0;
                }
            }
        }
    }

    /** Processes interleaved float samples (-1..1) in place. */
    void process(float[] buf, int frames) {
        refresh();
        if (bypass) return;
        final int ch = channels;
        for (int n = 0; n < frames; n++) {
            int base = n * ch;
            for (int c = 0; c < ch; c++) {
                double y = buf[base + c] * preGain;
                double[][] st = state[c];
                for (int f = 0; f < FILTER_COUNT; f++) {
                    if (!active[f]) continue;
                    double[] k = coef[f];
                    double[] z = st[f];
                    double out = k[0] * y + z[0];
                    z[0] = k[1] * y - k[3] * out + z[1];
                    z[1] = k[2] * y - k[4] * out;
                    y = out;
                }
                buf[base + c] = (float) y;
            }
            if (ch == 2 && sideGain != 1.0) {
                double l = buf[base];
                double r = buf[base + 1];
                double mid = (l + r) * 0.5;
                double side = (l - r) * 0.5 * sideGain;
                buf[base] = (float) (mid + side);
                buf[base + 1] = (float) (mid - side);
            }
            for (int c = 0; c < ch; c++) {
                buf[base + c] = (float) softLimit(buf[base + c]);
            }
        }
    }

    static double softLimit(double v) {
        double a = Math.abs(v);
        if (a <= LIMIT_KNEE) return v;
        double room = 1.0 - LIMIT_KNEE;
        double limited = LIMIT_KNEE + room * Math.tanh((a - LIMIT_KNEE) / room);
        return v < 0 ? -limited : limited;
    }

    // ----------------------------------------------------------------- filters
    // RBJ audio-EQ-cookbook biquads; shelves use slope S = 1, as Web Audio does.

    private void peaking(double[] out, double freq, double q, double db) {
        double a = Math.pow(10.0, db / 40.0);
        double w0 = 2.0 * Math.PI * Math.min(freq, 0.49 * sampleRate) / sampleRate;
        double cos = Math.cos(w0);
        double alpha = Math.sin(w0) / (2.0 * q);
        double a0 = 1.0 + alpha / a;
        store(out, 1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a, a0, -2.0 * cos, 1.0 - alpha / a);
    }

    private void lowShelf(double[] out, double freq, double db) {
        double a = Math.pow(10.0, db / 40.0);
        double w0 = 2.0 * Math.PI * Math.min(freq, 0.49 * sampleRate) / sampleRate;
        double cos = Math.cos(w0);
        double alpha = Math.sin(w0) / Math.sqrt(2.0);
        double t = 2.0 * Math.sqrt(a) * alpha;
        store(out,
                a * ((a + 1) - (a - 1) * cos + t),
                2 * a * ((a - 1) - (a + 1) * cos),
                a * ((a + 1) - (a - 1) * cos - t),
                (a + 1) + (a - 1) * cos + t,
                -2 * ((a - 1) + (a + 1) * cos),
                (a + 1) + (a - 1) * cos - t);
    }

    private void highShelf(double[] out, double freq, double db) {
        double a = Math.pow(10.0, db / 40.0);
        double w0 = 2.0 * Math.PI * Math.min(freq, 0.49 * sampleRate) / sampleRate;
        double cos = Math.cos(w0);
        double alpha = Math.sin(w0) / Math.sqrt(2.0);
        double t = 2.0 * Math.sqrt(a) * alpha;
        store(out,
                a * ((a + 1) + (a - 1) * cos + t),
                -2 * a * ((a - 1) + (a + 1) * cos),
                a * ((a + 1) + (a - 1) * cos - t),
                (a + 1) - (a - 1) * cos + t,
                2 * ((a - 1) - (a + 1) * cos),
                (a + 1) - (a - 1) * cos - t);
    }

    private static void store(double[] out, double b0, double b1, double b2,
                              double a0, double a1, double a2) {
        out[0] = b0 / a0;
        out[1] = b1 / a0;
        out[2] = b2 / a0;
        out[3] = a1 / a0;
        out[4] = a2 / a0;
    }
}
