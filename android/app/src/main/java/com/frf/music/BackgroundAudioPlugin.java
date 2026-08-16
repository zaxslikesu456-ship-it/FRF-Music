package com.frf.music;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        PlaybackService.bridgeRef = getBridge();
        startServiceWith(call);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        PlaybackService.bridgeRef = getBridge();
        startServiceWith(call);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), PlaybackService.class);
        intent.setAction(PlaybackService.ACTION_STOP);
        try {
            getContext().startService(intent);
        } catch (Exception ignored) {}
        call.resolve();
    }

    private void startServiceWith(PluginCall call) {
        Intent intent = new Intent(getContext(), PlaybackService.class);
        intent.putExtra(PlaybackService.EXTRA_TITLE, call.getString("title", "Aura Music"));
        intent.putExtra(PlaybackService.EXTRA_ARTIST, call.getString("artist", ""));
        intent.putExtra(PlaybackService.EXTRA_PLAYING, call.getBoolean("isPlaying", true));

        String cover = call.getString("coverUrl");
        if (cover != null) intent.putExtra(PlaybackService.EXTRA_COVER, cover);
        String stream = call.getString("streamUrl");
        if (stream != null) intent.putExtra(PlaybackService.EXTRA_STREAM_URL, stream);
        String file = call.getString("filePath");
        if (file != null) intent.putExtra(PlaybackService.EXTRA_FILE_PATH, file);
        Float position = call.getFloat("position");
        if (position != null) intent.putExtra(PlaybackService.EXTRA_POSITION, position);

        try {
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (Exception e) {
            try {
                getContext().startService(intent);
            } catch (Exception ignored) {}
        }
    }
}
