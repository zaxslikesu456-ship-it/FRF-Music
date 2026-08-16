import React, { useEffect, useState } from 'react';
import {
  Home,
  Search,
  LibraryBig,
  Settings,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Volume2,
  VolumeX,
  ListPlus,
  ListMusic,
  MoreVertical,
  Mic,
  Loader2,
  Video,
  User,
  Tv,
} from 'lucide-react';
import { fetchLyrics } from '../utils/lyrics';
import { useAudio } from '../context/AudioContext';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import { ArtistDetailView } from './ArtistDetailView';
import { PlaylistDetailView } from './PlaylistDetailView';
import type { Track } from '../types/music';
import { HomeView } from './HomeView';
import { SearchView } from './SearchView';
import { LibraryView } from './LibraryView';
import { SettingsView } from './SettingsView';
import { NowPlayingScreen } from './NowPlayingScreen';
import type { NavTab } from '../types/music';

const formatTime = (secs: number) => {
  if (isNaN(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const DesktopNowPlaying: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    repeatMode,
    isShuffle,
    favorites,
    queue,
    playTrack,
    togglePlay,
    nextTrack,
    previousTrack,
    seekTo,
    setVolume,
    toggleRepeatMode,
    toggleShuffle,
    toggleFavorite,
    openArtistProfile,
    isResolvingStream,
  } = useAudio();

  const [dragTime, setDragTime] = useState<number | null>(null);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  useEffect(() => {
    if (!showLyrics || !currentTrack) return;
    let mounted = true;
    setLyricsLoading(true);
    setLyrics(null);
    fetchLyrics(currentTrack.title, currentTrack.artist).then(text => {
      if (mounted) {
        setLyrics(text);
        setLyricsLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [showLyrics, currentTrack]);

  if (!currentTrack) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="w-40 h-40 rounded-2xl bg-app-surface flex items-center justify-center">
          <Play className="w-10 h-10 text-app-secondary" />
        </div>
        <p className="text-app-secondary mt-6 text-sm">Nothing playing yet</p>
        <p className="text-app-secondary mt-1 text-xs">Pick a song and it will show up here</p>
      </div>
    );
  }

  const isFav = favorites.includes(currentTrack.id);
  const shownTime = dragTime ?? currentTime;
  const hasYtVideo = Boolean(currentTrack.youtubeId || currentTrack.isYouTube);

  const commitSeek = () => {
    if (dragTime !== null) {
      seekTo(dragTime);
      setDragTime(null);
    }
  };

  return (
    <div className="flex flex-col h-full p-6">
      <AddToPlaylistModal
        track={showAddToPlaylist ? currentTrack : null}
        onClose={() => setShowAddToPlaylist(false)}
      />
      <TrackOptionsMenuModal
        track={showOptions ? currentTrack : null}
        onClose={() => setShowOptions(false)}
      />

      {/* Media Display: YouTube Video Player or Spinning Vinyl */}
      {showVideo && hasYtVideo && currentTrack.youtubeId ? (
        <div className="relative w-full max-w-[260px] mx-auto aspect-video rounded-xl overflow-hidden shadow-2xl bg-black border border-app-theme">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${currentTrack.youtubeId}?autoplay=1&controls=1&enablejsapi=1&origin=${window.location.origin}`}
            title={currentTrack.title}
            className="w-full h-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="relative w-full max-w-[260px] mx-auto aspect-square">
          <img
            src={currentTrack.coverUrl}
            alt={currentTrack.title}
            className={`w-full h-full object-cover rounded-full shadow-2xl border-4 border-app-card ${
              isPlaying ? 'animate-[spin_12s_linear_infinite]' : ''
            }`}
          />
          <div className="absolute inset-0 m-auto w-9 h-9 rounded-full bg-app-primary border-2 border-app-card" />
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-app-primary truncate">{currentTrack.title}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <button
              onClick={() => openArtistProfile(currentTrack.artist)}
              className="text-sm text-app-secondary truncate hover:text-app-primary hover:underline cursor-pointer flex items-center gap-1.5"
              title="View full artist profile & liked songs"
            >
              <User className="w-3.5 h-3.5 shrink-0 text-app-highlight" />
              <span>{currentTrack.artist}</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasYtVideo && (
            <button
              onClick={() => setShowVideo(v => !v)}
              className={`p-2 ${showVideo ? 'text-app-highlight' : 'text-app-secondary hover:text-app-primary'}`}
              title={showVideo ? 'Switch to Vinyl' : 'Watch YouTube Video'}
            >
              <Video className="w-5 h-5" />
            </button>
          )}
          <button onClick={() => toggleFavorite(currentTrack.id)} className="p-2" title="Like">
            <Heart className={`w-5 h-5 ${isFav ? 'text-app-primary fill-white' : 'text-app-secondary'}`} />
          </button>
          <button
            onClick={() => setShowAddToPlaylist(true)}
            className="p-2 text-app-secondary hover:text-app-primary"
            title="Add to playlist"
          >
            <ListPlus className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowLyrics(v => !v)}
            className={`p-2 ${showLyrics ? 'text-app-primary' : 'text-app-secondary hover:text-app-primary'}`}
            title="Lyrics"
          >
            <Mic className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowOptions(true)}
            className="p-2 text-app-secondary hover:text-app-primary"
            title="More options"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="pt-4">
        <input
          type="range"
          min={0}
          max={Math.max(duration || 0, 1)}
          step={1}
          value={Math.min(shownTime, duration || 0)}
          onChange={e => setDragTime(parseFloat(e.target.value))}
          onPointerUp={commitSeek}
          onMouseUp={commitSeek}
          className="w-full h-1 accent-white cursor-pointer"
        />
        <div className="flex justify-between text-xs text-app-secondary mt-1">
          <span>{formatTime(shownTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex items-center justify-center gap-5 pt-3">
        <button
          onClick={toggleShuffle}
          className={isShuffle ? 'text-app-primary' : 'text-app-secondary'}
          title="Shuffle"
        >
          <Shuffle className="w-4 h-4" />
        </button>
        <button onClick={previousTrack} className="text-app-primary" title="Previous">
          <SkipBack className="w-6 h-6 fill-current" />
        </button>
        <button
          onClick={togglePlay}
          className="w-11 h-11 rounded-full bg-app-highlight text-app-inverse flex items-center justify-center hover:scale-105 transition-transform"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isResolvingStream && !isPlaying ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current ml-0.5" />
          )}
        </button>
        <button onClick={nextTrack} className="text-app-primary" title="Next">
          <SkipForward className="w-6 h-6 fill-current" />
        </button>
        <button
          onClick={toggleRepeatMode}
          className={repeatMode !== 'off' ? 'text-app-primary' : 'text-app-secondary'}
          title={`Repeat: ${repeatMode}`}
        >
          {repeatMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex items-center gap-3 pt-5">
        <button
          onClick={() => setVolume(volume === 0 ? 0.8 : 0)}
          className="text-app-secondary"
          title="Mute"
        >
          {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={e => setVolume(parseFloat(e.target.value))}
          className="w-full h-1 accent-white cursor-pointer"
        />
      </div>

      {showLyrics && (
        <div className="pt-5 min-h-0 flex-1 overflow-y-auto no-scrollbar">
          <p className="text-xs text-app-secondary pb-2">LYRICS</p>
          {lyricsLoading ? (
            <p className="text-sm text-app-secondary py-4">Loading lyrics...</p>
          ) : lyrics ? (
            <p className="text-sm text-app-primary whitespace-pre-wrap leading-relaxed">{lyrics}</p>
          ) : (
            <p className="text-sm text-app-secondary py-4">No lyrics found for this song</p>
          )}
        </div>
      )}

      {!showLyrics && (
        <div className="pt-5 min-h-0 flex-1 flex flex-col overflow-y-auto no-scrollbar">
          {/* YouTube Video Player in UpNext Bottom Section */}
          {hasYtVideo && currentTrack.youtubeId && !showVideo && (
            <div className="mb-4 p-3 rounded-xl bg-app-surface border border-app-theme flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center shrink-0">
                  <Tv className="w-5 h-5 text-app-highlight" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-app-primary truncate">YouTube Music Video</p>
                  <p className="text-[11px] text-app-secondary truncate">Play video player at the top</p>
                </div>
              </div>
              <button
                onClick={() => setShowVideo(true)}
                className="px-3 py-1.5 rounded-lg bg-app-highlight text-app-inverse text-xs font-bold shrink-0 hover:scale-105 transition-transform cursor-pointer"
              >
                Watch
              </button>
            </div>
          )}

          {/* Up Next List */}
          {queue.length > 0 && (
            <div className="flex-1 min-h-0">
              <p className="text-xs text-app-secondary pb-2">UP NEXT • {queue.length}</p>
              {queue.map((t, idx) => {
                const isCurrent = t.id === currentTrack.id;
                return (
                  <button
                    key={`${t.id}-${idx}`}
                    onClick={() => playTrack(t)}
                    className={`w-full text-left flex items-center gap-3 py-1.5 px-2 rounded-lg transition-all cursor-pointer hover:bg-app-surface/80 active:scale-98 ${
                      isCurrent ? 'bg-app-surface border border-app-theme' : ''
                    }`}
                  >
                    <img src={t.coverUrl} alt={t.title} className="w-9 h-9 rounded object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm truncate ${isCurrent ? 'text-app-primary font-bold' : 'text-app-secondary hover:text-app-primary'}`}>
                        {t.title}
                      </p>
                      <p className="text-xs text-app-secondary truncate">{t.artist}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

import { AnimatedBackground } from './AnimatedBackground';

export const DesktopFrame: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    downloadStatus,
    settings,
    artistProfileName,
    closeArtistProfile,
    playlists,
    tracks,
    trackStore,
    favorites,
    favoriteTracks,
    reorderPlaylistTracks,
    renamePlaylist,
    deletePlaylist,
    downloadPlaylist,
  } = useAudio();

  const [sidebarPlaylistId, setSidebarPlaylistId] = useState<string | null>(null);

  const sidebarPlaylist = playlists.find(p => p.id === sidebarPlaylistId) || null;
  const sidebarPlaylistTracks = sidebarPlaylist
    ? sidebarPlaylist.trackIds
        .map(id => tracks.find(t => t.id === id) || trackStore[id])
        .filter((t): t is Track => Boolean(t))
    : [];
  const favoriteSidebarTracks = favoriteTracks.length
    ? favoriteTracks
    : tracks.filter(t => favorites.includes(t.id));

  const navItems: { id: NavTab; label: string; icon: React.ElementType }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'library', label: 'Library', icon: LibraryBig },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="w-full h-screen flex bg-app-primary text-app-primary overflow-hidden select-none relative">
      <AnimatedBackground type={settings.backgroundAnimation || 'off'} />
      {settings.backgroundImage && (
        <img
          src={settings.backgroundImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
      )}
      {/* Left Navigation */}
      <aside className="w-56 shrink-0 bg-app-surface border-r border-app-theme flex flex-col p-3">
        <h1 className="text-2xl font-black px-3 py-5">Aura Music</h1>
        <div className="space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-4 px-3 py-2.5 rounded-lg text-base font-semibold transition-colors ${
                  isActive ? 'bg-app-card text-app-primary' : 'text-app-secondary hover:text-app-primary'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Your Playlists */}
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto no-scrollbar">
          <p className="px-3 pb-2 text-xs font-semibold text-app-secondary">YOUR PLAYLISTS</p>
          <div className="space-y-1">
            <button
              onClick={() => setSidebarPlaylistId('favorites')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                sidebarPlaylistId === 'favorites'
                  ? 'bg-app-card text-app-primary'
                  : 'text-app-secondary hover:text-app-primary'
              }`}
            >
              <Heart className="w-4 h-4 shrink-0" />
              <span className="truncate font-semibold">Favorites</span>
            </button>
            {playlists.map(pl => (
              <button
                key={pl.id}
                onClick={() => setSidebarPlaylistId(pl.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  sidebarPlaylistId === pl.id
                    ? 'bg-app-card text-app-primary'
                    : 'text-app-secondary hover:text-app-primary'
                }`}
              >
                <ListMusic className="w-4 h-4 shrink-0" />
                <span className="truncate font-semibold">{pl.name}</span>
                <span className="ml-auto text-xs text-app-secondary">{pl.trackIds.length}</span>
              </button>
            ))}
            {playlists.length === 0 && (
              <p className="px-3 text-xs text-app-secondary">
                Create playlists from any song's ⋮ menu
              </p>
            )}
          </div>
        </div>
        <p className="px-3 pt-3 text-[11px] text-app-secondary">
          Streams via YouTube Music & Invidious
        </p>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
        {activeTab === 'home' && <HomeView />}
        {activeTab === 'search' && <SearchView />}
        {activeTab === 'library' && <LibraryView />}
        {activeTab === 'settings' && <SettingsView />}

        {downloadStatus && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary text-xs font-mono font-bold shadow-2xl max-w-[80%] text-center">
            {downloadStatus}
          </div>
        )}
      </main>

      {/* Right Now Playing Panel */}
      <aside className="w-80 shrink-0 bg-app-surface border-l border-app-theme overflow-hidden">
        <DesktopNowPlaying />
      </aside>

      {/* Playlist Overlay (from sidebar) */}
      {sidebarPlaylistId && (
        <div className="fixed inset-0 z-40 bg-app-primary flex flex-col anim-fade">
          {sidebarPlaylistId === 'favorites' ? (
            <PlaylistDetailView
              title="Favorites"
              subtitle={`${favoriteSidebarTracks.length} liked songs`}
              coverUrl={favoriteSidebarTracks[0]?.coverUrl}
              tracks={favoriteSidebarTracks}
              onBack={() => setSidebarPlaylistId(null)}
              onDownloadAll={() => downloadPlaylist('Favorites', favoriteSidebarTracks)}
            />
          ) : sidebarPlaylist ? (
            <PlaylistDetailView
              title={sidebarPlaylist.name}
              subtitle={sidebarPlaylist.description || 'Playlist'}
              coverUrl={sidebarPlaylistTracks[0]?.coverUrl}
              tracks={sidebarPlaylistTracks}
              onBack={() => setSidebarPlaylistId(null)}
              onDownloadAll={() => downloadPlaylist(sidebarPlaylist.name, sidebarPlaylistTracks)}
              onMoveTrack={(from, to) => reorderPlaylistTracks(sidebarPlaylist.id, from, to)}
              onRename={() => {
                const name = prompt('Rename playlist', sidebarPlaylist.name);
                if (name && name.trim()) renamePlaylist(sidebarPlaylist.id, name.trim());
              }}
              onDelete={() => {
                if (confirm(`Delete playlist "${sidebarPlaylist.name}"?`)) {
                  deletePlaylist(sidebarPlaylist.id);
                  setSidebarPlaylistId(null);
                }
              }}
            />
          ) : null}
        </div>
      )}

      {/* Artist Profile Overlay */}
      {artistProfileName && (
        <div className="fixed inset-0 z-40 bg-app-primary flex flex-col anim-fade">
          <ArtistDetailView
            artistName={artistProfileName}
            localTracks={[]}
            onBack={closeArtistProfile}
          />
        </div>
      )}

      {/* Expanded player still available on desktop */}
      <NowPlayingScreen />
    </div>
  );
};
