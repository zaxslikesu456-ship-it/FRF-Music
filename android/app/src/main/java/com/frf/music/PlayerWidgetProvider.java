package com.frf.music;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;

/**
 * Home-screen widget: cover, title, artist and previous / play-pause / next.
 *
 * PlaybackService pushes its state here whenever the notification refreshes.
 * The buttons send broadcasts to this receiver, which forwards them to the
 * service with the same actions the notification buttons use, but only while
 * the service is running. Starting a foreground service from the background is
 * restricted on Android 12+, so otherwise the buttons just open the app.
 */
public class PlayerWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "FRFWidget";

    private static final String ACTION_WIDGET_PREV = "com.frf.music.widget.PREV";
    private static final String ACTION_WIDGET_TOGGLE = "com.frf.music.widget.TOGGLE";
    private static final String ACTION_WIDGET_NEXT = "com.frf.music.widget.NEXT";

    // RemoteViews travel through a binder transaction with a size limit, so the
    // cover is scaled down to this edge length.
    private static final int COVER_PX = 256;

    // Last state pushed by the service (main thread only, but guarded anyway).
    private static final Object LOCK = new Object();
    private static boolean active = false;
    private static String lastTitle = "";
    private static String lastArtist = "";
    private static boolean lastPlaying = false;
    private static Bitmap lastCoverSource;
    private static Bitmap lastCoverScaled;

    /** Called by PlaybackService when the song, play state or cover changes. */
    public static void update(Context context, String title, String artist,
                              boolean playing, Bitmap cover) {
        try {
            synchronized (LOCK) {
                Bitmap scaled = lastCoverScaled;
                if (cover != lastCoverSource) {
                    scaled = scaleCover(cover);
                }
                String t = title == null ? "" : title;
                String a = artist == null ? "" : artist;
                if (active && t.equals(lastTitle) && a.equals(lastArtist)
                        && playing == lastPlaying && scaled == lastCoverScaled) {
                    return; // nothing the widget shows has changed
                }
                active = true;
                lastTitle = t;
                lastArtist = a;
                lastPlaying = playing;
                lastCoverSource = cover;
                lastCoverScaled = scaled;
                pushAll(context.getApplicationContext());
            }
        } catch (Throwable t) {
            Log.w(TAG, "widget update failed: " + t);
        }
    }

    /** Called by PlaybackService when it stops: shows "Nothing playing". */
    public static void setIdle(Context context) {
        try {
            synchronized (LOCK) {
                if (!active) return;
                active = false;
                lastCoverSource = null;
                lastCoverScaled = null;
                pushAll(context.getApplicationContext());
            }
        } catch (Throwable t) {
            Log.w(TAG, "widget idle failed: " + t);
        }
    }

    private static Bitmap scaleCover(Bitmap src) {
        if (src == null || src.isRecycled() || src.getWidth() <= 0 || src.getHeight() <= 0) return null;
        try {
            // Centre-crop to a square, then shrink.
            int side = Math.min(src.getWidth(), src.getHeight());
            Bitmap square = Bitmap.createBitmap(
                    src, (src.getWidth() - side) / 2, (src.getHeight() - side) / 2, side, side);
            if (side <= COVER_PX) return square;
            return Bitmap.createScaledBitmap(square, COVER_PX, COVER_PX, true);
        } catch (Throwable t) {
            return null;
        }
    }

    private static void pushAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PlayerWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        manager.updateAppWidget(ids, buildViews(context));
    }

    private static PendingIntent openAppIntent(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) return null;
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
                context, 10, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent buttonIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, PlayerWidgetProvider.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(
                context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_player);
        PendingIntent open = openAppIntent(context);
        boolean showPlayer;
        synchronized (LOCK) {
            showPlayer = active && PlaybackService.instance != null;
            if (showPlayer) {
                views.setTextViewText(R.id.widget_title, lastTitle.isEmpty() ? "FRF Music" : lastTitle);
                views.setTextViewText(R.id.widget_artist, lastArtist);
                if (lastCoverScaled != null) {
                    views.setImageViewBitmap(R.id.widget_cover, lastCoverScaled);
                } else {
                    views.setImageViewResource(R.id.widget_cover, R.drawable.ic_stat_music);
                }
                views.setImageViewResource(
                        R.id.widget_play, lastPlaying ? R.drawable.ic_widget_pause : R.drawable.ic_widget_play);
            }
        }
        if (showPlayer) {
            views.setViewVisibility(R.id.widget_controls, View.VISIBLE);
            views.setOnClickPendingIntent(R.id.widget_prev, buttonIntent(context, ACTION_WIDGET_PREV, 11));
            views.setOnClickPendingIntent(R.id.widget_play, buttonIntent(context, ACTION_WIDGET_TOGGLE, 12));
            views.setOnClickPendingIntent(R.id.widget_next, buttonIntent(context, ACTION_WIDGET_NEXT, 13));
        } else {
            views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_idle_title));
            views.setTextViewText(R.id.widget_artist, context.getString(R.string.widget_idle_subtitle));
            views.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher);
            views.setViewVisibility(R.id.widget_controls, View.GONE);
        }
        if (open != null) {
            // Cover, title and artist (and the idle widget as a whole) open the app.
            views.setOnClickPendingIntent(R.id.widget_root, open);
            views.setOnClickPendingIntent(R.id.widget_cover, open);
            views.setOnClickPendingIntent(R.id.widget_info, open);
        }
        return views;
    }

    // Also runs after a reboot or when a widget is added/resized: the service
    // may be gone then, in which case the static state is stale and ignored.
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        try {
            synchronized (LOCK) {
                if (PlaybackService.instance == null) active = false;
            }
            manager.updateAppWidget(appWidgetIds, buildViews(context));
        } catch (Throwable t) {
            Log.w(TAG, "widget onUpdate failed: " + t);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager,
                                          int appWidgetId, android.os.Bundle newOptions) {
        onUpdate(context, manager, new int[] {appWidgetId});
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        String serviceAction = null;
        if (ACTION_WIDGET_PREV.equals(action)) serviceAction = PlaybackService.ACTION_PREV;
        else if (ACTION_WIDGET_TOGGLE.equals(action)) serviceAction = PlaybackService.ACTION_TOGGLE;
        else if (ACTION_WIDGET_NEXT.equals(action)) serviceAction = PlaybackService.ACTION_NEXT;

        if (serviceAction == null) {
            super.onReceive(context, intent);
            return;
        }

        if (PlaybackService.instance != null) {
            // Same intent the notification buttons send. The service is already
            // running in the foreground, so startService is allowed.
            try {
                Intent svc = new Intent(context, PlaybackService.class);
                svc.setAction(serviceAction);
                context.startService(svc);
            } catch (Throwable t) {
                Log.w(TAG, "could not reach the playback service: " + t);
            }
        } else {
            // The widget was stale (the app process died). Do not start a
            // foreground service from here; correct the widget instead.
            synchronized (LOCK) {
                active = false;
            }
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, PlayerWidgetProvider.class));
            if (ids != null && ids.length > 0) manager.updateAppWidget(ids, buildViews(context));
        }
    }
}
