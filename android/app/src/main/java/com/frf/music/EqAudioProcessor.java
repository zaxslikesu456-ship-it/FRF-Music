package com.frf.music;

import com.google.android.exoplayer2.C;
import com.google.android.exoplayer2.audio.BaseAudioProcessor;

import java.nio.ByteBuffer;

/**
 * Puts ParametricEq into ExoPlayer's audio pipeline, so the equalizer shapes
 * the actual PCM that is played. It works on every device and does not depend
 * on any platform audio effect.
 */
final class EqAudioProcessor extends BaseAudioProcessor {

    private final ParametricEq eq = new ParametricEq();
    private boolean pcm16;
    private int channels;
    private float[] scratch = new float[0];

    @Override
    protected AudioFormat onConfigure(AudioFormat inputAudioFormat)
            throws UnhandledAudioFormatException {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT
                && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw new UnhandledAudioFormatException(inputAudioFormat);
        }
        pcm16 = inputAudioFormat.encoding == C.ENCODING_PCM_16BIT;
        channels = inputAudioFormat.channelCount;
        eq.configure(inputAudioFormat.sampleRate, channels);
        return inputAudioFormat; // same format out
    }

    @Override
    public void queueInput(ByteBuffer input) {
        int remaining = input.remaining();
        if (remaining == 0) return;
        ByteBuffer out = replaceOutputBuffer(remaining);

        // Flat or disabled: pass the audio through untouched.
        if (eq.isBypass() || channels <= 0) {
            out.put(input);
            out.flip();
            return;
        }

        int bytesPerSample = pcm16 ? 2 : 4;
        int frames = remaining / (bytesPerSample * channels);
        int samples = frames * channels;
        if (scratch.length < samples) scratch = new float[samples];

        for (int i = 0; i < samples; i++) {
            scratch[i] = pcm16 ? input.getShort() / 32768f : input.getFloat();
        }
        eq.process(scratch, frames);
        for (int i = 0; i < samples; i++) {
            float v = scratch[i];
            if (pcm16) {
                int s = Math.round(v * 32767f);
                out.putShort((short) Math.max(-32768, Math.min(32767, s)));
            } else {
                out.putFloat(v);
            }
        }
        // Anything past a whole frame is copied unchanged.
        if (input.hasRemaining()) out.put(input);
        out.flip();
    }
}
