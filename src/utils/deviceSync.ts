import type { Playlist, Track } from '../types/music';

// Sync between devices. The library state (playlists, likes, history, play counts and
// the listening log) becomes a compact text code or a JSON file, and importing it on
// another device MERGES it into what is already there. Pure functions only (no React,
// no storage), so they can be tested on their own. Only YouTube songs travel: local
// files only exist on one device.

const PREFIX = 'FRFSYNC1';
const MAX_HISTORY = 50;

// ------------------------------------------------------------------- types

export interface SyncLog {
  days: Record<string, number>; // YYYY-MM-DD -> seconds
  artists: Record<string, number>; // artist -> seconds
  songs: Record<string, number>; // track id ("yt-...") -> seconds
  last: Record<string, number>; // track id -> last played (ms)
}

/** What this device has. Track ids are the app's own ("yt-<videoId>"). */
export interface SyncLocal {
  playlists: Playlist[];
  favorites: string[];
  favoriteTracks: Track[];
  recent: Track[];
  playCounts: Record<string, number>;
  log: SyncLog;
  known: Record<string, Track>; // every track object the device knows, by id
}

/** The portable form (what goes in the file / code). Ids are plain video ids. */
export interface SyncData {
  v: 1;
  at: number;
  tracks: Record<string, [string, string, number]>; // videoId -> [title, artist, seconds]
  playlists: { name: string; desc?: string; ids: string[] }[];
  liked: string[]; // newest first
  recent: string[]; // newest first
  counts: Record<string, number>;
  log?: {
    days: Record<string, number>;
    artists: Record<string, number>;
    songs: Record<string, number>;
    last: Record<string, number>;
  };
  skipped?: number; // local-only songs left out
}

export interface SyncSummary {
  playlistsNew: number;
  playlistsUpdated: number;
  playlistSongsAdded: number;
  likesAdded: number;
  historyAdded: number;
  countsChanged: number;
  logDaysChanged: number;
  tracksRegistered: number;
}

export interface SyncMergeResult {
  playlists: Playlist[];
  favorites: string[];
  favoriteTracks: Track[];
  recent: Track[];
  playCounts: Record<string, number>;
  log: SyncLog;
  newTracks: Track[];
  summary: SyncSummary;
}

// -------------------------------------------------------------- id helpers

const isYt = (id: string) => /^yt-[A-Za-z0-9_-]{11}$/.test(id);
const vid = (id: string) => id.slice(3);
const VID_RE = /^[A-Za-z0-9_-]{11}$/;

export function trackFromSyncEntry(videoId: string, e: [string, string, number]): Track {
  return {
    id: `yt-${videoId}`,
    title: e[0],
    artist: e[1] || 'Unknown artist',
    album: 'Synced',
    duration: e[2] || 0,
    url: '',
    coverUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    isYouTube: true,
    youtubeId: videoId,
    addedAt: Date.now(),
  };
}

// ---------------------------------------------------------------- building

export interface BuildOptions {
  /** Smaller output for a QR code: shorter history, trimmed listening log. */
  lite?: boolean;
}

function topN(rec: Record<string, number>, n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n))
    out[k] = v;
  return out;
}

export function buildSyncData(local: SyncLocal, opts: BuildOptions = {}): SyncData {
  const lite = !!opts.lite;
  const tracks: SyncData['tracks'] = {};
  let skipped = 0;
  const seenSkip = new Set<string>();
  const use = (id: string): string | null => {
    if (!isYt(id)) {
      if (!seenSkip.has(id)) {
        seenSkip.add(id);
        skipped++;
      }
      return null;
    }
    const v = vid(id);
    if (!tracks[v]) {
      const t = local.known[id];
      // A song with no known title can't be shown on the other device; leave it out.
      if (!t || !t.title) return null;
      tracks[v] = [t.title, t.artist || '', Math.round(t.duration || 0)];
    }
    return v;
  };
  const useAll = (ids: string[]) => ids.map(use).filter((x): x is string => !!x);

  const playlists = local.playlists
    .map(p => ({
      name: p.name,
      ...(p.description && !lite ? { desc: p.description } : {}),
      ids: useAll(p.trackIds),
    }))
    .filter(p => p.ids.length > 0);

  const likedIds = [...local.favoriteTracks.map(t => t.id), ...local.favorites];
  const liked = useAll([...new Set(likedIds)]);
  const recent = useAll(local.recent.map(t => t.id).slice(0, lite ? 25 : MAX_HISTORY));

  const counts: Record<string, number> = {};
  const countEntries = Object.entries(local.playCounts).filter(([id]) => isYt(id));
  for (const [id, n] of lite ? countEntries.sort((a, b) => b[1] - a[1]).slice(0, 60) : countEntries) {
    const v = use(id);
    if (v) counts[v] = n;
  }

  // Listening log: song keys become video ids.
  const songSec: Record<string, number> = {};
  for (const [id, s] of Object.entries(local.log.songs)) if (isYt(id)) songSec[id] = s;
  const songKeep = lite ? topN(songSec, 60) : songSec;
  const songs: Record<string, number> = {};
  for (const [id, s] of Object.entries(songKeep)) {
    const v = use(id);
    if (v) songs[v] = Math.round(s);
  }
  const last: Record<string, number> = {};
  for (const [id, ms] of Object.entries(local.log.last)) {
    if (!isYt(id)) continue;
    if (lite && !(songs[vid(id)] !== undefined || recent.includes(vid(id)))) continue;
    const v = tracks[vid(id)] ? vid(id) : use(id);
    if (v) last[v] = ms;
  }
  let days: Record<string, number> = {};
  for (const [k, s] of Object.entries(local.log.days)) days[k] = Math.round(s);
  if (lite) {
    const keys = Object.keys(days).sort().slice(-90);
    days = Object.fromEntries(keys.map(k => [k, days[k]]));
  }
  const artists: Record<string, number> = {};
  for (const [k, s] of Object.entries(lite ? topN(local.log.artists, 40) : local.log.artists))
    artists[k] = Math.round(s);

  const data: SyncData = {
    v: 1,
    at: Date.now(),
    tracks,
    playlists,
    liked,
    recent,
    counts,
    log: { days, artists, songs, last },
  };
  if (skipped) data.skipped = skipped;
  return data;
}

export function isEmptySync(d: SyncData): boolean {
  return (
    d.playlists.length === 0 &&
    d.liked.length === 0 &&
    d.recent.length === 0 &&
    Object.keys(d.counts).length === 0 &&
    !(d.log && Object.keys(d.log.days).length > 0)
  );
}

/** Counts shown before importing: what the data holds. */
export function describeSync(d: SyncData) {
  const playlistSongs = d.playlists.reduce((n, p) => n + p.ids.length, 0);
  return {
    playlists: d.playlists.length,
    playlistSongs,
    liked: d.liked.length,
    recent: d.recent.length,
    counted: Object.keys(d.counts).length,
    logDays: d.log ? Object.keys(d.log.days).length : 0,
    songs: Object.keys(d.tracks).length,
  };
}

// ------------------------------------------------------------------ merging

function maxMerge(a: Record<string, number>, b: Record<string, number>): { out: Record<string, number>; changed: number } {
  const out = { ...a };
  let changed = 0;
  for (const [k, v] of Object.entries(b)) {
    if (typeof v !== 'number' || !isFinite(v)) continue;
    if (!(k in out) || v > out[k]) {
      out[k] = v;
      changed++;
    }
  }
  return { out, changed };
}

const nameKey = (s: string) => s.trim().toLowerCase();

/** Merge incoming data into this device's state. Pure: returns the new state. */
export function mergeSync(local: SyncLocal, inc: SyncData): SyncMergeResult {
  const summary: SyncSummary = {
    playlistsNew: 0,
    playlistsUpdated: 0,
    playlistSongsAdded: 0,
    likesAdded: 0,
    historyAdded: 0,
    countsChanged: 0,
    logDaysChanged: 0,
    tracksRegistered: 0,
  };

  // Track objects for every incoming song this device doesn't know yet.
  const known = { ...local.known };
  const newTracks: Track[] = [];
  const objOf = (v: string): Track | null => {
    const id = `yt-${v}`;
    if (known[id]) return known[id];
    const e = inc.tracks[v];
    if (!e) return null;
    const t = trackFromSyncEntry(v, e);
    known[id] = t;
    newTracks.push(t);
    return t;
  };
  summary.tracksRegistered = 0;

  // Playlists: matched by name; missing songs are appended, existing order is kept.
  const playlists = local.playlists.map(p => ({ ...p, trackIds: [...p.trackIds] }));
  const byName = new Map(playlists.map(p => [nameKey(p.name), p]));
  let stamp = Date.now();
  for (const ip of inc.playlists) {
    const ids = ip.ids.filter(v => VID_RE.test(v) && objOf(v)).map(v => `yt-${v}`);
    if (ids.length === 0) continue;
    const mine = byName.get(nameKey(ip.name));
    if (mine) {
      const have = new Set(mine.trackIds);
      let added = 0;
      for (const id of ids) {
        if (!have.has(id)) {
          have.add(id);
          mine.trackIds.push(id);
          added++;
        }
      }
      if (added > 0) {
        summary.playlistsUpdated++;
        summary.playlistSongsAdded += added;
      }
    } else {
      const fresh: Playlist = {
        id: `playlist-${stamp++}`,
        name: ip.name.trim() || 'Synced playlist',
        description: ip.desc || 'Synced from another device',
        trackIds: [...new Set(ids)],
        createdAt: Date.now(),
      };
      playlists.unshift(fresh);
      byName.set(nameKey(fresh.name), fresh);
      summary.playlistsNew++;
      summary.playlistSongsAdded += fresh.trackIds.length;
    }
  }

  // Likes: union. New ones go in front (newest first), keeping the local order after.
  const favorites = [...local.favorites];
  const favSet = new Set(favorites);
  const favoriteTracks = [...local.favoriteTracks];
  const favObjSet = new Set(favoriteTracks.map(t => t.id));
  const addedLikes: Track[] = [];
  for (const v of inc.liked) {
    if (!VID_RE.test(v)) continue;
    const t = objOf(v);
    if (!t) continue;
    const id = t.id;
    if (!favSet.has(id)) {
      favSet.add(id);
      favorites.push(id);
      summary.likesAdded++;
    }
    if (!favObjSet.has(id)) {
      favObjSet.add(id);
      addedLikes.push(t);
    }
  }
  favoriteTracks.unshift(...addedLikes);

  // Play counts and the listening log: the larger number wins.
  const incCounts: Record<string, number> = {};
  for (const [v, n] of Object.entries(inc.counts)) if (VID_RE.test(v)) incCounts[`yt-${v}`] = n;
  const pc = maxMerge(local.playCounts, incCounts);
  summary.countsChanged = pc.changed;

  const il = inc.log;
  const remap = (rec: Record<string, number> | undefined) => {
    const o: Record<string, number> = {};
    if (rec) for (const [v, n] of Object.entries(rec)) if (VID_RE.test(v)) o[`yt-${v}`] = n;
    return o;
  };
  const days = maxMerge(local.log.days, il?.days || {});
  const artists = maxMerge(local.log.artists, il?.artists || {});
  const songs = maxMerge(local.log.songs, remap(il?.songs));
  const last = maxMerge(local.log.last, remap(il?.last));
  summary.logDaysChanged = days.changed;
  const log: SyncLog = { days: days.out, artists: artists.out, songs: songs.out, last: last.out };

  // History: merged by most recent play time (from the merged log); unknown times sink.
  const localRecentIds = local.recent.map(t => t.id);
  const merged: { t: Track; ts: number; n: number }[] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const t of local.recent) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      merged.push({ t, ts: log.last[t.id] || 0, n: n++ });
    }
  }
  const localSet = new Set(localRecentIds);
  for (const v of inc.recent) {
    if (!VID_RE.test(v)) continue;
    const t = objOf(v);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    merged.push({ t, ts: log.last[t.id] || 0, n: n++ });
  }
  merged.sort((a, b) => b.ts - a.ts || a.n - b.n);
  const recent = merged.slice(0, MAX_HISTORY).map(m => m.t);
  summary.historyAdded = recent.filter(t => !localSet.has(t.id)).length;

  return {
    playlists,
    favorites,
    favoriteTracks,
    recent,
    playCounts: pc.out,
    log,
    newTracks,
    summary: { ...summary, tracksRegistered: newTracks.length },
  };
}

export function summaryIsEmpty(s: SyncSummary): boolean {
  return (
    s.playlistsNew === 0 &&
    s.playlistsUpdated === 0 &&
    s.likesAdded === 0 &&
    s.historyAdded === 0 &&
    s.countsChanged === 0 &&
    s.logDaysChanged === 0
  );
}

// ---------------------------------------------------------------- encoding

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipeThrough(
  data: Uint8Array,
  transform: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(transform as any);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const hasCompression = () =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** The code body (after the prefix): 'z' + deflate+base64url, or 'p' + base64url. */
export async function encodeSyncBody(d: SyncData): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(d));
  if (hasCompression()) {
    return 'z' + toBase64Url(await pipeThrough(json, new CompressionStream('deflate-raw')));
  }
  return 'p' + toBase64Url(json);
}

export async function encodeSyncCode(d: SyncData): Promise<string> {
  return `${PREFIX}:${await encodeSyncBody(d)}`;
}

/** Validates parsed JSON from a file or code and drops anything malformed. */
export function normalizeSync(raw: any): SyncData | null {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  const num = (x: any) => (typeof x === 'number' && isFinite(x) ? x : 0);
  const rec = (o: any, keyOk: (k: string) => boolean = () => true) => {
    const out: Record<string, number> = {};
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (keyOk(k) && typeof v === 'number' && isFinite(v)) out[k] = v;
    return out;
  };
  const ids = (a: any): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && VID_RE.test(x)) : []);
  const tracks: SyncData['tracks'] = {};
  if (raw.tracks && typeof raw.tracks === 'object') {
    for (const [k, e] of Object.entries(raw.tracks as Record<string, any>)) {
      if (VID_RE.test(k) && Array.isArray(e) && typeof e[0] === 'string' && e[0].trim())
        tracks[k] = [e[0], typeof e[1] === 'string' ? e[1] : '', num(e[2])];
    }
  }
  const playlists = Array.isArray(raw.playlists)
    ? raw.playlists
        .filter((p: any) => p && typeof p.name === 'string')
        .map((p: any) => ({
          name: p.name as string,
          ...(typeof p.desc === 'string' ? { desc: p.desc as string } : {}),
          ids: ids(p.ids),
        }))
    : [];
  const out: SyncData = {
    v: 1,
    at: num(raw.at),
    tracks,
    playlists,
    liked: ids(raw.liked),
    recent: ids(raw.recent),
    counts: rec(raw.counts, k => VID_RE.test(k)),
  };
  if (raw.log && typeof raw.log === 'object') {
    out.log = {
      days: rec(raw.log.days, k => /^\d{4}-\d{2}-\d{2}$/.test(k)),
      artists: rec(raw.log.artists),
      songs: rec(raw.log.songs, k => VID_RE.test(k)),
      last: rec(raw.log.last, k => VID_RE.test(k)),
    };
  }
  if (typeof raw.skipped === 'number') out.skipped = raw.skipped;
  return out;
}

async function decodeBody(body: string): Promise<SyncData | null> {
  try {
    const bytes = fromBase64Url(body.slice(1));
    let json: Uint8Array;
    if (body[0] === 'z') {
      if (!hasCompression()) return null;
      json = await pipeThrough(bytes, new DecompressionStream('deflate-raw'));
    } else if (body[0] === 'p') {
      json = bytes;
    } else {
      return null;
    }
    return normalizeSync(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- QR splitting

/** Splits a code body into numbered pieces that each fit one QR code. */
export function splitForQr(body: string, chunkSize = 900): string[] {
  const total = Math.max(1, Math.ceil(body.length / chunkSize));
  const out: string[] = [];
  for (let i = 0; i < total; i++) {
    out.push(`${PREFIX}#${i + 1}/${total}:${body.slice(i * chunkSize, (i + 1) * chunkSize)}`);
  }
  return out;
}

export type SyncParseResult =
  | { ok: true; data: SyncData }
  | { ok: false; error: string; missing?: number[] };

/**
 * Accepts a whole code ("FRFSYNC1:..."), several numbered pieces ("FRFSYNC1#1/3:...")
 * pasted together in any order, or the text of a backup file (JSON).
 */
export async function parseSyncText(text: string): Promise<SyncParseResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Nothing to import yet.' };

  if (trimmed.startsWith('{')) {
    try {
      const d = normalizeSync(JSON.parse(trimmed));
      if (d) return { ok: true, data: d };
    } catch {
      // fall through
    }
    return { ok: false, error: 'This file is not an FRF Music sync file.' };
  }

  const parts = new Map<number, string>();
  let total = 0;
  for (const m of trimmed.matchAll(/FRFSYNC1#(\d+)\/(\d+):([A-Za-z0-9_-]+)/g)) {
    parts.set(Number(m[1]), m[3]);
    total = Math.max(total, Number(m[2]));
  }
  if (parts.size > 0) {
    const missing: number[] = [];
    for (let i = 1; i <= total; i++) if (!parts.has(i)) missing.push(i);
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Part ${missing.join(', ')} of ${total} is missing. Paste all ${total} parts.`,
        missing,
      };
    }
    const body = Array.from({ length: total }, (_, i) => parts.get(i + 1)).join('');
    const d = await decodeBody(body);
    return d ? { ok: true, data: d } : { ok: false, error: 'This code is damaged or incomplete.' };
  }

  const whole = trimmed.match(/FRFSYNC1:([A-Za-z0-9_-]+)/);
  if (whole) {
    const d = await decodeBody(whole[1]);
    return d ? { ok: true, data: d } : { ok: false, error: 'This code is damaged or incomplete.' };
  }
  return { ok: false, error: 'This is not an FRF Music sync code.' };
}
