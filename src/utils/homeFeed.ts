// Home's endless rows, built automatically from YouTube Music's own curated
// playlists: the charts first, then its Moods & moments and Genres (Chill,
// Workout, Hip-Hop, K-Pop...), one curated playlist per row. The order changes
// every day. Only if YouTube Music's lists can't be reached does it fall back
// to keyword searches.
import type { Track } from '../types/music';
import {
  fetchChartPlaylists,
  fetchMoodCategories,
  fetchCategoryPlaylists,
  fetchYouTubePlaylistTracks,
  searchYouTubeMusic,
  type CuratedPlaylist,
  type MoodCategory,
} from './ytMusicApi';

export interface HomeRow {
  key: string;
  title: string;
  /** Where the row comes from: "Charts", or the mood / genre name. */
  subtitle?: string;
  tracks: Track[];
}

const FALLBACK_SEARCHES: { title: string; query: string }[] = [
  { title: 'Top Hits', query: 'billboard top 100 hits' },
  { title: 'Hip-Hop & Rap', query: 'trending hip hop rap' },
  { title: 'Pop & Dance', query: 'dance pop party energy hits' },
  { title: 'Chill & Lo-Fi', query: 'chill lofi hip hop study beats' },
  { title: 'R&B & Soul', query: 'smooth rb soul contemporary groove' },
  { title: 'Rock & Alternative', query: 'classic rock alternative indie anthems' },
];

// Same order all day, a new one tomorrow.
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface HomeFeed {
  /** The next row, or null once there is nothing more. */
  next(): Promise<HomeRow | null>;
  readonly done: boolean;
}

export function createHomeFeed(): HomeFeed {
  const day = new Date().toDateString();
  const used = new Set<string>();
  let makers: Array<() => Promise<HomeRow | null>> = [];
  let ready: Promise<void> | null = null;
  let initialised = false;

  const playlistRow = async (p: CuratedPlaylist, subtitle: string): Promise<HomeRow | null> => {
    if (used.has(p.playlistId)) return null;
    used.add(p.playlistId);
    const tracks = await fetchYouTubePlaylistTracks(p.playlistId);
    if (tracks.length < 5) return null;
    return { key: p.playlistId, title: p.title, subtitle, tracks: tracks.slice(0, 30) };
  };

  const categoryRow = async (c: MoodCategory): Promise<HomeRow | null> => {
    const groups = await fetchCategoryPlaylists(c);
    const pool = groups.flatMap(g => g.playlists).filter(p => !used.has(p.playlistId));
    for (const p of seededShuffle(pool, day + c.title).slice(0, 3)) {
      const row = await playlistRow(p, c.title);
      if (row) return row;
    }
    return null;
  };

  const init = async () => {
    const [charts, categories] = await Promise.all([fetchChartPlaylists(), fetchMoodCategories()]);
    // Live-performance charts are concert recordings, not what people want on Home.
    const chartMakers = charts
      .filter(p => !/live/i.test(p.title))
      .slice(0, 4)
      .map(p => () => playlistRow(p, 'Charts'));
    const categoryMakers = seededShuffle(categories, day).map(c => () => categoryRow(c));
    // Two chart rows first, then moods and genres with the other charts mixed in.
    const rest: typeof makers = [];
    categoryMakers.forEach((m, i) => {
      rest.push(m);
      if (i % 4 === 3 && chartMakers.length > 2) rest.push(chartMakers.splice(2, 1)[0]);
    });
    makers = [...chartMakers.slice(0, 2), ...rest, ...chartMakers.slice(2)];
    if (makers.length === 0) {
      makers = FALLBACK_SEARCHES.map(s => async () => {
        const tracks = await searchYouTubeMusic(s.query);
        return tracks.length >= 5 ? { key: `search-${s.query}`, title: s.title, tracks } : null;
      });
    }
    initialised = true;
  };

  return {
    async next() {
      if (!ready) ready = init().catch(() => {
        initialised = true;
      });
      await ready;
      while (makers.length > 0) {
        const make = makers.shift()!;
        try {
          const row = await make();
          if (row) return row;
        } catch {
          // try the next source
        }
      }
      return null;
    },
    get done() {
      return initialised && makers.length === 0;
    },
  };
}
