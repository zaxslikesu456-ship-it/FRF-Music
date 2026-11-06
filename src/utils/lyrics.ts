import { httpGetJson } from './http';

const cache = new Map<string, string | null>();

/**
 * Clean title and artist to remove YouTube clutter like "(Official Video)", "[4K]", "ft.", etc.
 */
function cleanSongTitle(title: string): { cleanTitle: string; cleanArtist: string } {
  let cleaned = title
    // Remove brackets/parentheses like (Official Video), [Music Video], (Lyric Video), (Audio)
    .replace(/\([\s\S]*?(official|music|video|audio|lyric|visualizer|explicit|hd|4k|remastered|version)[\s\S]*?\)/gi, '')
    .replace(/\[[\s\S]*?(official|music|video|audio|lyric|visualizer|explicit|hd|4k|remastered|version)[\s\S]*?\]/gi, '')
    // Remove leftover brackets if empty
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .trim();

  // If title is "Artist - Song Title"
  let artistFromTitle = '';
  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ');
    artistFromTitle = parts[0].trim();
    cleaned = parts.slice(1).join(' - ').trim();
  }

  // Strip feat./ft.
  cleaned = cleaned.replace(/\s+(feat\.|ft\.|featuring)\s+.*/gi, '').trim();

  return {
    cleanTitle: cleaned || title,
    cleanArtist: artistFromTitle || '',
  };
}

interface LrcResult {
  synced: string | null;
  plain: string | null;
}

const usable = (v: unknown): string | null =>
  v && String(v).trim().length > 10 ? String(v).trim() : null;

// LRCLIB lives at lrclib.net. (lrclib.com does not exist, so every lookup used
// to fail and songs only ever got plain, untimed lyrics from the fallbacks.)
// Both lookups return the timed and plain versions separately, so a timed
// version found by a later lookup still wins over plain text from an earlier one.
//
// LRCLIB keeps several versions of most songs (album, radio edit, music video)
// whose lines start at different times — up to several seconds apart. Taking the
// first one made the lyrics run ahead of (or behind) the song, so the version
// whose length matches the song being played is chosen.

function closestByDuration(results: any[], durationSec: number): any | undefined {
  if (!(durationSec > 0)) return results[0];
  let best: any;
  let bestDiff = Infinity;
  for (const r of results) {
    const d = Number(r?.duration);
    if (!(d > 0)) continue;
    const diff = Math.abs(d - durationSec);
    if (diff < bestDiff) {
      best = r;
      bestDiff = diff;
    }
  }
  // Nothing close enough: a far-off version would be badly out of time, but it
  // is still better than no timed lyrics at all.
  return best ?? results[0];
}

async function fetchFromLrcLibGet(trackName: string, artistName: string, durationSec: number): Promise<LrcResult> {
  try {
    const params = new URLSearchParams({ track_name: trackName });
    if (artistName) params.append('artist_name', artistName);
    // With a duration LRCLIB only answers with a version of that length (±2 s).
    if (durationSec > 0) params.append('duration', String(Math.round(durationSec)));
    const data = await httpGetJson(`https://lrclib.net/api/get?${params.toString()}`, 5000);
    return { synced: usable(data?.syncedLyrics), plain: usable(data?.plainLyrics) };
  } catch {
    return { synced: null, plain: null };
  }
}

async function fetchFromLrcLibSearch(query: string, durationSec: number): Promise<LrcResult> {
  try {
    const results = await httpGetJson(
      `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
      5000
    );
    if (Array.isArray(results) && results.length > 0) {
      const synced = closestByDuration(
        results.filter((r: any) => usable(r?.syncedLyrics)),
        durationSec
      );
      const plain = results.find((r: any) => usable(r?.plainLyrics));
      return {
        synced: synced ? usable(synced.syncedLyrics) : null,
        plain: plain ? usable(plain.plainLyrics) : null,
      };
    }
  } catch {
    // try next
  }
  return { synced: null, plain: null };
}

async function fetchFromLyrist(title: string, artist: string): Promise<string | null> {
  try {
    const query = artist ? `${title}/${artist}` : title;
    const data = await httpGetJson(`https://lyrist.vercel.app/api/${encodeURIComponent(query)}`, 5000);
    if (data?.lyrics && typeof data.lyrics === 'string' && data.lyrics.trim().length > 10) {
      return data.lyrics.trim();
    }
  } catch {
    // try next
  }
  return null;
}

async function fetchFromOvh(title: string, artist: string): Promise<string | null> {
  if (!artist || !title) return null;
  try {
    const data = await httpGetJson(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
      5000
    );
    if (data?.lyrics && typeof data.lyrics === 'string' && data.lyrics.trim().length > 10) {
      return data.lyrics.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * durationSec: length of the song actually playing (0 if not known yet). It is
 * used to pick the lyrics version that is in time with this recording.
 */
export async function fetchLyrics(
  rawTitle: string,
  rawArtist: string,
  durationSec = 0
): Promise<string | null> {
  if (!rawTitle) return null;

  const key = `${rawTitle}::${rawArtist}::${Math.round(durationSec || 0)}`.toLowerCase();
  if (cache.has(key)) return cache.get(key) || null;

  const { cleanTitle, cleanArtist } = cleanSongTitle(rawTitle);
  const effectiveArtist = rawArtist && rawArtist.toLowerCase() !== 'unknown artist' ? rawArtist : cleanArtist;

  const done = (lyrics: string | null) => {
    cache.set(key, lyrics);
    return lyrics;
  };

  // Timed lyrics are what let the lyrics view follow the song, so every LRCLIB
  // lookup is tried for a timed version before settling for plain text.
  let plain: string | null = null;
  const lrcLookups: Array<() => Promise<LrcResult>> = [
    () => fetchFromLrcLibGet(cleanTitle, effectiveArtist, durationSec),
    () => fetchFromLrcLibSearch(`${cleanTitle} ${effectiveArtist}`.trim(), durationSec),
    () => fetchFromLrcLibSearch(rawTitle, durationSec),
  ];
  for (const lookup of lrcLookups) {
    const r = await lookup();
    if (r.synced) return done(r.synced);
    plain = plain || r.plain;
  }
  if (plain) return done(plain);

  // Plain-text fallbacks (Genius via Lyrist, then lyrics.ovh).
  const fallbacks: Array<() => Promise<string | null>> = [
    () => fetchFromLyrist(cleanTitle, effectiveArtist),
    () => fetchFromOvh(cleanTitle, effectiveArtist),
  ];
  for (const provider of fallbacks) {
    const lyrics = await provider();
    if (lyrics) return done(lyrics);
  }
  return done(null);
}
