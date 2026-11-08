import React, { useState } from 'react';
import { t as tr } from '../i18n';
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
  PictureInPicture2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
} from 'lucide-react';
import { usePcLayout, ResizeHandle, SIDEBAR, PLAYER } from './PcLayout';
import { MiniPlayer } from './MiniPlayer';
import { PcExtrasBridge } from './PcExtrasBridge';
import { invokeTauri } from '../utils/miniPlayer';
import { LyricsPanel } from './LyricsPanel';
import { CastButton, CastingLabel } from './CastButton';
import { usePlaylistMenu } from './PlaylistMenu';
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
import { EqualizerModal } from './EqualizerModal';
import type { NavTab } from '../types/music';

const formatTime = (secs: number) => {
  if (isNaN(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const DesktopNowPlaying: React.FC = () => {
  const {
    settings,
    artColors,
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

  if (!currentTrack) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="w-40 h-40 rounded-2xl bg-app-surface flex items-center justify-center">
          <Play className="w-10 h-10 text-app-secondary" />
        </div>
        <p className="text-app-secondary mt-6 text-sm">{tr("Nothing playing yet")}</p>
        <p className="text-app-secondary mt-1 text-xs">{tr("Pick a song and it will show up here")}</p>
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
    <div
      className="flex flex-col h-full p-6 transition-[background] duration-700"
      style={
        settings.albumArtColors !== false && artColors
          ? { background: `linear-gradient(to bottom, ${artColors.dark} 0%, transparent 70%)` }
          : undefined
      }
    >
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
        <div className="relative w-full max-w-[260px] mx-auto aspect-square rounded-full shadow-2xl border-4 border-app-card overflow-hidden">
          {/* The shadow and border stay still on the frame; only the picture turns,
              on its own layer. Rotating them all redrew the shadow every frame and
              kept a third of a CPU core busy for as long as a song played. The turn
              itself is a plain smooth rotation on the graphics card (stepping it
              made it look choppy). */}
          <img
            src={currentTrack.coverUrl}
            alt={currentTrack.title}
            className={`w-full h-full object-cover rounded-full will-change-transform backface-hidden pause-when-hidden ${
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
              title={tr("View full artist profile & liked songs")}
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
          <button onClick={() => toggleFavorite(currentTrack.id, currentTrack)} className="p-2" title={tr("Like")}>
            <Heart className={`w-5 h-5 ${isFav ? 'text-app-accent fill-current' : 'text-app-secondary'}`} />
          </button>
          <button
            onClick={() => setShowAddToPlaylist(true)}
            className="p-2 text-app-secondary hover:text-app-primary"
            title={tr("Add to playlist")}
          >
            <ListPlus className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowLyrics(v => !v)}
            className={`p-2 ${showLyrics ? 'text-app-primary' : 'text-app-secondary hover:text-app-primary'}`}
            title={tr("Lyrics")}
          >
            <Mic className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowOptions(true)}
            className="p-2 text-app-secondary hover:text-app-primary"
            title={tr("More options")}
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
          className="w-full h-1 accent-[var(--bg-highlight)] cursor-pointer"
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
          title={tr("Shuffle")}
        >
          <Shuffle className="w-4 h-4" />
        </button>
        <button onClick={previousTrack} className="text-app-primary" title={tr("Previous")}>
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
        <button onClick={nextTrack} className="text-app-primary" title={tr("Next")}>
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
          title={tr("Mute")}
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
          className="w-full h-1 accent-[var(--bg-highlight)] cursor-pointer"
        />
        <button
          onClick={() => invokeTauri('toggle_mini_player')}
          className="text-app-secondary hover:text-app-primary shrink-0"
          title={tr("Mini player (always on top)")}
        >
          <PictureInPicture2 className="w-4 h-4" />
        </button>
        <CastButton className="text-app-secondary hover:text-app-primary shrink-0" iconClassName="w-4 h-4" />
      </div>
      <CastingLabel className="pt-3" />

      {/* Same lyrics view as the phone: synced, Follow, timing nudge, Copy, Share */}
      {showLyrics && <LyricsPanel className="mt-3 min-h-0 flex-1" />}

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
                  <p className="text-xs font-bold text-app-primary truncate">{tr("YouTube Music Video")}</p>
                  <p className="text-[11px] text-app-secondary truncate">{tr("Play video player at the top")}</p>
                </div>
              </div>
              <button
                onClick={() => setShowVideo(true)}
                className="px-3 py-1.5 rounded-lg bg-app-highlight text-app-inverse text-xs font-bold shrink-0 hover:scale-105 transition-transform cursor-pointer"
              >
                {tr("Watch")}
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
                      <p className={`text-sm truncate ${isCurrent ? 'text-app-accent font-bold' : 'text-app-secondary hover:text-app-primary'}`}>
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
    removeTrackFromPlaylist,
    addTrackToPlaylist,
    isEqualizerOpen,
    setIsEqualizerOpen,
  } = useAudio();
  const { layout, update } = usePcLayout();

  const [sidebarPlaylistId, setSidebarPlaylistId] = useState<string | null>(null);
  const playlistMenu = usePlaylistMenu();

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
    { id: 'home', label: tr("Home"), icon: Home },
    { id: 'search', label: tr("Search"), icon: Search },
    { id: 'library', label: tr("Library"), icon: LibraryBig },
    { id: 'settings', label: tr("Settings"), icon: Settings },
  ];

  return (
    <div className="w-full h-screen flex bg-app-primary text-app-primary overflow-hidden select-none relative isolate">
      <PcExtrasBridge />
      <AnimatedBackground type={settings.backgroundAnimation || 'off'} />
      {settings.backgroundImage && (
        <img
          src={settings.backgroundImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover pointer-events-none -z-10"
        />
      )}
      {/* Left sidebar: drag its edge to resize, or hide it to a slim strip */}
      {layout.sidebarOpen ? (
      <aside
        className="relative shrink-0 bg-app-surface border-r border-app-theme flex flex-col p-3"
        style={{ width: layout.sidebarWidth }}
      >
        <div className="flex items-center justify-between gap-2 pl-3 pr-1 py-5">
          <h1 className="text-2xl font-black truncate">{tr("Aura Music")}</h1>
          <button
            onClick={() => update({ sidebarOpen: false })}
            className="p-1.5 rounded-lg text-app-secondary hover:text-app-primary hover:bg-app-card shrink-0"
            title={tr('Hide the sidebar')}
            aria-label={tr('Hide the sidebar')}
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-4 px-3 py-2.5 rounded-lg text-base font-semibold transition-colors ${
                  isActive ? 'bg-app-card text-app-accent' : 'text-app-secondary hover:text-app-primary'
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
          <p className="px-3 pb-2 text-xs font-semibold text-app-secondary">{tr("YOUR PLAYLISTS")}</p>
          {playlistMenu.element}
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
              <span className="truncate font-semibold">{tr("Favorites")}</span>
            </button>
            {playlists.map(pl => (
              <button
                key={pl.id}
                onClick={() => setSidebarPlaylistId(pl.id)}
                onContextMenu={e => playlistMenu.open(e, pl, () => setSidebarPlaylistId(pl.id))}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  sidebarPlaylistId === pl.id
                    ? 'bg-app-card text-app-primary'
                    : 'text-app-secondary hover:text-app-primary'
                }`}
              >
                {pl.coverUrl ? (
                  <img src={pl.coverUrl} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
                ) : (
                  <ListMusic className="w-4 h-4 shrink-0" />
                )}
                <span className="truncate font-semibold">{pl.name}</span>
                <span className="ml-auto text-xs text-app-secondary">{pl.trackIds.length}</span>
              </button>
            ))}
            {playlists.length === 0 && (
              <p className="px-3 text-xs text-app-secondary">
                {tr("Create playlists from any song's ⋮ menu")}
              </p>
            )}
          </div>
        </div>
        <p className="px-3 pt-3 text-[11px] text-app-secondary">
          {tr("Streams via YouTube Music & Invidious")}
        </p>
        <ResizeHandle
          edge="right"
          width={layout.sidebarWidth}
          limits={SIDEBAR}
          onResize={w => update({ sidebarWidth: w })}
          onCollapse={() => update({ sidebarOpen: false })}
          label={tr('Drag to resize the sidebar')}
        />
      </aside>
      ) : (
        /* Sidebar hidden: a slim strip with the tabs, to bring it back */
        <aside className="w-14 shrink-0 bg-app-surface border-r border-app-theme flex flex-col items-center gap-1 py-3">
          <button
            onClick={() => update({ sidebarOpen: true })}
            className="p-2.5 mb-2 rounded-lg text-app-secondary hover:text-app-primary hover:bg-app-card"
            title={tr('Show the sidebar')}
            aria-label={tr('Show the sidebar')}
          >
            <PanelLeftOpen className="w-5 h-5" />
          </button>
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`p-2.5 rounded-lg transition-colors ${
                  isActive ? 'bg-app-card text-app-accent' : 'text-app-secondary hover:text-app-primary'
                }`}
                title={item.label}
                aria-label={item.label}
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </aside>
      )}

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          {activeTab === 'home' && <HomeView />}
          {activeTab === 'search' && <SearchView />}
          {activeTab === 'library' && <LibraryView />}
          {activeTab === 'settings' && <SettingsView />}

          {downloadStatus && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary text-xs font-mono font-bold shadow-2xl max-w-[80%] text-center">
              {downloadStatus}
            </div>
          )}
        </div>
        {/* Player panel hidden: the phone-style bar at the bottom instead */}
        {!layout.playerOpen && <MiniPlayer onShowPanel={() => update({ playerOpen: true })} />}
      </main>

      {/* Right player panel: drag its edge to resize, or hide it (the bottom bar takes over) */}
      {layout.playerOpen && (
        <aside
          className="relative shrink-0 bg-app-surface border-l border-app-theme overflow-hidden"
          style={{ width: layout.playerWidth }}
        >
          <ResizeHandle
            edge="left"
            width={layout.playerWidth}
            limits={PLAYER}
            onResize={w => update({ playerWidth: w })}
            onCollapse={() => update({ playerOpen: false })}
            label={tr('Drag to resize the player')}
          />
          <button
            onClick={() => update({ playerOpen: false })}
            className="absolute top-2 right-2 z-20 p-1.5 rounded-lg text-app-secondary hover:text-app-primary hover:bg-app-card"
            title={tr('Hide the player panel')}
            aria-label={tr('Hide the player panel')}
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
          <DesktopNowPlaying />
        </aside>
      )}

      {/* Playlist Overlay (from sidebar) */}
      {sidebarPlaylistId && (
        <div className="fixed inset-0 z-40 bg-app-primary flex flex-col anim-fade">
          {sidebarPlaylistId === 'favorites' ? (
            <PlaylistDetailView
              title={tr("Favorites")}
              subtitle={`${favoriteSidebarTracks.length} liked songs`}
              coverUrl={favoriteSidebarTracks[0]?.coverUrl}
              tracks={favoriteSidebarTracks}
              onBack={() => setSidebarPlaylistId(null)}
              onDownloadAll={() => downloadPlaylist('Favorites', favoriteSidebarTracks, 'favorites')}
              onRemoveTrack={trackId => removeTrackFromPlaylist('favorites', trackId)}
            />
          ) : sidebarPlaylist ? (
            <PlaylistDetailView
              title={sidebarPlaylist.name}
              subtitle={sidebarPlaylist.description || 'Playlist'}
              coverUrl={sidebarPlaylist.coverUrl || sidebarPlaylistTracks[0]?.coverUrl}
              tracks={sidebarPlaylistTracks}
              onBack={() => setSidebarPlaylistId(null)}
              onDownloadAll={() => downloadPlaylist(sidebarPlaylist.name, sidebarPlaylistTracks, sidebarPlaylist.id)}
              onRemoveTrack={trackId => removeTrackFromPlaylist(sidebarPlaylist.id, trackId)}
              onAddTrack={t => addTrackToPlaylist(sidebarPlaylist.id, t)}
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

      {/* Studio Equalizer & Sound FX Modal */}
      <EqualizerModal
        isOpen={isEqualizerOpen}
        onClose={() => setIsEqualizerOpen(false)}
      />
    </div>
  );
};
