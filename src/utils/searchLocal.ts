// Searching your own music: liked songs, downloads, history, playlists. It needs
// no network, so it also works offline, and it ranks songs whose title or artist
// match best first.
import type { Playlist, Track } from '../types/music';

// Anything that is not a letter or digit in any script (so non-Latin titles still match).
const NON_WORD = /[^\p{L}\p{N}]+/gu;
// Accent marks left over after NFD splits 'é' into 'e' + U+0301.
const COMBINING_MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

// Lowercase, accents removed, punctuation to spaces: "Beyoncé - Halo!" -> "beyonce halo".
export function normalizeText(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_WORD, ' ')
    .trim();
}

function scoreTrack(t: Track, words: string[], phrase: string): number {
  const title = normalizeText(t.title);
  const artist = normalizeText(t.artist);
  const album = normalizeText(t.album);
  const all = `${title} ${artist} ${album}`;
  // Every word has to appear somewhere.
  if (!words.every(w => all.includes(w))) return 0;
  let score = 1;
  if (title === phrase) score += 50;
  else if (title.startsWith(phrase)) score += 30;
  else if (title.includes(phrase)) score += 20;
  if (artist === phrase) score += 40;
  else if (artist.includes(phrase)) score += 15;
  for (const w of words) {
    if (title.split(' ').includes(w)) score += 4;
    if (artist.split(' ').includes(w)) score += 3;
  }
  return score;
}

export interface LibraryMatches {
  tracks: Track[];
  playlists: { playlist: Playlist; tracks: Track[] }[];
}

export function searchLibrary(
  query: string,
  sources: {
    tracks: Track[][]; // liked, downloads, history, library... (duplicates are fine)
    playlists: Playlist[];
    resolve: (id: string) => Track | undefined;
    downloadedIds?: Set<string>;
  }
): LibraryMatches {
  const phrase = normalizeText(query);
  if (!phrase) return { tracks: [], playlists: [] };
  const words = phrase.split(' ').filter(Boolean);

  const seen = new Map<string, Track>();
  for (const list of sources.tracks) for (const t of list) if (t?.id && !seen.has(t.id)) seen.set(t.id, t);
  for (const p of sources.playlists) {
    for (const id of p.trackIds) {
      if (seen.has(id)) continue;
      const t = sources.resolve(id);
      if (t) seen.set(id, t);
    }
  }

  const tracks = Array.from(seen.values())
    .map(t => ({ t, s: scoreTrack(t, words, phrase) + (sources.downloadedIds?.has(t.id) ? 2 : 0) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.t);

  const playlists = sources.playlists
    .filter(p => {
      const name = normalizeText(p.name);
      return words.every(w => name.includes(w));
    })
    .map(playlist => ({
      playlist,
      tracks: playlist.trackIds.map(id => sources.resolve(id)).filter((t): t is Track => !!t),
    }));

  return { tracks, playlists };
}

// Songs and artists opened from search, newest first, shown under the search box.
const RECENT_KEY = 'frf_search_recent_items_v1';
export type RecentSearchItem =
  | { kind: 'track'; track: Track; at: number }
  | { kind: 'artist'; name: string; thumbnail?: string; at: number };

export function loadRecentItems(): RecentSearchItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveRecentItems(items: RecentSearchItem[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, 12)));
  } catch {
    // storage full
  }
}

export function recentItemKey(i: RecentSearchItem): string {
  return i.kind === 'track' ? `t:${i.track.id}` : `a:${i.name.toLowerCase()}`;
}
