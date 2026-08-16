import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  ChevronLeft,
  Play,
  Pause,
  Shuffle,
  Download,
  FolderPlus,
  MoreVertical,
  Loader2,
  X,
} from 'lucide-react';
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
  fetchYouTubePlaylistTracks,
  loadMoreSearchResults,
  loadMorePlaylistResults,
  getCachedSearch,
  type ArtistResult,
  type AlbumResult,
} from '../utils/ytMusicApi';
import type { Track, CommunityPlaylist } from '../types/music';

type SearchMode = 'results' | 'songs' | 'artists' | 'albums' | 'videos' | 'playlists';

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
        thumbnail: s.coverUrl || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300',
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
        coverUrl: s.coverUrl || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300',
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
      coverUrl: songs[0]?.coverUrl || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300',
    },
    {
      id: `derived-pl-2`,
      browseId: `derived-pl-2`,
      title: `Best of ${query}`,
      author: 'YouTube Music Community',
      songCount: `${Math.min(songs.length, 12)} Songs`,
      coverUrl: songs[1]?.coverUrl || songs[0]?.coverUrl || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300',
    },
  ];
};

export const SearchView: React.FC = () => {
  const {
    searchQuery,
    setSearchQuery,
    playQueue,
    currentTrack,
    isPlaying,
    togglePlay,
    downloadTrack,
    downloadPlaylist,
    importPlaylistToLibrary,
    openArtistProfile,
  } = useAudio();

  const [searchMode, setSearchMode] = useState<SearchMode>('results');

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
  const [communityPlaylistTracks, setCommunityPlaylistTracks] = useState<Track[]>([]);
  const [isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = useState(false);

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

    const timer = setTimeout(async () => {
      setIsSearching(true);
      saveHistory(searchQuery);
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
    }, 50);

    return () => {
      isMounted = false;
      clearTimeout(timer);
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

  const handleOpenCommunityPlaylist = async (pl: CommunityPlaylist) => {
    setActiveCommunityPlaylist(pl);
    setIsLoadingPlaylistTracks(true);
    try {
      const tracks = await fetchYouTubePlaylistTracks(pl.browseId);
      setCommunityPlaylistTracks(tracks);
    } catch {
      setCommunityPlaylistTracks([]);
    } finally {
      setIsLoadingPlaylistTracks(false);
    }
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
    { id: 'results', label: 'Results' },
    { id: 'songs', label: 'Songs' },
    { id: 'artists', label: 'Artists' },
    { id: 'albums', label: 'Albums' },
    { id: 'videos', label: 'Videos' },
    { id: 'playlists', label: 'Community Playlists' },
  ];

  const SongRow: React.FC<{ track: Track; list: Track[]; index: number }> = ({ track, list, index }) => {
    const isCurrent = currentTrack?.id === track.id;
    return (
      <button
        onClick={() => playQueue(list, index)}
        className="w-full flex items-center gap-4 p-2 rounded-xl text-left"
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
            title="View artist profile"
          >
            Song, {track.artist}
          </span>
        </div>
        {isCurrent && isPlaying && <Pause className="w-4 h-4 text-app-primary fill-current shrink-0" />}
        <span
          role="button"
          tabIndex={0}
          onClick={e => {
            e.stopPropagation();
            setSelectedTrackForMenu(track);
          }}
          className="p-1.5 text-app-secondary shrink-0"
          title="More Options"
        >
          <MoreVertical className="w-5 h-5" />
        </span>
      </button>
    );
  };

  const ArtistRows: React.FC<{ artists: ArtistResult[]; limit?: number }> = ({ artists, limit }) => (
    <>
      {artists.slice(0, limit || artists.length).map(a => (
        <button
          key={a.id}
          onClick={() => setActiveArtist(a)}
          className="w-full flex items-center gap-5 py-3 text-left"
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
    return (
      <div className="flex-1 flex flex-col overflow-y-auto pb-28 bg-app-primary">
        {menuModal}
          <div className="relative h-80 shrink-0 overflow-hidden">
            <img
              src={activeCommunityPlaylist.coverUrl}
              alt={activeCommunityPlaylist.title}
              className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black" />
            <button
              onClick={() => setActiveCommunityPlaylist(null)}
              className="absolute top-4 left-4 p-2 text-app-primary"
              title="Back"
            >
              <ChevronLeft className="w-7 h-7" />
            </button>
          </div>

          <div className="px-6 pt-2 flex items-center justify-between">
            <button
              onClick={() => communityPlaylistTracks.length > 0 && playQueue(communityPlaylistTracks, 0)}
              className="p-2 text-app-primary hover:scale-105 active:scale-95 transition-transform"
              title="Play All"
            >
              <Play className="w-7 h-7 fill-current" />
            </button>
            <button
              onClick={() => communityPlaylistTracks.length > 0 && playQueue(communityPlaylistTracks, Math.floor(Math.random() * communityPlaylistTracks.length))}
              className="p-2 text-app-primary hover:scale-105 active:scale-95 transition-transform"
              title="Shuffle"
            >
              <Shuffle className="w-6 h-6" />
            </button>
            <button
              onClick={() => {
                if (communityPlaylistTracks.length > 0) {
                  importPlaylistToLibrary(
                    activeCommunityPlaylist.title,
                    `Imported Search Playlist (${communityPlaylistTracks.length} tracks)`,
                    communityPlaylistTracks
                  );
                }
              }}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-app-primary rounded-xl flex items-center gap-1.5 text-xs font-semibold hover:scale-105 active:scale-95 transition-all"
              title="Add to My Playlists"
            >
              <FolderPlus className="w-4 h-4 text-app-primary" />
              <span>Add Playlist</span>
            </button>
            <button
              onClick={() => {
                if (communityPlaylistTracks.length > 0) {
                  downloadPlaylist(activeCommunityPlaylist.title, communityPlaylistTracks);
                }
              }}
              className="p-2 text-app-primary hover:scale-105 active:scale-95 transition-transform"
              title="Download All"
            >
              <Download className="w-6 h-6" />
            </button>
          </div>

          <div className="px-6 pt-4">
            <h1 className="text-3xl font-bold text-app-primary leading-tight">{activeCommunityPlaylist.title}</h1>
            <p className="text-base text-app-secondary mt-2">
              {activeCommunityPlaylist.author} • {activeCommunityPlaylist.songCount}
            </p>
          </div>

          <div className="px-3 pt-6 space-y-1">
            {isLoadingPlaylistTracks ? (
              <div className="text-center py-12 space-y-2">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-app-primary" />
                <p className="text-sm text-app-secondary">Fetching playlist tracks...</p>
              </div>
            ) : (
              communityPlaylistTracks.map((t, idx) => (
                <button
                  key={`${t.id}-${idx}`}
                  onClick={() => playQueue(communityPlaylistTracks, idx)}
                  className="w-full flex items-center gap-4 p-2 rounded-xl text-left"
                >
                  <img src={t.coverUrl} alt={t.title} className="w-14 h-14 rounded-lg object-cover shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-app-primary truncate">{t.title}</p>
                    <p className="text-sm text-app-secondary truncate mt-0.5">{t.artist}</p>
                  </div>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      downloadTrack(t);
                    }}
                    className="p-1.5 text-app-secondary shrink-0"
                    title="Download"
                  >
                    <Download className="w-5 h-5" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedTrackForMenu(t);
                    }}
                    className="p-1.5 text-app-secondary shrink-0"
                    title="More Options"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      const isCurrent = currentTrack?.id === t.id;
                      if (isCurrent) togglePlay();
                      else playQueue(communityPlaylistTracks, idx);
                    }}
                    className="p-1.5 text-app-primary shrink-0"
                    title="Play"
                  >
                    {currentTrack?.id === t.id && isPlaying ? (
                      <Pause className="w-6 h-6 fill-current" />
                    ) : (
                      <Play className="w-6 h-6 fill-current" />
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-28 bg-transparent" onScroll={handleScroll}>
      {menuModal}
      <>
          {/* Header */}
          <div className="flex items-center gap-4 px-5 safe-top pb-4">
            <button
              onClick={() => setSearchQuery('')}
              className="p-1 text-app-primary"
              title="Back"
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
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Songs, artists, albums, playlists..."
                className="w-full bg-app-surface border border-app-theme rounded-full py-3 pl-12 pr-10 text-base text-app-primary placeholder:text-app-secondary focus:outline-none focus:border-app-theme"
              />
              {isSearching && (
                <Loader2 className="absolute right-4 top-3.5 w-5 h-5 text-app-primary animate-spin" />
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
              {searchHistory.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm text-app-secondary pb-2">RECENT SEARCHES</p>
                  {searchHistory.map(q => (
                    <div key={q} className="flex items-center justify-between py-2">
                      <button
                        onClick={() => setSearchQuery(q)}
                        className="flex items-center gap-3 min-w-0 text-left"
                      >
                        <Search className="w-4 h-4 text-app-secondary shrink-0" />
                        <span className="text-base text-app-primary truncate">{q}</span>
                      </button>
                      <button
                        onClick={() => removeHistory(q)}
                        className="p-2 text-app-secondary hover:text-app-primary shrink-0"
                        title="Remove"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-3">
              <p className="text-sm text-app-secondary">TRENDING SEARCHES</p>
              <div className="flex flex-wrap gap-2">
                {['Drake', 'Taylor Swift', 'Lo-Fi Chill Beats', 'Synthwave', 'Gym Workout Beats'].map(term => (
                  <button
                    key={term}
                    onClick={() => setSearchQuery(term)}
                    className="px-4 py-2 rounded-full bg-app-surface border border-app-theme text-sm text-app-primary"
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
            <div className="px-5 space-y-8">
              {artistResults.length > 0 && (
                <div>
                  <div className="flex items-center justify-between pb-2">
                    <h2 className="text-2xl font-bold text-app-primary">Artists</h2>
                    <button onClick={() => setSearchMode('artists')} className="text-base text-app-secondary">
                      View all
                    </button>
                  </div>
                  <ArtistRows artists={artistResults} limit={3} />
                </div>
              )}

              {searchResults.length > 0 && (
                <div>
                  <div className="flex items-center justify-between pb-2">
                    <h2 className="text-2xl font-bold text-app-primary">Songs</h2>
                    <button onClick={() => setSearchMode('songs')} className="text-base text-app-secondary">
                      View all
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
                    <h2 className="text-2xl font-bold text-app-primary">Playlists</h2>
                    <button onClick={() => setSearchMode('playlists')} className="text-base text-app-secondary">
                      View all
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
                    <h2 className="text-2xl font-bold text-app-primary">Albums</h2>
                    <button onClick={() => setSearchMode('albums')} className="text-base text-app-secondary">
                      View all
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

              {!isSearching && searchResults.length === 0 && artistResults.length === 0 && albumResults.length === 0 && playlistResults.length === 0 && (
                <p className="text-center text-app-secondary py-10">No results found</p>
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
                <p className="text-center text-app-secondary py-10">No artists found</p>
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
                <p className="col-span-2 text-center text-app-secondary py-10">No albums found</p>
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
                <p className="text-center text-app-secondary py-10">No videos found</p>
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
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const tracks = await fetchYouTubePlaylistTracks(pl.id);
                        if (tracks && tracks.length > 0) {
                          importPlaylistToLibrary(
                            pl.title,
                            `Imported Search Playlist (${tracks.length} tracks)`,
                            tracks
                          );
                        }
                      } catch {
                        // ignore
                      }
                    }}
                    className="px-3 py-2 bg-white/10 hover:bg-white/20 text-app-primary rounded-xl flex items-center gap-1.5 text-xs font-semibold hover:scale-105 active:scale-95 transition-all shrink-0 cursor-pointer"
                    title="Add to My Playlists"
                  >
                    <FolderPlus className="w-4 h-4 text-app-primary" />
                    <span>Add</span>
                  </button>
                </div>
              ))}
              {playlistResults.length > 0 && (
                <p className="text-center text-sm text-app-secondary py-6">
                  {loadingMore ? 'Loading more playlists...' : noMorePlaylists ? 'No more results' : 'Scroll for more'}
                </p>
              )}
              {playlistResults.length === 0 && !isSearching && (
                <p className="text-center text-app-secondary py-10">No community playlists found</p>
              )}
            </div>
          )}
      </>
    </div>
  );
};
