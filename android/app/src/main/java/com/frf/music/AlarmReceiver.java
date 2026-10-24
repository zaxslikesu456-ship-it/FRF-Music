package com.frf.music;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;

/**
 * Fires when the alarm time arrives (also the Stop / Snooze buttons of the alarm
 * notification). Opens the app so the web layer can start the chosen music.
 * A full-screen-intent notification is what lets this work from the background
 * on Android 10+; a direct startActivity() is tried as well.
 */
public class AlarmReceiver extends BroadcastReceiver {
    static final String CHANNEL_ID = "frf_alarm";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        switch (action) {
            case AlarmScheduler.ACTION_FIRE:
                fire(context, nm, intent.getBooleanExtra(AlarmScheduler.EXTRA_SNOOZE, false));
                break;
            case AlarmScheduler.ACTION_STOP:
                if (nm != null) nm.cancel(AlarmScheduler.NOTIF_ID);
                AlarmScheduler.pendingLaunchAt = 0;
                emit("stop");
                break;
            case AlarmScheduler.ACTION_SNOOZE:
                if (nm != null) nm.cancel(AlarmScheduler.NOTIF_ID);
                AlarmScheduler.pendingLaunchAt = 0;
                int mins = context.getSharedPreferences(AlarmScheduler.PREFS, Context.MODE_PRIVATE)
                        .getInt("snoozeMinutes", 10);
                AlarmScheduler.scheduleSnooze(context, mins);
                emit("snooze");
                break;
            default:
                break;
        }
    }

    private static void emit(String what) {
        JSObject o = new JSObject();
        o.put("action", what);
        AlarmPlugin.sendEvent("alarmAction", o);
    }

    private void fire(Context context, NotificationManager nm, boolean snooze) {
        AlarmScheduler.afterFire(context, snooze);
        AlarmScheduler.pendingLaunchAt = System.currentTimeMillis();

        PendingIntent open = AlarmScheduler.openAppIntent(context, AlarmScheduler.REQ_MAIN);
        try {
            if (nm != null) {
                ensureChannel(nm);
                PendingIntent stop = PendingIntent.getBroadcast(context, 1,
                        new Intent(context, AlarmReceiver.class).setAction(AlarmScheduler.ACTION_STOP),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                PendingIntent snz = PendingIntent.getBroadcast(context, 2,
                        new Intent(context, AlarmReceiver.class).setAction(AlarmScheduler.ACTION_SNOOZE),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_stat_music)
                        .setContentTitle("Alarm")
                        .setContentText("Tap to open FRF Music")
                        .setCategory(NotificationCompat.CATEGORY_ALARM)
                        .setPriority(NotificationCompat.PRIORITY_MAX)
                        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                        .setOngoing(true)
                        .setAutoCancel(false)
                        .setContentIntent(open)
                        .setFullScreenIntent(open, true)
                        .addAction(0, "Snooze", snz)
                        .addAction(0, "Stop", stop);
                nm.notify(AlarmScheduler.NOTIF_ID, b.build());
            }
        } catch (Throwable ignored) {}

        // Works when the app is already visible or the system grants the exemption.
        try {
            Intent i = new Intent(context, MainActivity.class);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            i.putExtra(AlarmScheduler.EXTRA_ALARM, true);
            context.startActivity(i);
        } catch (Throwable ignored) {}

        // App process already alive: tell the web layer right away.
        JSObject o = new JSObject();
        o.put("snooze", snooze);
        AlarmPlugin.sendEvent("alarmFired", o);
    }

    private static void ensureChannel(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Alarm", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Music alarm");
        ch.setSound(null, null); // the music itself is the sound
        ch.enableVibration(true);
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }
}
