import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { Track } from '../types/music';
import { httpGetJson, httpPostJson, isTauriRuntime } from './http';
import { getPoTokenMinter } from './poToken';

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
    'https://invidious.f5.si/api/v1',
    'https://inv.nadeko.net/api/v1',
    'https://invidious.nerdvpn.de/api/v1',
    'https://invidious.private.coffee/api/v1',
    'https://iv.datura.network/api/v1',
    'https://yewtu.be/api/v1',
    'https://inv.tux.pizza/api/v1',
    'https://invidious.protokolla.fi/api/v1',
    'https://iv.ggtyler.dev/api/v1',
  ];
}

function getPipedBases() {
  return [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.private.coffee',
    'https://pipedapi.reallyaweso.me',
    'https://api.piped.yt',
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
  let withUrl = formats.filter(f => typeof f?.url === 'string' && f.url);
  if (withUrl.length === 0) return null;

  // iOS AVPlayer / WKWebView can only decode MP4/AAC audio (itag 140/139).
  // Opus-in-WebM (itag 249/250/251) plays on Android/Chromium but fails on iPhone.
  if (Capacitor.getPlatform() === 'ios') {
    const mp4Only = withUrl.filter(f => {
      const itag = Number(f.itag);
      const mime = String(f.mimeType || f.type || '');
      return itag === 140 || itag === 139 || mime.includes('mp4') || mime.includes('m4a');
    });
    if (mp4Only.length > 0) withUrl = mp4Only;
  }

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

// Short diagnostics trail from the most recent stream resolution, shown to
// the user (and useful for support) when playback falls back to the player.
let lastResolveNotes: string[] = [];

export function getLastStreamResolveNotes(): string {
  // Keep the FIRST notes: the InnerTube clients fail fast and carry the real
  // reason, while the slow Piped/Invidious timeouts finish last.
  return lastResolveNotes.slice(0, 8).join(' · ');
}

function noted<T>(label: string, task: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await task();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastResolveNotes.push(`${label}:${msg.replace(/^Error: /, '')}`.slice(0, 60));
      throw e;
    }
  };
}

function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

// On native platforms there is no CORS, so we can cheaply verify that a
// resolved googlevideo URL actually serves bytes (some InnerTube clients
// return URLs that answer 403 without a poToken). A dead URL must never win
// the race over a working one from another client. Fail-open on transport
// errors: only a definitive 401/403/404/410 response rejects the URL, so a
// broken check can never silently kill every stream.
async function validateStreamUrl(url: string): Promise<string> {
  if (!Capacitor.isNativePlatform()) return url;
  let status: number;
  try {
    const res = await CapacitorHttp.get({
      url,
      headers: { Range: 'bytes=0-0' },
      connectTimeout: 2500,
      readTimeout: 2500,
    });
    status = res.status;
  } catch {
    // Transport or plugin failure: let the player itself decide.
    return url;
  }
  if (status === 401 || status === 403 || status === 404 || status === 410) {
    throw new Error(`Stream HTTP ${status}`);
  }
  return url;
}

function validated(task: () => Promise<string>): () => Promise<string> {
  return async () => validateStreamUrl(await task());
}

const YTM_API_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';

interface PoContext {
  visitorData: string;
  contentPoToken: string;
  sessionPoToken: string;
}

function appendPot(url: string, sessionPoToken: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}pot=${encodeURIComponent(sessionPoToken)}`;
}

async function resolveFromInnerTubeClient(
  youtubeId: string,
  client: any,
  po?: PoContext
): Promise<string> {
  const playerUrl = USE_YT_PROXY
    ? '/api/youtubei/player?prettyPrint=false'
    : `https://www.youtube.com/youtubei/v1/player?key=${YTM_API_KEY}&prettyPrint=false`;

  const headers: Record<string, string> = {
    'User-Agent': client.userAgent,
    'X-YouTube-Client-Name': client.clientId,
    'X-YouTube-Client-Version': client.clientVersion,
  };

  const contextBody: any = {
    client: {
      clientName: client.clientName,
      clientVersion: client.clientVersion,
      ...(client.deviceMake ? { deviceMake: client.deviceMake } : {}),
      ...(client.deviceModel ? { deviceModel: client.deviceModel } : {}),
      ...(client.osName ? { osName: client.osName } : {}),
      ...(client.osVersion ? { osVersion: client.osVersion } : {}),
      ...(po ? { visitorData: po.visitorData } : {}),
      hl: 'en',
      gl: 'US',
    },
    user: {},
  };

  const data = await httpPostJson(
    playerUrl,
    {
      context: contextBody,
      videoId: youtubeId,
      contentCheckOk: true,
      racyCheckOk: true,
      ...(po ? { serviceIntegrityDimensions: { poToken: po.contentPoToken } } : {}),
    },
    3000,
    headers,
    { bare: true }
  );

  const status = data?.playabilityStatus?.status;
  if (status && status !== 'OK') throw new Error(`Status ${status}`);

  const url = pickAudioUrl([
    ...(data?.streamingData?.adaptiveFormats || []),
    ...(data?.streamingData?.formats || []),
  ]);
  if (url) return po ? appendPot(url, po.sessionPoToken) : url;
  throw new Error('No audio URL found');
}

async function resolveFromInnerTube(
  youtubeId: string,
  usePoToken = false,
  forceRefreshMinter = false
): Promise<string> {
  // On bot-flagged networks, attach a freshly minted poToken: the player
  // request carries a content-bound token (video ID) and the returned stream
  // URL gets a session-bound pot parameter (visitor data).
  let po: PoContext | undefined;
  if (usePoToken) {
    const minter = await getPoTokenMinter(forceRefreshMinter);
    if (minter) {
      try {
        po = {
          visitorData: minter.visitorData,
          contentPoToken: await minter.mint(youtubeId),
          sessionPoToken: await minter.mint(minter.visitorData),
        };
      } catch {
        po = undefined;
      }
    }
  }
  const clients = [
    {
      // The WebPO attestation flow is built for the WEB client (visitorData +
      // poToken). This is the identity that clears YouTube's bot gate on
      // datacenter IPs — e.g. cloud emulators — where mobile clients get 403.
      clientName: 'WEB',
      clientVersion: '2.20260617.01.00',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      clientId: '1',
    },
    {
      // Verified 2026-08: current-version official clients return plain,
      // unciphered MP4 audio URLs (itag 140) without login or poToken — even
      // for VEVO uploads. Outdated client versions get HTTP 400 / LOGIN_REQUIRED.
      clientName: 'IOS',
      clientVersion: '20.10.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iOS',
      osVersion: '18.5.22F77',
      userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_5 like Mac OS X; en_US)',
      clientId: '5',
    },
    {
      clientName: 'ANDROID',
      clientVersion: '20.10.38',
      osName: 'Android',
      osVersion: '14',
      userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
      clientId: '3',
    },
    {
      clientName: 'ANDROID_VR',
      clientVersion: '1.65.10',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      osName: 'Android',
      osVersion: '12L',
      userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
      clientId: '28',
    },
    {
      clientName: 'ANDROID_MUSIC',
      clientVersion: '6.40.52',
      userAgent: 'com.google.android.apps.youtube.music/6.40.52 (Linux; U; Android 14; en_US) gzip',
      clientId: '21',
    },
    {
      // The embedded-player identity is designed for restricted embed contexts.
      clientName: 'WEB_EMBEDDED_PLAYER',
      clientVersion: '1.20240814.00.00',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      clientId: '56',
    },
    {
      clientName: 'TVHTML5',
      clientVersion: '7.20240814.00.00',
      userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.5 TV Safari/537.36',
      clientId: '7',
    },
    {
      clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      clientVersion: '2.0',
      userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/11.50) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/11.50 Safari/605.1.15',
      clientId: '85',
    },
  ];

  return raceFirstUrl(
    clients.map(c =>
      noted(
        po ? `${c.clientName}+po` : c.clientName,
        validated(() => resolveFromInnerTubeClient(youtubeId, c, po))
      )
    )
  );
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
  lastResolveNotes = [];
  // Pre-warm the poToken minter in the background so the fallback below does
  // not have to wait for BotGuard attestation from a cold start.
  if (IS_NATIVE) {
    void getPoTokenMinter();
  }
  try {
    return await raceFirstUrl([
      () => resolveFromInnerTube(youtubeId),
      ...getPipedBases().map(base =>
        noted(`piped:${hostOf(base)}`, validated(() => resolveFromPiped(base, youtubeId)))
      ),
      ...getInvidiousBases().map(base =>
        noted(`inv:${hostOf(base)}`, validated(() => resolveFromInvidious(base, youtubeId, false)))
      ),
    ]);
  } catch {
    // fall through to the retries below
  }

  // Retry: InnerTube with a freshly minted poToken. Bot-flagged networks
  // (very common on cellular) reject anonymous requests with LOGIN_REQUIRED
  // and answer googlevideo with 403, so every source above fails. The
  // ad-free stream is what keeps iOS off the ad-serving YouTube player, so
  // it is worth the extra mint round-trips before giving up.
  if (IS_NATIVE) {
    try {
      return await resolveFromInnerTube(youtubeId, true);
    } catch {
      // poToken path failed — keep going
    }
    // One more pass with a forced-fresh minter: the cached one may be poisoned.
    try {
      return await resolveFromInnerTube(youtubeId, true, true);
    } catch {
      // fresh minter also failed
    }
  }

  return await raceFirstUrl(
    getInvidiousBases().map(base =>
      noted(`inv-local:${hostOf(base)}`, validated(() => resolveFromInvidious(base, youtubeId, true)))
    )
  );
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
