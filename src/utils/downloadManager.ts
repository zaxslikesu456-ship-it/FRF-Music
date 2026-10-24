import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import type { Track } from '../types/music';
import { httpGetJson, httpPostJson, isTauriRuntime } from './http';
import { getPoTokenMinter } from './poToken';
import { recordSource } from './streamHealth';

const IS_NATIVE = Capacitor.isNativePlatform();

// Native probe for stream URLs. The player's real request is an open-ended
// ranged GET, and googlevideo 403s exactly that shape without a poToken while
// still answering tiny probes (bytes=0-0) — so validation has to match what
// playback will send or a dead URL wins the resolver race.
interface StreamProbePlugin {
  probeStreamUrl(options: { url: string }): Promise<{
    status?: number;
    contentType?: string;
    media?: boolean;
  }>;
  mintPoToken?(options: { videoId: string }): Promise<{
    ok?: boolean;
    visitorData?: string;
    contentPot?: string;
    sessionPot?: string;
    error?: string;
  }>;
  // Native Cronet download: fetches a resolved stream URL to the app's private
  // files dir using Chromium's network stack (googlevideo 403s the Java stack
  // that the patched fetch() uses). Returns the absolute file path + size.
  downloadUrl?(options: { url: string; fileName: string }): Promise<{
    path?: string;
    size?: number;
  }>;
  deleteOfflineFile?(options: { path: string }): Promise<void>;
  // Saves a cover image on disk so the notification can show it offline.
  cacheCover?(options: { url: string }): Promise<{ cached?: boolean }>;
  // A second copy of downloads in the shared Music folder (survives uninstall).
  musicBackupInfo?(): Promise<{ supported?: boolean; granted?: boolean }>;
  requestMusicPermission?(): Promise<{ granted?: boolean }>;
  exportToMusic?(options: {
    path: string;
    title: string;
    artist: string;
    youtubeId: string;
  }): Promise<{ ok?: boolean }>;
  deleteMusicCopy?(options: { youtubeId: string }): Promise<{ deleted?: boolean }>;
  listMusicBackups?(): Promise<{
    items?: Array<{
      uri: string;
      name: string;
      title?: string;
      artist?: string;
      duration?: number;
      size?: number;
      youtubeId: string;
    }>;
  }>;
  restoreFromMusic?(options: { uri: string; fileName: string }): Promise<{ path?: string; size?: number }>;
}
const StreamProbe = IS_NATIVE
  ? registerPlugin<StreamProbePlugin>('BackgroundAudio')
  : null;

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
    const started = Date.now();
    try {
      const value = await task();
      recordSource(label.replace(/^(piped|inv|inv-local):.*/, '$1 mirrors'), true, Date.now() - started);
      return value;
    } catch (e) {
      recordSource(label.replace(/^(piped|inv|inv-local):.*/, '$1 mirrors'), false, Date.now() - started, e);
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[streamResolve] ${label}: ${msg.slice(0, 120)}`);
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
// resolved stream URL actually serves bytes. The probe replicates the player's
// open-ended ranged GET: googlevideo answers small ranged probes without a
// poToken but rejects unbounded requests, so a URL that fails here is
// guaranteed to fail the moment playback starts. Fail-open on transport
// errors: only a definitive 401/403/404/410 response rejects the URL, so a
// broken check can never silently kill every stream.
async function validateStreamUrl(url: string): Promise<string> {
  if (!IS_NATIVE) return url;
  // googlevideo answers the Java probe (HttpURLConnection / OkHttp) with HTTP
  // 403 purely because of its TLS fingerprint — the very same URL streams fine
  // through the WebView's Chromium engine and the native Cronet downloader.
  // Probing it here would reject every good URL and break both resolution and
  // downloads, so trust googlevideo URLs outright (the InnerTube player already
  // confirmed the format exists). Non-googlevideo proxies keep the probe below,
  // where an HTML/JSON anti-bot page genuinely must be rejected.
  if (/googlevideo\.com/i.test(url)) return url;
  if (StreamProbe?.probeStreamUrl) {
    try {
      const res = await StreamProbe.probeStreamUrl({ url });
      const status = Number(res?.status ?? 0);
      console.warn(
        `[streamProbe] ${status} ${res?.contentType || '?'} media=${res?.media} ${url.slice(0, 100)}`
      );
      if (status === 401 || status === 403 || status === 404 || status === 410) {
        throw new Error(`Stream HTTP ${status}`);
      }
      // An anti-bot gate in front of a proxy (Anubis, Cloudflare) answers 200
      // with an HTML challenge. ExoPlayer cannot tell that apart from a dead
      // URL until it has already been handed the stream, so a status-only
      // check let those URLs win the resolver race and background playback
      // went silent. `media` is only present when the probe actually read
      // response bytes, so this can never reject on a transport hiccup.
      if (res?.media === false) {
        throw new Error(`Stream not media (${res?.contentType || 'unknown type'})`);
      }
      return url;
    } catch (e) {
      if (e instanceof Error && /^Stream HTTP \d+$/.test(e.message)) throw e;
      if (e instanceof Error && /^Stream not media/.test(e.message)) throw e;
      // Probe unavailable or errored — fall through to the legacy check.
    }
  }
  try {
    const res = await CapacitorHttp.get({
      url,
      headers: { Range: 'bytes=0-0' },
      connectTimeout: 2500,
      readTimeout: 2500,
    });
    const status = res.status;
    if (status === 401 || status === 403 || status === 404 || status === 410) {
      throw new Error(`Stream HTTP ${status}`);
    }
    const headers = res.headers || {};
    const type = String(
      headers['Content-Type'] || headers['content-type'] || ''
    ).toLowerCase();
    if (type.includes('html') || type.includes('json')) {
      throw new Error(`Stream not media (${type})`);
    }
  } catch (e) {
    if (e instanceof Error && /^Stream HTTP \d+$/.test(e.message)) throw e;
    if (e instanceof Error && /^Stream not media/.test(e.message)) throw e;
    // Transport or plugin failure: let the player itself decide.
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
  // The pot parameter on googlevideo URLs carries the CONTENT-bound proof of
  // origin (bound to the video ID), matching how YouTube's own player and
  // yt-dlp attach it; the session-bound token goes in the player request body.
  if (url) return po ? appendPot(url, po.contentPoToken) : url;
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
    // Preferred: mint inside a hidden native WebView running on the real
    // youtube.com origin. The BotGuard VM skips its WebPO stage anywhere else
    // (this app's WebView is https://localhost), so the JS-side minter below
    // can only ever receive the legacy fallback token.
    const native = StreamProbe?.mintPoToken
      ? await StreamProbe.mintPoToken({ videoId: youtubeId }).catch(() => null)
      : null;
    if (native?.ok && native.visitorData && native.contentPot) {
      po = {
        visitorData: native.visitorData,
        contentPoToken: native.contentPot,
        sessionPoToken: native.sessionPot || native.contentPot,
      };
    } else {
      const minter = await getPoTokenMinter(forceRefreshMinter);
      // Without a token this would just replay the plain-client race below.
      if (!minter) throw new Error('No poToken minter');
      po = {
        visitorData: minter.visitorData,
        contentPoToken: await minter.mint(youtubeId),
        sessionPoToken: await minter.mint(minter.visitorData),
      };
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

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function resolveAudioStreamUrlUncached(youtubeId: string): Promise<string> {
  lastResolveNotes = [];
  // Pre-warm the poToken minter in the background so the fallback below does
  // not have to wait for BotGuard attestation from a cold start.
  if (IS_NATIVE) {
    void getPoTokenMinter();
  }
  // Android and iPhone: the full-length TV_SIMPLY/MWEB source goes first, on
  // its own. In the race below the IOS/ANDROID clients answer fastest, but
  // googlevideo cuts their streams off after ~1 MiB, so playback would stop
  // seconds in. On iPhone that failure drops the song to the web player, which
  // iOS silences the moment the app is backgrounded. The PC app plays the stream
  // itself too (so the equalizer can process it), so it needs the same source.
  if (
    (IS_NATIVE && (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios')) ||
    isTauriRuntime()
  ) {
    try {
      return await withTimeout(resolveAudioStreamUrlFull(youtubeId), 20000, 'youtubei timeout');
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      console.warn(`[streamResolve] youtubei: ${msg.slice(0, 120)}`);
      lastResolveNotes.push(`youtubei:${msg}`.slice(0, 60));
    }
  }
  try {
    return await raceFirstUrl([
      // The poToken'd stream goes first: on bot-gated networks it is the only
      // kind googlevideo lets a native player stream open-ended, while the
      // plain mobile-client URLs die with HTTP 403 the moment playback starts.
      () => resolveFromInnerTube(youtubeId, true),
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

// Full-length stream via youtubei.js (TV_SIMPLY, then MWEB + the WebPO tokens
// minted in the native youtube.com WebView). App-client URLs (IOS/ANDROID/VR)
// 403 after the first ~1 MiB, so these are the sources that download to the end.
// Token minting, one request at a time. The Android and PC minters each run in a
// single hidden page and turn away a second request while one is in progress, so
// several downloads (plus playback preparing the next song) asking at once
// mostly got refused, failed and were retried over and over. Queued here, each
// waits its turn instead; a warm minter answers in well under a second.
let mintChain: Promise<unknown> = Promise.resolve();
function oneMintAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = mintChain.then(fn, fn);
  mintChain = run.catch(() => undefined);
  return run;
}

export async function resolveAudioStreamUrlFull(youtubeId: string): Promise<string> {
  const { resolveFullAudioUrl } = await import('./ytjs');
  return resolveFullAudioUrl(youtubeId, preferredItags(), () => oneMintAtATime(async () => {
    // The plugin object accepts any method name, so a missing native method only
    // shows up as a rejected call. Try the native minter (Android) and fall back to
    // the in-page one (iPhone), which cannot always produce the strongest token
    // but does establish the visitor session the TV client needs to answer.
    // The native minter fails now and then (its hidden page can time out), and a
    // failure used to leave the TV source with no session at all, which made it
    // answer "unplayable" and pushed the song onto the sources that cut off
    // after about a minute. A failed attempt resets it, so one retry usually works.
    let native: Awaited<ReturnType<NonNullable<StreamProbePlugin['mintPoToken']>>> | null = null;
    let nativeError = '';
    for (let attempt = 0; StreamProbe && attempt < 2 && !native; attempt++) {
      const tried = await StreamProbe?.mintPoToken?.({ videoId: youtubeId }).catch((e: unknown) => {
        nativeError = String((e as Error)?.message || e);
        return null;
      });
      if (tried?.ok && tried.visitorData && tried.contentPot && tried.sessionPot) {
        native = tried;
      } else {
        nativeError = tried?.error || nativeError || 'no token returned';
        if (attempt === 0) await new Promise(r => setTimeout(r, 600));
      }
    }
    if (!native && StreamProbe?.mintPoToken) {
      // Shown in Playback health even when the in-page minter covers for it.
      recordSource('Native token minter', false, 0, nativeError);
    }
    if (native?.ok && native.visitorData && native.contentPot && native.sessionPot) {
      // Keep YouTube's URL-encoded visitorData: the session token is minted
      // over exactly this string, and a decoded copy no longer matches it.
      return {
        visitorData: native.visitorData,
        contentPot: native.contentPot,
        sessionPot: native.sessionPot,
      };
    }
    // PC: the desktop app mints in a hidden youtube.com window (src-tauri/src/po_token.rs).
    // Tokens minted in the app's own page are not trusted by YouTube.
    const tauriInvoke = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__?.invoke;
    if (tauriInvoke) {
      let pcError = '';
      try {
        const res = JSON.parse(String(await tauriInvoke('mint_po_token', { videoId: youtubeId })));
        if (res?.ok && res.visitorData && res.contentPot && res.sessionPot) {
          return { visitorData: res.visitorData, contentPot: res.contentPot, sessionPot: res.sessionPot };
        }
        pcError = res?.error || 'no token returned';
      } catch (e) {
        pcError = String((e as Error)?.message || e);
      }
      recordSource('PC token minter', false, 0, pcError);
    }
    const minter = await getPoTokenMinter();
    if (!minter) throw new Error('No poToken minter');
    return {
      visitorData: minter.visitorData,
      contentPot: await minter.mint(youtubeId),
      sessionPot: await minter.mint(minter.visitorData),
    };
  }));
}

// Resolve a stream URL that carries a valid content-bound poToken. googlevideo
// answers anonymous Android-app fetches (Cronet / OkHttp / ExoPlayer TLS
// fingerprint) with HTTP 403 unless the URL has an accepted `pot`, and the
// general resolver races a fast token-less client that usually wins. Downloads
// must use this poToken-only path so the native fetch is authorized.
export async function resolveAudioStreamUrlPoToken(youtubeId: string): Promise<string> {
  // Try the cached minter first, then a forced-fresh one if the token is
  // rejected (a poisoned cache would otherwise 403 forever).
  try {
    return await resolveFromInnerTube(youtubeId, true);
  } catch (e) {
    console.warn(`[streamResolve] po attempt failed for ${youtubeId}: ${String((e as Error)?.message).slice(0, 80)}`);
    return await resolveFromInnerTube(youtubeId, true, true);
  }
}

export interface OfflineFileRecord {
  trackId: string;
  path: string;
  webUrl: string;
  size: number;
  downloadedAt: number;
  // Kept so a download can be matched to its Music-folder copy.
  youtubeId?: string;
  title?: string;
  artist?: string;
}

const IS_ANDROID_NATIVE = IS_NATIVE && Capacitor.getPlatform() === 'android';

// Total size of all downloads on this device (used by the auto-download limit).
let usageCache: { at: number; bytes: number } | null = null;
export function getOfflineUsageBytes(): number {
  if (usageCache && Date.now() - usageCache.at < 3000) return usageCache.bytes;
  let bytes = 0;
  try {
    const saved = localStorage.getItem(OFFLINE_KEY);
    const records: OfflineFileRecord[] = saved ? JSON.parse(saved) : [];
    for (const r of records) bytes += Number(r.size) || 0;
  } catch {
    // unreadable: report 0
  }
  usageCache = { at: Date.now(), bytes };
  return bytes;
}

export function keepMusicCopyEnabled(): boolean {
  try {
    const raw =
      localStorage.getItem('bw_music_settings_v11') || localStorage.getItem('bw_music_settings_v1');
    return !raw || JSON.parse(raw).keepMusicCopy !== false;
  } catch {
    return true;
  }
}

function youtubeIdFor(trackId: string, rec?: OfflineFileRecord): string {
  return rec?.youtubeId || /^yt-([A-Za-z0-9_-]{11})$/.exec(trackId)?.[1] || '';
}

// Put a copy of a downloaded song in the Music folder, so it survives an uninstall.
async function exportToMusicFolder(track: Track, path: string): Promise<void> {
  if (!IS_ANDROID_NATIVE || !StreamProbe?.exportToMusic || !path || !keepMusicCopyEnabled()) return;
  const youtubeId = track.youtubeId || youtubeIdFor(track.id);
  if (!youtubeId) return;
  try {
    await StreamProbe.exportToMusic({ path, title: track.title, artist: track.artist, youtubeId });
  } catch {
    // best effort: the private copy is what plays
  }
}

// Make sure every current download also has its Music-folder copy (used when the
// setting is switched on, and once per launch).
export async function syncMusicCopies(tracks: Track[]): Promise<number> {
  if (!IS_ANDROID_NATIVE || !StreamProbe?.exportToMusic || !keepMusicCopyEnabled()) return 0;
  const info = await StreamProbe.musicBackupInfo?.().catch(() => null);
  if (!info?.supported) return 0;
  let done = 0;
  for (const t of tracks) {
    const rec = getOfflineRecord(t.id);
    if (!rec?.path) continue;
    await exportToMusicFolder(t, rec.path);
    done++;
  }
  return done;
}

export interface RestoreResult {
  tracks: Track[];
  skipped: number;
  permissionDenied: boolean;
  unsupported: boolean;
}

// "Artist - Title [id].m4a" -> artist and title. Older copies have no artist part.
export function parseMusicFileName(name: string): { title: string; artist: string } {
  const withoutId = name.replace(/\s*\[[A-Za-z0-9_-]{11}\]\.[A-Za-z0-9]+$/, '');
  const split = withoutId.indexOf(' - ');
  if (split > 0) {
    return { artist: withoutId.slice(0, split).trim(), title: withoutId.slice(split + 3).trim() };
  }
  return { artist: '', title: withoutId.trim() };
}

function isAlreadyOfflineQuick(trackId: string): boolean {
  const rec = getOfflineRecord(trackId);
  return !!rec && (rec.path ? rec.size >= 20000 : rec.size > 0);
}

// After a reinstall: find songs in the Music/FRF Music folder and bring them
// back as downloads. Needs the audio permission, because the new install does not
// own the files the old one created.
export async function restoreDownloadsFromMusic(
  onProgress?: (done: number, total: number) => void
): Promise<RestoreResult> {
  const result: RestoreResult = { tracks: [], skipped: 0, permissionDenied: false, unsupported: false };
  if (!IS_ANDROID_NATIVE || !StreamProbe?.listMusicBackups || !StreamProbe.restoreFromMusic) {
    result.unsupported = true;
    return result;
  }
  const info = await StreamProbe.musicBackupInfo?.().catch(() => null);
  if (!info?.supported) {
    result.unsupported = true;
    return result;
  }
  if (!info.granted) {
    const perm = await StreamProbe.requestMusicPermission?.().catch(() => null);
    if (!perm?.granted) {
      result.permissionDenied = true;
      return result;
    }
  }

  const listing = await StreamProbe.listMusicBackups();
  const items = listing?.items || [];
  let index = 0;
  for (const it of items) {
    index++;
    onProgress?.(index, items.length);
    const trackId = 'yt-' + it.youtubeId;
    if (isAlreadyOfflineQuick(trackId)) {
      result.skipped++;
      continue;
    }
    const ext = /\.([A-Za-z0-9]+)$/.exec(it.name)?.[1] || 'm4a';
    try {
      const res = await StreamProbe.restoreFromMusic({
        uri: it.uri,
        fileName: 'offline-' + trackId + '.' + ext,
      });
      if (!res?.path) continue;
      // The file name is the reliable source: the media scanner overwrites any
      // title/artist stored in the media database.
      const parsed = parseMusicFileName(it.name);
      const title = parsed.title || it.title || 'Song';
      const track: Track = {
        id: trackId,
        title,
        artist: parsed.artist || 'Unknown artist',
        album: 'FRF Music',
        duration: Number(it.duration) || 0,
        url: '',
        coverUrl: 'https://i.ytimg.com/vi/' + it.youtubeId + '/hqdefault.jpg',
        isYouTube: true,
        youtubeId: it.youtubeId,
        addedAt: Date.now(),
      };
      const saved = localStorage.getItem(OFFLINE_KEY);
      const records: OfflineFileRecord[] = (saved ? JSON.parse(saved) : []).filter(
        (r: OfflineFileRecord) => r.trackId !== trackId
      );
      records.push({
        trackId,
        path: res.path,
        webUrl: Capacitor.convertFileSrc(res.path),
        size: Number(res.size) || 0,
        downloadedAt: Date.now(),
        youtubeId: it.youtubeId,
        title,
        artist: track.artist,
      });
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(records));
      result.tracks.push(track);
    } catch {
      // skip a file that cannot be read; the rest still restore
    }
  }
  return result;
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

// A stored record is only trustworthy if the file behind it still exists and is
// a plausible size. Older builds saved proxy error pages as ".m4a" (a few KB),
// and Android can clear app files; either way the record then claims the track
// is offline while nothing playable exists, and downloads were skipped as
// "already saved". Invalid records are purged so the track can be re-downloaded.
export async function verifyOfflineRecord(trackId: string): Promise<boolean> {
  const rec = getOfflineRecord(trackId);
  if (!rec) return false;
  if (!(IS_NATIVE && rec.path)) return true;
  let ok = rec.size >= 20000;
  if (ok) {
    try {
      const res = await fetch(Capacitor.convertFileSrc(rec.path), { method: 'HEAD' });
      ok = res.ok;
    } catch {
      ok = false;
    }
  }
  if (!ok) await removeOfflineTrack(trackId);
  return ok;
}

export function isTrackDownloadedLocally(trackId: string): boolean {
  return Boolean(getOfflineRecord(trackId));
}

export function isTrackOffline(trackId: string): boolean {
  return Boolean(getOfflineRecord(trackId));
}

// Pick a file extension for a downloaded stream from its googlevideo `mime`
// parameter so the WebView's <audio> element decodes the local file correctly.
function streamExtFromUrl(url: string): string {
  const m = /[?&]mime=audio[%2f/]+([a-z0-9]+)/i.exec(url);
  const t = (m?.[1] || '').toLowerCase();
  if (t.includes('webm') || t.includes('opus')) return 'webm';
  if (t.includes('ogg')) return 'ogg';
  return 'm4a'; // audio/mp4, aac, and the default
}

// Server-side proxy sources. googlevideo 403s the Android-app TLS fingerprint
// (Cronet/OkHttp/ExoPlayer) for anonymous media, even with a valid poToken, so
// the app cannot pull bytes from the CDN directly. Piped/Invidious instances
// fetch googlevideo themselves and re-serve the audio over an ordinary HTTPS
// connection the app CAN read. Returns a list of candidate stream URLs.
// PC: the page cannot fetch googlevideo itself (the browser engine blocks it),
// so the file is pulled through the desktop app's audio proxy
// (src-tauri/src/audio_proxy.rs), which serves at most 1 MiB per request.
// Four ranges are fetched at a time and joined in order.
async function fetchThroughDesktopProxy(url: string, onProgress?: (fraction: number) => void): Promise<Blob> {
  const proxied = `http://frfaudio.localhost/?u=${encodeURIComponent(url)}`;
  const CHUNK = 1024 * 1024;
  const getRange = async (start: number): Promise<{ data: ArrayBuffer; total: number }> => {
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(proxied, { headers: { Range: `bytes=${start}-${start + CHUNK - 1}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const range = res.headers.get('Content-Range') || '';
        const total = Number(range.split('/')[1]) || 0;
        return { data: await res.arrayBuffer(), total };
      } catch (e) {
        lastError = String((e as Error)?.message || e);
        await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    throw new Error(`Download stopped at ${Math.round(start / 1024)} KB (${lastError})`);
  };

  const first = await getRange(0);
  const total = first.total || first.data.byteLength;
  const parts: ArrayBuffer[] = [first.data];
  const starts: number[] = [];
  for (let s = first.data.byteLength; s < total; s += CHUNK) starts.push(s);
  let done = 1;
  const count = starts.length + 1;
  onProgress?.(done / count);
  for (let i = 0; i < starts.length; i += 4) {
    const batch = await Promise.all(starts.slice(i, i + 4).map(getRange));
    for (const b of batch) parts.push(b.data);
    done += batch.length;
    onProgress?.(done / count);
  }
  const type = url.includes('mime=audio%2Fwebm') || url.includes('mime=audio/webm') ? 'audio/webm' : 'audio/mp4';
  return new Blob(parts, { type });
}

async function collectProxyStreamUrls(youtubeId: string): Promise<string[]> {
  const tasks: Array<() => Promise<string>> = [
    ...getPipedBases().map(base => () => resolveFromPiped(base, youtubeId)),
    ...getInvidiousBases().map(base => () => resolveFromInvidious(base, youtubeId, true)),
  ];
  const settled = await Promise.allSettled(tasks.map(t => t()));
  const urls: string[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value && !urls.includes(r.value)) urls.push(r.value);
  }
  return urls;
}

// Keep a song's cover on the device so its notification still has a picture
// when offline.
export async function cacheCoverArt(url?: string): Promise<void> {
  if (!url || !StreamProbe?.cacheCover) return;
  try {
    await StreamProbe.cacheCover({ url });
  } catch {
    // best effort
  }
}

let lastDownloadError = '';
export function getLastDownloadError(): string {
  return lastDownloadError;
}

export async function downloadTrackToFile(
  track: Track,
  onProgress?: (p: { bytes: number; contentLength: number }) => void
): Promise<boolean> {
  if (!track || !track.id) return false;
  const downloadStartedAt = Date.now();
  lastDownloadError = '';
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
    const isAndroidNative = IS_NATIVE && Capacitor.getPlatform() === 'android' && StreamProbe?.downloadUrl;
    let filePath = '';
    let size = 0;
    let webUrl = '';

    if (isAndroidNative && track.isYouTube && track.youtubeId) {
      // Native Android: googlevideo refuses the app's TLS fingerprint, so pull
      // the bytes through a server-side proxy (Piped/Invidious). Only if every
      // proxy fails do we fall back to a direct poToken'd googlevideo URL.
      // Sources are tried one at a time, best first, and the slower ones (mirrors,
      // the other clients) are only looked up if the earlier ones fail. Looking
      // them all up before every download took tens of seconds per song.
      let lastErr = 'no source';
      const youtubeId = track.youtubeId;
      const sources: Array<() => Promise<string[]>> = [
        async () => [await resolveAudioStreamUrlFull(youtubeId)],
        async () => [await resolveAudioStreamUrlPoToken(youtubeId)],
        () => collectProxyStreamUrls(youtubeId),
        async () => [await resolveAudioStreamUrl(youtubeId, true)],
      ];
      const tried = new Set<string>();
      for (const source of sources) {
        if (filePath) break;
        let urls: string[] = [];
        try {
          urls = await source();
        } catch (e) {
          lastErr = String((e as Error)?.message || e);
          continue;
        }
        for (const url of urls) {
          if (!url || tried.has(url)) continue;
          tried.add(url);
          activeDownloadsMap.set(track.id, {
            trackId: track.id, title: track.title, coverUrl: track.coverUrl,
            bytes: 30, total: 100, status: 'downloading',
          });
          notifyDownloadListeners();
          const fileName = `offline-${track.id}.${streamExtFromUrl(url)}`;
          try {
            const res = await StreamProbe!.downloadUrl!({ url, fileName });
            if (res && res.path) {
              filePath = res.path;
              size = Number(res.size) || 0;
              webUrl = Capacitor.convertFileSrc(filePath);
              break;
            }
          } catch (e) {
            lastErr = String((e as Error)?.message || e);
          }
        }
      }
      if (!filePath) throw new Error(`All download sources failed (${lastErr})`);
    } else {
      // Non-Android / no native downloader: resolve and fetch via the web layer.
      let streamUrl = track.url;
      if (track.isYouTube && track.youtubeId) {
        streamUrl = await resolveAudioStreamUrl(track.youtubeId, true);
      }
      if (!streamUrl) throw new Error('No stream URL');

      activeDownloadsMap.set(track.id, {
        trackId: track.id, title: track.title, coverUrl: track.coverUrl,
        bytes: 30, total: 100, status: 'downloading',
      });
      notifyDownloadListeners();

      const blob = isTauriRuntime()
        ? await fetchThroughDesktopProxy(streamUrl, pct => {
            activeDownloadsMap.set(track.id, {
              trackId: track.id, title: track.title, coverUrl: track.coverUrl,
              bytes: 30 + Math.round(pct * 70), total: 100, status: 'downloading',
            });
            notifyDownloadListeners();
          })
        : await (async () => {
            const res = await fetch(streamUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.blob();
          })();
      if (blob.size < 20000) throw new Error(`File too small (${blob.size} bytes)`);
      await storeBlobOffline(track.id, blob);
      webUrl = URL.createObjectURL(blob);
      activeObjectUrls.set(track.id, webUrl);
      size = blob.size;
    }

    if (onProgress) {
      onProgress({ bytes: size, contentLength: size });
    }

    const saved = localStorage.getItem(OFFLINE_KEY);
    const records: OfflineFileRecord[] = saved ? JSON.parse(saved) : [];
    // Replace any existing record for this track
    const filtered = records.filter(r => r.trackId !== track.id);
    filtered.push({
      trackId: track.id,
      path: filePath,
      webUrl,
      size,
      downloadedAt: Date.now(),
      youtubeId: track.youtubeId,
      title: track.title,
      artist: track.artist,
    });
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(filtered));
    void cacheCoverArt(track.coverUrl);
    void exportToMusicFolder(track, filePath);
    recordSource('Download', true, Date.now() - downloadStartedAt);

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
    lastDownloadError = String((err as Error)?.message || err).slice(0, 160);
    recordSource('Download', false, Date.now() - downloadStartedAt, err);
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
      // Native downloads live on the filesystem; remove the file too.
      if (rec.path && IS_NATIVE && StreamProbe?.deleteOfflineFile) {
        void StreamProbe.deleteOfflineFile({ path: rec.path }).catch(() => {});
      }
      // A deleted song must not come back from the Music folder after a reinstall.
      const youtubeId = youtubeIdFor(trackId, rec);
      if (youtubeId && IS_ANDROID_NATIVE && StreamProbe?.deleteMusicCopy) {
        void StreamProbe.deleteMusicCopy({ youtubeId }).catch(() => {});
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
