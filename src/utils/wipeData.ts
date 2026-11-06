// "Clear all data": wipes everything the app keeps, not just localStorage.
//
// Clearing localStorage alone left the app's IndexedDB backup of the library
// (FRF_Permanent_Library_v1), which the next launch restored — so tracks,
// playlists, likes, downloads and settings all came back. It also left the
// offline-audio database, Cache Storage, and on Android the downloaded files,
// cached covers and alarms. And the running app wrote its in-memory state
// straight back (on pagehide, save effects), so the wipe ends with a reload and
// is finished again at the next startup before anything else runs.
import { Capacitor, registerPlugin } from '@capacitor/core';

const WIPE_PENDING_KEY = 'frf_wipe_pending';
const KNOWN_DATABASES = ['FRF_Permanent_Library_v1', 'bw_music_offline_db'];

interface ClearDataPlugin {
  clearAppData?(): Promise<void>;
  stop?(): Promise<void>;
}
const NativeAudio = Capacitor.isNativePlatform()
  ? registerPlugin<ClearDataPlugin>('BackgroundAudio')
  : null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))]);
}

async function deleteAllIndexedDb(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const names = new Set(KNOWN_DATABASES);
  try {
    const list = await (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases?.();
    list?.forEach(db => db?.name && names.add(db.name));
  } catch {
    // databases() is not available everywhere; the known names still go
  }
  await Promise.all(
    [...names].map(
      name =>
        new Promise<void>(resolve => {
          try {
            const req = indexedDB.deleteDatabase(name);
            // "blocked" means a connection is still open; the delete completes
            // once the page reloads, and startup deletes again anyway.
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          } catch {
            resolve();
          }
        })
    )
  );
}

async function clearWebStorage(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {
    // ignore
  }
  await deleteAllIndexedDb();
}

/** Wipes all app data and restarts the app (it opens as on first launch). */
export async function wipeAllDataAndRestart(): Promise<void> {
  try {
    await withTimeout(NativeAudio?.stop?.() ?? Promise.resolve(), 1500);
  } catch {
    // ignore
  }
  // Android: downloaded songs, cached covers, alarms, WebView storage, cookies.
  try {
    await withTimeout(NativeAudio?.clearAppData?.() ?? Promise.resolve(), 4000);
  } catch {
    // ignore
  }
  await clearWebStorage();

  // Finish the job at the next startup too, before the app reads anything.
  try {
    localStorage.setItem(WIPE_PENDING_KEY, '1');
  } catch {
    // ignore
  }
  // Nothing may write the old state back between now and the reload.
  try {
    Storage.prototype.setItem = function () {};
    IDBFactory.prototype.open = function () {
      throw new DOMException('App data is being cleared', 'AbortError');
    };
  } catch {
    // ignore
  }
  window.location.reload();
}

/** Run before the app starts: completes a wipe that was started last session. */
export async function finishPendingWipe(): Promise<void> {
  let pending = false;
  try {
    pending = localStorage.getItem(WIPE_PENDING_KEY) === '1';
  } catch {
    return;
  }
  if (!pending) return;
  await clearWebStorage();
}
