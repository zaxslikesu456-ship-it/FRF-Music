import type { Track, Playlist, SettingsState } from '../types/music';

const DB_NAME = 'FRF_Permanent_Library_v1';
const DB_VERSION = 1;
const STORE_NAME = 'app_library_store';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSaveItem(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(value, key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // ignore
  }
}

export async function idbGetItem<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    return new Promise(resolve => {
      req.onsuccess = () => {
        db.close();
        resolve(req.result ?? null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

// Fallback search across historical localStorage keys so app updates never lose data
export function loadFromAnyKey<T>(keys: string[], defaultVal: T): T {
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as T;
        if (!Array.isArray(parsed) && parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          return parsed as T;
        }
      }
    } catch {
      // try next key
    }
  }
  return defaultVal;
}

export interface LibraryBackup {
  version: number;
  timestamp: number;
  tracks: Track[];
  playlists: Playlist[];
  favorites: string[];
  downloads: string[];
  settings?: Partial<SettingsState>;
}

export function exportLibraryBackup(data: {
  tracks: Track[];
  playlists: Playlist[];
  favorites: string[];
  downloads: string[];
  settings: SettingsState;
}) {
  const backup: LibraryBackup = {
    version: 1,
    timestamp: Date.now(),
    tracks: data.tracks,
    playlists: data.playlists,
    favorites: data.favorites,
    downloads: data.downloads,
    settings: data.settings,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `FRF-Music-Backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function parseLibraryBackup(file: File): Promise<LibraryBackup | null> {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data && (Array.isArray(data.tracks) || Array.isArray(data.playlists))) {
      return data as LibraryBackup;
    }
  } catch {
    // invalid JSON
  }
  return null;
}
