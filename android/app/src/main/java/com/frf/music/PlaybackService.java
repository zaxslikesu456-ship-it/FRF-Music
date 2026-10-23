package com.frf.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.google.android.exoplayer2.C;
import com.google.android.exoplayer2.DefaultRenderersFactory;
import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.PlaybackException;
import com.google.android.exoplayer2.PlaybackParameters;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.analytics.AnalyticsListener;
import com.google.android.exoplayer2.audio.AudioAttributes;
import com.google.android.exoplayer2.audio.AudioProcessor;
import com.google.android.exoplayer2.audio.AudioSink;
import com.google.android.exoplayer2.audio.DefaultAudioSink;
import com.google.android.exoplayer2.source.DefaultMediaSourceFactory;
import com.google.android.exoplayer2.upstream.DefaultDataSource;
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource;
import java.io.File;
import java.io.InputStream;
import java.net.URL;

public class PlaybackService extends Service {

    private static final String TAG = "FRFPlayback";

    public static final String CHANNEL_ID = "aura_playback_channel";
    public static final int NOTIFICATION_ID = 9001;

    public static final String ACTION_PLAY_URL = "com.frf.music.action.PLAY_URL";
    public static final String ACTION_PAUSE = "com.frf.music.action.PAUSE";
    public static final String ACTION_RESUME = "com.frf.music.action.RESUME";
    public static final String ACTION_SEEK = "com.frf.music.action.SEEK";
    public static final String ACTION_UPDATE = "com.frf.music.action.UPDATE";
    public static final String ACTION_TOGGLE = "com.frf.music.action.TOGGLE";
    public static final String ACTION_NEXT = "com.frf.music.action.NEXT";
    public static final String ACTION_PREV = "com.frf.music.action.PREV";
    public static final String ACTION_STOP = "com.frf.music.action.STOP";
    public static final String ACTION_TAKE_OVER = "com.frf.music.action.TAKE_OVER";

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_COVER = "coverUrl";
    public static final String EXTRA_STREAM_URL = "streamUrl";
    public static final String EXTRA_FILE_PATH = "filePath";
    public static final String EXTRA_POSITION = "position";
    public static final String EXTRA_DURATION = "duration";

    public static volatile Bridge bridgeRef;
    public static volatile PlaybackService instance;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private String title = "FRF Music";
    private String artist = "";
    private boolean playing = false;
    private String coverUrl;
    private Bitmap coverBitmap;

    private String streamUrl;
    private String filePath;
    private float position = 0f;
    private float duration = 0f;
    private float volume = 1.0f;
    private float speed = 1.0f;
    private String lastPlaybackError;

    // Set by the web layer while the WebView engine (YouTube iframe / <audio>)
    // is the one actually making sound. The service's own `playing` flag goes
    // stale-false whenever a native start fails, which used to make takeOver()
    // bail out exactly when the handover mattered — backgrounding with the
    // WebView still audible produced instant silence.
    private volatile boolean webAudible = false;

    private ExoPlayer exoPlayer;
    private MediaSessionCompat mediaSession;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            if (exoPlayer != null) {
                try {
                    if (exoPlayer.isPlaying()) {
                        long posMs = exoPlayer.getCurrentPosition();
                        long durMs = exoPlayer.getDuration();
                        float curSec = posMs / 1000f;
                        float durSec = durMs > 0 ? durMs / 1000f : duration;
                        position = curSec;
                        if (durSec > 0 && duration <= 0) {
                            duration = durSec;
                            updateMediaSessionMetadata();
                        }

                        JSObject data = new JSObject();
                        data.put("currentTime", curSec);
                        data.put("duration", durSec);
                        BackgroundAudioPlugin.sendEvent("playbackProgress", data);
                        refreshPlaybackState();
                        mainHandler.postDelayed(this, 500);
                    }
                } catch (Exception ignored) {}
            }
        }
    };

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                handleUserPause();
            }
        }
    };
    private boolean noisyReceiverRegistered = false;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
        setupMediaSession();
        setupExoPlayer();
        registerNoisyReceiver();
        acquireLocks();
        startForegroundCompat(buildNotification());
    }

    private void setupExoPlayer() {
        try {
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build();

            DefaultHttpDataSource.Factory httpDataSourceFactory = new DefaultHttpDataSource.Factory()
                    .setUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36")
                    .setAllowCrossProtocolRedirects(true)
                    .setConnectTimeoutMs(15000)
                    .setReadTimeoutMs(15000);

            // googlevideo throttles one long GET to a few KB/s; chunked range
            // requests stream at full speed (see GoogleVideoChunkedDataSource).
            DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(
                    this,
                    () -> new GoogleVideoChunkedDataSource(httpDataSourceFactory.createDataSource()));
            DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(dataSourceFactory);

            // The equalizer runs inside the player's audio pipeline (see
            // EqAudioProcessor) so it works on every device, unlike the platform
            // audio effects, which often never attach.
            DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this) {
                @Override
                protected AudioSink buildAudioSink(
                        Context context,
                        boolean enableFloatOutput,
                        boolean enableAudioTrackPlaybackParams,
                        boolean enableOffload) {
                    return new DefaultAudioSink.Builder(context)
                            .setEnableFloatOutput(enableFloatOutput)
                            .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                            .setAudioProcessors(new AudioProcessor[] {new EqAudioProcessor()})
                            .build();
                }
            };

            exoPlayer = new ExoPlayer.Builder(this, renderersFactory)
                    .setMediaSourceFactory(mediaSourceFactory)
                    // The second argument enables ExoPlayer's own audio focus
                    // handling. Without it the WebView's embedded player keeps
                    // focus and the stream is routed but produces no sound.
                    .setAudioAttributes(audioAttributes, true)
                    .setWakeMode(C.WAKE_MODE_NETWORK)
                    .build();
            exoPlayer.setVolume(volume);
            exoPlayer.setHandleAudioBecomingNoisy(true);
            exoPlayer.setPlaybackParameters(new PlaybackParameters(speed));

            // Android's Equalizer has to be bound to the player's audio session,
            // which is only known once an audio track is opened.
            exoPlayer.addAnalyticsListener(new AnalyticsListener() {
                @Override
                public void onAudioSessionIdChanged(
                        AnalyticsListener.EventTime eventTime, int audioSessionId) {
                    AudioEffects.get().attach(audioSessionId);
                }

                @Override
                public void onPlaybackStateChanged(AnalyticsListener.EventTime eventTime, int state) {
                    if (state == Player.STATE_BUFFERING) {
                        Log.d(TAG, "buffering at " + eventTime.currentPlaybackPositionMs + "ms, buffered "
                                + eventTime.totalBufferedDurationMs + "ms");
                    }
                }

                @Override
                public void onLoadError(AnalyticsListener.EventTime eventTime,
                                        com.google.android.exoplayer2.source.LoadEventInfo loadEventInfo,
                                        com.google.android.exoplayer2.source.MediaLoadData mediaLoadData,
                                        java.io.IOException error, boolean wasCanceled) {
                    Log.w(TAG, "load error (canceled=" + wasCanceled + "): " + error);
                }
            });

            exoPlayer.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) {
                        Log.d(TAG, "ExoPlayer ready");
                        long dur = exoPlayer.getDuration();
                        if (dur > 0) duration = dur / 1000f;
                        updateMediaSessionMetadata();
                        refreshNotification();
                        refreshPlaybackState();
                    } else if (state == Player.STATE_ENDED) {
                        Log.d(TAG, "ExoPlayer ended");
                        playing = false;
                        stopProgressTicker();
                        refreshNotification();
                        refreshPlaybackState();
                        // One channel only. Emitting "next" here as well advanced
                        // the queue twice, because the JS playbackEnded listener
                        // already runs handleEnded().
                        BackgroundAudioPlugin.sendEvent("playbackEnded", new JSObject());
                    }
                }

                @Override
                public void onIsPlayingChanged(boolean isPlaying) {
                    // READY also occurs while waiting for audio focus. Confirm
                    // ownership only once the player actually starts, including
                    // when focus returns after another app temporarily takes it.
                    playing = isPlaying;
                    if (isPlaying) {
                        mainHandler.removeCallbacks(handoverWatchdog);
                        startProgressTicker();
                        evalRaw("if (window.__frfNativePause) { window.__frfNativePause(); }");
                    } else {
                        stopProgressTicker();
                    }
                    refreshPlaybackState();
                    refreshNotification();
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    Log.e(TAG, "ExoPlayer error: " + error.getMessage(), error);
                    playing = false;
                    stopProgressTicker();
                    refreshNotification();
                    refreshPlaybackState();
                    JSObject err = new JSObject();
                    lastPlaybackError = describePlaybackError(error);
                    err.put("message", lastPlaybackError);
                    BackgroundAudioPlugin.sendEvent("playbackError", err);
                }
            });
        } catch (Throwable t) {
            Log.e(TAG, "Error initializing ExoPlayer", t);
        }
    }

    private void setupMediaSession() {
        try {
            mediaSession = new MediaSessionCompat(this, "FRFMusicPlayback");
            mediaSession.setFlags(
                    MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                            | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            );
            mediaSession.setCallback(new MediaSessionCompat.Callback() {
                @Override
                public void onPlay() {
                    handleUserPlay();
                }

                @Override
                public void onPause() {
                    handleUserPause();
                }

                @Override
                public void onSkipToNext() {
                    handleNextCommand();
                }

                @Override
                public void onSkipToPrevious() {
                    handlePrevCommand();
                }

                @Override
                public void onSeekTo(long posMs) {
                    seekPlayback(posMs / 1000f);
                }
            });
            mediaSession.setActive(true);
            updateMediaSessionMetadata();
            refreshPlaybackState();
        } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_PLAY_URL.equals(action)) {
                handlePlayUrlCommand(intent);
            } else if (ACTION_PAUSE.equals(action)) {
                pausePlayback();
            } else if (ACTION_RESUME.equals(action)) {
                resumePlayback();
            } else if (ACTION_SEEK.equals(action)) {
                float targetPos = intent.getFloatExtra(EXTRA_POSITION, position);
                seekPlayback(targetPos);
            } else if (ACTION_TOGGLE.equals(action)) {
                handleUserToggle();
            } else if (ACTION_NEXT.equals(action)) {
                handleNextCommand();
            } else if (ACTION_PREV.equals(action)) {
                handlePrevCommand();
            } else if (ACTION_STOP.equals(action)) {
                stopPlaybackKeepForeground();
                return START_NOT_STICKY;
            } else if (ACTION_TAKE_OVER.equals(action)) {
                handleTakeOverCommand(intent);
            } else if (ACTION_UPDATE.equals(action)) {
                handleUpdateCommand(intent);
            } else {
                handleUpdateCommand(intent);
            }
        }
        if (playing) mainHandler.removeCallbacks(delayedShutdown);
        acquireLocks();
        startForegroundCompat(buildNotification());
        refreshPlaybackState();
        return START_STICKY;
    }

    private void handlePlayUrlCommand(Intent intent) {
        applyMetadataFromIntent(intent);
        String src = currentSource();
        if (src != null && !src.isEmpty()) {
            startNative(src, position);
        }
    }

    public void setWebAudible(boolean audible) {
        webAudible = audible;
    }

    // The web layer calls this the moment the app starts backgrounding, while
    // its JavaScript is still alive: it hands over the freshest stream URL and
    // position so the takeover does not depend on a JS round-trip after the
    // page has been suspended.
    public void handoverNow(
            String newTitle, String newArtist, String newCover,
            String newStream, String newFile, float pos, float dur) {
        // Capacitor invokes plugin methods on its worker thread; ExoPlayer
        // belongs to the main thread, where Android created this service.
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(() -> handoverNow(
                    newTitle, newArtist, newCover, newStream, newFile, pos, dur));
            return;
        }
        if (newTitle != null && !newTitle.isEmpty()) title = newTitle;
        if (newArtist != null) artist = newArtist;
        if (newCover != null && !newCover.isEmpty() && !newCover.equals(coverUrl)) {
            coverUrl = newCover;
            loadCover();
        }
        streamUrl = newStream;
        filePath = newFile;
        position = Math.max(0f, pos);
        if (dur > 0) duration = dur;
        webAudible = true;
        playing = true;
        takeOver();
    }

    public void takeOver() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(this::takeOver);
            return;
        }
        if (!playing && !webAudible) {
            Log.d(TAG, "takeOver skipped: nothing audible to take over");
            return;
        }
        if (exoPlayer != null && exoPlayer.isPlaying()) return;
        if (exoPlayer != null && exoPlayer.getPlaybackState() == Player.STATE_BUFFERING) return;

        String src = currentSource();
        if (src == null || src.isEmpty()) {
            // Nothing playable was ever handed to the service. The WebView is
            // about to lose its audio, so ask the web layer to resolve a direct
            // stream now — it answers with playUrl().
            Log.w(TAG, "takeOver has no source; requesting a stream from the web layer");
            lastPlaybackError = "No playable audio source has reached the Android player";
            BackgroundAudioPlugin.sendEvent("requestStream", new JSObject());
            return;
        }

        Log.d(TAG, "takeOver executing for " + src + " at position " + position);
        startNative(src, position);
    }

    private void handleTakeOverCommand(Intent intent) {
        applyMetadataFromIntent(intent);
        takeOver();
    }

    private void handleUpdateCommand(Intent intent) {
        applyMetadataFromIntent(intent);
        refreshNotification();
        updateMediaSessionMetadata();
        refreshPlaybackState();
    }

    private void applyMetadataFromIntent(Intent intent) {
        String newTitle = intent.getStringExtra(EXTRA_TITLE);
        if (newTitle != null && !newTitle.isEmpty()) title = newTitle;

        String newArtist = intent.getStringExtra(EXTRA_ARTIST);
        if (newArtist != null) artist = newArtist;

        if (intent.hasExtra(EXTRA_PLAYING)) {
            playing = intent.getBooleanExtra(EXTRA_PLAYING, playing);
        }

        String newCover = intent.getStringExtra(EXTRA_COVER);
        if (newCover != null && !newCover.isEmpty() && !newCover.equals(coverUrl)) {
            coverUrl = newCover;
            loadCover();
        }

        String newStream = intent.getStringExtra(EXTRA_STREAM_URL);
        if (intent.hasExtra(EXTRA_STREAM_URL)) streamUrl = newStream;

        String newPath = intent.getStringExtra(EXTRA_FILE_PATH);
        if (intent.hasExtra(EXTRA_FILE_PATH)) filePath = newPath;

        if (intent.hasExtra(EXTRA_POSITION)) {
            position = intent.getFloatExtra(EXTRA_POSITION, position);
        }
        if (intent.hasExtra(EXTRA_DURATION)) {
            duration = intent.getFloatExtra(EXTRA_DURATION, duration);
        }
    }

    private synchronized void startNative(String source, float startPos) {
        try {
            lastPlaybackError = null;
            if (exoPlayer == null) {
                setupExoPlayer();
            }
            if (exoPlayer == null) return;

            Log.d(TAG, "startNative: " + source);
            MediaItem mediaItem;
            if (Uri.parse(source).getScheme() != null) {
                mediaItem = MediaItem.fromUri(Uri.parse(source));
            } else {
                String cleanPath = source.replace("file://", "");
                mediaItem = MediaItem.fromUri(Uri.fromFile(new File(cleanPath)));
            }

            long startMs = startPos > 0 ? (long) (startPos * 1000L) : 0L;
            exoPlayer.setMediaItem(mediaItem, startMs);
            exoPlayer.prepare();
            exoPlayer.setPlayWhenReady(true);
            playing = true;
            startProgressTicker();
            updateMediaSessionMetadata();
            refreshNotification();
            refreshPlaybackState();
            scheduleHandoverWatchdog(source);
        } catch (Throwable t) {
            Log.e(TAG, "Failed to start native playback", t);
            playing = false;
            JSObject err = new JSObject();
            lastPlaybackError = describePlaybackError(t);
            err.put("message", lastPlaybackError);
            BackgroundAudioPlugin.sendEvent("playbackError", err);
        }
    }

    public void setVolumeLevel(float level) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(() -> setVolumeLevel(level));
            return;
        }
        volume = Math.max(0f, Math.min(1f, level));
        if (exoPlayer != null) {
            try {
                exoPlayer.setVolume(volume);
            } catch (Exception ignored) {}
        }
    }

    public void setSpeed(float rate) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(() -> setSpeed(rate));
            return;
        }
        speed = rate > 0f ? rate : 1.0f;
        if (exoPlayer != null) {
            try {
                exoPlayer.setPlaybackParameters(new PlaybackParameters(speed));
            } catch (Exception ignored) {}
        }
    }

    public void setEqualizer(
            boolean enabled, int[] bandsDb, int bassBoostLevel, int surroundLevel) {
        AudioEffects.get().set(enabled, bandsDb, bassBoostLevel, surroundLevel);
    }

    private String currentSource() {
        if (filePath != null && !filePath.isEmpty()) return absolutePath(filePath);
        return streamUrl;
    }

    // Called on the main thread by the plugin: ExoPlayer forbids reading its
    // state from Capacitor's worker thread, even when no controls are changed.
    public JSObject getPlaybackStatus() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            throw new IllegalStateException("Playback status must be read on the main thread");
        }
        String state = "idle";
        double currentPosition = Math.max(0f, position);
        double currentDuration = Math.max(0f, duration);
        if (exoPlayer != null) {
            if (exoPlayer.isPlaying()) state = "playing";
            else if (exoPlayer.getPlaybackState() == Player.STATE_BUFFERING) state = "buffering";
            else if (exoPlayer.getPlaybackState() == Player.STATE_READY) state = "paused";
            if (exoPlayer.getCurrentMediaItem() != null) {
                currentPosition = Math.max(0L, exoPlayer.getCurrentPosition()) / 1000d;
                long durationMs = exoPlayer.getDuration();
                if (durationMs > 0) currentDuration = durationMs / 1000d;
            }
        }
        String source = currentSource();
        JSObject result = new JSObject();
        result.put("serviceRunning", true);
        result.put("state", state);
        result.put("currentPosition", currentPosition);
        result.put("duration", currentDuration);
        result.put("hasSource", source != null && !source.isEmpty());
        result.put("lastError", lastPlaybackError != null ? lastPlaybackError : "");
        return result;
    }

    private static String describePlaybackError(Throwable error) {
        StringBuilder description = new StringBuilder();
        Throwable cause = error;
        // Include causes such as HTTP response codes while keeping signed media
        // URLs and local file locations out of the diagnostic exposed to JS.
        for (int depth = 0; cause != null && depth < 4; depth++) {
            if (description.length() > 0) description.append(": ");
            description.append(cause.getClass().getSimpleName());
            String message = cause.getMessage();
            if (message != null && !message.isEmpty()) {
                description.append(" ").append(message
                        .replaceAll("(?i)\\b(?:https?|file|content)://\\S+", "[source]")
                        .replaceAll("[\\r\\n]+", " "));
            }
            if (cause.getCause() == cause) break;
            cause = cause.getCause();
        }
        String safeDescription = description.toString();
        return safeDescription.length() > 500 ? safeDescription.substring(0, 500) : safeDescription;
    }

    // A handover that never produces audio is indistinguishable from silence to
    // the user. If ExoPlayer has not started within a few seconds, ask the web
    // layer for a fresh stream instead of sitting on a dead notification.
    private void scheduleHandoverWatchdog(String source) {
        mainHandler.removeCallbacks(handoverWatchdog);
        pendingWatchdogSource = source;
        mainHandler.postDelayed(handoverWatchdog, 6000);
    }

    private volatile String pendingWatchdogSource;

    private final Runnable handoverWatchdog = new Runnable() {
        @Override
        public void run() {
            try {
                if (exoPlayer != null && exoPlayer.isPlaying()) return;
                if (exoPlayer != null && exoPlayer.getPlaybackState() == Player.STATE_BUFFERING) {
                    mainHandler.postDelayed(this, 4000);
                    return;
                }
                Log.w(TAG, "Handover produced no audio for " + pendingWatchdogSource);
                playing = false;
                // playbackError alone drives recovery. Emitting requestStream here
                // as well raced the two paths against each other: both re-resolved
                // the track and the loser's handover clobbered the winner's.
                JSObject err = new JSObject();
                lastPlaybackError = "Native playback never started";
                err.put("message", lastPlaybackError);
                BackgroundAudioPlugin.sendEvent("playbackError", err);
            } catch (Exception ignored) {}
        }
    };

    public void pausePlayback() {
        mainHandler.removeCallbacks(handoverWatchdog);
        if (exoPlayer != null) {
            try {
                exoPlayer.pause();
            } catch (Exception ignored) {}
        }
        playing = false;
        stopProgressTicker();
        refreshNotification();
        refreshPlaybackState();
    }

    public void resumePlayback() {
        if (exoPlayer != null) {
            try {
                exoPlayer.play();
                playing = true;
                startProgressTicker();
            } catch (Exception ignored) {}
        } else {
            String src = currentSource();
            if (src != null && !src.isEmpty()) {
                startNative(src, position);
                return;
            }
            // ExoPlayer was released and nothing else is cached — the track has
            // to be re-resolved by the web layer.
            BackgroundAudioPlugin.sendEvent("requestStream", new JSObject());
        }
        refreshNotification();
        refreshPlaybackState();
    }

    public void handleUserToggle() {
        if (playing) {
            handleUserPause();
        } else {
            handleUserPlay();
        }
    }

    // Remote commands travel over Capacitor events only. The old code also
    // injected window.__frfBgAction() through bridge.eval(), so a single
    // notification tap was delivered twice — and because the second delivery
    // went through the generic toggle, it inverted the first one.
    public void handleUserPlay() {
        resumePlayback();
        BackgroundAudioPlugin.sendEvent("remotePlay", new JSObject());
    }

    public void handleUserPause() {
        pausePlayback();
        BackgroundAudioPlugin.sendEvent("remotePause", new JSObject());
    }

    public void seekPlayback(float targetPos) {
        position = Math.max(0f, targetPos);
        if (exoPlayer != null) {
            try {
                exoPlayer.seekTo((long) (position * 1000L));
            } catch (Exception ignored) {}
        }
        refreshPlaybackState();
        JSObject data = new JSObject();
        data.put("position", position);
        BackgroundAudioPlugin.sendEvent("remoteSeek", data);
    }

    public void handleNextCommand() {
        BackgroundAudioPlugin.sendEvent("remoteNext", new JSObject());
    }

    public void handlePrevCommand() {
        BackgroundAudioPlugin.sendEvent("remotePrev", new JSObject());
    }

    // The web layer sends stop and then the next track's play command back to
    // back. Demoting the service from the foreground in between meant the play
    // command could not re-promote it while the app was in the background (an
    // Android 12+ crash). So a stop ends playback but keeps the service in the
    // foreground for a moment; a play command in that window cancels the
    // shutdown, and otherwise the service shuts down for real.
    private static final long STOP_GRACE_MS = 4000;

    private final Runnable delayedShutdown = () -> stopPlaybackAndService(-1);

    private void stopPlaybackKeepForeground() {
        stopProgressTicker();
        mainHandler.removeCallbacks(handoverWatchdog);
        if (exoPlayer != null) {
            try {
                exoPlayer.stop();
                exoPlayer.release();
            } catch (Exception ignored) {}
            exoPlayer = null;
        }
        playing = false;
        refreshPlaybackState();
        mainHandler.removeCallbacks(delayedShutdown);
        mainHandler.postDelayed(delayedShutdown, STOP_GRACE_MS);
    }

    // stopSelf(startId), not stopSelf(): the web layer sends stop and then the
    // next track's play command back to back, and a plain stopSelf() destroyed
    // the service after it had accepted that play command, silently killing the
    // new track (it only recovered after the web layer's 15 s confirm timeout).
    // With the id, Android ignores the stop when a newer command has arrived.
    private void stopPlaybackAndService(int startId) {
        mainHandler.removeCallbacks(delayedShutdown);
        stopProgressTicker();
        mainHandler.removeCallbacks(handoverWatchdog);
        if (exoPlayer != null) {
            try {
                exoPlayer.stop();
                exoPlayer.release();
            } catch (Exception ignored) {}
            exoPlayer = null;
        }
        releaseLocks();
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (startId < 0) stopSelf();
        else stopSelf(startId);
    }

    // The app was closed (swiped away): end playback and the notification now,
    // not at the end of the song.
    public void shutdownNow() {
        stopPlaybackAndService(-1);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopPlaybackAndService(-1);
        super.onTaskRemoved(rootIntent);
    }

    private void startProgressTicker() {
        stopProgressTicker();
        mainHandler.post(progressRunnable);
    }

    private void stopProgressTicker() {
        mainHandler.removeCallbacks(progressRunnable);
    }

    private void refreshPlaybackState() {
        if (mediaSession == null) return;
        long posMs;
        if (exoPlayer != null && exoPlayer.isPlaying()) {
            try {
                posMs = exoPlayer.getCurrentPosition();
            } catch (Exception ignored) {
                posMs = (long) (position * 1000f);
            }
        } else {
            posMs = (long) (position * 1000f);
        }

        PlaybackStateCompat.Builder builder = new PlaybackStateCompat.Builder()
                .setActions(
                        PlaybackStateCompat.ACTION_PLAY
                                | PlaybackStateCompat.ACTION_PAUSE
                                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                                | PlaybackStateCompat.ACTION_SEEK_TO
                )
                .setState(
                        playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                        posMs,
                        playing ? 1.0f : 0.0f
                );

        try {
            mediaSession.setPlaybackState(builder.build());
        } catch (Exception ignored) {}
    }

    private void updateMediaSessionMetadata() {
        if (mediaSession == null) return;
        try {
            long durMs = (long) (duration * 1000f);
            MediaMetadataCompat.Builder builder = new MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durMs > 0 ? durMs : -1);

            if (coverBitmap != null) {
                builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, coverBitmap);
                builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, coverBitmap);
            }

            mediaSession.setMetadata(builder.build());
        } catch (Exception ignored) {}
    }

    private void refreshNotification() {
        try {
            startForegroundCompat(buildNotification());
        } catch (Exception ignored) {}
    }

    private void startForegroundCompat(Notification notification) {
        // Android 12+ refuses startForeground() for an app in the background
        // that is not allowed to start one (ForegroundServiceStartNotAllowed).
        // Uncaught here it crashed the whole app the moment a song ended with
        // the app closed to the background, so never let it escape.
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Throwable t) {
            Log.w(TAG, "startForeground refused: " + t);
        }
    }

    private Notification buildNotification() {
        PendingIntent contentIntent = null;
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            contentIntent = PendingIntent.getActivity(
                    this,
                    0,
                    launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(artist)
                .setSmallIcon(R.drawable.ic_stat_music)
                .setOngoing(playing)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(contentIntent)
                .setStyle(
                        new androidx.media.app.NotificationCompat.MediaStyle()
                                .setMediaSession(mediaSession != null ? mediaSession.getSessionToken() : null)
                                .setShowActionsInCompactView(0, 1, 2)
                )
                .addAction(android.R.drawable.ic_media_previous, "Previous", actionIntent(ACTION_PREV, 1))
                .addAction(
                        playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Play",
                        actionIntent(ACTION_TOGGLE, 2)
                )
                .addAction(android.R.drawable.ic_media_next, "Next", actionIntent(ACTION_NEXT, 3));

        if (coverBitmap != null) {
            builder.setLargeIcon(coverBitmap);
        }

        return builder.build();
    }

    private PendingIntent actionIntent(String action, int requestCode) {
        Intent intent = new Intent(this, PlaybackService.class);
        intent.setAction(action);
        return PendingIntent.getService(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void loadCover() {
        final String url = coverUrl;
        if (url == null || url.isEmpty()) return;
        new Thread(() -> {
            final Bitmap bmp = CoverCache.load(this, url);
            if (bmp != null) {
                mainHandler.post(() -> {
                    // A newer track may have replaced this cover while it loaded.
                    if (!url.equals(coverUrl)) return;
                    coverBitmap = bmp;
                    updateMediaSessionMetadata();
                    refreshNotification();
                });
            }
        }, "frf-cover").start();
    }

    private void registerNoisyReceiver() {
        if (!noisyReceiverRegistered) {
            try {
                IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
                registerReceiver(noisyReceiver, filter);
                noisyReceiverRegistered = true;
            } catch (Exception ignored) {}
        }
    }

    private void unregisterNoisyReceiver() {
        if (noisyReceiverRegistered) {
            try {
                unregisterReceiver(noisyReceiver);
            } catch (Exception ignored) {}
                noisyReceiverRegistered = false;
        }
    }

    private String absolutePath(String path) {
        if (Uri.parse(path).getScheme() != null) return path;
        if (path.startsWith("/")) return path;
        return getFilesDir().getAbsolutePath() + "/" + path;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "FRF Music Playback",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setSound(null, null);
            channel.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private void evalJs(String action) {
        evalRaw("if (window.__frfBgAction) { window.__frfBgAction('" + action + "'); }");
    }

    private void evalRaw(String script) {
        final Bridge bridge = bridgeRef;
        if (bridge == null || bridge.getWebView() == null) return;
        final String js = script;
        bridge.getWebView().post(() -> {
            // The page may already be gone (app closed); never let that crash.
            try {
                bridge.eval(js, null);
            } catch (Throwable ignored) {}
        });
    }

    private void acquireLocks() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "frf:music-playback");
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(12 * 60 * 60 * 1000L);
        }

        if (wifiLock == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "frf:wifi-lock");
                wifiLock.setReferenceCounted(false);
            }
        }
        if (wifiLock != null && !wifiLock.isHeld()) {
            wifiLock.acquire();
        }
    }

    private void releaseLocks() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
        }
    }

    @Override
    public void onDestroy() {
        instance = null;
        stopProgressTicker();
        mainHandler.removeCallbacks(handoverWatchdog);
        unregisterNoisyReceiver();
        releaseLocks();
        if (exoPlayer != null) {
            try {
                exoPlayer.stop();
                exoPlayer.release();
            } catch (Exception ignored) {}
            exoPlayer = null;
        }
        if (mediaSession != null) {
            try {
                mediaSession.setActive(false);
                mediaSession.release();
            } catch (Exception ignored) {}
            mediaSession = null;
        }
        AudioEffects.get().release();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
