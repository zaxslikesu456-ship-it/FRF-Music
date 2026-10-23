package com.frf.music;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.exoplayer2.ExoPlayer;
import java.io.DataOutputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Field;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BackgroundPlaybackTest {
    private Context context;
    private Activity activity;
    private File tone;

    @Before
    public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(
                new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        tone = new File(context.getFilesDir(), "background-test.wav");
        // Generated audio keeps this regression independent of network providers.
        try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(tone)))) {
            int samples = 44100 * 60;
            out.writeBytes("RIFF"); out.writeInt(Integer.reverseBytes(36 + samples * 2));
            out.writeBytes("WAVEfmt "); out.writeInt(Integer.reverseBytes(16));
            out.writeShort(Short.reverseBytes((short) 1));
            out.writeShort(Short.reverseBytes((short) 1));
            out.writeInt(Integer.reverseBytes(44100));
            out.writeInt(Integer.reverseBytes(88200));
            out.writeShort(Short.reverseBytes((short) 2));
            out.writeShort(Short.reverseBytes((short) 16));
            out.writeBytes("data"); out.writeInt(Integer.reverseBytes(samples * 2));
            for (int i = 0; i < samples; i++) {
                out.writeShort(Short.reverseBytes((short) (Math.sin(i * 2 * Math.PI * 440 / 44100) * 800)));
            }
        }
    }

    @After
    public void tearDown() {
        context.stopService(new Intent(context, PlaybackService.class));
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.finish());
        tone.delete();
    }

    private ExoPlayer player() {
        try {
            Field field = PlaybackService.class.getDeclaredField("exoPlayer");
            field.setAccessible(true);
            return (ExoPlayer) field.get(PlaybackService.instance);
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    private void onMain(Runnable action) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(action);
    }

    private void awaitPlaying() throws Exception {
        for (int i = 0; i < 100; i++) {
            AtomicReference<Boolean> playing = new AtomicReference<>(false);
            onMain(() -> {
                if (PlaybackService.instance != null) playing.set(player().isPlaying());
            });
            if (playing.get()) return;
            Thread.sleep(100);
        }
        fail("Native player did not start within 10 seconds");
    }

    @Test
    public void workerThreadHandoffKeepsPlayingAfterActivityStops() throws Exception {
        context.startForegroundService(new Intent(context, PlaybackService.class)
                .setAction(PlaybackService.ACTION_UPDATE));
        for (int i = 0; PlaybackService.instance == null && i < 100; i++) Thread.sleep(50);
        assertNotNull(PlaybackService.instance);
        // Instrumentation's thread models Capacitor's plugin worker, not main.
        PlaybackService.instance.handoverNow("Test", "FRF", "", "", tone.toURI().toString(), 0, 60);
        awaitPlaying();
        PlaybackService.instance.setVolumeLevel(0.4f);
        PlaybackService.instance.setSpeed(1.25f);
        onMain(() -> {
            assertEquals(0.4f, player().getVolume(), 0.001f);
            assertEquals(1.25f, player().getPlaybackParameters().speed, 0.001f);
            assertTrue(activity.moveTaskToBack(true));
        });
        AtomicReference<Long> before = new AtomicReference<>();
        onMain(() -> before.set(player().getCurrentPosition()));
        Thread.sleep(2500);
        onMain(() -> {
            assertTrue("Playback stopped after backgrounding", player().isPlaying());
            assertTrue("Playback position did not advance", player().getCurrentPosition() > before.get() + 1500);
        });
        try {
            InstrumentationRegistry.getInstrumentation().getUiAutomation()
                    .executeShellCommand("input keyevent KEYCODE_SLEEP").close();
            onMain(() -> before.set(player().getCurrentPosition()));
            Thread.sleep(2500);
            onMain(() -> {
                assertTrue("Playback stopped with screen off", player().isPlaying());
                assertTrue(player().getCurrentPosition() > before.get() + 1500);
            });
        } finally {
            InstrumentationRegistry.getInstrumentation().getUiAutomation()
                    .executeShellCommand("input keyevent KEYCODE_WAKEUP").close();
        }
    }

    @Test
    public void newStreamReplacesPreviousFileSource() throws Exception {
        context.startForegroundService(new Intent(context, PlaybackService.class)
                .setAction(PlaybackService.ACTION_PLAY_URL)
                .putExtra(PlaybackService.EXTRA_FILE_PATH, tone.getAbsolutePath())
                .putExtra(PlaybackService.EXTRA_STREAM_URL, ""));
        awaitPlaying();
        String replacement = tone.toURI().toString();
        context.startService(new Intent(context, PlaybackService.class)
                .setAction(PlaybackService.ACTION_PLAY_URL)
                .putExtra(PlaybackService.EXTRA_FILE_PATH, "")
                .putExtra(PlaybackService.EXTRA_STREAM_URL, replacement));
        Thread.sleep(500);
        awaitPlaying();
        onMain(() -> assertEquals(replacement, player().getCurrentMediaItem().localConfiguration.uri.toString()));
    }
}
