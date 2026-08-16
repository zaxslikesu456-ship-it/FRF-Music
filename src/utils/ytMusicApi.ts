import type { Track, CommunityPlaylist } from '../types/music';
import { Capacitor } from '@capacitor/core';
import { httpGetJson, httpPostJson, httpGetText } from './http';

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
    ? ['/api/invidious', 'https://inv.nadeko.net/api/v1', 'https://invidious.nerdvpn.de/api/v1', 'https://invidious.private.coffee/api/v1', 'https://yt.artemislena.eu/api/v1']
    : ['https://inv.nadeko.net/api/v1', 'https://invidious.nerdvpn.de/api/v1', 'https://invidious.private.coffee/api/v1', 'https://yt.artemislena.eu/api/v1', 'https://inv.tux.pizza/api/v1', 'https://invidious.drgns.space/api/v1', 'https://y.com.sb/api/v1'];
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
    const match = str.match(/"continuationCommand":\{"token":"([^"]+)"/);
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
      coverUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
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
      coverUrl: `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,
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
          coverUrl: `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
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
      if (token) session.token = token;
      else session.done = true;
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

      const playlistId =
        renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.playlistId ||
        renderer.navigationEndpoint?.watchEndpoint?.playlistId ||
        '';

      const titleCol = renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
      const title = titleCol?.[0]?.text || 'Playlist';

      const infoCol = renderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const author = infoCol?.[0]?.text || 'YouTube Music';
      const songCount = infoCol?.[2]?.text || 'Playlist';

      const thumbs = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      const coverUrl = thumbs?.[thumbs.length - 1]?.url || thumbs?.[0]?.url || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300';

      if (playlistId) {
        playlists.push({
          id: `yt-playlist-${playlistId}`,
          browseId: playlistId,
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

  const playlists = await raceToSuccess([
    fetchInnerTube,
    ...getInvidiousBases().map(base => () => fetchFrom(base)),
  ]);
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
        ? `https://i.ytimg.com/vi/${firstVidId}/mqdefault.jpg`
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
    const thumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300';

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
          thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : '',
        };
      });
  };

  return await raceToSuccess([
    fetchInnerTube,
    ...getInvidiousBases().map(b => () => fetchInvidious(b)),
  ]);
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
          ? `https://i.ytimg.com/vi/${i.videos[0].videoId}/mqdefault.jpg`
          : 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300',
      }));
  };

  return await raceToSuccess([
    fetchInnerTube,
    ...getInvidiousBases().map(b => () => fetchInvidious(b)),
  ]);
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

  return await raceToSuccess([
    fetchInnerTube,
    ...getInvidiousBases().map(b => () => fetchInvidious(b)),
  ]);
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
    const browseId = cleanId.startsWith('VL') ? cleanId : `VL${cleanId}`;
    const data = await httpPostJson(
      `${getYtmBase()}/browse?alt=json&key=${YTM_API_KEY}`,
      { ...buildClientContext(), browseId },
      1500
    );
    const contents =
      data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    const tracks: Track[] = [];
    const seen = new Set<string>();

    for (const section of contents) {
      const shelf = section.musicPlaylistShelfRenderer || section.musicShelfRenderer;
      const items = shelf?.contents || [];
      for (const entry of items) {
        const r = entry?.musicResponsiveListItemRenderer;
        if (!r) continue;
        const videoId =
          r.playlistItemData?.videoId ||
          r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
          '';
        if (!videoId || seen.has(videoId)) continue;
        seen.add(videoId);

        const titleCol = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
        const title = titleCol?.[0]?.text || 'Track';
        const infoCol = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        const artist = infoCol?.[0]?.text || 'YouTube Artist';

        tracks.push({
          id: `yt-${videoId}`,
          title,
          artist,
          album: 'Community Playlist',
          duration: 200,
          url: '',
          coverUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
          isYouTube: true,
          youtubeId: videoId,
          addedAt: Date.now(),
        });
      }
    }
    return tracks;
  };

  const fetchFromInvidious = async (base: string): Promise<Track[]> => {
    const data = await httpGetJson(`${base}/playlists/${cleanId}`, 1500);
    const videos = data.videos || [];
    if (!Array.isArray(videos) || videos.length === 0) return [];

    return videos.map((video: any, idx: number) => {
      const videoId = video.videoId || `track-${idx}`;
      return {
        id: `yt-${videoId}`,
        title: video.title || 'Playlist Track',
        artist: video.author || data.author || 'YouTube Artist',
        album: data.title || 'Community Playlist',
        duration: video.lengthSeconds || 200,
        url: '',
        coverUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        isYouTube: true,
        youtubeId: videoId,
        addedAt: Date.now(),
      };
    });
  };

  const tracks = await raceToSuccess([
    fetchInnerTube,
    ...getInvidiousBases().map(base => () => fetchFromInvidious(base)),
  ]);
  if (tracks.length > 0) {
    playlistTracksCache.set(cleanId, tracks);
  }
  return tracks;
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

function alternateRelevance(
  track: Track,
  title: string,
  artist: string,
  expectedDuration?: number
): number {
  const wantedTitle = normalizedSearchTokens(title);
  const wantedArtist = normalizedSearchTokens(artist);
  const candidateTitle = normalizedSearchTokens(track.title);
  const candidateArtist = normalizedSearchTokens(track.artist);

  const titleCoverage = tokenCoverage(wantedTitle, candidateTitle);
  const ownerCoverage = tokenCoverage(wantedArtist, candidateArtist);
  const artistInTitleCoverage = tokenCoverage(wantedArtist, candidateTitle);
  const candidateLabel = `${track.title} ${track.artist}`.toLowerCase();
  const looksOfficial = /official audio|official video|provided to youtube|\bvevo\b|\btopic\b|ncs release/.test(
    candidateLabel
  );

  // Never substitute a merely similar title. Every meaningful title token
  // must match, and the uploader must be the artist unless the title itself
  // names the artist and the upload carries a trusted release marker.
  if (titleCoverage < 1) return Number.NEGATIVE_INFINITY;
  if (ownerCoverage < 0.8 && !(artistInTitleCoverage >= 1 && looksOfficial)) {
    return Number.NEGATIVE_INFINITY;
  }

  for (const token of ALTERNATE_NOISE_WORDS) {
    if (candidateTitle.has(token) && !wantedTitle.has(token)) {
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
    const tolerance = Math.max(10, expectedDuration * 0.07);
    if (difference > tolerance) return Number.NEGATIVE_INFINITY;
    durationScore = 1 - difference / tolerance;
  }

  const identityScore = Math.max(
    ownerCoverage,
    looksOfficial ? artistInTitleCoverage * 0.9 : 0
  );
  return titleCoverage * 0.45 + identityScore * 0.3 + durationScore * 0.15 + (looksOfficial ? 0.1 : 0);
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

  const query = `${artist} ${title} official audio`;
  const htmlResults = await fetchYouTubeHtmlSearch(query).catch(() => []);
  let pool = htmlResults;

  // Native YouTube HTML search normally supplies enough regular uploads. If
  // it does not, add the app's existing video-search providers as a backup.
  if (pool.length < 8) {
    const providerResults = await searchYouTubeMusicVideos(query).catch(() => []);
    const seen = new Set(pool.map(track => track.youtubeId).filter(Boolean));
    pool = [
      ...pool,
      ...providerResults.filter(track => track.youtubeId && !seen.has(track.youtubeId)),
    ];
  }

  const verified = await filterEmbeddableWithDataApi(pool);
  const ranked = verified
    .map(track => ({ track, score: alternateRelevance(track, title, artist, expectedDuration) }))
    .filter(candidate => Number.isFinite(candidate.score) && candidate.score >= 0.75)
    .sort((a, b) => b.score - a.score)
    .map(candidate => candidate.track);

  alternatePlaybackCache.set(cacheKey, ranked);
  if (alternatePlaybackCache.size > 30) {
    const oldestKey = alternatePlaybackCache.keys().next().value;
    if (oldestKey) alternatePlaybackCache.delete(oldestKey);
  }
  return ranked;
}

// Finds another legitimate upload of the same recording. The IFrame Player is
// still responsible for enforcing the upload's embedding and age rules.
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
