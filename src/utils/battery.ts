import { Capacitor, registerPlugin } from '@capacitor/core';

// OEM Android builds suspend background work a few minutes after the user
// leaves an app, which stops ExoPlayer mid-track. The manifest already
// declares REQUEST_IGNORE_BATTERY_OPTIMIZATIONS; this asks for it.
interface BatteryPlugin {
  batteryStatus(): Promise<{ ignoring?: boolean }>;
  requestBatteryExemption(): Promise<{ ignoring?: boolean }>;
}

const Battery =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    ? registerPlugin<BatteryPlugin>('BackgroundAudio')
    : null;

/** true = exempt, false = not exempt, null = not Android (nothing to ask). */
export async function checkBatteryExempt(): Promise<boolean | null> {
  if (!Battery) return null;
  try {
    const res = await Battery.batteryStatus();
    return res?.ignoring !== false;
  } catch {
    return null;
  }
}

export async function requestBatteryExemption(): Promise<boolean> {
  if (!Battery) return false;
  try {
    const res = await Battery.requestBatteryExemption();
    return res?.ignoring !== false;
  } catch {
    return false;
  }
}
