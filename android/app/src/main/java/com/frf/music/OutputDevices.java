package com.frf.music;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;

/**
 * Works out where the sound is going (a specific Bluetooth headset, wired
 * headphones, USB audio or the phone speaker) so the app can remember an
 * equalizer preset per headphone. No Bluetooth permission is needed; the
 * audio system already reports the product name of connected outputs.
 */
final class OutputDevices {

    private final AudioManager audio;
    private AudioDeviceCallback callback;
    private String lastKey = "";

    OutputDevices(Context context) {
        audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }

    /** The output the sound goes to now: {key, name, kind}. */
    JSObject current() {
        JSObject out = new JSObject();
        String key = "speaker";
        String name = "Phone speaker";
        String kind = "speaker";
        if (audio != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            AudioDeviceInfo best = null;
            int bestRank = 0;
            for (AudioDeviceInfo d : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int rank = rankOf(d.getType());
                if (rank > bestRank) {
                    best = d;
                    bestRank = rank;
                }
            }
            if (best != null) {
                int type = best.getType();
                CharSequence product = best.getProductName();
                String label = product == null ? "" : product.toString().trim();
                if (isBluetooth(type)) {
                    kind = "bluetooth";
                    name = label.isEmpty() ? "Bluetooth headphones" : label;
                    key = "bt:" + name.toLowerCase();
                } else if (type == AudioDeviceInfo.TYPE_USB_HEADSET
                        || type == AudioDeviceInfo.TYPE_USB_DEVICE
                        || type == AudioDeviceInfo.TYPE_USB_ACCESSORY) {
                    kind = "usb";
                    name = label.isEmpty() ? "USB audio" : label;
                    key = "usb:" + name.toLowerCase();
                } else if (type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                        || type == AudioDeviceInfo.TYPE_WIRED_HEADSET) {
                    kind = "wired";
                    name = "Wired headphones";
                    key = "wired";
                }
            }
        }
        out.put("key", key);
        out.put("name", name);
        out.put("kind", kind);
        return out;
    }

    private static boolean isBluetooth(int type) {
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
            return true;
        }
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && (type == AudioDeviceInfo.TYPE_BLE_HEADSET || type == AudioDeviceInfo.TYPE_BLE_SPEAKER);
    }

    // Higher wins. A connected headset beats the speaker.
    private static int rankOf(int type) {
        if (isBluetooth(type)) return 4;
        if (type == AudioDeviceInfo.TYPE_USB_HEADSET || type == AudioDeviceInfo.TYPE_USB_DEVICE
                || type == AudioDeviceInfo.TYPE_USB_ACCESSORY) return 3;
        if (type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || type == AudioDeviceInfo.TYPE_WIRED_HEADSET) return 2;
        return 0;
    }

    /** Calls back with the new output whenever something is plugged in or removed. */
    void listen(Runnable onChange) {
        if (audio == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M || callback != null) return;
        lastKey = current().optString("key", "");
        callback = new AudioDeviceCallback() {
            @Override
            public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
                check(onChange);
            }

            @Override
            public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                check(onChange);
            }
        };
        audio.registerAudioDeviceCallback(callback, new Handler(Looper.getMainLooper()));
    }

    private void check(Runnable onChange) {
        String key = current().optString("key", "");
        if (!key.equals(lastKey)) {
            lastKey = key;
            onChange.run();
        }
    }

    void stop() {
        if (audio != null && callback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            audio.unregisterAudioDeviceCallback(callback);
        }
        callback = null;
    }
}
