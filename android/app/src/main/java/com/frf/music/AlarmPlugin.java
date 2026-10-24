package com.frf.music;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;

/** Music alarm: schedules AlarmManager alarms that open the app, and reports launches to JS. */
@CapacitorPlugin(
        name = "FrfAlarm",
        permissions = {
            @Permission(alias = "notifications", strings = {"android.permission.POST_NOTIFICATIONS"})
        })
public class AlarmPlugin extends Plugin {

    public static volatile AlarmPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    public static void sendEvent(String name, JSObject data) {
        AlarmPlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners(name, data != null ? data : new JSObject());
        } catch (Exception ignored) {}
    }

    /** Called by MainActivity when it is opened by the alarm. */
    public static void onAlarmLaunch() {
        AlarmScheduler.pendingLaunchAt = System.currentTimeMillis();
        JSObject o = new JSObject();
        o.put("snooze", false);
        sendEvent("alarmFired", o);
    }

    private JSObject state() {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("enabled", AlarmScheduler.isEnabled(c));
        o.put("canScheduleExact", AlarmScheduler.canScheduleExact(c));
        o.put("nextAt", AlarmScheduler.computeNext(c, System.currentTimeMillis()));
        return o;
    }

    @PluginMethod
    public void setAlarm(PluginCall call) {
        Context c = getContext();
        int hour = call.getInt("hour", 7);
        int minute = call.getInt("minute", 0);
        int mask = 0;
        try {
            JSArray days = call.getArray("days");
            if (days != null) {
                JSONArray arr = days;
                for (int i = 0; i < arr.length(); i++) {
                    int d = arr.getInt(i);
                    if (d >= 0 && d <= 6) mask |= 1 << d;
                }
            }
        } catch (Exception ignored) {}
        int snoozeMin = call.getInt("snoozeMinutes", 10);
        c.getSharedPreferences(AlarmScheduler.PREFS, Context.MODE_PRIVATE)
                .edit().putInt("snoozeMinutes", snoozeMin).apply();
        AlarmScheduler.save(c, call.getBoolean("enabled", true), hour, minute, mask);
        AlarmScheduler.schedule(c);
        call.resolve(state());
    }

    @PluginMethod
    public void cancelAlarm(PluginCall call) {
        Context c = getContext();
        AlarmScheduler.save(c, false, 7, 0, 0);
        AlarmScheduler.cancelAll(c);
        call.resolve();
    }

    @PluginMethod
    public void getAlarmState(PluginCall call) {
        call.resolve(state());
    }

    /** Was the app opened by an alarm since the last call? Consumes the flag. */
    @PluginMethod
    public void getAlarmLaunch(PluginCall call) {
        long at = AlarmScheduler.pendingLaunchAt;
        boolean launched = at > 0 && System.currentTimeMillis() - at < AlarmScheduler.LAUNCH_VALID_MS;
        AlarmScheduler.pendingLaunchAt = 0;
        if (launched) cancelNotification();
        JSObject o = new JSObject();
        o.put("launched", launched);
        call.resolve(o);
    }

    @PluginMethod
    public void snooze(PluginCall call) {
        int minutes = call.getInt("minutes", 10);
        cancelNotification();
        AlarmScheduler.pendingLaunchAt = 0;
        AlarmScheduler.scheduleSnooze(getContext(), minutes);
        call.resolve();
    }

    @PluginMethod
    public void stopRinging(PluginCall call) {
        cancelNotification();
        AlarmScheduler.pendingLaunchAt = 0;
        call.resolve();
    }

    private void cancelNotification() {
        try {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(AlarmScheduler.NOTIF_ID);
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject o = new JSObject();
            o.put("granted", true);
            call.resolve(o);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        JSObject o = new JSObject();
        o.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(o);
    }
}
