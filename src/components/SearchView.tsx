import React, { useState, useEffect, useRef } from 'react';
import { t as tr } from '../i18n';
import {
  Search,
  ChevronLeft,
  MoreVertical,
  FolderPlus,
  Check,
  Loader2,
  X,
  History,
  Library,
  Heart,
  Download,
  ListMusic,
  Play,
  User,
  Trash2,
} from 'lucide-react';
import { useContextMenu } from './ContextMenu';
import {
  searchLibrary,
  loadRecentItems,
  saveRecentItems,
  recentItemKey,
  type RecentSearchItem,
} from '../utils/searchLocal';
import { useAudio } from '../context/AudioContext';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import { ArtistDetailView } from './ArtistDetailView';
import { PlaylistDetailView } from './PlaylistDetailView';
import {
  searchYouTubeMusic,
  searchYouTubeMusicPlaylists,
  searchYouTubeMusicArtists,
  searchYouTubeMusicAlbums,
  searchYouTubeMusicVideos,
  fetchSearchSuggestions,
  fetchYouTubePlaylistTracks,
  loadMoreSearchResults,
  loadMorePlaylistResults,
  getCachedSearch,
  type ArtistResult,
  type AlbumResult,
} from '../utils/ytMusicApi';
import type { Track, CommunityPlaylist } from '../types/music';

type SearchMode = 'results' | 'library' | 'songs' | 'artists' | 'albums' | 'videos' | 'playlists';

const deriveArtistsFromSongs = (query: string, songs: Track[]): ArtistResult[] => {
  if (!songs || songs.length === 0) return [];
  const artistMap = new Map<string, { name: string; thumbnail: string; count: number }>();
  for (const s of songs) {
    const name = s.artist || query;
    const item = artistMap.get(name.toLowerCase());
    if (item) {
      item.count += 1;
    } else {
      artistMap.set(name.toLowerCase(), {
        name,
        thumbnail: s.coverUrl || '',
        count: 1,
      });
    }
  }
  return Array.from(artistMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(a => ({
      id: `derived-art-${encodeURIComponent(a.name)}`,
      name: a.name,
      subtitle: 'Artist',
      thumbnail: a.thumbnail,
    }));
};

const deriveAlbumsFromSongs = (songs: Track[]): AlbumResult[] => {
  if (!songs || songs.length === 0) return [];
  const albumMap = new Map<string, { title: string; artist: string; coverUrl: string }>();
  for (const s of songs) {
    const title = s.album && s.album !== 'YouTube Music' ? s.album : `${s.artist} Top Songs`;
    if (!albumMap.has(title.toLowerCase())) {
      albumMap.set(title.toLowerCase(), {
        title,
        artist: s.artist,
        coverUrl: s.coverUrl || '',
      });
    }
  }
  return Array.from(albumMap.values()).slice(0, 8).map((alb, i) => ({
    id: `derived-alb-${i}`,
    title: alb.title,
    artist: alb.artist,
    coverUrl: alb.coverUrl,
  }));
};

const derivePlaylistsFromSongs = (query: string, songs: Track[]): CommunityPlaylist[] => {
  if (!songs || songs.length === 0) return [];
  const mainArtist = songs[0]?.artist || query;
  return [
    {
      id: `derived-pl-1`,
      browseId: `derived-pl-1`,
      title: `${mainArtist} - Top Hits & Essentials`,
      author: mainArtist,
      songCount: `${songs.length} Songs`,
      coverUrl: songs[0]?.coverUrl || '',
    },
    {
      id: `derived-pl-2`,
      browseId: `derived-pl-2`,
      title: `Best of ${query}`,
      author: 'YouTube Music Community',
      songCount: `${Math.min(songs.length, 12)} Songs`,
      coverUrl: songs[1]?.coverUrl || songs[0]?.coverUrl || '',
    },
  ];
};

export const SearchView: React.FC = () => {
  const {
    searchQuery,
    setSearchQuery,
    playQueue,
    playWithArtistTop,
    currentTrack,
    isPlaying,
    downloadPlaylist,
    importPlaylistToLibrary,
    openArtistProfile,
    addTrackToLibrary,
    tracks,
    favoriteTracks,
    favorites,
    downloadedTracks,
    downloads,
    recentlyPlayed,
    playlists,
    trackStore,
  } = useAudio();

  // Your own music that matches the search: liked songs, downloads, history and
  // playlists. Needs no network, so it also works offline.
  const libraryMatches = React.useMemo(
    () =>
      searchLibrary(searchQuery, {
        tracks: [favoriteTracks, downloadedTracks, tracks, recentlyPlayed],
        playlists,
        resolve: id => trackStore[id] || tracks.find(t => t.id === id),
        downloadedIds: new Set(downloads),
      }),
    [searchQuery, favoriteTracks, downloadedTracks, tracks, recentlyPlayed, playlists, trackStore, downloads]
  );
  const likedIds = React.useMemo(() => new Set(favorites), [favorites]);
  const downloadedIds = React.useMemo(() => new Set(downloads), [downloads]);
  const [activeLocalPlaylist, setActiveLocalPlaylist] = useState<{ id: string; title: string; tracks: Track[] } | null>(null);

  // Songs and artists you opened from search, shown when the box is empty.
  const [recentItems, setRecentItems] = useState<RecentSearchItem[]>(() => loadRecentItems());
  const rememberItem = (item: RecentSearchItem) => {
    setRecentItems(prev => {
      const next = [item, ...prev.filter(i => recentItemKey(i) !== recentItemKey(item))].slice(0, 12);
      saveRecentItems(next);
      return next;
    });
  };
  // Right-click (long press on phones) a recently opened song or artist.
  const recentMenu = useContextMenu();
  const forgetItem = (item: RecentSearchItem) => {
    setRecentItems(prev => {
      const next = prev.filter(i => recentItemKey(i) !== recentItemKey(item));
      saveRecentItems(next);
      return next;
    });
  };
  const openRecentItem = (item: RecentSearchItem) => {
    rememberItem({ ...item, at: Date.now() });
    if (item.kind === 'track') {
      if (item.track.isYouTube) playWithArtistTop(item.track, [item.track]);
      else playQueue([item.track], 0);
    } else {
      setActiveArtist({ id: item.name, name: item.name, thumbnail: item.thumbnail || '' } as ArtistResult);
    }
  };
  const clearAllRecent = () => {
    setRecentItems([]);
    saveRecentItems([]);
    setSearchHistory([]);
    try {
      localStorage.setItem('bw_music_search_history_v1', '[]');
    } catch {
      // ignore
    }
  };

  const [searchMode, setSearchMode] = useState<SearchMode>('results');

  // The text field holds its own draft state: results only refresh when the
  // user submits (Enter, a suggestion, a recent search or a trending chip),
  // never on each keystroke.
  const [inputValue, setInputValue] = useState<string>(searchQuery);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [artistResults, setArtistResults] = useState<ArtistResult[]>([]);
  const [albumResults, setAlbumResults] = useState<AlbumResult[]>([]);
  const [videoResults, setVideoResults] = useState<Track[]>([]);
  const [playlistResults, setPlaylistResults] = useState<CommunityPlaylist[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedTrackForMenu, setSelectedTrackForMenu] = useState<Track | null>(null);

  const [activeArtist, setActiveArtist] = useState<ArtistResult | null>(null);
  const [activeAlbum, setActiveAlbum] = useState<{ title: string; artist: string; tracks: Track[] } | null>(null);
  const [activeCommunityPlaylist, setActiveCommunityPlaylist] = useState<CommunityPlaylist | null>(null);
  const [playlistAddState, setPlaylistAddState] = useState<Record<string, 'adding' | 'added' | 'failed'>>({});
  const [communityPlaylistTracks, setCommunityPlaylistTracks] = useState<Track[]>([]);
  const [_isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = useState(false);

  const [communityPlaylistCache, setCommunityPlaylistCache] = useState<Record<string, Track[]>>(() => {
    try {
      const saved = localStorage.getItem('bw_music_community_pl_cache_v1');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const updateCommunityPlaylistCache = (plKey: string, updatedTracks: Track[]) => {
    setCommunityPlaylistCache(prev => {
      const next = { ...prev, [plKey]: updatedTracks };
      try {
        localStorage.setItem('bw_music_community_pl_cache_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const [loadingMore, setLoadingMore] = useState(false);
  const [noMoreSongs, setNoMoreSongs] = useState(false);
  const [noMorePlaylists, setNoMorePlaylists] = useState(false);

  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('bw_music_search_history_v1');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveHistory = (query: string) => {
    const clean = query.trim();
    if (!clean) return;
    setSearchHistory(prev => {
      const next = [clean, ...prev.filter(q => q.toLowerCase() !== clean.toLowerCase())].slice(0, 10);
      try {
        localStorage.setItem('bw_music_search_history_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const removeHistory = (query: string) => {
    setSearchHistory(prev => {
      const next = prev.filter(q => q !== query);
      try {
        localStorage.setItem('bw_music_search_history_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Runs the search for a query and records it in history. The only paths
  // into results — Enter, suggestion rows, recent searches, trending chips —
  // all go through here.
  const submitSearch = (raw?: string) => {
    const q = (raw ?? inputValue).trim();
    if (!q) return;
    setInputValue(q);
    setSearchQuery(q);
    setShowSuggestions(false);
    saveHistory(q);
    inputRef.current?.blur();
  };

  // Autocomplete suggestions for what is being typed. Debounced so fast
  // typists do not fire a request per keystroke.
  useEffect(() => {
    const q = inputValue.trim();
    if (!showSuggestions || !q) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void fetchSearchSuggestions(q).then(items => {
        if (alive) setSuggestions(items);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [inputValue, showSuggestions]);

  useEffect(() => {
    setNoMoreSongs(false);
    setNoMorePlaylists(false);
    setLoadingMore(false);
  }, [searchQuery, searchMode]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setArtistResults([]);
      setAlbumResults([]);
      setVideoResults([]);
      setPlaylistResults([]);
      return;
    }

    let isMounted = true;

    // Show cached results instantly while fresh ones load
    if (searchMode === 'songs' || searchMode === 'results') {
      const cached = getCachedSearch(searchQuery);
      if (cached && cached.length > 0) setSearchResults(cached);
    }

    const run = async () => {
      setIsSearching(true);
      try {
        if (searchMode === 'results') {
          // Fetch songs first for instant results (< 300ms)
          const songs = await searchYouTubeMusic(searchQuery).catch(() => []);
          if (!isMounted) return;
          const validSongs = songs || [];
          setSearchResults(validSongs);
          setIsSearching(false);

          // Populate initial fast derived results
          setArtistResults(deriveArtistsFromSongs(searchQuery, validSongs));
          setAlbumResults(deriveAlbumsFromSongs(validSongs));
          setPlaylistResults(derivePlaylistsFromSongs(searchQuery, validSongs));

          // Fetch rich artists, albums, playlists in background without blocking songs
          void Promise.all([
            searchYouTubeMusicArtists(searchQuery).catch(() => []),
            searchYouTubeMusicAlbums(searchQuery).catch(() => []),
            searchYouTubeMusicPlaylists(searchQuery).catch(() => []),
          ]).then(([artists, albums, playlists]) => {
            if (!isMounted) return;
            if (artists && artists.length > 0) setArtistResults(artists);
            if (albums && albums.length > 0) setAlbumResults(albums);
            if (playlists && playlists.length > 0) setPlaylistResults(playlists);
          });
        } else if (searchMode === 'songs') {
          const r = await searchYouTubeMusic(searchQuery).catch(() => []);
          if (isMounted) {
            setSearchResults(r || []);
            setIsSearching(false);
          }
        } else if (searchMode === 'artists') {
          let r = await searchYouTubeMusicArtists(searchQuery).catch(() => []);
          if ((!r || r.length === 0) && searchResults.length > 0) {
            r = deriveArtistsFromSongs(searchQuery, searchResults);
          }
          if (isMounted) {
            if (searchResults.length > 0) setSearchResults(searchResults);
            setArtistResults(r || []);
          }
        } else if (searchMode === 'albums') {
          let r = await searchYouTubeMusicAlbums(searchQuery).catch(() => []);
          if ((!r || r.length === 0) && searchResults.length > 0) {
            r = deriveAlbumsFromSongs(searchResults);
          }
          if (isMounted) setAlbumResults(r || []);
        } else if (searchMode === 'videos') {
          const r = await searchYouTubeMusicVideos(searchQuery).catch(() => []);
          if (isMounted) setVideoResults(r.length > 0 ? r : searchResults);
        } else {
          let r = await searchYouTubeMusicPlaylists(searchQuery).catch(() => []);
          if ((!r || r.length === 0) && searchResults.length > 0) {
            r = derivePlaylistsFromSongs(searchQuery, searchResults);
          }
          if (isMounted) setPlaylistResults(r || []);
        }
      } catch {
        if (isMounted && searchResults.length > 0) {
          setArtistResults(deriveArtistsFromSongs(searchQuery, searchResults));
          setAlbumResults(deriveAlbumsFromSongs(searchResults));
          setPlaylistResults(derivePlaylistsFromSongs(searchQuery, searchResults));
        }
      } finally {
        if (isMounted) setIsSearching(false);
      }
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [searchQuery, searchMode]);

  const fetchingMoreRef = useRef(false);

  const handleScroll = async (e: React.UIEvent<HTMLDivElement>) => {
    if (activeCommunityPlaylist || activeArtist || activeAlbum || loadingMore || fetchingMoreRef.current || !searchQuery.trim()) return;
    const el = e.currentTarget;
    if (el.scrollTop < 100) return;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 200) return;

    fetchingMoreRef.current = true;
    setLoadingMore(true);
    try {
      if (searchMode === 'songs' && !noMoreSongs) {
        const more = await loadMoreSearchResults(searchQuery);
        const ids = new Set(searchResults.map(t => t.id));
        const fresh = more.filter(t => !ids.has(t.id));
        if (more.length === 0 || fresh.length === 0) setNoMoreSongs(true);
        else setSearchResults(prev => [...prev, ...fresh]);
      } else if (searchMode === 'playlists' && !noMorePlaylists) {
        const more = await loadMorePlaylistResults(searchQuery);
        const ids = new Set(playlistResults.map(p => p.id));
        const fresh = more.filter(p => !ids.has(p.id));
        if (more.length === 0 || fresh.length === 0) setNoMorePlaylists(true);
        else setPlaylistResults(prev => [...prev, ...fresh]);
      }
    } finally {
      setLoadingMore(false);
      fetchingMoreRef.current = false;
    }
  };

  // Songs for a community playlist. Real playlists are fetched by id; the
  // generated ones (derived-pl-*) have no id to look up, so they, and any
  // playlist that comes back empty, fall back to searching by title.
  const resolveCommunityPlaylistTracks = async (pl: CommunityPlaylist): Promise<Track[]> => {
    const cacheKey = pl.browseId || pl.id;
    const cached = communityPlaylistCache[cacheKey];
    if (cached && cached.length > 0) return cached;

    let tracks: Track[] = [];
    try {
      if (pl.browseId && !pl.browseId.startsWith('derived-pl')) {
        tracks = await fetchYouTubePlaylistTracks(pl.browseId);
      }
    } catch {
      // fall through to the search fallbacks
    }
    if (!tracks || tracks.length === 0) {
      try {
        const query = pl.title.replace(/top hits|essentials|best of/gi, '').trim() || pl.title;
        tracks = (await searchYouTubeMusic(`${query} ${pl.author}`)) || [];
      } catch {
        tracks = [];
      }
    }
    if (tracks.length === 0) {
      try {
        tracks = (await searchYouTubeMusic(pl.title)) || [];
      } catch {
        tracks = [];
      }
    }
    if (tracks.length > 0) updateCommunityPlaylistCache(cacheKey, tracks);
    return tracks;
  };

  const handleOpenCommunityPlaylist = async (pl: CommunityPlaylist) => {
    setActiveCommunityPlaylist(pl);
    const cacheKey = pl.browseId || pl.id;

    if (communityPlaylistCache[cacheKey] && communityPlaylistCache[cacheKey].length > 0) {
      setCommunityPlaylistTracks(communityPlaylistCache[cacheKey]);
      return;
    }

    setIsLoadingPlaylistTracks(true);
    try {
      setCommunityPlaylistTracks(await resolveCommunityPlaylistTracks(pl));
    } finally {
      setIsLoadingPlaylistTracks(false);
    }
  };

  // Add button on a playlist row. With popups off, the button itself shows
  // the result.
  const handleAddCommunityPlaylist = async (pl: CommunityPlaylist) => {
    setPlaylistAddState(prev => ({ ...prev, [pl.id]: 'adding' }));
    const tracks = await resolveCommunityPlaylistTracks(pl);
    if (tracks.length === 0) {
      setPlaylistAddState(prev => ({ ...prev, [pl.id]: 'failed' }));
      return;
    }
    importPlaylistToLibrary(pl.title, `Imported Search Playlist (${tracks.length} tracks)`, tracks);
    setPlaylistAddState(prev => ({ ...prev, [pl.id]: 'added' }));
  };

  const handleOpenAlbum = async (album: { title: string; artist: string }) => {
    setActiveAlbum({ title: album.title, artist: album.artist, tracks: [] });
    try {
      const tracks = await searchYouTubeMusic(`${album.title} ${album.artist}`);
      setActiveAlbum({ title: album.title, artist: album.artist, tracks: tracks || [] });
    } catch {
      setActiveAlbum({ title: album.title, artist: album.artist, tracks: [] });
    }
  };

  const chips: { id: SearchMode; label: string }[] = [
    { id: 'results', label: tr("Results") },
    { id: 'library', label: tr("Your library") },
    { id: 'songs', label: tr("Songs") },
    { id: 'artists', label: tr("Artists") },
    { id: 'albums', label: tr("Albums") },
    { id: 'videos', label: tr("Videos") },
    { id: 'playlists', label: tr("Community Playlists") },
  ];

  const SongRow: React.FC<{ track: Track; list: Track[]; index: number }> = ({ track, list, index }) => {
    const isCurrent = currentTrack?.id === track.id;
    return (
      <button
        onClick={() => {
          rememberItem({ kind: 'track', track, at: Date.now() });
          if (track.isYouTube) playWithArtistTop(track, list);
          else playQueue(list, index);
        }}
        className="w-full flex items-center gap-4 p-2 rounded-xl text-left hover:bg-app-surface/70 active:scale-[0.99] transition-all"
      >
        <img src={track.coverUrl} alt={track.title} loading="lazy" className="w-14 h-14 rounded-lg object-cover shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-app-primary truncate">{track.title}</p>
          <span
            role="button"
            tabIndex={0}
            onClick={e => {
              e.stopPropagation();
              openArtistProfile(track.artist);
            }}
            className="block text-sm text-app-secondary truncate mt-0.5 hover:text-app-primary hover:underline"
            title={tr("View artist profile")}
          >
            Song, {track.artist}
          </span>
        </div>
        {isCurrent && isPlaying && <span className="eq pause-when-hidden shrink-0" aria-hidden="true"><span /><span /><span /></span>}
        <span
          role="button"
          tabIndex={0}
          onClick={e => {
            e.stopPropagation();
            setSelectedTrackForMenu(track);
          }}
          className="p-2 text-app-secondary hover:text-app-primary"
          title={tr("Track options")}
        >
          <MoreVertical className="w-5 h-5" />
        </span>
      </button>
    );
  };

  // A song from your own library, marked liked / downloaded.
  const LibrarySongRow: React.FC<{ track: Track; list: Track[]; index: number }> = ({ track, list, index }) => (
    <button
      onClick={() => {
        rememberItem({ kind: 'track', track, at: Date.now() });
        playQueue(list, index);
      }}
      className="w-full flex items-center gap-4 p-2 rounded-xl text-left"
    >
      <img src={track.coverUrl} alt={track.title} loading="lazy" className="w-14 h-14 rounded-lg object-cover shrink-0 bg-app-surface" />
      <div className="flex-1 min-w-0">
        <p className={`text-base font-semibold truncate ${currentTrack?.id === track.id ? 'text-app-accent' : 'text-app-primary'}`}>
          {track.title}
        </p>
        <p className="text-sm text-app-secondary truncate flex items-center gap-1.5">
          {downloadedIds.has(track.id) && <Download className="w-3.5 h-3.5 shrink-0" />}
          {likedIds.has(track.id) && <Heart className="w-3.5 h-3.5 shrink-0 fill-current" />}
          <span className="truncate">{track.artist}</span>
        </p>
      </div>
      <span
        role="button"
        tabIndex={0}
        onClick={e => {
          e.stopPropagation();
          setSelectedTrackForMenu(track);
        }}
        className="p-2 text-app-secondary"
        title={tr("More")}
      >
        <MoreVertical className="w-5 h-5" />
      </span>
    </button>
  );

  const LocalPlaylistRow: React.FC<{ id: string; name: string; tracks: Track[] }> = ({ id, name, tracks: plTracks }) => (
    <button
      onClick={() => setActiveLocalPlaylist({ id, title: name, tracks: plTracks })}
      className="w-full flex items-center gap-4 p-2 rounded-xl text-left"
    >
      {plTracks[0]?.coverUrl ? (
        <img src={plTracks[0].coverUrl} alt="" loading="lazy" className="w-14 h-14 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="w-14 h-14 rounded-lg bg-app-surface flex items-center justify-center shrink-0">
          <ListMusic className="w-6 h-6 text-app-secondary" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-base font-semibold text-app-primary truncate">{name}</p>
        <p className="text-sm text-app-secondary truncate flex items-center gap-1.5">
          <Library className="w-3.5 h-3.5 shrink-0" />
          Your playlist · {plTracks.length} songs
        </p>
      </div>
    </button>
  );

  const ArtistRows: React.FC<{ artists: ArtistResult[]; limit?: number }> = ({ artists, limit }) => (
    <>
      {(limit ? artists.slice(0, limit) : artists).map(a => (
        <button
          key={a.id}
          onClick={() => {
            setActiveArtist(a);
            saveHistory(a.name);
            rememberItem({ kind: 'artist', name: a.name, thumbnail: a.thumbnail, at: Date.now() });
          }}
          className="w-full flex items-center gap-4 p-2 rounded-xl text-left hover:bg-app-surface/70 active:scale-[0.99] transition-all"
        >
          <img
            src={a.thumbnail}
            alt={a.name}
            loading="lazy"
            className="w-20 h-20 rounded-full object-cover bg-app-surface shrink-0"
          />
          <div className="min-w-0">
            <p className="text-lg font-semibold text-app-primary truncate">{a.name}</p>
            <p className="text-base text-app-secondary truncate mt-0.5">{a.subtitle || 'Artist'}</p>
          </div>
        </button>
      ))}
    </>
  );

  const menuModal = (
    <TrackOptionsMenuModal
      track={selectedTrackForMenu}
      onClose={() => setSelectedTrackForMenu(null)}
    />
  );

  const typed = inputValue.trim().toLowerCase();
  const historyMatches = typed
    ? searchHistory
        .filter(q => q.toLowerCase().includes(typed) && q.toLowerCase() !== typed)
        .slice(0, 3)
    : [];
  const remoteMatches = typed
    ? suggestions
        .filter(
          s =>
            s.toLowerCase() !== typed &&
            !historyMatches.some(h => h.toLowerCase() === s.toLowerCase())
        )
        .slice(0, 8)
    : [];
  const showDropdown =
    showSuggestions && typed.length > 0 && (historyMatches.length > 0 || remoteMatches.length > 0);

  if (activeArtist) {
    return (
      <>
        {menuModal}
        <ArtistDetailView
          artistName={activeArtist.name}
          localTracks={[]}
          onBack={() => setActiveArtist(null)}
          onOpenAlbum={title => handleOpenAlbum({ title, artist: activeArtist.name })}
        />
      </>
    );
  }

  if (activeLocalPlaylist) {
    return (
      <>
        {menuModal}
        <PlaylistDetailView
          title={activeLocalPlaylist.title}
          subtitle={`${activeLocalPlaylist.tracks.length} songs`}
          coverUrl={activeLocalPlaylist.tracks[0]?.coverUrl}
          tracks={activeLocalPlaylist.tracks}
          playlistId={activeLocalPlaylist.id}
          onBack={() => setActiveLocalPlaylist(null)}
        />
      </>
    );
  }

  if (activeAlbum) {
    return (
      <>
        {menuModal}
        <PlaylistDetailView
          title={activeAlbum.title}
          subtitle={activeAlbum.artist}
          coverUrl={activeAlbum.tracks[0]?.coverUrl}
          tracks={activeAlbum.tracks}
          onBack={() => setActiveAlbum(null)}
        />
      </>
    );
  }

  if (activeCommunityPlaylist) {
    const cacheKey = activeCommunityPlaylist.browseId || activeCommunityPlaylist.id;
    return (
      <>
        {menuModal}
        <PlaylistDetailView
          title={activeCommunityPlaylist.title}
          subtitle={`${activeCommunityPlaylist.author} • ${activeCommunityPlaylist.songCount}`}
          coverUrl={activeCommunityPlaylist.coverUrl}
          tracks={communityPlaylistTracks}
          onBack={() => setActiveCommunityPlaylist(null)}
          onDownloadAll={() => downloadPlaylist(activeCommunityPlaylist.title, communityPlaylistTracks)}
          onAddTrack={track => {
            setCommunityPlaylistTracks(prev => {
              const next = prev.some(t => t.id === track.id) ? prev : [track, ...prev];
              updateCommunityPlaylistCache(cacheKey, next);
              return next;
            });
            addTrackToLibrary(track);
          }}
          onRemoveTrack={trackId => {
            setCommunityPlaylistTracks(prev => {
              const next = prev.filter(t => t.id !== trackId);
              updateCommunityPlaylistCache(cacheKey, next);
              return next;
            });
          }}
        />
      </>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-28 bg-transparent" onScroll={handleScroll}>
      {menuModal}
      <>
          {/* Header */}
          <div className="flex items-center gap-4 px-5 safe-top pb-4">
            <button
              onClick={() => {
                setInputValue('');
                setSearchQuery('');
              }}
              className="p-1 text-app-primary"
              title={tr("Back")}
            >
              <ChevronLeft className="w-7 h-7" />
            </button>
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-app-primary leading-tight">
                {searchQuery ? 'Search results' : 'Search'}
              </h1>
              {searchQuery && (
                <p className="text-base text-app-secondary mt-1">for "{searchQuery}"</p>
              )}
            </div>
          </div>

          {/* Search Input */}
          <div className="px-5 pb-4">
            <div className="relative w-full">
              <Search className="absolute left-4 top-3.5 w-5 h-5 text-app-secondary" />
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={e => {
                  setInputValue(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitSearch();
                }}
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={tr("Songs, artists, albums, playlists...")}
                className="w-full bg-app-surface border border-app-theme rounded-full py-3 pl-12 pr-10 text-base text-app-primary placeholder:text-app-secondary focus:outline-none focus:border-app-theme"
              />
              {inputValue ? (
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    setInputValue('');
                    inputRef.current?.focus();
                  }}
                  className="absolute right-3 top-3 p-0.5 text-app-secondary hover:text-app-primary"
                  title={tr("Clear")}
                >
                  <X className="w-5 h-5" />
                </button>
              ) : (
                isSearching && (
                  <Loader2 className="absolute right-4 top-3.5 w-5 h-5 text-app-primary animate-spin" />
                )
              )}

              {showDropdown && (
                <div className="absolute left-0 right-0 top-full mt-2 z-30 rounded-2xl bg-app-solid border border-app-theme overflow-hidden shadow-lg anim-dropdown">
                  {historyMatches.map(q => (
                    <button
                      key={`h-${q}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => submitSearch(q)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                    >
                      <History className="w-4 h-4 text-app-secondary shrink-0" />
                      <span className="text-base text-app-primary truncate">{q}</span>
                    </button>
                  ))}
                  {remoteMatches.map(s => (
                    <button
                      key={`s-${s}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => submitSearch(s)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                    >
                      <Search className="w-4 h-4 text-app-secondary shrink-0" />
                      <span className="text-base text-app-primary truncate">{s}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Mode Chips */}
          {searchQuery && (
            <div className="flex gap-2 overflow-x-auto px-5 pb-4 no-scrollbar">
              {chips.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSearchMode(c.id)}
                  className={`px-5 py-2.5 rounded-lg text-base font-semibold shrink-0 transition-all ${
                    searchMode === c.id
                      ? 'bg-app-highlight text-app-inverse'
                      : 'bg-app-card text-app-primary'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {!searchQuery && (
            <div className="px-5 space-y-6">
              {recentItems.length > 0 && (
                <div>
                  <div className="flex items-center justify-between pb-2">
                    <p className="text-sm text-app-secondary">{tr("RECENTLY OPENED")}</p>
                    {recentMenu.element}
                  </div>
                  <div className="flex gap-4 overflow-x-auto pb-1 -mx-5 px-5 no-scrollbar">
                    {recentItems.map(item => (
                      <button
                        key={recentItemKey(item)}
                        onClick={() => openRecentItem(item)}
                        onContextMenu={e =>
                          recentMenu.open(e, [
                            item.kind === 'track'
                              ? { label: tr('Play'), icon: Play, onClick: () => openRecentItem(item) }
                              : { label: tr('Open artist'), icon: User, onClick: () => openRecentItem(item) },
                            {
                              label: tr('Remove from recently opened'),
                              icon: Trash2,
                              danger: true,
                              onClick: () => forgetItem(item),
                            },
                          ])
                        }
                        className="w-24 shrink-0 text-left"
                      >
                        <img
                          src={item.kind === 'track' ? item.track.coverUrl : item.thumbnail}
                          alt=""
                          loading="lazy"
                          className={`w-24 h-24 object-cover bg-app-surface ${item.kind === 'artist' ? 'rounded-full' : 'rounded-xl'}`}
                        />
                        <p className="text-sm font-semibold text-app-primary mt-1.5 truncate">
                          {item.kind === 'track' ? item.track.title : item.name}
                        </p>
                        <p className="text-xs text-app-secondary truncate">
                          {item.kind === 'track' ? item.track.artist : 'Artist'}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {searchHistory.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between pb-2">
                    <p className="text-sm text-app-secondary">{tr("RECENT SEARCHES")}</p>
                    <button onClick={clearAllRecent} className="text-sm text-app-secondary hover:text-app-primary">
                      {tr("Clear all")}
                    </button>
                  </div>
                  {searchHistory.map(q => (
                    <div key={q} className="flex items-center justify-between py-2">
                      <button
                        onClick={() => submitSearch(q)}
                        className="flex items-center gap-3 min-w-0 text-left"
                      >
                        <Search className="w-4 h-4 text-app-secondary shrink-0" />
                        <span className="text-base text-app-primary truncate">{q}</span>
                      </button>
                      <button
                        onClick={() => removeHistory(q)}
                        className="p-2 text-app-secondary hover:text-app-primary shrink-0"
                        title={tr("Remove")}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-3">
              <p className="text-sm text-app-secondary font-medium tracking-wide">{tr("TRENDING ARTISTS & GENRES")}</p>
              <div className="flex flex-wrap gap-2">
                {['Drake', 'Travis Scott', 'Future', 'King Von', 'Lil Baby', 'Kendrick Lamar', 'Metro Boomin', 'Hip Hop Hits'].map(term => (
                  <button
                    key={term}
                    onClick={() => submitSearch(term)}
                    className="px-4 py-2 rounded-full bg-app-surface border border-app-theme text-sm text-app-primary hover:border-app-primary active:scale-95 transition-all"
                  >
                    {term}
                  </button>
                ))}
              </div>
              </div>
            </div>
          )}

          {/* RESULTS MODE */}
          {searchMode === 'results' && searchQuery && (
            <div className="px-5 space-y-8 anim-fade">
              {(libraryMatches.tracks.length > 0 || libraryMatches.playlists.length > 0) && (
                <div>
                  <div className="flex items-center justify-between pb-2">
                    <h2 className="text-2xl font-bold text-app-primary">{tr("In your library")}</h2>
                    <button onClick={() => setSearchMode('library')} className="text-base text-app-secondary">
                      {tr("View all")}
                    </button>
                  </div>
                  <div className="space-y-1 -mx-2">
                    {libraryMatches.playlists.slice(0, 2).map(({ playlist, tracks: plTracks }) => (
                      <LocalPlaylistRow key={playlist.id} id={playlist.id} name={playlist.name} tracks={plTracks} />
                    ))}
                    {libraryMatches.tracks.slice(0, 3).map((t, idx) => (
                      <LibrarySongRow key={t.id} track={t} list={libraryMatches.tracks} index={idx} />
                    ))}
                  </div>
                </div>
              )}

              {artistResults.length > 0 && (
                <div>
                  <div className="flex items-center justify-between pb-2">
                    <h2 className="text-2xl font-bold text-app-primary">{tr("Artists")}</h2>
                    <button onClick={() => setSearchMode('artists')} className="text-base text-app-secondary">
                      {tr("View all")}
                    </button>
                  </div>
                  <ArtistRows artists={artistResults} limit={3} />
                </div>
              )}

              {searchResults.length > 0 && (
                <div>
                  <div className="flex items-center justify-between pb-2">
                    <h2 className="text-2xl font-bold text-app-primary">{tr("Songs")}</h2>
                    <button onClick={() => setSearchMode('songs')} className="text-base text-app-secondary">
                      {tr("View all")}
                    </button>
                  </div>
                  <div className="space-y-1 -mx-2">
                    {searchResults.slice(0, 5).map((t, idx) => (
                      <SongRow key={t.id} track={t} list={searchResults} index={idx} />
                    ))}
                  </div>
                </div>
              )}

              {playlistResults.length > 0 && (
                <div>
                  <div className="flex items-center justify-between pb-3">
                    <h2 className="text-2xl font-bold text-app-primary">{tr("Playlists")}</h2>
                    <button onClick={() => setSearchMode('playlists')} className="text-base text-app-secondary">
                      {tr("View all")}
                    </button>
                  </div>
                  <div className="flex gap-4 overflow-x-auto pb-2 -mx-5 px-5 no-scrollbar">
                    {playlistResults.slice(0, 8).map(p => (
                      <button
                        key={p.id}
                        onClick={() => handleOpenCommunityPlaylist(p)}
                        className="w-36 shrink-0 text-left"
                      >
                        <img src={p.coverUrl} alt={p.title} loading="lazy" className="w-36 h-36 rounded-xl object-cover bg-app-surface" />
                        <p className="text-sm font-semibold text-app-primary mt-2 truncate">{p.title}</p>
                        <p className="text-sm text-app-secondary truncate">{p.author || p.songCount}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {albumResults.length > 0 && (
                <div>
                  <div className="flex items-center justify-between pb-3">
                    <h2 className="text-2xl font-bold text-app-primary">{tr("Albums")}</h2>
                    <button onClick={() => setSearchMode('albums')} className="text-base text-app-secondary">
                      {tr("View all")}
                    </button>
                  </div>
                  <div className="flex gap-4 overflow-x-auto pb-2 -mx-5 px-5 no-scrollbar">
                    {albumResults.slice(0, 8).map(a => (
                      <button
                        key={a.id}
                        onClick={() => handleOpenAlbum(a)}
                        className="w-36 shrink-0 text-left"
                      >
                        <img src={a.coverUrl} alt={a.title} loading="lazy" className="w-36 h-36 rounded-xl object-cover bg-app-surface" />
                        <p className="text-sm font-semibold text-app-primary mt-2 truncate">{a.title}</p>
                        <p className="text-sm text-app-secondary truncate">{a.artist}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!isSearching && searchResults.length === 0 && artistResults.length === 0 && albumResults.length === 0 && playlistResults.length === 0 && libraryMatches.tracks.length === 0 && (
                <p className="text-center text-app-secondary py-10">{tr("No results found")}</p>
              )}
            </div>
          )}

          {/* YOUR LIBRARY MODE */}
          {searchMode === 'library' && searchQuery && (
            <div className="px-3 space-y-1">
              {libraryMatches.playlists.map(({ playlist, tracks: plTracks }) => (
                <LocalPlaylistRow key={playlist.id} id={playlist.id} name={playlist.name} tracks={plTracks} />
              ))}
              {libraryMatches.tracks.map((t, idx) => (
                <LibrarySongRow key={t.id} track={t} list={libraryMatches.tracks} index={idx} />
              ))}
              {libraryMatches.tracks.length === 0 && libraryMatches.playlists.length === 0 && (
                <p className="text-center text-app-secondary py-10">
                  Nothing in your liked songs, downloads, history or playlists matches "{searchQuery}"
                </p>
              )}
            </div>
          )}

          {/* SONGS MODE */}
          {searchMode === 'songs' && (
            <div className="px-3 space-y-1">
              {searchResults.map((t, idx) => (
                <SongRow key={t.id} track={t} list={searchResults} index={idx} />
              ))}
              {searchResults.length > 0 && (
                <p className="text-center text-sm text-app-secondary py-6">
                  {loadingMore ? 'Loading more songs...' : noMoreSongs ? 'No more results' : 'Scroll for more'}
                </p>
              )}
            </div>
          )}

          {/* ARTISTS MODE */}
          {searchMode === 'artists' && (
            <div className="px-5">
              <ArtistRows artists={artistResults} />
              {artistResults.length === 0 && !isSearching && (
                <p className="text-center text-app-secondary py-10">{tr("No artists found")}</p>
              )}
            </div>
          )}

          {/* ALBUMS MODE */}
          {searchMode === 'albums' && (
            <div className="px-5 grid grid-cols-2 gap-x-5 gap-y-6">
              {albumResults.map(a => (
                <button key={a.id} onClick={() => handleOpenAlbum(a)} className="text-left">
                  <img src={a.coverUrl} alt={a.title} loading="lazy" className="w-full aspect-square rounded-xl object-cover bg-app-surface" />
                  <p className="text-base font-semibold text-app-primary mt-2 truncate">{a.title}</p>
                  <p className="text-sm text-app-secondary truncate">{a.artist}</p>
                </button>
              ))}
              {albumResults.length === 0 && !isSearching && (
                <p className="col-span-2 text-center text-app-secondary py-10">{tr("No albums found")}</p>
              )}
            </div>
          )}

          {/* VIDEOS MODE */}
          {searchMode === 'videos' && (
            <div className="px-3 space-y-1">
              {videoResults.map((t, idx) => (
                <SongRow key={`${t.id}-${idx}`} track={t} list={videoResults} index={idx} />
              ))}
              {videoResults.length === 0 && !isSearching && (
                <p className="text-center text-app-secondary py-10">{tr("No videos found")}</p>
              )}
            </div>
          )}

          {/* PLAYLISTS MODE */}
          {searchMode === 'playlists' && (
            <div className="px-5 space-y-4">
              {playlistResults.map(pl => (
                <div
                  key={pl.id}
                  className="w-full flex items-center justify-between gap-4 p-2 rounded-2xl hover:bg-white/5 transition-colors group"
                >
                  <button
                    onClick={() => handleOpenCommunityPlaylist(pl)}
                    className="flex-1 flex items-center gap-4 text-left min-w-0"
                  >
                    <img src={pl.coverUrl} alt={pl.title} loading="lazy" className="w-20 h-20 rounded-xl object-cover shrink-0" />
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-app-primary truncate">{pl.title}</p>
                      <p className="text-sm text-app-secondary truncate mt-0.5">
                        {pl.author} • {pl.songCount}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (playlistAddState[pl.id] === 'adding' || playlistAddState[pl.id] === 'added') return;
                      void handleAddCommunityPlaylist(pl);
                    }}
                    disabled={playlistAddState[pl.id] === 'adding' || playlistAddState[pl.id] === 'added'}
                    className={`px-3 py-2 rounded-xl flex items-center gap-1.5 text-xs font-semibold active:scale-95 transition-all shrink-0 cursor-pointer ${
                      playlistAddState[pl.id] === 'added'
                        ? 'bg-app-highlight text-app-inverse'
                        : playlistAddState[pl.id] === 'failed'
                          ? 'bg-red-500/20 text-red-300'
                          : 'bg-white/10 hover:bg-white/20 text-app-primary hover:scale-105'
                    }`}
                    title={tr("Add to My Playlists")}
                  >
                    {playlistAddState[pl.id] === 'added' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <FolderPlus className="w-4 h-4" />
                    )}
                    <span>
                      {playlistAddState[pl.id] === 'adding'
                        ? 'Adding...'
                        : playlistAddState[pl.id] === 'added'
                          ? 'Added'
                          : playlistAddState[pl.id] === 'failed'
                            ? 'Retry'
                            : 'Add'}
                    </span>
                  </button>
                </div>
              ))}
              {playlistResults.length > 0 && (
                <p className="text-center text-sm text-app-secondary py-6">
                  {loadingMore ? 'Loading more playlists...' : noMorePlaylists ? 'No more results' : 'Scroll for more'}
                </p>
              )}
              {playlistResults.length === 0 && !isSearching && (
                <p className="text-center text-app-secondary py-10">{tr("No community playlists found")}</p>
              )}
            </div>
          )}
      </>
    </div>
  );
};
