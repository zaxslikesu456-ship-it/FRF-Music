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

const usable = (v: unknown): string | null =>
  v && String(v).trim().length > 10 ? String(v).trim() : null;

// LRCLIB lives at lrclib.net. (lrclib.com does not exist, so every lookup used
// to fail and songs only ever got plain, untimed lyrics from the fallbacks.)
//
// LRCLIB keeps several versions of most songs (album, radio edit, music video)
// whose lines start at different times, and its search also returns other songs
// entirely. Lyrics that are not the right song, or the right song in a version
// of another length, run out of time with the music. So every candidate is
// checked: same title, same artist, and a length close to the recording that is
// playing. A version more than MAX_LENGTH_GAP seconds off is not used as timed
// lyrics (plain text is better than lines that are visibly wrong).

const MAX_LENGTH_GAP = 8;
// Close enough that the lines can be trusted without looking further.
const GOOD_LENGTH_GAP = 3;

const normalize = (s: string): string =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function sameTitle(candidate: string, wanted: string): boolean {
  const a = normalize(candidate);
  const b = normalize(wanted);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // "Song" vs "Song - Remastered 2011": one contains the other and they are of similar size.
  return short.length >= 4 && long.includes(short) && short.length / long.length >= 0.6;
}

function sameArtist(candidate: string, wanted: string): boolean {
  if (!wanted) return true;
  const a = normalize(candidate);
  if (!a) return true;
  return wanted
    .split(/,|&| feat\.? | ft\.? | x | and /i)
    .map(normalize)
    .filter(Boolean)
    .some(w => a.includes(w) || w.includes(a));
}

interface Candidate {
  synced: string | null;
  plain: string | null;
  /** Seconds away from the length of the recording playing (0 when either is unknown). */
  gap: number;
  lengthKnown: boolean;
}

function toCandidate(r: any, durationSec: number): Candidate {
  const d = Number(r?.duration);
  const lengthKnown = durationSec > 0 && d > 0;
  return {
    synced: usable(r?.syncedLyrics),
    plain: usable(r?.plainLyrics),
    gap: lengthKnown ? Math.abs(d - durationSec) : 0,
    lengthKnown,
  };
}

async function lrclibGet(trackName: string, artistName: string, durationSec: number): Promise<Candidate[]> {
  try {
    const params = new URLSearchParams({ track_name: trackName });
    if (artistName) params.append('artist_name', artistName);
    // With a duration LRCLIB only answers with a version of that length (+-2 s).
    if (durationSec > 0) params.append('duration', String(Math.round(durationSec)));
    const data = await httpGetJson(`https://lrclib.net/api/get?${params.toString()}`, 5000);
    return data && (data.syncedLyrics || data.plainLyrics) ? [toCandidate(data, durationSec)] : [];
  } catch {
    return [];
  }
}

async function lrclibSearch(
  query: string,
  wantedTitle: string,
  wantedArtist: string,
  durationSec: number,
  structured = false
): Promise<Candidate[]> {
  try {
    const url = structured
      ? `https://lrclib.net/api/search?track_name=${encodeURIComponent(wantedTitle)}${
          wantedArtist ? `&artist_name=${encodeURIComponent(wantedArtist)}` : ''
        }`
      : `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const results = await httpGetJson(url, 5000);
    if (!Array.isArray(results)) return [];
    return results
      .filter(
        (r: any) =>
          sameTitle(r?.trackName || r?.name || '', wantedTitle) && sameArtist(r?.artistName || '', wantedArtist)
      )
      .map((r: any) => toCandidate(r, durationSec));
  } catch {
    return [];
  }
}

/** The best timed version (closest in length), and the first plain one. */
function pick(candidates: Candidate[]): { synced: Candidate | null; plain: string | null } {
  const timed = candidates
    .filter(c => c.synced && (!c.lengthKnown || c.gap <= MAX_LENGTH_GAP))
    .sort((a, b) => a.gap - b.gap)[0];
  const plain = candidates.find(c => c.plain)?.plain || null;
  return { synced: timed || null, plain };
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
  // lookup is tried for a timed version before settling for plain text. The
  // first lookup is exact; the others widen the net but only keep real matches.
  const firstArtist = effectiveArtist.split(/,|&| feat\.? | ft\.? /i)[0].trim();
  const lookups: Array<() => Promise<Candidate[]>> = [
    () => lrclibGet(cleanTitle, firstArtist, durationSec),
    () => lrclibSearch('', cleanTitle, effectiveArtist, durationSec, true),
    () => lrclibSearch(`${cleanTitle} ${firstArtist}`.trim(), cleanTitle, effectiveArtist, durationSec),
    () => lrclibSearch(rawTitle, cleanTitle, effectiveArtist, durationSec),
  ];
  let plain: string | null = null;
  let best: Candidate | null = null;
  for (const lookup of lookups) {
    const r = pick(await lookup());
    plain = plain || r.plain;
    if (r.synced && (!best || r.synced.gap < best.gap)) best = r.synced;
    // Close enough in length: no need to keep looking.
    if (best && (!best.lengthKnown || best.gap <= GOOD_LENGTH_GAP)) break;
  }
  if (best?.synced) return done(best.synced);
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
