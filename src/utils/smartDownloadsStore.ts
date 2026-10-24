import { getOfflineRecord } from './downloadManager';

// Remembers which downloads smart downloads added itself. Only those may ever
// be removed automatically; anything the user saved by hand is never listed here.

const KEY = 'bw_music_smart_dl_v1';
const listeners = new Set<() => void>();

function load(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let owned = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(owned));
  } catch {
    // storage full: the in-memory copy still works this session
  }
  listeners.forEach(fn => fn());
}

export function subscribeSmartOwned(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isSmartOwned(id: string): boolean {
  return id in owned;
}

export function getSmartOwnedIds(): string[] {
  return Object.keys(owned);
}

export function claimSmart(ids: string[]) {
  let changed = false;
  const now = Date.now();
  for (const id of ids) {
    if (!(id in owned)) {
      owned[id] = now;
      changed = true;
    }
  }
  if (changed) save();
}

/** The user took this song over (manual download) or it was removed: forget it. */
export function releaseSmart(ids: string[]) {
  let changed = false;
  for (const id of ids) {
    if (id in owned) {
      delete owned[id];
      changed = true;
    }
  }
  if (changed) save();
}

// Songs the user removed from Downloads by hand: smart downloads must not
// quietly fetch them again. Cleared when the user downloads the song themselves.
const DECLINED_KEY = 'bw_music_smart_dl_declined_v1';

function loadDeclined(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DECLINED_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let declined = loadDeclined();

function saveDeclined() {
  try {
    localStorage.setItem(DECLINED_KEY, JSON.stringify(declined));
  } catch {
    // ignore
  }
}

export function isSmartDeclined(id: string): boolean {
  return id in declined;
}

export function declineSmart(id: string) {
  declined[id] = Date.now();
  saveDeclined();
}

export function undeclineSmart(ids: string[]) {
  let changed = false;
  for (const id of ids) {
    if (id in declined) {
      delete declined[id];
      changed = true;
    }
  }
  if (changed) saveDeclined();
}

/** How many smart-added songs are stored now, and the space they take. */
export function getSmartSummary(): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const id of Object.keys(owned)) {
    const rec = getOfflineRecord(id);
    if (!rec || !(rec.size > 0)) continue;
    count++;
    bytes += rec.size;
  }
  return { count, bytes };
}
