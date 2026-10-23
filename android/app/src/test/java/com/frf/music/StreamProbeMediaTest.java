package com.frf.music;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import org.junit.Test;

/**
 * The stream probe used to accept any HTTP 200, so an anti-bot interstitial
 * served by an Invidious proxy (HTTP 200, text/html, "Making sure you're not a
 * bot!") won the resolver race and was handed to ExoPlayer, which died with
 * UnrecognizedInputFormatException. In the foreground the WebView engine
 * covered for it; backgrounded there is no other engine, so the music simply
 * stopped.
 */
public class StreamProbeMediaTest {

    private static boolean probe(String contentType, byte[] body) {
        return BackgroundAudioPlugin.looksLikeMedia(contentType, body, body.length);
    }

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    @Test
    public void rejectsAnubisBotChallenge() {
        byte[] page = bytes(
                "<!doctype html><html lang=\"en\"><head><title>Making sure you&#39;re not a bot!</title>");
        assertFalse(probe("text/html; charset=utf-8", page));
    }

    @Test
    public void rejectsCloudflareInterstitialWithoutContentType() {
        assertFalse(probe(null, bytes("<!DOCTYPE html><html><head><title>Attention Required!")));
    }

    @Test
    public void rejectsJsonErrorBody() {
        assertFalse(probe("application/json", bytes("{\"error\":\"Endpoint disabled\"}")));
    }

    @Test
    public void acceptsDeclaredAudio() {
        assertTrue(probe("audio/mp4", bytes("whatever the body looks like")));
        assertTrue(probe("video/mp4", new byte[] {0, 0, 0, 0}));
    }

    @Test
    public void acceptsMp4BySignatureWhenProxyMislabelsType() {
        byte[] mp4 = new byte[] {0, 0, 0, 0x20, 'f', 't', 'y', 'p', 'M', '4', 'A', ' '};
        assertTrue(probe("application/octet-stream", mp4));
    }

    @Test
    public void acceptsOggOpusAndMp3Signatures() {
        assertTrue(probe("application/octet-stream", bytes("OggS...")));
        assertTrue(probe("application/octet-stream", bytes("ID3\u0003")));
        assertTrue(probe("application/octet-stream", new byte[] {(byte) 0xFF, (byte) 0xFB, 0x00}));
    }

    @Test
    public void acceptsWebmSignature() {
        assertTrue(probe(
                "application/octet-stream",
                new byte[] {(byte) 0x1A, (byte) 0x45, (byte) 0xDF, (byte) 0xA3, 0x01}));
    }
}
