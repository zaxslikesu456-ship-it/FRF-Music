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

async function fetchFromLrcLibGet(trackName: string, artistName: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ track_name: trackName });
    if (artistName) params.append('artist_name', artistName);
    const data = await httpGetJson(`https://lrclib.com/api/get?${params.toString()}`, 5000);

    // Prefer syncedLyrics with LRC timestamps for auto-scroll karaoke
    if (data?.syncedLyrics && String(data.syncedLyrics).trim().length > 10) {
      return String(data.syncedLyrics).trim();
    }
    if (data?.plainLyrics && String(data.plainLyrics).trim().length > 10) {
      return String(data.plainLyrics).trim();
    }
  } catch {
    // try next
  }
  return null;
}

async function fetchFromLrcLibSearch(query: string): Promise<string | null> {
  try {
    const results = await httpGetJson(
      `https://lrclib.com/api/search?q=${encodeURIComponent(query)}`,
      5000
    );
    if (Array.isArray(results) && results.length > 0) {
      const best =
        results.find((r: any) => r.syncedLyrics) ||
        results.find((r: any) => r.plainLyrics) ||
        results[0];

      if (best?.syncedLyrics && String(best.syncedLyrics).trim().length > 10) {
        return String(best.syncedLyrics).trim();
      }
      if (best?.plainLyrics && String(best.plainLyrics).trim().length > 10) {
        return String(best.plainLyrics).trim();
      }
    }
  } catch {
    // try next
  }
  return null;
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

export async function fetchLyrics(rawTitle: string, rawArtist: string): Promise<string | null> {
  if (!rawTitle) return null;

  const key = `${rawTitle}::${rawArtist}`.toLowerCase();
  if (cache.has(key)) return cache.get(key) || null;

  const { cleanTitle, cleanArtist } = cleanSongTitle(rawTitle);
  const effectiveArtist = rawArtist && rawArtist.toLowerCase() !== 'unknown artist' ? rawArtist : cleanArtist;

  // Try providers in order of quality & accuracy
  const providers: Array<() => Promise<string | null>> = [
    // 1. LrcLib GET with cleaned title + artist
    () => fetchFromLrcLibGet(cleanTitle, effectiveArtist),
    // 2. LrcLib SEARCH with cleaned query
    () => fetchFromLrcLibSearch(`${cleanTitle} ${effectiveArtist}`.trim()),
    // 3. Lyrist (Genius backend) with cleaned title + artist
    () => fetchFromLyrist(cleanTitle, effectiveArtist),
    // 4. OVH Lyrics with cleaned artist + title
    () => fetchFromOvh(cleanTitle, effectiveArtist),
    // 5. Fallback LrcLib SEARCH with raw title
    () => fetchFromLrcLibSearch(rawTitle),
  ];

  for (const provider of providers) {
    const lyrics = await provider();
    if (lyrics) {
      cache.set(key, lyrics);
      return lyrics;
    }
  }

  cache.set(key, null);
  return null;
}
