package com.frf.music;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Checks the equalizer numerically: play test tones through it and measure how
 * much louder or quieter each frequency comes out. The old equalizer was
 * never verified this way, and in practice it did nothing at all.
 */
public class ParametricEqTest {

    private static final int RATE = 44100;

    private static ParametricEq eq(int rate, int channels) {
        ParametricEq e = new ParametricEq();
        e.configure(rate, channels);
        return e;
    }

    /** Gain in dB of a stereo sine at freq, measured after the filters settle. */
    private static double gainDb(ParametricEq e, double freq, double amplitude) {
        int frames = RATE * 2;
        float[] buf = new float[frames * 2];
        for (int n = 0; n < frames; n++) {
            float v = (float) (amplitude * Math.sin(2 * Math.PI * freq * n / RATE));
            buf[n * 2] = v;
            buf[n * 2 + 1] = v;
        }
        float[] input = buf.clone();
        e.process(buf, frames);
        // Ignore the first second so start-up transients are gone.
        double inSq = 0, outSq = 0;
        for (int n = RATE; n < frames; n++) {
            inSq += input[n * 2] * input[n * 2];
            outSq += buf[n * 2] * buf[n * 2];
        }
        return 10 * Math.log10(outSq / inSq);
    }

    private static void set(boolean enabled, double[] bands, double bass, double surround) {
        ParametricEq.setSettings(enabled, bands, bass, surround);
    }

    @Test
    public void flatSettingsPassAudioThroughUnchanged() {
        set(true, new double[] {0, 0, 0, 0, 0}, 0, 0);
        ParametricEq e = eq(RATE, 2);
        assertTrue(e.isBypass());
        float[] buf = {0.1f, -0.2f, 0.3f, 0.4f};
        float[] copy = buf.clone();
        e.process(buf, 2);
        for (int i = 0; i < buf.length; i++) assertEquals(copy[i], buf[i], 0f);
    }

    @Test
    public void disabledEqualizerIsBypassedEvenWithBandsSet() {
        set(false, new double[] {12, 12, 12, 12, 12}, 10, 10);
        assertTrue(eq(RATE, 2).isBypass());
    }

    @Test
    public void midBandBoostRaisesThatFrequencyByTheBandGainMinusHeadroom() {
        set(true, new double[] {0, 0, 10, 0, 0}, 0, 0);
        // +10 dB at 910 Hz; the preamp gives back half of the boost (5 dB).
        assertEquals(5.0, gainDb(eq(RATE, 2), 910, 0.1), 0.4);
    }

    @Test
    public void midBandCutLowersThatFrequencyWithoutHeadroomLoss() {
        set(true, new double[] {0, 0, -8, 0, 0}, 0, 0);
        assertEquals(-8.0, gainDb(eq(RATE, 2), 910, 0.1), 0.4);
    }

    @Test
    public void boostIsClearlyLouderAtTheBandThanFarFromIt() {
        set(true, new double[] {0, 0, 10, 0, 0}, 0, 0);
        double atBand = gainDb(eq(RATE, 2), 910, 0.1);
        double faraway = gainDb(eq(RATE, 2), 60, 0.1);
        assertTrue("band " + atBand + " dB vs far " + faraway + " dB", atBand - faraway > 8.0);
    }

    @Test
    public void everyBandActuallyChangesItsOwnFrequency() {
        int[] centres = {60, 230, 910, 3600, 14000};
        for (int band = 0; band < centres.length; band++) {
            double[] bands = new double[5];
            bands[band] = -10; // a cut, so there is no headroom adjustment
            set(true, bands, 0, 0);
            double g = gainDb(eq(RATE, 2), centres[band], 0.1);
            // The end bands are shelves, so at their centre they give about half.
            double expected = (band == 0 || band == 4) ? -5.0 : -10.0;
            assertEquals("band " + band, expected, g, 1.0);
        }
    }

    @Test
    public void bassBoostRaisesDeepBassRelativeToTheMidrange() {
        set(true, new double[] {0, 0, 0, 0, 0}, 10, 0);
        double bass = gainDb(eq(RATE, 2), 30, 0.05);
        double mid = gainDb(eq(RATE, 2), 3000, 0.05);
        assertTrue("bass " + bass + " dB mid " + mid + " dB", bass - mid > 15.0);
    }

    @Test
    public void surroundWidensOutOfPhaseSignalButLeavesMonoAlone() {
        set(true, new double[] {0, 0, 0, 0, 0}, 0, 10);
        ParametricEq e = eq(RATE, 2);

        float[] mono = {0.1f, 0.1f};
        e.process(mono, 1);
        assertEquals(0.1f, mono[0], 1e-4f);
        assertEquals(0.1f, mono[1], 1e-4f);

        float[] wide = {0.1f, -0.1f};
        e.process(wide, 1);
        assertEquals(0.28f, wide[0], 1e-3f); // side gain 1 + 10 * 0.18
        assertEquals(-0.28f, wide[1], 1e-3f);
    }

    @Test
    public void loudBoostedAudioNeverClips() {
        set(true, new double[] {15, 15, 15, 15, 15}, 10, 10);
        ParametricEq e = eq(RATE, 2);
        int frames = RATE;
        float[] buf = new float[frames * 2];
        for (int n = 0; n < frames; n++) {
            float v = (float) (0.99 * Math.sin(2 * Math.PI * 100 * n / RATE));
            buf[n * 2] = v;
            buf[n * 2 + 1] = v;
        }
        e.process(buf, frames);
        for (float v : buf) {
            assertFalse(Float.isNaN(v));
            assertTrue("sample " + v, Math.abs(v) <= 1.0f);
        }
    }

    @Test
    public void quietAudioBelowTheKneeIsNotTouchedByTheLimiter() {
        assertEquals(0.5, ParametricEq.softLimit(0.5), 0.0);
        assertEquals(-0.8, ParametricEq.softLimit(-0.8), 0.0);
        assertTrue(ParametricEq.softLimit(3.0) < 1.0);
    }

    @Test
    public void lowSampleRateSkipsTheTopBandAndStaysFinite() {
        set(true, new double[] {0, 0, 0, 0, 12}, 0, 0);
        ParametricEq e = eq(16000, 2); // 14 kHz is above Nyquist here
        float[] buf = new float[2000];
        for (int i = 0; i < buf.length; i++) buf[i] = (float) (0.2 * Math.sin(i * 0.05));
        float[] copy = buf.clone();
        e.process(buf, 1000);
        for (int i = 0; i < buf.length; i++) {
            assertFalse(Float.isNaN(buf[i]) || Float.isInfinite(buf[i]));
            assertEquals(copy[i], buf[i], 1e-6f);
        }
    }

    @Test
    public void monoAndMultichannelAudioAreProcessedAndStayFinite() {
        set(true, new double[] {6, 3, -2, 4, 6}, 5, 4);
        for (int channels : new int[] {1, 2, 6}) {
            ParametricEq e = eq(48000, channels);
            float[] buf = new float[4800 * channels];
            for (int i = 0; i < buf.length; i++) buf[i] = (float) (0.3 * Math.sin(i * 0.01));
            e.process(buf, 4800);
            for (float v : buf) assertFalse(Float.isNaN(v) || Float.isInfinite(v));
        }
    }

    @Test
    public void changingSettingsMidStreamDoesNotProduceNonFiniteSamples() {
        ParametricEq e = eq(RATE, 2);
        float[] buf = new float[2048];
        for (int round = 0; round < 50; round++) {
            set(true, new double[] {round % 12 - 6, 3, -5, round % 7, 4}, round % 11, round % 11);
            for (int i = 0; i < buf.length; i++) buf[i] = (float) (0.25 * Math.sin(i * 0.02 + round));
            e.process(buf, 1024);
            for (float v : buf) assertFalse(Float.isNaN(v) || Float.isInfinite(v));
        }
    }
}
