// A small local log of what you listen to: seconds per day, per artist and per
// song, plus when each song was last played. Everything stays on the device.
// It backs the listening stats screen, the daily mixes and "Rediscover".
import type { Track } from '../types/music';

const KEY = 'frf_listening_v1';
const DAY_KEEP = 400; // days of history kept

interface Log {
  days: Record<string, number>; // YYYY-MM-DD -> seconds
  artists: Record<string, number>; // artist -> seconds
  songs: Record<string, number>; // track id -> seconds
  last: Record<string, number>; // track id -> last played (ms)
}

let cache: Log | null = null;
let dirty = false;

const empty = (): Log => ({ days: {}, artists: {}, songs: {}, last: {} });

function load(): Log {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cache = parsed && typeof parsed === 'object' ? { ...empty(), ...parsed } : empty();
  } catch {
    cache = empty();
  }
  // keep the day list bounded
  const keys = Object.keys(cache!.days).sort();
  if (keys.length > DAY_KEEP) for (const k of keys.slice(0, keys.length - DAY_KEEP)) delete cache!.days[k];
  return cache!;
}

function save() {
  if (!cache || !dirty) return;
  dirty = false;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage full: drop the oldest days and try once more
    try {
      const keys = Object.keys(cache.days).sort();
      for (const k of keys.slice(0, Math.ceil(keys.length / 2))) delete cache.days[k];
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      // give up quietly
    }
  }
}

export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function artistKey(artist: string): string {
  return (artist || '').split(/,| & | feat\.?| ft\.?| x /i)[0].trim() || 'Unknown artist';
}

/** A song just started. */
export function logPlayStart(track: Track) {
  const log = load();
  log.last[track.id] = Date.now();
  dirty = true;
  save();
}

/** Playback ran for `seconds` more seconds of this song. */
export function logListened(track: Track, seconds: number) {
  if (!(seconds > 0) || seconds > 60) return;
  const log = load();
  const k = dayKey();
  log.days[k] = (log.days[k] || 0) + seconds;
  const a = artistKey(track.artist);
  log.artists[a] = (log.artists[a] || 0) + seconds;
  log.songs[track.id] = (log.songs[track.id] || 0) + seconds;
  log.last[track.id] = Date.now();
  dirty = true;
}

/** Writes pending changes. Called every few ticks and when the app is hidden. */
export function flushListening() {
  save();
}

/** A copy of the whole log (for syncing to another device). */
export function getListeningLog(): Log {
  const l = load();
  return {
    days: { ...l.days },
    artists: { ...l.artists },
    songs: { ...l.songs },
    last: { ...l.last },
  };
}

/** Replaces the log with a merged one (sync import). */
export function replaceListeningLog(next: Log) {
  cache = { ...empty(), ...next };
  const keys = Object.keys(cache.days).sort();
  if (keys.length > DAY_KEEP) for (const k of keys.slice(0, keys.length - DAY_KEEP)) delete cache.days[k];
  dirty = true;
  save();
}

export function getLastPlayed(): Record<string, number> {
  return load().last;
}

export function getArtistSeconds(): Record<string, number> {
  return load().artists;
}

export interface ListeningStats {
  totalSeconds: number;
  weekSeconds: number;
  monthSeconds: number;
  todaySeconds: number;
  currentStreak: number;
  longestStreak: number;
  last14: { key: string; label: string; seconds: number }[];
  topArtists: { name: string; seconds: number }[];
  hasData: boolean;
}

export function computeStats(now: Date = new Date()): ListeningStats {
  const log = load();
  const days = log.days;
  const sum = (from: number) => {
    let s = 0;
    for (let i = 0; i < from; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      s += days[dayKey(d)] || 0;
    }
    return s;
  };
  const totalSeconds = Object.values(days).reduce((a, b) => a + b, 0);

  // Streak: consecutive days with any listening, ending today (or yesterday, so a
  // streak is not lost before you have listened today).
  let currentStreak = 0;
  const cursor = new Date(now);
  if (!(days[dayKey(cursor)] > 0)) cursor.setDate(cursor.getDate() - 1);
  while (days[dayKey(cursor)] > 0) {
    currentStreak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  let longestStreak = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of Object.keys(days).sort()) {
    if (!(days[k] > 0)) continue;
    const [y, m, d] = k.split('-').map(Number);
    const cur = new Date(y, m - 1, d);
    if (prev) {
      const diff = Math.round((cur.getTime() - prev.getTime()) / 86400000);
      run = diff === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    prev = cur;
    if (run > longestStreak) longestStreak = run;
  }

  const last14: ListeningStats['last14'] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    last14.push({
      key: dayKey(d),
      label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
      seconds: days[dayKey(d)] || 0,
    });
  }

  const topArtists = Object.entries(log.artists)
    .map(([name, seconds]) => ({ name, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 8);

  return {
    totalSeconds,
    weekSeconds: sum(7),
    monthSeconds: sum(30),
    todaySeconds: sum(1),
    currentStreak,
    longestStreak,
    last14,
    topArtists,
    hasData: totalSeconds > 0,
  };
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------------------------------------------------------------------------
// Mixes
// ---------------------------------------------------------------------------

export interface Mix {
  id: string;
  title: string;
  subtitle: string;
  tracks: Track[];
}

// Small seeded random so a mix stays the same all day and changes tomorrow.
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: T[], rnd: () => number): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const REDISCOVER_DAYS = 30;

interface MixInput {
  known: Track[]; // every song the app knows about
  favoriteIds: string[];
  playCounts: Record<string, number>;
  day?: string;
}

/** Liked or often played songs you have not played for a while. */
export function buildRediscover({ known, favoriteIds, playCounts }: MixInput): Mix | null {
  const last = getLastPlayed();
  const cutoff = Date.now() - REDISCOVER_DAYS * 86400000;
  const fav = new Set(favoriteIds);
  const rnd = seeded('rediscover' + dayKey());
  const list = known.filter(t => {
    if (!(fav.has(t.id) || (playCounts[t.id] || 0) >= 2)) return false;
    const lp = last[t.id];
    // Songs with no timestamp predate the log; treat them as long unplayed.
    return lp === undefined || lp < cutoff;
  });
  if (list.length < 3) return null;
  const tracks = shuffled(list, rnd).slice(0, 30);
  return {
    id: 'rediscover',
    title: 'Rediscover',
    subtitle: `Songs you loved but haven't played in ${REDISCOVER_DAYS}+ days`,
    tracks,
  };
}

/**
 * Three daily mixes. Each is led by one of your top artists and filled with your
 * own songs that match, then any extra songs passed in (searched suggestions).
 */
function pickLeads({ known, favoriteIds, playCounts }: MixInput) {
  const fav = new Set(favoriteIds);
  const rnd = seeded('daily' + dayKey());
  const byArtist = new Map<string, Track[]>();
  for (const t of known) {
    const a = artistKey(t.artist);
    byArtist.set(a, [...(byArtist.get(a) || []), t]);
  }
  // Score artists by how much you like them.
  const secs = getArtistSeconds();
  const scored = Array.from(byArtist.entries()).map(([name, list]) => {
    let score = (secs[name] || 0) / 60;
    for (const t of list) score += (playCounts[t.id] || 0) * 2 + (fav.has(t.id) ? 3 : 0);
    return { name, list, score };
  });
  const leads = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 9);
  return { pool: shuffled(leads, rnd).slice(0, 3), rnd, fav };
}

export function buildDailyMixes(
  input: MixInput,
  extras: Record<string, Track[]> = {}
): Mix[] {
  const { known } = input;
  const { pool, rnd, fav } = pickLeads(input);
  const mixes: Mix[] = [];
  pool.forEach(lead => {
    const seen = new Set<string>();
    const out: Track[] = [];
    const add = (t: Track) => {
      if (!t || seen.has(t.id)) return;
      seen.add(t.id);
      out.push(t);
    };
    // Your songs by this artist first, then liked songs, then searched extras.
    shuffled(lead.list, rnd).forEach(add);
    shuffled(known.filter(t => fav.has(t.id)), rnd).slice(0, 8).forEach(add);
    (extras[lead.name] || []).forEach(add);
    if (out.length < 4) return;
    mixes.push({
      id: `daily-${mixes.length + 1}`,
      title: `Daily Mix ${mixes.length + 1}`,
      subtitle: `${lead.name} and more`,
      tracks: shuffled(out, rnd).slice(0, 30),
    });
  });
  return mixes;
}

/** The artists today's mixes are built around, so Home can search extra songs for them. */
export function leadArtistsForToday(input: MixInput): string[] {
  return pickLeads(input).pool.map(p => p.name);
}
