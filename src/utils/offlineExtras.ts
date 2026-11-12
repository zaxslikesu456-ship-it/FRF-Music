// Lyrics and cover pictures kept on the device for downloaded songs, so a
// downloaded song still shows both with no internet.
//
// Both are saved when a song finishes downloading (and, for songs downloaded
// before this existed, the next time the app starts online). Lyrics are found
// by title and artist; a cover by the picture's identity (the same picture at
// any size, since the app asks for different sizes in different places).
import type { Track } from '../types/music';
import { getPlatformFetch } from './http';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const DB_NAME = 'frf_offline_extras_v1';
const LYRICS = 'lyrics';
const COVERS = 'covers';

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(LYRICS)) d.createObjectStore(LYRICS);
        if (!d.objectStoreNames.contains(COVERS)) d.createObjectStore(COVERS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

async function get<T>(store: string, key: string): Promise<T | null> {
  try {
    const d = await db();
    return await new Promise<T | null>(resolve => {
      const req = d.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function put(store: string, key: string, value: unknown): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>(resolve => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // storage unavailable: it is just not kept
  }
}

// ---------------------------------------------------------------- lyrics

const norm = (s: string) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const lyricsKey = (title: string, artist: string) => `${norm(title)}::${norm(artist)}`;

export function saveOfflineLyrics(title: string, artist: string, lyrics: string): Promise<void> {
  return put(LYRICS, lyricsKey(title, artist), lyrics);
}

export function getOfflineLyrics(title: string, artist: string): Promise<string | null> {
  return get<string>(LYRICS, lyricsKey(title, artist));
}

// ---------------------------------------------------------------- covers

/** The same picture at any size: album art without its size suffix, or the video id. */
export function coverKey(url: string): string | null {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
  const thumb = url.match(/ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{6,})\//);
  if (thumb) return `yt:${thumb[1]}`;
  const art = url.match(/^https?:\/\/[^/]*(?:googleusercontent|ggpht)\.com\/([^=?#]+)/);
  if (art) return `art:${art[1]}`;
  return null;
}

const objectUrls = new Map<string, string>();

/** A picture saved on the device for this address (any size of it), as a local URL. */
export async function getOfflineCoverUrl(url: string): Promise<string | null> {
  const key = coverKey(url);
  if (!key) return null;
  const known = objectUrls.get(key);
  if (known) return known;
  const blob = await get<Blob>(COVERS, key);
  if (!blob) return null;
  const local = URL.createObjectURL(blob);
  objectUrls.set(key, local);
  return local;
}

async function fetchImage(url: string): Promise<Blob | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({ url, responseType: 'blob', connectTimeout: 10000, readTimeout: 10000 });
      if (res.status < 200 || res.status >= 300 || typeof res.data !== 'string') return null;
      const bin = atob(res.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const type = String(res.headers?.['Content-Type'] || res.headers?.['content-type'] || 'image/jpeg');
      return new Blob([bytes], { type });
    }
    const f = (await getPlatformFetch()) || fetch;
    const res = await f(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

/** Saves a song's picture on the device (a medium size: enough for the player, small to keep). */
export async function saveOfflineCover(coverUrl: string | undefined): Promise<void> {
  if (!coverUrl) return;
  const key = coverKey(coverUrl);
  if (!key) return;
  if (await get<Blob>(COVERS, key)) return;
  const id = key.startsWith('yt:') ? key.slice(3) : null;
  const tries = id
    ? [`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, `https://i.ytimg.com/vi/${id}/mqdefault.jpg`]
    : [coverUrl.replace(/=w\d+-h\d+.*$|=s\d+.*$/, '=w544-h544'), coverUrl];
  for (const url of tries) {
    const blob = await fetchImage(url);
    // A missing YouTube thumbnail comes back as a tiny grey stand-in.
    if (blob && blob.size > 2000) {
      await put(COVERS, key, blob);
      return;
    }
  }
}

/** Lyrics and picture for a downloaded song (skips what is already saved). */
export async function saveOfflineExtras(
  track: Track,
  findLyrics: (title: string, artist: string, durationSec: number) => Promise<string | null>
): Promise<void> {
  if (!navigator.onLine) return;
  await saveOfflineCover(track.coverUrl);
  if (!(await getOfflineLyrics(track.title, track.artist))) {
    // 200 s is the stand-in length search results get when YouTube gives none.
    const length = track.duration && track.duration !== 200 ? Math.round(track.duration) : 0;
    const text = await findLyrics(track.title, track.artist, length).catch(() => null);
    if (text) await saveOfflineLyrics(track.title, track.artist, text);
  }
}
