package com.frf.music;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.Calendar;

/**
 * Music alarm scheduling. The time/days are persisted in SharedPreferences so
 * the alarm can be re-registered after a reboot or an app update. Uses
 * AlarmManager.setAlarmClock(), which is exact, shows the system alarm icon and
 * is allowed to fire in Doze.
 */
public final class AlarmScheduler {
    static final String PREFS = "frf_alarm";
    static final String ACTION_FIRE = "com.frf.music.ALARM_FIRE";
    static final String ACTION_STOP = "com.frf.music.ALARM_STOP";
    static final String ACTION_SNOOZE = "com.frf.music.ALARM_SNOOZE";
    static final String EXTRA_ALARM = "frf_alarm";
    static final String EXTRA_SNOOZE = "frf_snooze";
    static final int REQ_MAIN = 7101;
    static final int REQ_SNOOZE = 7102;
    static final int REQ_SHOW = 7103;
    static final int NOTIF_ID = 7104;
    static final long LAUNCH_VALID_MS = 15 * 60 * 1000L;

    /** True when the app was opened by an alarm and JS has not picked that up yet. */
    static volatile long pendingLaunchAt = 0;

    private AlarmScheduler() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context c, boolean enabled, int hour, int minute, int daysMask) {
        prefs(c).edit()
                .putBoolean("enabled", enabled)
                .putInt("hour", hour)
                .putInt("minute", minute)
                .putInt("days", daysMask)
                .apply();
    }

    static boolean isEnabled(Context c) {
        return prefs(c).getBoolean("enabled", false);
    }

    /** Epoch ms of the next regular occurrence after `from`, or 0 when disabled. */
    static long computeNext(Context c, long from) {
        SharedPreferences p = prefs(c);
        if (!p.getBoolean("enabled", false)) return 0;
        int hour = p.getInt("hour", 7);
        int minute = p.getInt("minute", 0);
        int mask = p.getInt("days", 0); // bit 0 = Sunday ... bit 6 = Saturday; 0 = once
        for (int add = 0; add <= 7; add++) {
            Calendar cal = Calendar.getInstance();
            cal.setTimeInMillis(from);
            cal.add(Calendar.DAY_OF_YEAR, add);
            cal.set(Calendar.HOUR_OF_DAY, hour);
            cal.set(Calendar.MINUTE, minute);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            if (cal.getTimeInMillis() <= from) continue;
            int dow = cal.get(Calendar.DAY_OF_WEEK) - 1; // 0 = Sunday
            if (mask == 0 || (mask & (1 << dow)) != 0) return cal.getTimeInMillis();
        }
        return 0;
    }

    static boolean canScheduleExact(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    private static PendingIntent fireIntent(Context c, int req, boolean snooze) {
        Intent i = new Intent(c, AlarmReceiver.class);
        i.setAction(ACTION_FIRE);
        i.putExtra(EXTRA_SNOOZE, snooze);
        return PendingIntent.getBroadcast(
                c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent openAppIntent(Context c, int req) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra(EXTRA_ALARM, true);
        i.setAction(ACTION_FIRE);
        return PendingIntent.getActivity(
                c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void register(Context c, long at, int req, boolean snooze) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        // Tapping the system alarm icon just opens the app (no ringing).
        Intent show = new Intent(c, MainActivity.class);
        show.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent showPi = PendingIntent.getActivity(
                c, REQ_SHOW, show, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent op = fireIntent(c, req, snooze);
        try {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, showPi), op);
        } catch (SecurityException e) {
            // Exact alarms not permitted: fall back to the closest inexact one.
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op);
            } catch (Exception ignored) {}
        }
    }

    /** (Re)registers the regular alarm from the saved settings. */
    static long schedule(Context c) {
        cancelRegular(c);
        long at = computeNext(c, System.currentTimeMillis());
        if (at > 0) register(c, at, REQ_MAIN, false);
        return at;
    }

    static void scheduleSnooze(Context c, int minutes) {
        long at = System.currentTimeMillis() + Math.max(1, minutes) * 60_000L;
        prefs(c).edit().putLong("snoozeAt", at).apply();
        register(c, at, REQ_SNOOZE, true);
    }

    private static void cancelRegular(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(fireIntent(c, REQ_MAIN, false));
    }

    static void cancelAll(Context c) {
        cancelRegular(c);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(fireIntent(c, REQ_SNOOZE, true));
        prefs(c).edit().remove("snoozeAt").apply();
    }

    /** After a reboot / app update / clock change. */
    static void restore(Context c) {
        SharedPreferences p = prefs(c);
        if (p.getBoolean("enabled", false)) schedule(c);
        long snoozeAt = p.getLong("snoozeAt", 0);
        if (snoozeAt > System.currentTimeMillis()) register(c, snoozeAt, REQ_SNOOZE, true);
    }

    /** A regular alarm went off: chain the next occurrence, or switch a one-off alarm off. */
    static void afterFire(Context c, boolean wasSnooze) {
        SharedPreferences p = prefs(c);
        if (wasSnooze) {
            p.edit().remove("snoozeAt").apply();
            return;
        }
        if (p.getInt("days", 0) == 0) {
            p.edit().putBoolean("enabled", false).apply();
        } else {
            schedule(c);
        }
    }
}
