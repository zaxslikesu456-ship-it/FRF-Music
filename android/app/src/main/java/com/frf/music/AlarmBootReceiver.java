package com.frf.music;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Re-registers the music alarm after a reboot, an app update or a clock/timezone change. */
public class AlarmBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            AlarmScheduler.restore(context);
        } catch (Throwable ignored) {}
    }
}
