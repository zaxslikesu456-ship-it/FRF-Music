package com.frf.music;

/**
 * The visualizer's spectrum, measured from the audio the app itself plays.
 *
 * EqAudioProcessor hands over the newest samples of every buffer it outputs
 * (after the equalizer), and AudioEffects turns the latest block into 64
 * frequency bins a few times a second. This replaces android.media.audiofx
 * .Visualizer, which needs the microphone permission and often returned nothing.
 */
final class PcmSpectrum {

    static final int SIZE = 1024; // FFT length
    static volatile boolean enabled = false;

    // The player processes audio in bursts, ahead of what is heard. So the last
    // ~1.5 s of mono samples is kept, and the block analysed is the one at the
    // estimated playback point: samples pushed since playback (re)started, timed
    // by the wall clock.
    private static final int RING = 1 << 16; // ~1.5 s at 44.1 kHz
    private static final float[] ring = new float[RING];
    private static long written = 0; // total mono samples pushed
    private static long lastPushAt = 0; // nanoTime of the latest push
    private static long clockStartAt = 0; // nanoTime when the current stretch started
    private static long clockStartSample = 0; // samples written at that moment
    private static volatile int sampleRate = 44100;

    private PcmSpectrum() {}

    private static void begin(int rate) {
        long now = System.nanoTime();
        sampleRate = rate > 0 ? rate : 44100;
        // A pause or a new song: restart the playback clock.
        if (lastPushAt == 0 || now - lastPushAt > 1_000_000_000L) {
            clockStartAt = now;
            clockStartSample = written;
        }
        lastPushAt = now;
    }

    private static void put(float v) {
        ring[(int) (written & (RING - 1))] = v;
        written++;
    }

    /** Mono samples from an interleaved float buffer (-1..1). */
    static void pushFloats(float[] interleaved, int frames, int channels, int rate) {
        if (!enabled || frames <= 0 || channels <= 0) return;
        synchronized (ring) {
            begin(rate);
            for (int f = 0; f < frames; f++) {
                float sum = 0;
                int base = f * channels;
                for (int c = 0; c < channels; c++) sum += interleaved[base + c];
                put(sum / channels);
            }
        }
    }

    /** Same, for 16-bit samples read from a buffer the processor passes through untouched. */
    static void pushPcm16(java.nio.ByteBuffer buf, int frames, int channels, int rate) {
        if (!enabled || frames <= 0 || channels <= 0) return;
        java.nio.ByteBuffer b = buf.duplicate().order(buf.order());
        synchronized (ring) {
            begin(rate);
            for (int f = 0; f < frames; f++) {
                float sum = 0;
                int base = b.position() + f * channels * 2;
                for (int c = 0; c < channels; c++) sum += b.getShort(base + c * 2) / 32768f;
                put(sum / channels);
            }
        }
    }

    /** Float buffer passed through untouched. */
    static void pushPcmFloat(java.nio.ByteBuffer buf, int frames, int channels, int rate) {
        if (!enabled || frames <= 0 || channels <= 0) return;
        java.nio.ByteBuffer b = buf.duplicate().order(buf.order());
        synchronized (ring) {
            begin(rate);
            for (int f = 0; f < frames; f++) {
                float sum = 0;
                int base = b.position() + f * channels * 4;
                for (int c = 0; c < channels; c++) sum += b.getFloat(base + c * 4);
                put(sum / channels);
            }
        }
    }

    /** True while audio is being played (pushes stop when playback pauses). */
    static boolean fresh() {
        synchronized (ring) {
            return lastPushAt != 0 && System.nanoTime() - lastPushAt < 1_000_000_000L;
        }
    }

    /** The newest sample index that has been heard by now. */
    private static long playedIndex() {
        long elapsed = System.nanoTime() - clockStartAt;
        long played = clockStartSample + elapsed * sampleRate / 1_000_000_000L;
        long oldest = Math.max(0, written - RING + SIZE);
        return Math.max(Math.min(played, written), Math.min(oldest + SIZE, written));
    }

    /**
     * 64 bins, 0..255, spaced logarithmically from ~40 Hz to ~16 kHz like the
     * Web Audio analyser the web version uses (louder = higher).
     */
    static int[] bins(int count) {
        float[] re = new float[SIZE];
        float[] im = new float[SIZE];
        synchronized (ring) {
            long endIdx = playedIndex();
            long startIdx = endIdx - SIZE;
            for (int i = 0; i < SIZE; i++) {
                float w = (float) (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1))); // Hann
                long idx = startIdx + i;
                re[i] = idx < 0 ? 0 : ring[(int) (idx & (RING - 1))] * w;
            }
        }
        fft(re, im);
        int[] out = new int[count];
        int rate = sampleRate > 0 ? sampleRate : 44100;
        double lo = 40, hi = Math.min(16000, rate / 2.0);
        for (int b = 0; b < count; b++) {
            double f0 = lo * Math.pow(hi / lo, (double) b / count);
            double f1 = lo * Math.pow(hi / lo, (double) (b + 1) / count);
            int i0 = Math.max(1, (int) Math.floor(f0 * SIZE / rate));
            int i1 = Math.max(i0 + 1, (int) Math.ceil(f1 * SIZE / rate));
            double peak = 0;
            for (int i = i0; i < i1 && i < SIZE / 2; i++) {
                double m = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
                if (m > peak) peak = m;
            }
            // Magnitude to dB, mapped -80..-10 dB onto 0..255.
            double db = 20 * Math.log10(peak / (SIZE / 4.0) + 1e-9);
            int v = (int) Math.round((db + 80) / 70 * 255);
            out[b] = Math.max(0, Math.min(255, v));
        }
        return out;
    }

    // In-place radix-2 FFT.
    private static void fft(float[] re, float[] im) {
        int n = re.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                float t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (int len = 2; len <= n; len <<= 1) {
            double ang = -2 * Math.PI / len;
            float wr = (float) Math.cos(ang), wi = (float) Math.sin(ang);
            for (int i = 0; i < n; i += len) {
                float cr = 1, ci = 0;
                for (int k = 0; k < len / 2; k++) {
                    int a = i + k, b = i + k + len / 2;
                    float xr = re[b] * cr - im[b] * ci;
                    float xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi;
                    re[a] += xr; im[a] += xi;
                    float ncr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = ncr;
                }
            }
        }
    }
}
