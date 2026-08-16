import React, { useEffect, useMemo, useRef, useState } from 'react';
import { searchYouTubeMusic, loadMoreSearchResults } from '../utils/ytMusicApi';
import {
  Plus,
  History,
  Heart,
  Plane,
  Download,
  ArrowDownAZ,
  Search,
  FolderPlus,
  Disc3,
  X,
} from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { PlaylistDetailView } from './PlaylistDetailView';
import { ArtistDetailView } from './ArtistDetailView';
import { LikedMusicView } from './LikedMusicView';
import { DownloadsView } from './DownloadsView';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import type { Track } from '../types/music';

type LibTab = 'songs' | 'playlists' | 'albums' | 'artists' | 'discover';

const DISCOVER_QUERIES = [
  'top hits popular songs',
  'new music 2026',
  'trending hip hop rap',
  'pop hits',
  'rock classics',
  'chill lofi beats',
  'r&b soul hits',
  'edm dance hits',
];

type SubView =
  | { kind: 'favorites' }
  | { kind: 'downloads' }
  | { kind: 'recent' }
  | { kind: 'playlist'; id: string }
  | { kind: 'album'; name: string }
  | { kind: 'artist'; name: string }
  | null;

const formatDuration = (secs: number) => {
  if (!secs || isNaN(secs)) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export const LibraryView: React.FC = () => {
  const {
    tracks,
    playlists,
    favorites,
    downloads,
    recentlyPlayed,
    currentTrack,
    isPlaying,
    playQueue,
    createPlaylist,
    addLocalTracks,
    downloadPlaylist,
    setActiveTab,
    favoriteTracks,
    trackStore,
    renamePlaylist,
    deletePlaylist,
    hiddenArtists,
    hideArtist,
    reorderPlaylistTracks,
    removeTrackFromPlaylist,
    addTrackToPlaylist,
    settings,
  } = useAudio();

  const isCompact = settings.iconSize === 'compact' || settings.compactView;
  const isLarge = settings.iconSize === 'large';

  const allKnownTracks = useMemo(() => {
    const map = new Map<string, Track>();
    recentlyPlayed.forEach(t => map.set(t.id, t));
    favoriteTracks.forEach(t => map.set(t.id, t));
    tracks.forEach(t => map.set(t.id, t));
    return Array.from(map.values());
  }, [tracks, favoriteTracks, recentlyPlayed]);

  const [tab, setTab] = useState<LibTab>('playlists');
  const [subView, setSubView] = useState<SubView>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedTrackForMenu, setSelectedTrackForMenu] = useState<Track | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [discoverTracks, setDiscoverTracks] = useState<Track[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverDone, setDiscoverDone] = useState(false);
  const [discoverQueryIdx, setDiscoverQueryIdx] = useState(0);

  useEffect(() => {
    if (tab !== 'discover' || discoverTracks.length > 0 || discoverLoading) return;
    setDiscoverLoading(true);
    searchYouTubeMusic(DISCOVER_QUERIES[0])
      .then(results => setDiscoverTracks(results || []))
      .catch(() => setDiscoverTracks([]))
      .finally(() => setDiscoverLoading(false));
  }, [tab, discoverTracks.length, discoverLoading]);

  const appendDiscover = (incoming: Track[]) => {
    const ids = new Set(discoverTracks.map(t => t.id));
    const fresh = incoming.filter(t => !ids.has(t.id));
    if (fresh.length > 0) setDiscoverTracks([...discoverTracks, ...fresh]);
    return fresh.length;
  };

  const handleScroll = async (e: React.UIEvent<HTMLDivElement>) => {
    if (tab !== 'discover' || discoverLoading || discoverDone) return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 400) return;

    setDiscoverLoading(true);
    try {
      const more = await loadMoreSearchResults(DISCOVER_QUERIES[discoverQueryIdx]);
      if (appendDiscover(more) > 0) return;

      // Current source exhausted — rotate to the next discover feed.
      const nextIdx = discoverQueryIdx + 1;
      if (nextIdx >= DISCOVER_QUERIES.length) {
        setDiscoverDone(true);
        return;
      }
      setDiscoverQueryIdx(nextIdx);
      const fresh = await searchYouTubeMusic(DISCOVER_QUERIES[nextIdx]);
      if (appendDiscover(fresh) === 0) setDiscoverDone(true);
    } finally {
      setDiscoverLoading(false);
    }
  };

  const sortedTracks = useMemo(() => {
    return [...tracks].sort((a, b) =>
      sortAsc ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title)
    );
  }, [tracks, sortAsc]);

  const albums = useMemo(() => {
    const map = new Map<string, Track[]>();
    tracks.forEach(t => {
      const name = t.album || 'Singles';
      const list = map.get(name) || [];
      list.push(t);
      map.set(name, list);
    });
    return Array.from(map.entries());
  }, [tracks]);

  const artists = useMemo(() => {
    const map = new Map<string, { cover: string; count: number }>();
    allKnownTracks.forEach(t => {
      const name = t.artist || 'Unknown Artist';
      const info = map.get(name);
      if (info) info.count++;
      else map.set(name, { cover: t.coverUrl || '', count: 1 });
    });
    return Array.from(map.entries());
  }, [allKnownTracks]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addLocalTracks(e.target.files);
    }
  };

  // ---------- DETAIL SUBVIEWS ----------
  if (subView) {
    const back = () => setSubView(null);

    if (subView.kind === 'favorites') return <LikedMusicView onBack={back} />;
    if (subView.kind === 'downloads') return <DownloadsView onBack={back} />;

    if (subView.kind === 'recent') {
      const recentTracks = recentlyPlayed;
      return (
        <PlaylistDetailView
          title="Recently Played"
          subtitle="Your listening history"
          coverUrl={recentTracks[0]?.coverUrl}
          tracks={recentTracks}
          onBack={back}
        />
      );
    }

    if (subView.kind === 'playlist') {
      const pl = playlists.find(p => p.id === subView.id);
      if (!pl) return null;
      const plTracks = pl.trackIds
        .map(id => tracks.find(t => t.id === id) || trackStore[id])
        .filter((t): t is Track => Boolean(t));
      return (
        <PlaylistDetailView
          title={pl.name}
          subtitle={pl.description || 'Playlist'}
          coverUrl={plTracks[0]?.coverUrl}
          tracks={plTracks}
          onBack={back}
          playlistId={pl.id}
          onAddTrack={t => addTrackToPlaylist(pl.id, t)}
          onRemoveTrack={trackId => removeTrackFromPlaylist(pl.id, trackId)}
          onDownloadAll={() => downloadPlaylist(pl.name, plTracks)}
          onMoveTrack={(from, to) => reorderPlaylistTracks(pl.id, from, to)}
          onRename={() => {
            const name = prompt('Rename playlist', pl.name);
            if (name && name.trim()) renamePlaylist(pl.id, name.trim());
          }}
          onDelete={() => {
            if (confirm(`Delete playlist "${pl.name}"?`)) {
              deletePlaylist(pl.id);
              back();
            }
          }}
        />
      );
    }

    if (subView.kind === 'album') {
      const albumTracks = tracks.filter(t => (t.album || 'Singles') === subView.name);
      return (
        <PlaylistDetailView
          title={subView.name}
          subtitle={albumTracks[0]?.artist || 'Album'}
          coverUrl={albumTracks[0]?.coverUrl}
          tracks={albumTracks}
          onBack={back}
        />
      );
    }

    if (subView.kind === 'artist') {
      const artistTracks = allKnownTracks.filter(
        t => (t.artist || 'Unknown Artist') === subView.name
      );
      return (
        <ArtistDetailView
          artistName={subView.name}
          localTracks={artistTracks}
          onBack={back}
          onOpenAlbum={name => setSubView({ kind: 'album', name })}
        />
      );
    }
  }

  // ---------- MAIN LIBRARY ----------
  return (
    <div className="flex-1 flex flex-col overflow-y-auto pb-28 bg-transparent" onScroll={handleScroll}>
      <TrackOptionsMenuModal
        track={selectedTrackForMenu}
        onClose={() => setSelectedTrackForMenu(null)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.flac"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-5 safe-top pb-4">
        <h1 className="text-3xl font-bold text-app-primary">Library</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-3 rounded-full bg-app-card text-app-primary"
            title="Add Local Files"
          >
            <FolderPlus className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              const name = prompt('Enter new playlist title:');
              if (name && name.trim()) createPlaylist(name.trim());
            }}
            className="p-3 rounded-full bg-app-card text-app-primary"
            title="New Playlist"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 px-5 border-b border-app-theme">
        {(['songs', 'playlists', 'albums', 'artists', 'discover'] as LibTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-3 text-base capitalize transition-all ${
              tab === t
                ? 'text-app-primary font-semibold border-b-2 border-white'
                : 'text-app-secondary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Meta Row */}
      <div className="flex items-center justify-between px-5 py-3 text-app-secondary">
        <div className="flex items-center gap-3">
          <span className="text-sm">
            {tab === 'songs'
              ? `${tracks.length} items`
              : tab === 'playlists'
                ? `${playlists.length + 4} items`
                : tab === 'albums'
                  ? `${albums.length} items`
                  : `${artists.length} items`}
          </span>
          <button onClick={() => setSortAsc(v => !v)} title="Sort A-Z">
            <ArrowDownAZ className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setSubView({ kind: 'downloads' })} title="Downloads">
            <Download className="w-5 h-5" />
          </button>
          <button onClick={() => setActiveTab('search')} title="Search">
            <Search className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* SONGS TAB */}
      {tab === 'songs' && (
        <div className="px-3 space-y-1">
          {sortedTracks.map((t, idx) => {
            const isCurrent = currentTrack?.id === t.id;
            return (
              <button
                key={t.id}
                onClick={() => playQueue(sortedTracks, idx)}
                className={`w-full flex items-center gap-4 ${isCompact ? 'p-1.5' : 'p-2'} rounded-xl text-left transition-all`}
              >
                <img
                  src={t.coverUrl}
                  alt={t.title}
                  loading="lazy"
                  className={`${
                    isCompact ? 'w-10 h-10' : isLarge ? 'w-16 h-16' : 'w-14 h-14'
                  } rounded-lg object-cover shrink-0 transition-all`}
                />
                <div className="flex-1 min-w-0">
                  <p className={`${isCompact ? 'text-sm' : 'text-base'} font-semibold text-app-primary truncate`}>{t.title}</p>
                  <p className={`${isCompact ? 'text-xs' : 'text-sm'} text-app-secondary truncate mt-0.5`}>{t.artist}</p>
                </div>
                <span className={`${isCompact ? 'text-xs' : 'text-sm'} text-app-secondary shrink-0`}>
                  {formatDuration(t.duration)}
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
                  <svg viewBox="0 0 24 24" className={`${isCompact ? 'w-4 h-4' : 'w-5 h-5'} fill-current`}>
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </span>
                {isCurrent && isPlaying && (
                  <span className="eq"><span /><span /><span /></span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* PLAYLISTS TAB */}
      {tab === 'playlists' && (
        <div className="px-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-8">
            <button onClick={() => setSubView({ kind: 'recent' })} className="text-left">
              <div className="aspect-square rounded-2xl bg-app-card flex items-center justify-center">
                <History className="w-16 h-16 text-app-primary" />
              </div>
              <p className="text-base font-semibold text-app-primary mt-3">Recently Played</p>
            </button>

            <button onClick={() => setSubView({ kind: 'favorites' })} className="text-left">
              <div className="aspect-square rounded-2xl bg-app-card flex items-center justify-center">
                <Heart className="w-16 h-16 text-app-primary fill-white" />
              </div>
              <p className="text-base font-semibold text-app-primary mt-3">Favorites</p>
            </button>

            <button onClick={() => setSubView({ kind: 'downloads' })} className="text-left">
              <div className="aspect-square rounded-2xl bg-app-card flex items-center justify-center">
                <Plane className="w-16 h-16 text-app-primary" />
              </div>
              <p className="text-base font-semibold text-app-primary mt-3">Cached/Offline</p>
            </button>

            <button onClick={() => setSubView({ kind: 'downloads' })} className="text-left">
              <div className="aspect-square rounded-2xl bg-app-card flex items-center justify-center">
                <Download className="w-16 h-16 text-app-primary" />
              </div>
              <p className="text-base font-semibold text-app-primary mt-3">Downloads</p>
            </button>
          </div>

          {playlists.length > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-8 mt-10">
              {playlists.map(pl => {
                const first = tracks.find(t => pl.trackIds.includes(t.id));
                return (
                  <button
                    key={pl.id}
                    onClick={() => setSubView({ kind: 'playlist', id: pl.id })}
                    className="text-left"
                  >
                    <div className="aspect-square rounded-2xl bg-app-card overflow-hidden flex items-center justify-center">
                      {first?.coverUrl ? (
                        <img
                          src={first.coverUrl}
                          alt={pl.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Disc3 className="w-16 h-16 text-app-primary" />
                      )}
                    </div>
                    <p className="text-base font-semibold text-app-primary mt-3 truncate">{pl.name}</p>
                    <p className="text-sm text-app-secondary">{pl.trackIds.length} songs</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ALBUMS TAB */}
      {tab === 'albums' && (
        <div className="px-5 grid grid-cols-2 gap-x-6 gap-y-8">
          {albums.map(([name, albumTracks]) => (
            <button
              key={name}
              onClick={() => setSubView({ kind: 'album', name })}
              className="text-left"
            >
              <div className="aspect-square rounded-2xl bg-app-card overflow-hidden">
                <img
                  src={albumTracks[0]?.coverUrl}
                  alt={name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
              <p className="text-base font-semibold text-app-primary mt-3 truncate">{name}</p>
              <p className="text-sm text-app-secondary truncate">{albumTracks[0]?.artist}</p>
            </button>
          ))}
        </div>
      )}

      {/* ARTISTS TAB */}
      {tab === 'artists' && (
        <div className="px-5 grid grid-cols-2 gap-x-6 gap-y-8">
          {artists
            .filter(([name]) => !hiddenArtists.includes(name))
            .map(([name, info]) => (
              <div key={name} className="relative flex flex-col items-center text-center">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={e => {
                    e.stopPropagation();
                    hideArtist(name);
                  }}
                  className="absolute top-0 right-4 z-10 p-1.5 rounded-full bg-app-card border border-app-theme text-app-secondary hover:text-red-400"
                  title="Remove artist"
                >
                  <X className="w-4 h-4" />
                </span>
                <button
                  onClick={() => setSubView({ kind: 'artist', name })}
                  className="flex flex-col items-center text-center"
                >
                  <div className="w-32 h-32 rounded-full bg-app-card overflow-hidden">
                    {info.cover && (
                      <img src={info.cover} alt={name} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <p className="text-base font-semibold text-app-primary mt-3 truncate w-full">{name}</p>
                  <p className="text-sm text-app-secondary">{info.count} songs</p>
                </button>
              </div>
            ))}
          {artists.filter(([name]) => !hiddenArtists.includes(name)).length === 0 && (
            <p className="col-span-2 text-center text-app-secondary py-10">No artists yet</p>
          )}
        </div>
      )}

      {/* DISCOVER TAB: infinite scroll feed of new songs */}
      {tab === 'discover' && (
        <div className="px-3 space-y-1 stagger">
          {discoverLoading && discoverTracks.length === 0 && (
            <p className="text-center text-sm text-app-secondary py-10">Finding new songs...</p>
          )}
          {discoverTracks.map((t, idx) => (
            <button
              key={`${t.id}-${idx}`}
              onClick={() => playQueue(discoverTracks, idx)}
              className={`w-full flex items-center gap-4 ${isCompact ? 'p-1.5' : 'p-2'} rounded-xl text-left transition-all`}
            >
              <img
                src={t.coverUrl}
                alt={t.title}
                loading="lazy"
                className={`${
                  isCompact ? 'w-10 h-10' : isLarge ? 'w-16 h-16' : 'w-14 h-14'
                } rounded-lg object-cover shrink-0 transition-all`}
              />
              <div className="flex-1 min-w-0">
                <p className={`${isCompact ? 'text-sm' : 'text-base'} font-semibold text-app-primary truncate`}>{t.title}</p>
                <p className={`${isCompact ? 'text-xs' : 'text-sm'} text-app-secondary truncate mt-0.5`}>{t.artist}</p>
              </div>
              <span className={`${isCompact ? 'text-xs' : 'text-sm'} text-app-secondary shrink-0`}>
                {formatDuration(t.duration)}
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
                <svg viewBox="0 0 24 24" className={`${isCompact ? 'w-4 h-4' : 'w-5 h-5'} fill-current`}>
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </span>
            </button>
          ))}
          {discoverTracks.length > 0 && (
            <p className="text-center text-sm text-app-secondary py-6">
              {discoverLoading ? 'Loading more songs...' : discoverDone ? 'No more results' : 'Scroll for more'}
            </p>
          )}
        </div>
      )}

      {/* Downloads count hint */}
      <p className="px-5 pt-10 text-xs text-app-secondary">
        {downloads.length} songs saved offline • {favorites.length} favorites
      </p>
    </div>
  );
};
