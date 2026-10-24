import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SettingsState } from '../types/music';
import { getOfflineUsageBytes } from './downloadManager';

// Auto-download: liked songs and chosen playlists are queued for you. Two rules
// can hold those items back: "Wi-Fi only" (never use mobile data) and a storage
// limit (stop once the downloads take up that much space).

interface NetworkPlugin {
  networkStatus?(): Promise<{ connected?: boolean; unmetered?: boolean }>;
}

const Plugin = Capacitor.isNativePlatform() ? registerPlugin<NetworkPlugin>('BackgroundAudio') : null;

// Last known state. Unknown counts as unmetered so a broken check can never
// silently stop downloads.
let unmetered = true;
let monitorStarted = false;

export function isUnmetered(): boolean {
  return unmetered;
}

async function readNetwork(): Promise<boolean> {
  try {
    if (Plugin?.networkStatus) {
      const res = await Plugin.networkStatus();
      return res?.connected === false ? unmetered : !!res?.unmetered;
    }
  } catch {
    // fall through to the browser's own hint
  }
  const type = (navigator as any).connection?.type;
  return type !== 'cellular';
}

export async function refreshNetworkStatus(): Promise<boolean> {
  unmetered = await readNetwork();
  return unmetered;
}

/** Keeps the Wi-Fi/mobile-data state fresh and tells the caller when it changes. */
export function startNetworkMonitor(onChange: () => void) {
  if (monitorStarted) return;
  monitorStarted = true;
  const check = async () => {
    const before = unmetered;
    await refreshNetworkStatus();
    if (unmetered !== before) onChange();
  };
  void check();
  window.addEventListener('online', check);
  window.addEventListener('offline', check);
  (navigator as any).connection?.addEventListener?.('change', check);
  window.setInterval(check, 20000);
}

const MB = 1024 * 1024;

// skipSizeLimit: smart downloads keep to their own storage limit instead.
export function autoDownloadAllowed(settings: SettingsState | undefined, skipSizeLimit = false): boolean {
  if (!settings) return true;
  if (settings.autoDownloadWifiOnly && !unmetered) return false;
  const limitMb = settings.autoDownloadLimitMb || 0;
  if (!skipSizeLimit && limitMb > 0 && getOfflineUsageBytes() >= limitMb * MB) return false;
  return true;
}

export function formatMb(bytes: number): string {
  const mb = bytes / MB;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
