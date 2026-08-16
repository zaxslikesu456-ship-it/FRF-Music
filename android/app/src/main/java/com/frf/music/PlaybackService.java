package com.frf.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.Bridge;
import java.io.InputStream;

public class PlaybackService extends Service {

    public static final String CHANNEL_ID = "aura_playback_channel";
    public static final int NOTIFICATION_ID = 9001;

    public static final String ACTION_TOGGLE = "com.frf.music.action.TOGGLE";
    public static final String ACTION_NEXT = "com.frf.music.action.NEXT";
    public static final String ACTION_PREV = "com.frf.music.action.PREV";
    public static final String ACTION_STOP = "com.frf.music.action.STOP";

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_COVER = "coverUrl";
    public static final String EXTRA_STREAM_URL = "streamUrl";
    public static final String EXTRA_FILE_PATH = "filePath";
    public static final String EXTRA_POSITION = "position";

    public static volatile Bridge bridgeRef;
    public static volatile PlaybackService instance;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private String title = "Aura Music";
    private String artist = "";
    private boolean playing = false;
    private String coverUrl;
    private Bitmap coverBitmap;

    private String streamUrl;
    private String filePath;
    private float position;
    private MediaPlayer mediaPlayer;
    private boolean nativeMode = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
    }

    @Override
    public void onDestroy() {
        instance = null;
        releaseLocks();
        stopNative();
        super.onDestroy();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_TOGGLE.equals(action)) {
                if (nativeMode) {
                    toggleNative();
                } else {
                    evalJs("toggle");
                }
            } else if (ACTION_NEXT.equals(action)) {
                if (!nativeMode) evalJs("next");
            } else if (ACTION_PREV.equals(action)) {
                if (!nativeMode) evalJs("prev");
            } else if (ACTION_STOP.equals(action)) {
                stopNative();
                releaseLocks();
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
                return START_NOT_STICKY;
            } else {
                if (nativeMode) {
                    stopNative();
                }

                String newTitle = intent.getStringExtra(EXTRA_TITLE);
                if (newTitle != null && !newTitle.isEmpty()) {
                    title = newTitle;
                }
                String newArtist = intent.getStringExtra(EXTRA_ARTIST);
                if (newArtist != null) artist = newArtist;
                playing = intent.getBooleanExtra(EXTRA_PLAYING, playing);

                String newCover = intent.getStringExtra(EXTRA_COVER);
                if (newCover != null && !newCover.isEmpty() && !newCover.equals(coverUrl)) {
                    coverUrl = newCover;
                    loadCover();
                }

                String newStream = intent.getStringExtra(EXTRA_STREAM_URL);
                if (newStream != null && !newStream.isEmpty()) streamUrl = newStream;
                String newPath = intent.getStringExtra(EXTRA_FILE_PATH);
                if (newPath != null && !newPath.isEmpty()) filePath = newPath;
                position = intent.getFloatExtra(EXTRA_POSITION, position);
            }
        }
        acquireLocks();
        startForegroundCompat(buildNotification());
        return START_STICKY;
    }

    public void takeOver() {
        if (nativeMode) return;
        if (!playing) return;
        String source = filePath != null ? absolutePath(filePath) : streamUrl;
        if (source == null) return;

        try {
            MediaPlayer player = new MediaPlayer();
            player.setAudioAttributes(
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build()
            );
            player.setDataSource(source);
            player.setOnPreparedListener(mp -> {
                try {
                    if (position > 0) mp.seekTo((int) (position * 1000));
                } catch (Exception ignored) {}
                mp.start();
                playing = true;
                mainHandler.post(this::refreshNotification);
            });
            player.setOnCompletionListener(mp -> {
                playing = false;
                mainHandler.post(this::refreshNotification);
            });
            player.setOnErrorListener((mp, what, extra) -> {
                playing = false;
                return true;
            });
            player.prepareAsync();
            mediaPlayer = player;
            nativeMode = true;
        } catch (Exception e) {
            nativeMode = false;
        }
    }

    private void toggleNative() {
        if (mediaPlayer == null) return;
        try {
            if (mediaPlayer.isPlaying()) {
                mediaPlayer.pause();
                playing = false;
            } else {
                mediaPlayer.start();
                playing = true;
            }
        } catch (Exception ignored) {}
        refreshNotification();
    }

    private void stopNative() {
        if (mediaPlayer != null) {
            try {
                mediaPlayer.stop();
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }
        nativeMode = false;
    }

    private String absolutePath(String path) {
        if (path.startsWith("/")) return path;
        return getFilesDir().getAbsolutePath() + "/" + path;
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void refreshNotification() {
        try {
            startForegroundCompat(buildNotification());
        } catch (Exception ignored) {}
    }

    private Notification buildNotification() {
        PendingIntent contentIntent = null;
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            contentIntent = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE);
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

    private void loadCover() {
        final String url = coverUrl;
        new Thread(() -> {
            try {
                InputStream in = new java.net.URL(url).openStream();
                final Bitmap bmp = BitmapFactory.decodeStream(in);
                in.close();
                if (bmp != null) {
                    mainHandler.post(() -> {
                        coverBitmap = bmp;
                        refreshNotification();
                    });
                }
            } catch (Exception ignored) {}
        }).start();
    }

    private PendingIntent actionIntent(String action, int requestCode) {
        Intent intent = new Intent(this, PlaybackService.class);
        intent.setAction(action);
        return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_IMMUTABLE);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Aura Music Playback", NotificationManager.IMPORTANCE_LOW);
            channel.setSound(null, null);
            channel.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private void evalJs(String action) {
        final Bridge bridge = bridgeRef;
        if (bridge == null || bridge.getWebView() == null) return;
        final String script = "if (window.__frfBgAction) { window.__frfBgAction('" + action + "'); }";
        bridge.getWebView().post(() -> bridge.eval(script, null));
    }

    private void acquireLocks() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "aura:music-playback");
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(12 * 60 * 60 * 1000L);
        }

        if (wifiLock == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "aura:wifi-lock");
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
    public void onTaskRemoved(Intent rootIntent) {
        takeOver();
        super.onTaskRemoved(rootIntent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
