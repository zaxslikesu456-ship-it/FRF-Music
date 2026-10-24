// Volume normalization. YouTube reports how loud each song is compared with a
// reference level ("loudnessDb": positive means louder than the reference). Songs
// that are louder get turned down by that amount, like YouTube's own player does,
// so a whole playlist plays at a similar loudness. Quiet songs are left alone.
const KEY = 'frf_loudness_v1';
const MAX_ENTRIES = 600;
const MIN_GAIN_DB = -14;

let cache: Record<string, number> | null = null;

function load(): Record<string, number> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    cache = raw && typeof raw === 'object' ? raw : {};
  } catch {
    cache = {};
  }
  return cache!;
}

export function recordLoudness(videoId: string, loudnessDb: number | undefined | null) {
  if (!videoId || typeof loudnessDb !== 'number' || !isFinite(loudnessDb)) return;
  const map = load();
  if (map[videoId] === loudnessDb) return;
  map[videoId] = loudnessDb;
  const keys = Object.keys(map);
  if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // storage full
  }
}

/** Gain in dB to apply to a song (0 or negative), or 0 when its loudness is unknown. */
export function normalizationGainDb(videoId: string | undefined, enabled: boolean): number {
  if (!enabled || !videoId) return 0;
  const db = load()[videoId];
  if (typeof db !== 'number') return 0;
  return Math.max(MIN_GAIN_DB, Math.min(0, -db));
}
