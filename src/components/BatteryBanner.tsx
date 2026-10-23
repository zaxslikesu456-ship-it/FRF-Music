import React, { useEffect, useState } from 'react';
import { BatteryWarning, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { checkBatteryExempt, requestBatteryExemption } from '../utils/battery';

const DISMISS_KEY = 'bw_music_battery_banner_dismissed_v1';

/**
 * On many OEM Android builds (Xiaomi, Samsung, Huawei...) the system suspends
 * background work minutes after leaving the app, which is exactly when music
 * should keep playing. This surfaces the battery-optimization exemption request
 * when it's actually needed, and stays out of the way once dismissed.
 */
export const BatteryBanner: React.FC = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // ignore
    }
    let mounted = true;
    checkBatteryExempt().then(exempt => {
      // Only warn when we positively know the app is NOT exempt.
      if (mounted && exempt === false) setShow(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
  };

  return (
    <div className="mx-4 mt-2 flex items-start gap-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 px-3.5 py-3 text-amber-200">
      <BatteryWarning className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Background playback may stop</p>
        <p className="text-xs opacity-80 mt-0.5">
          Let the app ignore battery optimization so music keeps playing when you leave it.
        </p>
        <div className="flex items-center gap-5 mt-2">
          <button
            onClick={() => {
              void requestBatteryExemption().then(ok => {
                if (ok) dismiss();
              });
            }}
            className="text-xs font-bold underline"
          >
            Fix now
          </button>
          <button onClick={dismiss} className="text-xs opacity-70">
            Not now
          </button>
        </div>
      </div>
      <button onClick={dismiss} className="p-1 shrink-0 opacity-70" title="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
