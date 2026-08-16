import { Capacitor } from '@capacitor/core';
import type { Track } from '../types/music';
import { httpGetJson, httpPostJson, isTauriRuntime } from './http';

const IS_NATIVE = Capacitor.isNativePlatform();
const OFFLINE_KEY = 'bw_music_offline_files_v1';
const USE_YT_PROXY = import.meta.env.DEV && !IS_NATIVE && !isTauriRuntime();

export interface ActiveDownload {
  trackId: string;
  title: string;
  coverUrl?: string;
  bytes: number;
  total: number;
  status: 'resolving' | 'downloading' | 'done' | 'failed';
}

const activeDownloadsMap = new Map<string, ActiveDownload>();
const downloadListeners = new Set<() => void>();

function notifyDownloadListeners() {
  downloadListeners.forEach(fn => fn());
}

export function subscribeDownloads(listener: () => void) {
  downloadListeners.add(listener);
  return () => {
    downloadListeners.delete(listener);
  };
}

export function getActiveDownloads(): ActiveDownload[] {
  return Array.from(activeDownloadsMap.values());
}

export function cancelDownload(trackId: string) {
  activeDownloadsMap.delete(trackId);
  notifyDownloadListeners();
}

function getInvidiousBases() {
  return [
    'https://inv.nadeko.net/api/v1',
    'https://invidious.nerdvpn.de/api/v1',
    'https://invidious.private.coffee/api/v1',
    'https://yt.artemislena.eu/api/v1',
    'https://inv.tux.pizza/api/v1',
    'https://invidious.drgns.space/api/v1',
    'https://y.com.sb/api/v1',
  ];
}

function getPipedBases() {
  return [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.private.coffee',
    'https://piped-api.lunar.icu',
  ];
}

function preferredItags(): number[] {
  try {
    const raw =
      localStorage.getItem('bw_music_settings_v11') ||
      localStorage.getItem('bw_music_settings_v1');
    if (raw && JSON.parse(raw).downloadQuality === 'low') {
      return [249, 250, 140, 139];
    }
  } catch {
    // default quality
  }
  // 140 = m4a/AAC — starts fastest in WebView2 / Tauri / Chromium
  return [140, 251, 250, 139, 249];
}

function pickAudioUrl(formats: any[]): string | null {
  if (!Array.isArray(formats) || formats.length === 0) return null;
  const withUrl = formats.filter(f => typeof f?.url === 'string' && f.url);
  if (withUrl.length === 0) return null;

  for (const itag of preferredItags()) {
    const hit = withUrl.find(f => Number(f.itag) === itag);
    if (hit?.url) return hit.url;
  }

  const audioOnly = withUrl.find(f => {
    const mime = String(f.mimeType || f.type || '');
    return mime.startsWith('audio/') || mime.includes('audio');
  });
  if (audioOnly?.url) return audioOnly.url;

  return withUrl[0].url;
}

function raceFirstUrl(tasks: Array<() => Promise<string>>): Promise<string> {
  return new Promise((resolve, reject) => {
    let pending = tasks.length;
    let settled = false;
    if (pending === 0) {
      reject(new Error('Could not resolve a downloadable audio stream'));
      return;
    }
    for (const task of tasks) {
      task()
        .then(url => {
          if (settled) return;
          if (url) {
            settled = true;
            resolve(url);
            return;
          }
          pending--;
          if (pending === 0) {
            settled = true;
            reject(new Error('Could not resolve a downloadable audio stream'));
          }
        })
        .catch(() => {
          if (settled) return;
          pending--;
          if (pending === 0) {
            settled = true;
            reject(new Error('Could not resolve a downloadable audio stream'));
          }
        });
    }
  });
}

async function resolveFromCobalt(youtubeId: string): Promise<string> {
  const cobaltBases = ['https://api.cobalt.tools', 'https://co.wuk.sh'];
  for (const base of cobaltBases) {
    try {
      const data = await httpPostJson(
        `${base}/api/json`,
        {
          url: `https://www.youtube.com/watch?v=${youtubeId}`,
          isAudioOnly: true,
          aFormat: 'mp3',
        },
        3000,
        { Accept: 'application/json' }
      );
      if (data?.url && typeof data.url === 'string') {
        return data.url;
      }
    } catch {
      // try next cobalt instance
    }
  }
  throw new Error('Cobalt failed');
}

async function resolveFromInnerTubeClient(youtubeId: string, client: any): Promise<string> {
  const playerUrl = USE_YT_PROXY
    ? '/api/youtubei/player?prettyPrint=false'
    : 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

  const data = await httpPostJson(
    playerUrl,
    {
      context: {
        client: {
          clientName: client.clientName,
          clientVersion: client.clientVersion,
          hl: 'en',
          gl: 'US',
        },
      },
      videoId: youtubeId,
      contentCheckOk: true,
      racyCheckOk: true,
    },
    2500,
    {
      'User-Agent': client.userAgent,
      'X-YouTube-Client-Name': client.clientId,
      'X-YouTube-Client-Version': client.clientVersion,
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/',
    }
  );

  const status = data?.playabilityStatus?.status;
  if (status && status !== 'OK') throw new Error('Status not OK');

  const url = pickAudioUrl([
    ...(data?.streamingData?.adaptiveFormats || []),
    ...(data?.streamingData?.formats || []),
  ]);
  if (url) return url;
  throw new Error('No audio URL found');
}

async function resolveFromInnerTube(youtubeId: string): Promise<string> {
  const clients = [
    {
      clientName: 'IOS',
      clientVersion: '19.29.1',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      userAgent: 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
      clientId: '5',
    },
    {
      clientName: 'ANDROID',
      clientVersion: '19.29.1',
      userAgent: 'com.google.android.youtube/19.29.1 (Linux; U; Android 14; en_US) gzip',
      clientId: '3',
    },
    {
      clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      clientVersion: '2.0',
      userAgent: 'Mozilla/5.0 (PlayStation 4 10.01) AppleWebKit/605.1.15 (KHTML, like Gecko)',
      clientId: '85',
    },
    {
      clientName: 'WEB_REMIX',
      clientVersion: '1.20260812.01.00',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
      clientId: '67',
    },
  ];

  return raceFirstUrl(clients.map(c => () => resolveFromInnerTubeClient(youtubeId, c)));
}

async function resolveFromPiped(base: string, youtubeId: string): Promise<string> {
  const data = await httpGetJson(`${base}/streams/${youtubeId}`, 4000);
  const streams: any[] = data.audioStreams || [];
  const m4a = streams.find(
    (s: any) =>
      s?.url &&
      ((s.mimeType || '').includes('mp4') || (s.codec || '').includes('mp4a'))
  );
  if (m4a?.url) return m4a.url;
  const ranked = streams
    .filter((s: any) => s?.url)
    .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
  if (ranked[0]?.url) return ranked[0].url;
  throw new Error('No Piped audio stream');
}

async function resolveFromInvidious(
  base: string,
  youtubeId: string,
  local: boolean
): Promise<string> {
  const suffix = local ? '?local=true' : '';
  const data = await httpGetJson(`${base}/videos/${youtubeId}${suffix}`, 4000);
  const url = pickAudioUrl([
    ...(data.adaptiveFormats || []),
    ...(data.formatStreams || []),
  ]);
  if (url) return url;
  throw new Error('No usable format');
}

const inflightResolves = new Map<string, Promise<string>>();

async function resolveAudioStreamUrlUncached(youtubeId: string): Promise<string> {
  try {
    return await raceFirstUrl([
      () => resolveFromInnerTube(youtubeId),
      () => resolveFromCobalt(youtubeId),
      ...getPipedBases().map(base => () => resolveFromPiped(base, youtubeId)),
      ...getInvidiousBases().map(
        base => () => resolveFromInvidious(base, youtubeId, false)
      ),
    ]);
  } catch {
    return await raceFirstUrl(
      getInvidiousBases().map(
        base => () => resolveFromInvidious(base, youtubeId, true)
      )
    );
  }
}

export async function resolveAudioStreamUrl(
  youtubeId: string,
  force = false
): Promise<string> {
  if (!force) {
    const cached = getCachedStreamUrl(youtubeId);
    if (cached) return cached;
    const inflight = inflightResolves.get(youtubeId);
    if (inflight) return inflight;
  }

  const pending = resolveAudioStreamUrlUncached(youtubeId)
    .then(url => {
      setCachedStreamUrl(youtubeId, url);
      return url;
    })
    .finally(() => {
      inflightResolves.delete(youtubeId);
    });

  inflightResolves.set(youtubeId, pending);
  return pending;
}

export interface OfflineFileRecord {
  trackId: string;
  path: string;
  webUrl: string;
  size: number;
  downloadedAt: number;
}

const streamUrlCache = new Map<string, string>();

export function getCachedStreamUrl(youtubeId: string): string | null {
  return streamUrlCache.get(youtubeId) || null;
}

export function setCachedStreamUrl(youtubeId: string, url: string): void {
  streamUrlCache.set(youtubeId, url);
}

export function dropCachedStreamUrl(youtubeId: string): void {
  streamUrlCache.delete(youtubeId);
}

// =========================================================================
// INDEXEDDB OFFLINE STORAGE FOR DESKTOP / WEB (PERMANENT AUDIO BLOB STORE)
// =========================================================================
function openDownloadsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('bw_music_offline_db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeBlobOffline(trackId: string, blob: Blob): Promise<void> {
  const db = await openDownloadsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const req = store.put(blob, trackId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

const activeObjectUrls = new Map<string, string>();

export async function getOfflinePlaybackUrlAsync(trackId: string): Promise<string | null> {
  const rec = getOfflineRecord(trackId);
  if (!rec) return null;
  if (IS_NATIVE && rec.path) {
    return Capacitor.convertFileSrc(rec.path);
  }
  if (activeObjectUrls.has(trackId)) {
    return activeObjectUrls.get(trackId)!;
  }
  try {
    const db = await openDownloadsDB();
    const blob = await new Promise<Blob | null>(resolve => {
      const tx = db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const req = store.get(trackId);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => resolve(null);
    });
    if (blob) {
      const url = URL.createObjectURL(blob);
      activeObjectUrls.set(trackId, url);
      return url;
    }
  } catch {
    // fallback to stored webUrl if any
  }
  return rec.webUrl || null;
}

export function getOfflinePlaybackUrl(trackId: string): string | null {
  const rec = getOfflineRecord(trackId);
  if (!rec) return null;
  if (IS_NATIVE && rec.path) {
    return Capacitor.convertFileSrc(rec.path);
  }
  if (activeObjectUrls.has(trackId)) {
    return activeObjectUrls.get(trackId)!;
  }
  return rec.webUrl || null;
}

export function getOfflineRecord(trackId: string): OfflineFileRecord | null {
  try {
    const saved = localStorage.getItem(OFFLINE_KEY);
    if (!saved) return null;
    const records: OfflineFileRecord[] = JSON.parse(saved);
    return records.find(r => r.trackId === trackId) || null;
  } catch {
    return null;
  }
}

export function isTrackDownloadedLocally(trackId: string): boolean {
  return Boolean(getOfflineRecord(trackId));
}

export function isTrackOffline(trackId: string): boolean {
  return Boolean(getOfflineRecord(trackId));
}

export async function downloadTrackToFile(
  track: Track,
  onProgress?: (p: { bytes: number; contentLength: number }) => void
): Promise<boolean> {
  if (!track || !track.id) return false;
  activeDownloadsMap.set(track.id, {
    trackId: track.id,
    title: track.title,
    coverUrl: track.coverUrl,
    bytes: 0,
    total: 100,
    status: 'resolving',
  });
  notifyDownloadListeners();

  try {
    let streamUrl = track.url;
    if (track.isYouTube && track.youtubeId) {
      streamUrl = await resolveAudioStreamUrl(track.youtubeId, true);
    }
    if (!streamUrl) throw new Error('No stream URL');

    activeDownloadsMap.set(track.id, {
      trackId: track.id,
      title: track.title,
      coverUrl: track.coverUrl,
      bytes: 30,
      total: 100,
      status: 'downloading',
    });
    notifyDownloadListeners();

    const res = await fetch(streamUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();

    await storeBlobOffline(track.id, blob);
    const webUrl = URL.createObjectURL(blob);
    activeObjectUrls.set(track.id, webUrl);

    if (onProgress) {
      onProgress({ bytes: blob.size, contentLength: blob.size });
    }

    const saved = localStorage.getItem(OFFLINE_KEY);
    const records: OfflineFileRecord[] = saved ? JSON.parse(saved) : [];
    // Replace any existing record for this track
    const filtered = records.filter(r => r.trackId !== track.id);
    filtered.push({
      trackId: track.id,
      path: '',
      webUrl,
      size: blob.size,
      downloadedAt: Date.now(),
    });
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(filtered));

    activeDownloadsMap.set(track.id, {
      trackId: track.id,
      title: track.title,
      coverUrl: track.coverUrl,
      bytes: 100,
      total: 100,
      status: 'done',
    });
    notifyDownloadListeners();
    setTimeout(() => cancelDownload(track.id), 2000);
    return true;
  } catch (err) {
    console.error('Download failed for track:', track.id, err);
    activeDownloadsMap.set(track.id, {
      trackId: track.id,
      title: track.title,
      coverUrl: track.coverUrl,
      bytes: 0,
      total: 100,
      status: 'failed',
    });
    notifyDownloadListeners();
    return false;
  }
}

export async function deleteOfflineFile(trackId: string): Promise<void> {
  return removeOfflineTrack(trackId);
}

export async function removeOfflineTrack(trackId: string): Promise<void> {
  try {
    const saved = localStorage.getItem(OFFLINE_KEY);
    if (!saved) return;
    let records: OfflineFileRecord[] = JSON.parse(saved);
    const rec = records.find(r => r.trackId === trackId);

    if (rec) {
      const objUrl = activeObjectUrls.get(trackId);
      if (objUrl) {
        URL.revokeObjectURL(objUrl);
        activeObjectUrls.delete(trackId);
      }
      try {
        const db = await openDownloadsDB();
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').delete(trackId);
      } catch {
        // ignore
      }
      records = records.filter(r => r.trackId !== trackId);
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(records));
    }
  } catch {
    // ignore
  }
}
