import type { Track, CommunityPlaylist } from '../types/music';
import { Capacitor } from '@capacitor/core';
import { httpGetJson, httpPostJson, httpGetText } from './http';
import { hiResCover } from './cover';

const YTM_API_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const IS_NATIVE = Capacitor.isNativePlatform();
// The Vite proxy only exists in dev; everywhere else go direct
// (native HTTP on Android/Tauri bypasses CORS, and Invidious is CORS-open).
const USE_PROXY = import.meta.env.DEV && !IS_NATIVE;

function getYtmBase() {
  return USE_PROXY
    ? '/api/ytmusic'
    : 'https://music.youtube.com/youtubei/v1';
}

function getInvidiousBases() {
  return USE_PROXY
    ? ['/api/invidious', 'https://inv.nadeko.net/api/v1', 'https://invidious.nerdvpn.de/api/v1']
    : ['https://inv.nadeko.net/api/v1', 'https://invidious.nerdvpn.de/api/v1', 'https://invidious.private.coffee/api/v1'];
}

function raceToSuccess<T>(tasks: Array<() => Promise<T[]>>): Promise<T[]> {
  return new Promise(resolve => {
    let pending = tasks.length;
    if (pending === 0) return resolve([]);
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve([]);
      }
    };
    for (const task of tasks) {
      task()
        .then(result => {
          if (done) return;
          if (result && result.length > 0) {
            done = true;
            resolve(result);
          } else if (--pending === 0) {
            finish();
          }
        })
        .catch(() => {
          if (done) return;
          if (--pending === 0) finish();
        });
    }
  });
}

function buildClientContext() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: `1.${dateStr}.01.00`,
        hl: 'en',
        gl: 'US',
      },
      user: {},
    },
  };
}

const SONGS_PARAMS = 'EgWKAQIIAWoKEAkQBRAKEAMQBA==';

const searchCache = new Map<string, Track[]>();
const playlistCache = new Map<string, CommunityPlaylist[]>();
const playlistTracksCache = new Map<string, Track[]>();
const alternatePlaybackCache = new Map<string, Track[]>();

const YOUTUBE_DATA_API_KEY_STORAGE = 'frf_youtube_data_api_key_v1';

function getBuiltInYouTubeDataApiKey(): string {
  return String(import.meta.env.VITE_YOUTUBE_DATA_API_KEY || '').trim();
}

export function getSavedYouTubeDataApiKey(): string {
  try {
    return localStorage.getItem(YOUTUBE_DATA_API_KEY_STORAGE)?.trim() || '';
  } catch {
    return '';
  }
}

export function setSavedYouTubeDataApiKey(value: string): void {
  try {
    const clean = value.trim();
    if (clean) localStorage.setItem(YOUTUBE_DATA_API_KEY_STORAGE, clean);
    else localStorage.removeItem(YOUTUBE_DATA_API_KEY_STORAGE);
    alternatePlaybackCache.clear();
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

export function hasBuiltInYouTubeDataApiKey(): boolean {
  return Boolean(getBuiltInYouTubeDataApiKey());
}

function getYouTubeDataApiKey(): string {
  return getSavedYouTubeDataApiKey() || getBuiltInYouTubeDataApiKey();
}

// Persisted search cache so repeat searches show instantly
const SEARCH_CACHE_KEY = 'bw_music_search_cache_v1';

function loadSearchCache() {
  try {
    const raw = localStorage.getItem(SEARCH_CACHE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v) && v.length > 0) searchCache.set(k, v as Track[]);
      }
    }
  } catch {
    // ignore
  }
}

function persistSearchCache() {
  try {
    const obj: Record<string, Track[]> = {};
    let i = 0;
    for (const [k, v] of searchCache) {
      obj[k] = v;
      if (++i >= 30) break;
    }
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

if (typeof localStorage !== 'undefined') loadSearchCache();

export function getCachedSearch(query: string): Track[] | null {
  const clean = query.trim().toLowerCase();
  return searchCache.get(clean) || null;
}

const PAGE_TIMEOUT_MS = 20000;
const MAX_ERRORS = 3;

interface SearchSession {
  token: string | null;
  page: number;
  done: boolean;
  errors: number;
  seen: Set<string>;
}
const searchSessions = new Map<string, SearchSession>();

interface PlaylistSearchSession {
  page: number;
  done: boolean;
  errors: number;
  seen: Set<string>;
}
const playlistSearchSessions = new Map<string, PlaylistSearchSession>();

function findContinuationToken(raw: any): string | null {
  try {
    const str = JSON.stringify(raw);
    // YouTube Music's song lists use nextContinuationData; other lists use a
    // continuationCommand. Only the second form was read, so "load more" never
    // found a next page of songs.
    const match =
      str.match(/"nextContinuationData":\{"continuation":"([^"]+)"/) ||
      str.match(/"continuationCommand":\{"token":"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function parseShelfEntries(entries: any[]): Track[] {
  const tracks: Track[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    const renderer = entry?.musicResponsiveListItemRenderer || entry?.musicTwoRowItemRenderer;
    if (!renderer) continue;

    const videoId =
      renderer.playlistItemData?.videoId ||
      renderer.navigationEndpoint?.watchEndpoint?.videoId ||
      renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
      renderer.menu?.menuRenderer?.items?.[0]?.menuNavigationItemRenderer?.navigationEndpoint?.watchEndpoint?.videoId ||
      '';

    if (!videoId) continue;
    if (seenIds.has(videoId)) continue;
    seenIds.add(videoId);

    const titleCol = renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || renderer.title?.runs;
    const title = titleCol?.[0]?.text || 'Unknown Song';

    const infoCol = renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || renderer.subtitle?.runs || [];
    const artistParts: string[] = [];
    let album = 'YouTube Music';

    for (let i = 0; i < infoCol.length; i++) {
      const run = infoCol[i];
      if (!run || !run.text || run.text === ' · ' || run.text === ' • ') continue;

      if (run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
        artistParts.push(run.text);
      } else if (run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ALBUM') {
        album = run.text;
      } else if (i <= 2 && !run.navigationEndpoint && run.text !== ' · ' && run.text !== ' • ') {
        if (!artistParts.length) artistParts.push(run.text);
      }
    }

    const artist = artistParts.join(', ') || (infoCol?.[0]?.text !== title ? infoCol?.[0]?.text : 'YouTube Artist') || 'YouTube Artist';

    let duration = 200;
    for (const run of infoCol) {
      const match = run.text?.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        duration = parseInt(match[1]) * 60 + parseInt(match[2]);
      }
    }

    tracks.push({
      id: `yt-${videoId}`,
      title,
      artist,
      album,
      duration,
      url: '',
      // Square album art when the result has it, else the video thumbnail.
      coverUrl: hiResCover(
        renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url ||
          `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
      ),
      isYouTube: true,
      youtubeId: videoId,
      addedAt: Date.now(),
    });
  }

  return tracks;
}

function parseInnerTubeSearchResults(data: any): { tracks: Track[]; token: string | null } {
  try {
    const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs || [];
    const tab0 = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    const entries: any[] = [];
    for (const section of tab0) {
      const shelf = section.musicShelfRenderer;
      if (shelf?.contents) entries.push(...shelf.contents);
      const card = section.musicCardRenderer;
      if (card?.contents) entries.push(...card.contents);
    }

    const parsed = parseShelfEntries(entries);
    if (parsed.length > 0) {
      return { tracks: parsed.slice(0, 25), token: findContinuationToken(data) };
    }

    return { tracks: [], token: findContinuationToken(data) };
  } catch {
    return { tracks: [], token: null };
  }
}

function mapInvidiousVideos(items: any): Track[] {
  if (!Array.isArray(items)) return [];
  const seenIds = new Set<string>();
  return items
    .filter((item: any) => item.type === 'video' || item.videoId)
    .filter((item: any) => {
      if (seenIds.has(item.videoId)) return false;
      seenIds.add(item.videoId);
      return true;
    })
    .map((item: any) => ({
      id: `yt-${item.videoId}`,
      title: item.title || 'YouTube Song',
      artist: item.author || 'YouTube Artist',
      album: 'YouTube Music',
      duration: item.lengthSeconds || 200,
      url: '',
      coverUrl: `https://i.ytimg.com/vi/${item.videoId}/maxresdefault.jpg`,
      isYouTube: true,
      youtubeId: item.videoId,
      addedAt: Date.now(),
    }));
}



async function fetchYouTubeHtmlSearch(query: string): Promise<Track[]> {
  try {
    const base = USE_PROXY ? '/api/youtube-search' : 'https://www.youtube.com';
    const html = await httpGetText(
      `${base}/results?search_query=${encodeURIComponent(query)}`,
      5000
    );
    const match = html.match(/var ytInitialData = ({.*?});<\/script>/);
    if (!match) return [];
    const data = JSON.parse(match[1]);
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents || [];

    const tracks: Track[] = [];
    const seen = new Set<string>();

    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const vr = item?.videoRenderer;
        if (!vr || !vr.videoId || seen.has(vr.videoId)) continue;
        seen.add(vr.videoId);

        const title = vr.title?.runs?.[0]?.text || 'YouTube Song';
        const artist = vr.ownerText?.runs?.[0]?.text || 'YouTube Artist';
        let duration = 200;
        const durText = vr.lengthText?.simpleText;
        if (durText) {
          const parts = durText.split(':').map(Number);
          if (parts.length === 2) duration = parts[0] * 60 + parts[1];
          else if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }

        tracks.push({
          id: `yt-${vr.videoId}`,
          title,
          artist,
          album: 'YouTube Music',
          duration,
          url: '',
          coverUrl: `https://i.ytimg.com/vi/${vr.videoId}/maxresdefault.jpg`,
          isYouTube: true,
          youtubeId: vr.videoId,
          addedAt: Date.now(),
        });
      }
    }
    return tracks.slice(0, 25);
  } catch {
    return [];
  }
}

// Search suggestions (autocomplete) for the search box. Typed text shows
// these instead of firing searches — the search itself only runs when the
// user submits (Enter, a suggestion, a recent search or a trending chip).
const suggestionCache = new Map<string, { items: string[]; fetchedAt: number }>();
const suggestionInflight = new Map<string, Promise<string[]>>();
const SUGGESTION_TTL_MS = 5 * 60 * 1000;

export async function fetchSearchSuggestions(query: string): Promise<string[]> {
  const clean = query.trim().toLowerCase();
  if (!clean) return [];
  const cached = suggestionCache.get(clean);
  if (cached && Date.now() - cached.fetchedAt < SUGGESTION_TTL_MS) return cached.items;
  const inflight = suggestionInflight.get(clean);
  if (inflight) return inflight;

  const pending = (async () => {
    // YouTube Music's own suggestion endpoint first — it reflects what this
    // app's search actually returns.
    try {
      const data = await httpPostJson(
        `${getYtmBase()}/music/get_search_suggestions?alt=json&key=${YTM_API_KEY}`,
        { ...buildClientContext(), input: query.trim() },
        3000
      );
      const items = (data?.contents || [])
        .map(
          (c: any) =>
            c?.searchSuggestionRenderer?.navigationEndpoint?.searchEndpoint?.query ||
            c?.searchSuggestionRenderer?.suggestion?.simpleText
        )
        .filter((s: unknown): s is string => typeof s === 'string' && s.length > 0)
        .slice(0, 10);
      if (items.length) {
        suggestionCache.set(clean, { items, fetchedAt: Date.now() });
        return items;
      }
    } catch {
      // fall through to the public suggest endpoint
    }

    // Fallback: Google's public YouTube suggest endpoint (client=firefox
    // returns plain JSON: [typedQuery, [suggestions]]).
    try {
      const data = await httpGetJson(
        `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query.trim())}`,
        3000
      );
      const list = Array.isArray(data?.[1]) ? data[1] : [];
      const items = list
        .filter((s: unknown): s is string => typeof s === 'string' && s.length > 0)
        .slice(0, 10);
      if (items.length) suggestionCache.set(clean, { items, fetchedAt: Date.now() });
      return items;
    } catch {
      return [];
    }
  })();

  suggestionInflight.set(clean, pending);
  try {
    return await pending;
  } finally {
    suggestionInflight.delete(clean);
  }
}

export async function searchYouTubeMusic(query: string): Promise<Track[]> {
  if (!query || !query.trim()) return [];

  const cleanQuery = query.trim().toLowerCase();
  if (searchCache.has(cleanQuery)) {
    return searchCache.get(cleanQuery)!;
  }

  const fetchInnerTubeSongs = async (): Promise<Track[]> => {
    const url = `${getYtmBase()}/search?alt=json&key=${YTM_API_KEY}`;
    const body = {
      ...buildClientContext(),
      query: cleanQuery,
      params: SONGS_PARAMS,
    };
    const data = await httpPostJson(url, body, 2500);
    const { tracks, token } = parseInnerTubeSearchResults(data);
    if (tracks.length > 0) {
      const session = searchSessions.get(cleanQuery) || {
        token: null,
        page: 1,
        done: false,
        errors: 0,
        seen: new Set<string>(),
      };
      session.token = token;
      if (!token) session.done = true;
      tracks.forEach(t => session.seen.add(t.id));
      searchSessions.set(cleanQuery, session);
    }
    return tracks;
  };

  const fetchInnerTubeGeneral = async (): Promise<Track[]> => {
    const url = `${getYtmBase()}/search?alt=json&key=${YTM_API_KEY}`;
    const body = {
      ...buildClientContext(),
      query: cleanQuery,
    };
    const data = await httpPostJson(url, body, 2500);
    const { tracks, token } = parseInnerTubeSearchResults(data);
    if (tracks.length > 0) {
      const session = searchSessions.get(cleanQuery) || {
        token: null,
        page: 1,
        done: false,
        errors: 0,
        seen: new Set<string>(),
      };
      // This search runs alongside the songs search, and its results rarely have a
      // next page. Marking the session finished here stopped "load more" for the
      // songs search, which does have one; only take its token if there is none.
      if (token && !session.token) session.token = token;
      tracks.forEach(t => session.seen.add(t.id));
      searchSessions.set(cleanQuery, session);
    }
    return tracks;
  };

  const attempts: Array<() => Promise<Track[]>> = [
    fetchInnerTubeSongs,
    fetchInnerTubeGeneral,
    () => fetchYouTubeHtmlSearch(cleanQuery),
  ];

  const tracks = await raceToSuccess(attempts);
  if (tracks.length > 0) {
    searchCache.set(cleanQuery, tracks);
    persistSearchCache();
    return tracks;
  }

  return [];
}

// Loads the next page of song results; returns [] when there is no more.
export async function loadMoreSearchResults(query: string): Promise<Track[]> {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim().toLowerCase();

  // Results that came from the saved search cache have no page token yet (the
  // cache only keeps songs), so ask for the first page again to get one. The
  // songs already shown are marked as seen so they are not repeated.
  if (!searchSessions.has(cleanQuery)) {
    try {
      const url = `${getYtmBase()}/search?alt=json&key=${YTM_API_KEY}`;
      const data = await httpPostJson(url, { ...buildClientContext(), query: cleanQuery, params: SONGS_PARAMS }, 5000);
      const { tracks, token } = parseInnerTubeSearchResults(data);
      const seen = new Set<string>((searchCache.get(cleanQuery) || []).map(t => t.id));
      const fresh = tracks.filter(t => !seen.has(t.id));
      tracks.forEach(t => seen.add(t.id));
      searchSessions.set(cleanQuery, { token, page: 1, done: !token && fresh.length === 0, errors: 0, seen });
      if (fresh.length > 0) return fresh;
    } catch {
      // fall through to the other sources below
    }
  }

  const session = searchSessions.get(cleanQuery) || {
    token: null,
    page: 1,
    done: false,
    errors: 0,
    seen: new Set<string>(),
  };

  if (session.done) return [];

  // Try 1: InnerTube Continuation Token if available
  if (session.token) {
    try {
      const url = `${getYtmBase()}/search?alt=json&key=${YTM_API_KEY}`;
      const data = await httpPostJson(
        url,
        { ...buildClientContext(), continuation: session.token },
        5000
      );
      const cont =
        data?.continuationContents?.musicShelfContinuation ||
        data?.continuationContents?.sectionListContinuation;
      const parsed = parseShelfEntries(cont?.contents || []);
      const fresh = parsed.filter(t => !session.seen.has(t.id));
      session.token = findContinuationToken(data);
      if (fresh.length > 0) {
        fresh.forEach(t => session.seen.add(t.id));
        searchSessions.set(cleanQuery, session);
        return fresh;
      }
    } catch {
      session.token = null;
    }
  }

  // Try 2: Page Incremental YouTube HTML Search
  session.page += 1;
  if (session.page > 8) {
    session.done = true;
    searchSessions.set(cleanQuery, session);
    return [];
  }

  const queries = [
    `${cleanQuery} songs`,
    `${cleanQuery} album tracks`,
    `${cleanQuery} music video`,
  ];
  const pageQuery = queries[(session.page - 2) % queries.length] || `${cleanQuery} music`;

  const moreTracks = await fetchYouTubeHtmlSearch(pageQuery).catch(() => []);
  const freshHtml = moreTracks.filter(t => !session.seen.has(t.id));

  if (freshHtml.length > 0) {
    freshHtml.forEach(t => session.seen.add(t.id));
    searchSessions.set(cleanQuery, session);
    return freshHtml;
  }

  // Try 3: Invidious Mirror Page Search
  for (const base of getInvidiousBases()) {
    try {
      const items = await httpGetJson(
        `${base}/search?q=${encodeURIComponent(cleanQuery)}&type=video&page=${session.page}`,
        5000
      );
      const mapped = mapInvidiousVideos(items);
      const freshInvidious = mapped.filter(t => !session.seen.has(t.id));
      if (freshInvidious.length > 0) {
        freshInvidious.forEach(t => session.seen.add(t.id));
        searchSessions.set(cleanQuery, session);
        return freshInvidious;
      }
    } catch {
      // ignore
    }
  }

  session.done = true;
  searchSessions.set(cleanQuery, session);
  return [];
}

const PLAYLIST_PARAMS = 'EgWKAQIoAWoKEAkQBRAKEAMQBA%3D%3D';

function parseInnerTubePlaylists(data: any): CommunityPlaylist[] {
  try {
    const entries = getShelfEntries(data);
    const playlists: CommunityPlaylist[] = [];
    for (const entry of entries) {
      const renderer = entry?.musicResponsiveListItemRenderer;
      if (!renderer) continue;

      const rawBrowseId =
        renderer.navigationEndpoint?.browseEndpoint?.browseId ||
        renderer.navigationEndpoint?.watchEndpoint?.playlistId ||
        renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.playlistId ||
        renderer.doubleTapCommand?.watchEndpoint?.playlistId ||
        '';
      const cleanId = rawBrowseId.replace(/^VL/, '');

      const titleCol =
        renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.title?.runs ||
        renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
      const title = titleCol?.[0]?.text || 'Playlist';

      const infoCol =
        renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.title?.runs ||
        renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const author = infoCol?.[0]?.text || 'YouTube Music';
      const songCount = infoCol?.[2]?.text || 'Playlist';

      const thumbs = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      const coverUrl = hiResCover(thumbs?.[thumbs.length - 1]?.url || thumbs?.[0]?.url || '');

      if (cleanId) {
        playlists.push({
          id: `yt-playlist-${cleanId}`,
          browseId: cleanId,
          title,
          author,
          songCount,
          coverUrl,
        });
      }
    }
    return playlists;
  } catch {
    return [];
  }
}

export async function searchYouTubeMusicPlaylists(
  query: string
): Promise<CommunityPlaylist[]> {
  if (!query || !query.trim()) return [];

  const cleanQuery = query.trim().toLowerCase();
  if (playlistCache.has(cleanQuery)) {
    return playlistCache.get(cleanQuery)!;
  }

  const fetchInnerTube = async (): Promise<CommunityPlaylist[]> => {
    const url = `${getYtmBase()}/search?alt=json&key=${YTM_API_KEY}`;
    const body = {
      ...buildClientContext(),
      query: cleanQuery,
      params: PLAYLIST_PARAMS,
    };
    const data = await httpPostJson(url, body, 1500);
    return parseInnerTubePlaylists(data);
  };

  const fetchFrom = async (base: string): Promise<CommunityPlaylist[]> => {
    const items = await httpGetJson(
      `${base}/search?q=${encodeURIComponent(cleanQuery)}&type=playlist`,
      1500
    );
    return mapInvidiousPlaylists(items);
  };

  let playlists: CommunityPlaylist[] = [];
  try {
    playlists = await fetchInnerTube();
  } catch {
    // fallback if innertube fails
    for (const base of getInvidiousBases()) {
      try {
        playlists = await fetchFrom(base);
        if (playlists.length > 0) break;
      } catch {
        // continue
      }
    }
  }

  if (playlists.length > 0) {
    playlistCache.set(cleanQuery, playlists);
    const session = playlistSearchSessions.get(cleanQuery) || {
      page: 1,
      done: false,
      errors: 0,
      seen: new Set<string>(),
    };
    playlists.forEach(p => session.seen.add(p.id));
    playlistSearchSessions.set(cleanQuery, session);
  }
  return playlists;
}

function mapInvidiousPlaylists(items: any): CommunityPlaylist[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items
    .filter((item: any) => item.type === 'playlist')
    .map((item: any) => {
      const firstVidId = item.videos?.[0]?.videoId;
      const coverUrl = firstVidId
        ? `https://i.ytimg.com/vi/${firstVidId}/maxresdefault.jpg`
        : item.playlistThumbnail ||
          `https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300`;

      return {
        id: `yt-playlist-${item.playlistId}`,
        browseId: item.playlistId,
        title: item.title || 'Community Playlist',
        author: item.author || 'YouTube Music Creator',
        songCount: `${item.videoCount || 20} Songs`,
        coverUrl,
      };
    });
}

// Loads the next page of community playlist results; returns [] when no more.
export async function loadMorePlaylistResults(query: string): Promise<CommunityPlaylist[]> {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim().toLowerCase();

  const session = playlistSearchSessions.get(cleanQuery) || {
    page: 1,
    done: false,
    errors: 0,
    seen: new Set<string>(),
  };
  if (session.done || session.errors >= MAX_ERRORS) return [];

  session.page += 1;
  if (session.page > 10) {
    session.done = true;
    return [];
  }

  for (const base of getInvidiousBases()) {
    try {
      const items = await httpGetJson(
        `${base}/search?q=${encodeURIComponent(cleanQuery)}&type=playlist&page=${session.page}`,
        PAGE_TIMEOUT_MS
      );
      const playlists = mapInvidiousPlaylists(items).filter(p => !session.seen.has(p.id));
      if (playlists.length === 0) continue;
      playlists.forEach(p => session.seen.add(p.id));
      session.errors = 0;
      playlistSearchSessions.set(cleanQuery, session);
      return playlists;
    } catch {
      session.errors += 1;
    }
  }

  playlistSearchSessions.set(cleanQuery, session);
  return [];
}

export interface ArtistResult {
  id: string;
  name: string;
  subtitle: string;
  thumbnail: string;
}

export interface AlbumResult {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
}

const ARTIST_PARAMS = 'EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D';
const ALBUM_PARAMS = 'EgWKAQIYAWoKEAkQBRAKEAMQBA%3D%3D';
const VIDEO_PARAMS = 'EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D';

function getShelfEntries(data: any): any[] {
  const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs || [];
  const sections =
    tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
  const entries: any[] = [];
  for (const section of sections) {
    if (section.musicShelfRenderer?.contents) {
      entries.push(...section.musicShelfRenderer.contents);
    } else if (section.musicCardShelfRenderer?.contents) {
      entries.push(...section.musicCardShelfRenderer.contents);
    }
  }
  return entries;
}

function parseArtistOrAlbumEntries(data: any, kind: 'artist' | 'album') {
  const entries = getShelfEntries(data);
  const results: (ArtistResult | AlbumResult)[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const r = entry?.musicResponsiveListItemRenderer || entry?.musicTwoColumnItemRenderer;
    if (!r) continue;

    const flex0 = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const title = flex0?.[0]?.text || r.title?.runs?.[0]?.text || '';
    if (!title) continue;

    const flex1 = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const subtitle = flex1?.map((x: any) => x.text).join('') || r.subtitle?.runs?.map((x: any) => x.text).join('') || (kind === 'artist' ? 'Artist' : 'Album');

    const thumbs =
      r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
      [];
    const thumbnail = hiResCover(thumbs.length ? thumbs[thumbs.length - 1].url : '');

    const browseId =
      r.navigationEndpoint?.browseEndpoint?.browseId ||
      r.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ||
      `browse-${results.length}`;

    const key = (browseId || title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (kind === 'artist') {
      results.push({ id: browseId || `artist-${title}`, name: title, subtitle, thumbnail });
    } else {
      results.push({ id: browseId || `album-${title}`, title, artist: subtitle, coverUrl: thumbnail });
    }
  }
  return results;
}

export async function searchYouTubeMusicArtists(query: string): Promise<ArtistResult[]> {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();

  const fetchInnerTube = async (): Promise<ArtistResult[]> => {
    const data = await httpPostJson(
      `${getYtmBase()}/search?alt=json&key=${YTM_API_KEY}`,
      { ...buildClientContext(), query: cleanQuery, params: ARTIST_PARAMS },
      1500
    );
    return parseArtistOrAlbumEntries(data, 'artist') as ArtistResult[];
  };

  const fetchInvidious = async (base: string): Promise<ArtistResult[]> => {
    const items = await httpGetJson(
      `${base}/search?q=${encodeURIComponent(cleanQuery)}&type=channel`,
      1500
    );
    if (!Array.isArray(items)) return [];
    return items
      .filter((i: any) => i.type === 'channel' || i.authorId)
      .map((i: any) => {
        const thumbs = i.authorThumbnails || [];
        return {
          id: i.authorId || `ch-${i.author}`,
          name: i.author || 'Unknown Artist',
          subtitle: i.subscriberCount
            ? `${formatCount(i.subscriberCount)} subscribers`
            : 'Artist',
          thumbnail: hiResCover(thumbs.length ? thumbs[thumbs.length - 1].url : ''),
        };
      });
  };

  return await raceToSuccess([
    fetchInnerTube,
    ...getInvidiousBases().map(b => () => fetchInvidious(b)),
  ]);
}

// An artist's YouTube Music page: their "Songs" shelf (which YouTube orders by
// popularity — the real "most popular" list, unlike search relevance; the
// shelf holds a handful, its "show all" endpoint has the rest), plus the
// header's description and audience numbers.
export interface ArtistPage {
  name: string;
  browseId: string;
  topSongs: Track[];
  /** The artist's own description on YouTube Music (often just a website link). */
  description: string;
  monthlyAudience: string;
  subscribers: string;
  views: string;
  /** The artist's own videos (YouTube Music's "Videos" shelf, not a search). */
  videos: Track[];
  /** Albums, then singles and EPs, newest first as YouTube lists them. */
  albums: ArtistRelease[];
  singles: ArtistRelease[];
}

/** One album, single or EP on an artist's page. */
export interface ArtistRelease {
  /** The release's page (MPREb_...) */
  browseId: string;
  params?: string;
  title: string;
  year: string;
  kind: string;
  coverUrl: string;
}

const artistPageCache = new Map<string, { page: ArtistPage | null; at: number }>();
const artistPageInflight = new Map<string, Promise<ArtistPage | null>>();
const ARTIST_TOP_TTL_MS = 30 * 60 * 1000;

const runsText = (x: any): string => (x?.runs || []).map((r: any) => r.text).join('').trim();

// "Beyoncé" and "beyonce" and "Alex G." are the same name when matching artists.
export function normalizeName(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, ' ')
    .trim();
}

/** True when the song's credited artists include this exact artist. */
export function isByArtist(track: Track, artistName: string): boolean {
  const want = normalizeName(artistName.split(/,|&| feat\.? | ft\.? /i)[0]);
  if (!want) return false;
  const credited = (track.artist || '').split(/,|&| feat\.? | ft\.? | x /i).map(normalizeName);
  return credited.includes(want) || normalizeName(track.artist || '') === want;
}

function parseReleases(items: any[], defaultKind: string): ArtistRelease[] {
  const out: ArtistRelease[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const r = it?.musicTwoRowItemRenderer;
    const ep = r?.navigationEndpoint?.browseEndpoint;
    if (!r || !ep?.browseId || !String(ep.browseId).startsWith('MPRE')) continue;
    if (seen.has(ep.browseId)) continue;
    seen.add(ep.browseId);
    const words = (r.subtitle?.runs || []).map((x: any) => String(x.text || '').trim()).filter((x: string) => x && x !== '•');
    const year = words.find((w: string) => /^(19|20)\d{2}$/.test(w)) || '';
    const kindWord = words.find((w: string) => /^(Album|Single|EP|Mixtape|Compilation|Live|Soundtrack)$/i.test(w));
    const thumbs = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    out.push({
      browseId: ep.browseId,
      params: ep.params,
      title: runsText(r.title) || 'Unknown',
      year,
      kind: kindWord ? kindWord.charAt(0).toUpperCase() + kindWord.slice(1).toLowerCase() : defaultKind || 'Album',
      coverUrl: hiResCover(thumbs.length ? thumbs[thumbs.length - 1].url : ''),
    });
  }
  return out;
}

/** The songs on one album, single or EP. */
export async function fetchReleaseTracks(release: ArtistRelease, artistName: string): Promise<Track[]> {
  const data = await httpPostJson(
    `${getYtmBase()}/browse?alt=json&key=${YTM_API_KEY}`,
    { ...buildClientContext(), browseId: release.browseId, ...(release.params ? { params: release.params } : {}) },
    5000
  );
  const sections =
    data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents ||
    data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ||
    [];
  const shelf = sections.map((s: any) => s?.musicShelfRenderer || s?.musicPlaylistShelfRenderer).find(Boolean);
  const tracks: Track[] = [];
  for (const entry of shelf?.contents || []) {
    const r = entry?.musicResponsiveListItemRenderer;
    const videoId = r?.playlistItemData?.videoId;
    if (!r || !videoId) continue;
    const title = runsText(r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) || 'Unknown Song';
    const credited = (r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
      .filter((x: any) => x?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST')
      .map((x: any) => x.text);
    const time = runsText(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text).match(/(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    const duration = time ? (Number(time[1] || 0) * 3600 + Number(time[2]) * 60 + Number(time[3])) : 200;
    tracks.push({
      id: `yt-${videoId}`,
      title,
      artist: credited.join(', ') || artistName,
      album: release.title,
      duration,
      url: '',
      coverUrl: release.coverUrl,
      isYouTube: true,
      youtubeId: videoId,
      addedAt: Date.now(),
    });
  }
  return tracks;
}

export async function fetchArtistPage(artistName: string): Promise<ArtistPage | null> {
  // A track credits "A, B"; the first name is the one whose page we want.
  const name = (artistName || '').split(/,|&| feat\.? | ft\.? /i)[0].trim();
  if (!name) return null;
  const key = name.toLowerCase();
  const cached = artistPageCache.get(key);
  if (cached && Date.now() - cached.at < ARTIST_TOP_TTL_MS) return cached.page;
  const inflight = artistPageInflight.get(key);
  if (inflight) return inflight;

  const pending = (async (): Promise<ArtistPage | null> => {
    try {
      const artists = await searchYouTubeMusicArtists(name);
      // The artist with exactly this name; a near match (another artist whose
      // name merely contains it) only when there is no exact one.
      const nk = normalizeName(name);
      const hit =
        artists.find(a => a.id.startsWith('UC') && normalizeName(a.name) === nk) ||
        artists.find(a => {
          const n = normalizeName(a.name);
          return a.id.startsWith('UC') && (n.startsWith(nk) || nk.startsWith(n));
        });
      if (!hit) return null;

      const page = await httpPostJson(
        `${getYtmBase()}/browse?alt=json&key=${YTM_API_KEY}`,
        { ...buildClientContext(), browseId: hit.id },
        4000
      );
      const header = page?.header?.musicImmersiveHeaderRenderer || page?.header?.musicVisualHeaderRenderer || {};
      const sections =
        page?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents || [];
      const about = sections.map((s: any) => s?.musicDescriptionShelfRenderer).find(Boolean);
      const info: ArtistPage = {
        name: hit.name,
        browseId: hit.id,
        topSongs: [],
        description: runsText(about?.description) || runsText(header.description),
        monthlyAudience: runsText(header.monthlyListenerCount),
        subscribers: runsText(header.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText),
        views: runsText(about?.subheader),
        videos: [],
        albums: [],
        singles: [],
      };

      const shelf = sections
        .map((s: any) => s?.musicShelfRenderer)
        .find((s: any) => s?.contents?.length);
      if (shelf) {
        let entries: any[] = shelf.contents;
        const more = shelf.bottomEndpoint?.browseEndpoint;
        if (more?.browseId) {
          try {
            const full = await httpPostJson(
              `${getYtmBase()}/browse?alt=json&key=${YTM_API_KEY}`,
              { ...buildClientContext(), browseId: more.browseId, params: more.params },
              4000
            );
            const fullSections =
              full?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
                ?.sectionListRenderer?.contents || [];
            const fullShelf = fullSections
              .map((s: any) => s?.musicPlaylistShelfRenderer || s?.musicShelfRenderer)
              .find((s: any) => s?.contents?.length);
            if (fullShelf && fullShelf.contents.length > entries.length) entries = fullShelf.contents;
          } catch {
            // keep the short shelf
          }
        }
        // Artist-page rows leave out the artist column, so credit the artist.
        info.topSongs = parseShelfEntries(entries)
          .map(t =>
            !t.artist || t.artist === 'YouTube Artist' || t.artist === t.title
              ? { ...t, artist: hit.name }
              : t
          )
          .slice(0, 30);
      }

      // Videos and releases come from the page's own shelves.
      const carousels: any[] = sections.map((s: any) => s?.musicCarouselShelfRenderer).filter(Boolean);
      const carouselTitle = (c: any) =>
        runsText(c?.header?.musicCarouselShelfBasicHeaderRenderer?.title).toLowerCase();
      const videoShelf = carousels.find(c => carouselTitle(c) === 'videos');
      if (videoShelf) {
        const more = videoShelf.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton?.buttonRenderer
          ?.navigationEndpoint?.browseEndpoint;
        let vEntries: any[] = videoShelf.contents || [];
        if (more?.browseId) {
          try {
            const full = await httpPostJson(
              `${getYtmBase()}/browse?alt=json&key=${YTM_API_KEY}`,
              { ...buildClientContext(), browseId: more.browseId, params: more.params },
              4000
            );
            const fullSections =
              full?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
                ?.sectionListRenderer?.contents || [];
            const fullShelf = fullSections
              .map((s: any) => s?.musicPlaylistShelfRenderer || s?.musicShelfRenderer)
              .find((s: any) => s?.contents?.length);
            if (fullShelf && fullShelf.contents.length > vEntries.length) vEntries = fullShelf.contents;
          } catch {
            // keep the short shelf
          }
        }
        info.videos = parseShelfEntries(vEntries)
          .map(t =>
            !t.artist || t.artist === 'YouTube Artist' || t.artist === t.title ? { ...t, artist: hit.name } : t
          )
          .slice(0, 40);
      }

      // Every album, single and EP: the artist's full discography page, else
      // whatever the page itself lists.
      let releases: ArtistRelease[] = [];
      try {
        const disco = await httpPostJson(
          `${getYtmBase()}/browse?alt=json&key=${YTM_API_KEY}`,
          { ...buildClientContext(), browseId: `MPAD${hit.id}` },
          4000
        );
        const dSections =
          disco?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
            ?.sectionListRenderer?.contents || [];
        const items = dSections.flatMap((s: any) => s?.gridRenderer?.items || []);
        releases = parseReleases(items, '');
      } catch {
        // use the page's shelves
      }
      if (releases.length === 0) {
        for (const c of carousels) {
          const t = carouselTitle(c);
          if (t === 'albums') releases.push(...parseReleases(c.contents || [], 'Album'));
          else if (t.startsWith('singles')) releases.push(...parseReleases(c.contents || [], 'Single'));
        }
      }
      info.albums = releases.filter(r => r.kind === 'Album');
      info.singles = releases.filter(r => r.kind !== 'Album');

      artistPageCache.set(key, { page: info, at: Date.now() });
      return info;
    } catch {
      return null;
    }
  })();

  artistPageInflight.set(key, pending);
  try {
    return await pending;
  } finally {
    artistPageInflight.delete(key);
  }
}

export async function fetchArtistTopSongs(artistName: string): Promise<Track[]> {
  return (await fetchArtistPage(artistName))?.topSongs || [];
}


// ---------------------------------------------------------------------------
// Home feed sources: YouTube Music's own curated lists, so Home fills itself
// with real, current music instead of keyword searches ("top hits 2026", which
// mostly found re-uploads and compilation videos).
// ---------------------------------------------------------------------------

export interface CuratedPlaylist {
  playlistId: string;
  title: string;
}

export interface MoodCategory {
  title: string;
  browseId: string;
  params: string;
}

async function ytmBrowse(body: Record<string, unknown>): Promise<any> {
  return httpPostJson(`${getYtmBase()}/browse?alt=json&key=${YTM_API_KEY}`, { ...buildClientContext(), ...body }, 6000);
}

function browseSections(data: any): any[] {
  return data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
}

function carouselTitle(c: any): string {
  return (c?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs || []).map((r: any) => r.text).join('');
}

function playlistsFromCarousel(c: any): CuratedPlaylist[] {
  const out: CuratedPlaylist[] = [];
  for (const item of c?.contents || []) {
    const r = item?.musicTwoRowItemRenderer;
    const id: string = r?.navigationEndpoint?.browseEndpoint?.browseId || '';
    // Playlists only (VL...), not albums or artists.
    if (!id.startsWith('VL')) continue;
    out.push({ playlistId: id, title: (r.title?.runs || []).map((x: any) => x.text).join('') || 'Playlist' });
  }
  return out;
}

/** The songs in YouTube Music's own "Quick picks" row. */
export async function fetchHomeQuickPicks(): Promise<Track[]> {
  try {
    const sections = browseSections(await ytmBrowse({ browseId: 'FEmusic_home' }));
    for (const s of sections) {
      const c = s?.musicCarouselShelfRenderer;
      const songs = (c?.contents || []).filter((x: any) => x?.musicResponsiveListItemRenderer);
      if (songs.length >= 6) return parseShelfEntries(songs);
    }
  } catch {
    // fall back to the caller's own picks
  }
  return [];
}

/** Chart playlists (top music videos, trending...). */
export async function fetchChartPlaylists(): Promise<CuratedPlaylist[]> {
  try {
    const sections = browseSections(await ytmBrowse({ browseId: 'FEmusic_charts' }));
    const out: CuratedPlaylist[] = [];
    for (const s of sections) out.push(...playlistsFromCarousel(s?.musicCarouselShelfRenderer));
    return out;
  } catch {
    return [];
  }
}

/** Moods & moments and genres (Chill, Workout, Hip-Hop, K-Pop...). */
export async function fetchMoodCategories(): Promise<MoodCategory[]> {
  try {
    const sections = browseSections(await ytmBrowse({ browseId: 'FEmusic_moods_and_genres' }));
    const out: MoodCategory[] = [];
    for (const s of sections) {
      for (const item of s?.gridRenderer?.items || []) {
        const b = item?.musicNavigationButtonRenderer;
        const ep = b?.clickCommand?.browseEndpoint;
        if (ep?.browseId && ep?.params) {
          out.push({ title: b.buttonText?.runs?.[0]?.text || '', browseId: ep.browseId, params: ep.params });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** The curated playlists inside one mood or genre, grouped by its rows. */
export async function fetchCategoryPlaylists(cat: MoodCategory): Promise<{ title: string; playlists: CuratedPlaylist[] }[]> {
  try {
    const sections = browseSections(await ytmBrowse({ browseId: cat.browseId, params: cat.params }));
    return sections
      .map(s => s?.musicCarouselShelfRenderer)
      .filter(Boolean)
      .map(c => ({ title: carouselTitle(c), playlists: playlistsFromCarousel(c) }))
      .filter(g => g.playlists.length > 0);
  } catch {
    return [];
  }
}

// Songs like this one: YouTube Music's own radio for the song (the "Up next"
// list it builds from the song, playlist RDAMVM<id>). Far closer to the song's
// style than searching its artist's name. The first entry is the song itself.
const similarCache = new Map<string, Track[]>();

export async function fetchSimilarSongs(videoId: string): Promise<Track[]> {
  if (!videoId) return [];
  const cached = similarCache.get(videoId);
  if (cached) return cached;
  try {
    const data = await httpPostJson(
      `${getYtmBase()}/next?alt=json&key=${YTM_API_KEY}`,
      { ...buildClientContext(), videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true },
      5000
    );
    const items =
      data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
        ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer
        ?.content?.playlistPanelRenderer?.contents || [];
    const tracks: Track[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const v = it?.playlistPanelVideoRenderer;
      const id: string = v?.videoId || '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      // Byline reads "Artist • 1.9B views • 11M likes": the artist is what
      // comes before the first separator.
      const runs: { text?: string }[] = v.longBylineText?.runs || v.shortBylineText?.runs || [];
      const artistRuns: string[] = [];
      for (const r of runs) {
        if ((r.text || '').trim() === '•') break;
        artistRuns.push(r.text || '');
      }
      const lengthText: string = v.lengthText?.runs?.[0]?.text || '';
      const parts = lengthText.split(':').map(Number);
      const duration =
        parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 200;
      tracks.push({
        id: `yt-${id}`,
        title: v.title?.runs?.[0]?.text || 'Unknown Song',
        artist: artistRuns.join('').trim() || 'YouTube Artist',
        album: 'YouTube Music',
        duration: Number.isFinite(duration) ? duration : 200,
        url: '',
        coverUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        isYouTube: true,
        youtubeId: id,
        addedAt: Date.now(),
      });
    }
    if (tracks.length > 0) similarCache.set(videoId, tracks);
    return tracks;
  } catch {
    return [];
  }
}

function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2).replace(/\.?0+$/, '')}K`;
  return String(n);
}

export async function searchYouTubeMusicAlbums(query: string): Promise<AlbumResult[]> {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();

  const fetchInnerTube = async (): Promise<AlbumResult[]> => {
    const data = await httpPostJson(
      `${getYtmBase()}/search?alt=json&key=${YTM_API_KEY}`,
      { ...buildClientContext(), query: cleanQuery, params: ALBUM_PARAMS },
      1500
    );
    return parseArtistOrAlbumEntries(data, 'album') as AlbumResult[];
  };

  const fetchInvidious = async (base: string): Promise<AlbumResult[]> => {
    const items = await httpGetJson(
      `${base}/search?q=${encodeURIComponent(cleanQuery)}&type=playlist`,
      1500
    );
    if (!Array.isArray(items)) return [];
    return items
      .filter((i: any) => i.type === 'playlist')
      .map((i: any) => ({
        id: i.playlistId || `alb-${i.title}`,
        title: i.title || 'Album',
        artist: i.author || 'YouTube Artist',
        coverUrl: i.videos?.[0]?.videoId
          ? `https://i.ytimg.com/vi/${i.videos[0].videoId}/maxresdefault.jpg`
          : '',
      }));
  };

  try {
    return await fetchInnerTube();
  } catch {
    for (const b of getInvidiousBases()) {
      try {
        const res = await fetchInvidious(b);
        if (res.length > 0) return res;
      } catch {
        // continue
      }
    }
    return [];
  }
}

export async function searchYouTubeMusicVideos(query: string): Promise<Track[]> {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();

  const fetchInnerTube = async (): Promise<Track[]> => {
    const data = await httpPostJson(
      `${getYtmBase()}/search?alt=json&key=${YTM_API_KEY}`,
      { ...buildClientContext(), query: cleanQuery, params: VIDEO_PARAMS },
      1500
    );
    return parseShelfEntries(getShelfEntries(data));
  };

  const fetchInvidious = async (base: string): Promise<Track[]> => {
    const items = await httpGetJson(
      `${base}/search?q=${encodeURIComponent(cleanQuery)}&type=video`,
      1500
    );
    return mapInvidiousVideos(items);
  };

  try {
    return await fetchInnerTube();
  } catch {
    for (const b of getInvidiousBases()) {
      try {
        const res = await fetchInvidious(b);
        if (res.length > 0) return res;
      } catch {
        // continue
      }
    }
    return [];
  }
}

export async function fetchYouTubePlaylistTracks(
  playlistId: string
): Promise<Track[]> {
  if (!playlistId) return [];

  const cleanId = playlistId.replace(/^VL/, '');
  if (playlistTracksCache.has(cleanId)) {
    return playlistTracksCache.get(cleanId)!;
  }

  const fetchInnerTube = async (): Promise<Track[]> => {
    const browseId = cleanId.startsWith('VL') ? cleanId : (cleanId.startsWith('MPSP') ? cleanId : `VL${cleanId}`);
    const data = await httpPostJson(
      `${getYtmBase()}/browse?alt=json&key=${YTM_API_KEY}`,
      { ...buildClientContext(), browseId },
      3500
    );

    const sections =
      data?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents ||
      data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ||
      [];

    const tracks: Track[] = [];
    const seen = new Set<string>();

    for (const section of sections) {
      const shelf = section.musicPlaylistShelfRenderer || section.musicShelfRenderer;
      const items = shelf?.contents || [];

      for (const entry of items) {
        const r = entry?.musicResponsiveListItemRenderer;
        if (!r) continue;

        const videoId =
          r.playlistItemData?.videoId ||
          r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
          r.doubleTapCommand?.watchEndpoint?.videoId ||
          '';

        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);

        const titleCol =
          r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.title?.runs ||
          r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
        const title = titleCol?.[0]?.text || 'Track';

        const infoCol =
          r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.title?.runs ||
          r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        const artist = infoCol?.[0]?.text || 'YouTube Artist';

        const albumCol =
          r.flexColumns?.[2]?.musicResponsiveListItemFlexColumnRenderer?.title?.runs ||
          r.flexColumns?.[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
        const album = albumCol?.[0]?.text || 'Community Playlist';

        const durationText =
          r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || '';
        let duration = 200;
        if (durationText) {
          const parts = durationText.split(':').map(Number);
          if (parts.length === 2) duration = parts[0] * 60 + parts[1];
          else if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }

        const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        const coverUrl = hiResCover(
          thumbs[thumbs.length - 1]?.url ||
            thumbs[0]?.url ||
            `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
        );

        tracks.push({
          id: `yt-${videoId}`,
          title,
          artist,
          album,
          duration,
          url: '',
          coverUrl,
          isYouTube: true,
          youtubeId: videoId,
          addedAt: Date.now(),
        });
      }
    }
    return tracks;
  };

  try {
    const res = await fetchInnerTube();
    if (res.length > 0) {
      playlistTracksCache.set(cleanId, res);
      return res;
    }
  } catch {
    // continue to fallback
  }

  for (const base of getInvidiousBases()) {
    try {
      const data = await httpGetJson(`${base}/playlists/${cleanId}`, 2500);
      const videos = data?.videos || [];
      if (Array.isArray(videos) && videos.length > 0) {
        const mapped = videos.map((video: any, idx: number) => {
          const videoId = video.videoId || `track-${idx}`;
          return {
            id: `yt-${videoId}`,
            title: video.title || 'Playlist Track',
            artist: video.author || data.author || 'YouTube Artist',
            album: data.title || 'Community Playlist',
            duration: video.lengthSeconds || 200,
            url: '',
            coverUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
            isYouTube: true,
            youtubeId: videoId,
            addedAt: Date.now(),
          };
        });
        playlistTracksCache.set(cleanId, mapped);
        return mapped;
      }
    } catch {
      // try next mirror
    }
  }

  return [];
}

const ALTERNATE_NOISE_WORDS = new Set([
  'acoustic',
  'bootleg',
  'cover',
  'instrumental',
  'karaoke',
  'live',
  'mashup',
  'nightcore',
  'orchestral',
  'parody',
  'piano',
  'pianoforte',
  'reaction',
  'remix',
  'reverb',
  'reversed',
  'slowed',
  'sped',
  'tutorial',
]);

function normalizedSearchTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(token => token.length > 1)
  );
}

function tokenCoverage(wanted: Set<string>, candidate: Set<string>): number {
  if (wanted.size === 0) return 0;
  let matches = 0;
  wanted.forEach(token => {
    if (candidate.has(token)) matches += 1;
  });
  return matches / wanted.size;
}

function cleanTrackTitle(title: string): string {
  return title
    .replace(/\s*[\(\[](feat\.?|ft\.?|official|audio|video|lyrics|visualizer|hd|4k|explicit|clean|remastered).*?[\)\]]/gi, '')
    .trim();
}

function cleanArtistName(artist: string): string {
  return artist
    .replace(/\b(feat\.?|ft\.?|with|and|&|,)\b.*/i, '')
    .trim();
}

function alternateRelevance(
  track: Track,
  title: string,
  artist: string,
  expectedDuration?: number
): number {
  const wantedTitle = normalizedSearchTokens(cleanTrackTitle(title));
  const primaryWantedArtist = normalizedSearchTokens(cleanArtistName(artist));
  const fullWantedArtist = normalizedSearchTokens(artist);

  const candidateTitle = normalizedSearchTokens(cleanTrackTitle(track.title));
  const candidateFullTitle = normalizedSearchTokens(track.title);
  const candidateArtist = normalizedSearchTokens(track.artist);

  const titleCoverage = tokenCoverage(wantedTitle, candidateTitle);
  const fullTitleCoverage = tokenCoverage(wantedTitle, candidateFullTitle);
  const bestTitleCoverage = Math.max(titleCoverage, fullTitleCoverage);

  const primaryArtistCoverage = tokenCoverage(primaryWantedArtist, candidateArtist);
  const artistInTitleCoverage = tokenCoverage(primaryWantedArtist, candidateFullTitle);
  const fullArtistCoverage = tokenCoverage(fullWantedArtist, candidateArtist);
  const bestArtistCoverage = Math.max(primaryArtistCoverage, artistInTitleCoverage, fullArtistCoverage);

  const candidateLabel = `${track.title} ${track.artist}`.toLowerCase();
  const looksOfficial = /\b(official\s+audio|official\s+video|provided\s+to\s+youtube|audio|visualizer|vevo|topic|lyrics|music\s+video|clean)\b/i.test(
    candidateLabel
  );

  // Must match song title and primary artist
  if (bestTitleCoverage < 0.75) return Number.NEGATIVE_INFINITY;
  if (bestArtistCoverage < 0.4 && !looksOfficial) {
    return Number.NEGATIVE_INFINITY;
  }

  for (const token of ALTERNATE_NOISE_WORDS) {
    if (candidateFullTitle.has(token) && !wantedTitle.has(token)) {
      return Number.NEGATIVE_INFINITY;
    }
  }

  let durationScore = 0;
  if (
    expectedDuration &&
    expectedDuration > 0 &&
    expectedDuration !== 200 &&
    track.duration > 0 &&
    track.duration !== 200
  ) {
    const difference = Math.abs(track.duration - expectedDuration);
    const tolerance = Math.max(15, expectedDuration * 0.15);
    if (difference > tolerance) return Number.NEGATIVE_INFINITY;
    durationScore = 1 - difference / tolerance;
  }

  return bestTitleCoverage * 0.45 + bestArtistCoverage * 0.35 + durationScore * 0.1 + (looksOfficial ? 0.1 : 0);
}

async function filterEmbeddableWithDataApi(tracks: Track[]): Promise<Track[]> {
  const key = getYouTubeDataApiKey();
  const videoIds = tracks
    .map(track => track.youtubeId)
    .filter((id): id is string => Boolean(id))
    .slice(0, 50);

  if (!key || videoIds.length === 0) return tracks;

  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'status');
  url.searchParams.set('id', videoIds.join(','));
  url.searchParams.set('key', key);

  try {
    const data = await httpGetJson(url.toString(), 6000);
    const embeddableIds = new Set<string>(
      (Array.isArray(data?.items) ? data.items : [])
        .filter((item: any) => item?.status?.embeddable === true)
        .map((item: any) => item.id)
        .filter(Boolean)
    );
    return tracks.filter(track => track.youtubeId && embeddableIds.has(track.youtubeId));
  } catch {
    // A missing, disabled, or exhausted key must not break playback recovery.
    return tracks;
  }
}

async function getAlternatePlaybackCandidates(
  title: string,
  artist: string,
  expectedDuration?: number
): Promise<Track[]> {
  const cacheKey = `${artist} ${title} ${expectedDuration || 0}`.trim().toLowerCase();
  const cached = alternatePlaybackCache.get(cacheKey);
  if (cached) return cached;

  const queries = [
    `${artist} - ${title} Topic`,
    `${artist} ${title} official audio`,
    `${artist} ${title} audio`,
    `${artist} ${title} lyrics`,
    `${title} ${artist}`,
  ];

  let pool: Track[] = [];
  const seen = new Set<string>();

  // 1. YouTube Music Official Songs Search (Topic/Clean Audio)
  try {
    const ytmSongs = await searchYouTubeMusic(`${artist} ${title}`).catch(() => []);
    for (const t of ytmSongs) {
      if (t.youtubeId && !seen.has(t.youtubeId)) {
        seen.add(t.youtubeId);
        pool.push(t);
      }
    }
  } catch {
    // continue
  }

  // 2. Multi-query search for Topic and Official Audio
  for (const q of queries) {
    try {
      const htmlResults = await fetchYouTubeHtmlSearch(q).catch(() => []);
      for (const t of htmlResults) {
        if (t.youtubeId && !seen.has(t.youtubeId)) {
          seen.add(t.youtubeId);
          pool.push(t);
        }
      }
      if (pool.length >= 15) break;
    } catch {
      // continue
    }
  }

  if (pool.length < 8) {
    const providerResults = await searchYouTubeMusicVideos(`${artist} ${title}`).catch(() => []);
    for (const track of providerResults) {
      if (track.youtubeId && !seen.has(track.youtubeId)) {
        seen.add(track.youtubeId);
        pool.push(track);
      }
    }
  }

  const verified = await filterEmbeddableWithDataApi(pool);
  const scored = verified
    .map(track => ({ track, score: alternateRelevance(track, title, artist, expectedDuration) }))
    .filter(candidate => Number.isFinite(candidate.score) && candidate.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .map(candidate => candidate.track);

  const ranked = scored.length > 0 ? scored : pool;

  alternatePlaybackCache.set(cacheKey, ranked);
  if (alternatePlaybackCache.size > 30) {
    const oldestKey = alternatePlaybackCache.keys().next().value;
    if (oldestKey) alternatePlaybackCache.delete(oldestKey);
  }
  return ranked;
}

// Finds another legitimate upload of the same recording (e.g. Official Topic / Clean Audio).
export async function findBestAlternateVideoId(
  title: string,
  artist: string,
  expectedDuration: number | undefined,
  excludedVideoIds: string | Iterable<string>
): Promise<string | null> {
  const excluded =
    typeof excludedVideoIds === 'string'
      ? new Set([excludedVideoIds])
      : new Set(excludedVideoIds);
  try {
    const candidates = await getAlternatePlaybackCandidates(title, artist, expectedDuration);
    return candidates.find(track => track.youtubeId && !excluded.has(track.youtubeId))?.youtubeId || null;
  } catch {
    return null;
  }
}

// Directly extracts raw audio stream URL from Invidious/Piped instances (InnerTube Android client)
// This bypasses 18+ web iframe age restrictions completely and plays directly via iOS native AVPlayer
export async function fetchDirectAudioStreamUrl(youtubeId: string): Promise<string | null> {
  if (!youtubeId) return null;
  const instances = getInvidiousBases();

  for (const base of instances.slice(0, 5)) {
    try {
      const url = `${base}/videos/${encodeURIComponent(youtubeId)}`;
      const data = await httpGetJson(url, 4500);

      if (data && Array.isArray(data.adaptiveFormats)) {
        const audioFormats = data.adaptiveFormats
          .filter((f: any) => typeof f.type === 'string' && f.type.startsWith('audio/') && f.url)
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        if (audioFormats.length > 0 && audioFormats[0].url) {
          return audioFormats[0].url;
        }
      }

      if (data && Array.isArray(data.formatStreams) && data.formatStreams.length > 0) {
        const stream = data.formatStreams.find((s: any) => s.url);
        if (stream?.url) return stream.url;
      }
    } catch {
      // try next mirror
    }
  }

  return null;
}


// An age-restricted music video cannot be played without signing in to
// YouTube, but the same song's YouTube Music audio track ("song" result)
// almost never carries that gate. Finds that track: best matches first.
export async function findSongVersionIds(
  title: string,
  artist: string,
  exclude: Iterable<string>
): Promise<string[]> {
  const skip = new Set(exclude);
  let wantedArtist = (artist || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .trim();
  let wantedTitle = title || '';
  // Video titles are often "Artist - Song (Official Video)".
  const dash = wantedTitle.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    const before = normalizedSearchTokens(dash[1]);
    const artistTokens = normalizedSearchTokens(wantedArtist);
    if (!wantedArtist || tokenCoverage(artistTokens, before) >= 0.5 || tokenCoverage(before, artistTokens) >= 0.5) {
      wantedArtist = wantedArtist || dash[1].trim();
      wantedTitle = dash[2];
    }
  }
  wantedTitle = cleanTrackTitle(wantedTitle);
  if (!wantedTitle) return [];
  const results = await searchYouTubeMusic(`${wantedArtist} ${wantedTitle}`.trim()).catch(() => [] as Track[]);
  // The video's length includes intros and skits, so it is not compared.
  return results
    .filter(t => t.youtubeId && !skip.has(t.youtubeId))
    .map(t => ({ id: t.youtubeId as string, score: alternateRelevance(t, wantedTitle, wantedArtist) }))
    .filter(c => Number.isFinite(c.score) && c.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(c => c.id);
}
