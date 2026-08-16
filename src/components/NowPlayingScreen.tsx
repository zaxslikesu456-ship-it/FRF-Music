import React, { useEffect, useRef, useState, useMemo } from 'react';
import { fetchLyrics } from '../utils/lyrics';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Shuffle,
  Heart,
  List,
  ListPlus,
  MoreVertical,
  Mic,
  ArrowUp,
  ArrowDown,
  Loader2,
  X,
  Sliders,
} from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';

interface SyncedLine {
  time: number;
  text: string;
}

const parseLrc = (lrcString: string): SyncedLine[] => {
  if (!lrcString) return [];
  const lines = lrcString.split('\n');
  const result: SyncedLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const msStr = match[3] || '0';
      const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10);
      const time = min * 60 + sec + ms / 1000;
      const text = line.replace(timeRegex, '').trim();
      if (text) {
        result.push({ time, text });
      }
    }
  }
  return result.sort((a, b) => a.time - b.time);
};

export const NowPlayingScreen: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    repeatMode,
    isShuffle,
    isPlayerOpen,
    favorites,
    tracks,
    togglePlay,
    nextTrack,
    previousTrack,
    seekTo,
    toggleRepeatMode,
    toggleShuffle,
    setIsPlayerOpen,
    toggleFavorite,
    queue,
    playQueue,
    playTrack,
    stopTrack,
    openArtistProfile,
    reorderQueue,
    isResolvingStream,
    setIsEqualizerOpen,
  } = useAudio();

  const [showQueueOverlay, setShowQueueOverlay] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [rawLyrics, setRawLyrics] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);

  const activeLyricRef = useRef<HTMLParagraphElement | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const youtubeSurfaceRef = useRef<HTMLDivElement | null>(null);
  const touchX = useRef<number | null>(null);

  // YouTube requires an embedded player viewport of at least 200x200. Keep the
  // shared IFrame mounted under document.body (moving an iframe reloads it),
  // and align it over the artwork slot while a YouTube track is open.
  useEffect(() => {
    if (!isPlayerOpen || !currentTrack?.isYouTube || !youtubeSurfaceRef.current) return;

    const surface = youtubeSurfaceRef.current;
    const alignPlayer = () => {
      const player = document.getElementById('yt-hidden-player');
      if (!player) return;
      const rect = surface.getBoundingClientRect();
      player.removeAttribute('aria-hidden');
      player.style.cssText =
        `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;` +
        'min-width:200px;min-height:200px;opacity:1;pointer-events:auto;z-index:45;border:0;display:block;';
      player.setAttribute('title', `${currentTrack.title} on YouTube`);
    };

    alignPlayer();
    const observer = new MutationObserver(alignPlayer);
    observer.observe(document.body, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(alignPlayer);
    resizeObserver.observe(surface);
    window.addEventListener('resize', alignPlayer);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', alignPlayer);
      const player = document.getElementById('yt-hidden-player');
      if (!player) return;
      player.setAttribute('aria-hidden', 'true');
      player.style.cssText =
        'position:fixed;left:-10000px;top:0;width:200px;height:200px;opacity:0;pointer-events:none;z-index:-1;border:0;';
    };
  }, [currentTrack?.id, currentTrack?.isYouTube, currentTrack?.title, isPlayerOpen]);

  // Fetch lyrics when track changes or user opens lyrics view
  useEffect(() => {
    if (!showLyrics || !currentTrack) return;
    let mounted = true;
    setLyricsLoading(true);
    setRawLyrics(null);
    fetchLyrics(currentTrack.title, currentTrack.artist).then(text => {
      if (mounted) {
        setRawLyrics(text);
        setLyricsLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [showLyrics, currentTrack]);

  // Parse timed LRC synced lines
  const syncedLyrics = useMemo(() => {
    if (!rawLyrics) return [];
    return parseLrc(rawLyrics);
  }, [rawLyrics]);

  // Determine currently active lyric line index based on playback currentTime
  const activeLyricIndex = useMemo(() => {
    if (syncedLyrics.length === 0) return -1;
    let index = -1;
    for (let i = 0; i < syncedLyrics.length; i++) {
      if (currentTime >= syncedLyrics[i].time) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }, [syncedLyrics, currentTime]);

  // Auto-scroll active lyric line to center smoothly
  useEffect(() => {
    if (showLyrics && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeLyricIndex, showLyrics]);

  if (!isPlayerOpen || !currentTrack) return null;

  const isFav = favorites.includes(currentTrack.id);
  const upNextTracks = queue.length > 0 ? queue : tracks;
  const shownTime = dragTime ?? currentTime;

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const commitSeek = () => {
    if (dragTime !== null) {
      seekTo(dragTime);
      setDragTime(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-app-primary max-w-xl mx-auto flex flex-col select-none overflow-hidden">
      <AddToPlaylistModal
        track={showAddToPlaylist ? currentTrack : null}
        onClose={() => setShowAddToPlaylist(false)}
      />
      <TrackOptionsMenuModal
        track={showOptions ? currentTrack : null}
        onClose={() => setShowOptions(false)}
      />

      {/* Blurred background image matching theme */}
      <div className="absolute inset-0 overflow-hidden">
        <img
          src={currentTrack.coverUrl}
          alt=""
          className="w-full h-full object-cover blur-3xl scale-125 opacity-25"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/40 to-black" />
      </div>

      <div
        className="relative flex flex-col flex-1 overflow-hidden px-6 pb-6"
        onTouchStart={e => {
          touchX.current = e.touches[0].clientX;
        }}
        onTouchEnd={e => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (dx < -60 && !currentTrack.isYouTube) setShowLyrics(true);
          if (dx > 60) setShowLyrics(false);
        }}
      >
        {/* Top Navigation Header */}
        <div className="flex items-center justify-between safe-area-player-top pb-4 px-1">
          <button
            onClick={() => {
              if (currentTrack.isYouTube && isPlaying) togglePlay();
              setIsPlayerOpen(false);
            }}
            className="p-2 text-app-primary hover:scale-110 active:scale-95 transition-transform"
            title="Minimize"
          >
            <ChevronDown className="w-7 h-7" />
          </button>

          <div className="text-center min-w-0 px-2">
            <p className="text-xs text-app-secondary truncate font-medium">Playing from queue</p>
          </div>

          <div className="flex items-center gap-1">
            {/* Equalizer & Sound FX */}
            <button
              onClick={() => setIsEqualizerOpen(true)}
              className="p-2 text-app-secondary hover:text-app-primary hover:scale-105 active:scale-95 transition-all"
              title="Equalizer & Sound FX"
            >
              <Sliders className="w-5 h-5" />
            </button>

            {/* 3 Lines Icon (Toggles Overlay Queue Sheet) */}
            <button
              onClick={() => setShowQueueOverlay(v => !v)}
              className={`p-2 transition-colors ${
                showQueueOverlay ? 'text-app-primary font-bold scale-110' : 'text-app-secondary hover:text-app-primary'
              }`}
              title="3 Lines - Up Next Queue"
            >
              <List className="w-6 h-6" />
            </button>

            {/* 3 Dots Icon (Opens Track Options Modal matching user screenshot) */}
            <button
              onClick={() => setShowOptions(true)}
              className="p-2 text-app-secondary hover:text-app-primary transition-colors"
              title="Track Options"
            >
              <MoreVertical className="w-6 h-6" />
            </button>

            {/* Stop & Dismiss Song */}
            <button
              onClick={stopTrack}
              className="p-2 text-app-secondary hover:text-red-400 transition-colors"
              title="Stop & Close Song"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Main Center Section: Artwork or Synchronized Animated Lyrics */}
        {showLyrics && !currentTrack.isYouTube ? (
          <div
            ref={lyricsContainerRef}
            className="flex-1 min-h-0 overflow-y-auto w-full py-6 no-scrollbar space-y-5 px-2"
          >
            <p className="text-center text-xs text-app-secondary pb-2 tracking-wide uppercase">
              Synced Lyrics • Tap line to jump
            </p>

            {lyricsLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-app-primary" />
                <p className="text-app-secondary text-sm">Fetching lyrics...</p>
              </div>
            ) : syncedLyrics.length > 0 ? (
              <>
                <p className="text-center text-xs text-app-secondary pb-2 tracking-wide uppercase">
                  Synced Lyrics • Tap line to jump
                </p>
                {syncedLyrics.map((line, idx) => {
                  const isActive = idx === activeLyricIndex;
                  return (
                    <p
                      key={`lyric-${idx}`}
                      ref={isActive ? activeLyricRef : null}
                      onClick={() => seekTo(line.time)}
                      className={`text-center transition-all duration-300 cursor-pointer select-none leading-relaxed ${
                        isActive
                          ? 'text-app-primary font-extrabold text-xl md:text-2xl scale-105 drop-shadow-[0_0_12px_rgba(255,255,255,0.4)]'
                          : 'text-app-secondary text-base opacity-40 hover:opacity-80 hover:scale-100'
                      }`}
                    >
                      {line.text}
                    </p>
                  );
                })}
              </>
            ) : rawLyrics ? (
              <div className="space-y-3 py-2 px-2">
                <p className="text-center text-xs text-app-secondary pb-2 tracking-wide uppercase">
                  Lyrics
                </p>
                {rawLyrics.split('\n').map((line, idx) => (
                  <p
                    key={`plain-lyric-${idx}`}
                    className="text-center text-base font-semibold text-app-primary leading-relaxed"
                  >
                    {line}
                  </p>
                ))}
              </div>
            ) : (
              <div className="text-center text-app-secondary text-sm py-16">
                No lyrics found for this song
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-4 min-h-0">
            {currentTrack.isYouTube ? (
              <>
                <div
                  ref={youtubeSurfaceRef}
                  className="w-full max-w-[320px] aspect-square min-w-[200px] min-h-[200px] overflow-hidden rounded-2xl shadow-2xl bg-black"
                  aria-label={`${currentTrack.title} YouTube player`}
                />
                <p className="text-xs text-app-secondary text-center mt-2">
                  Keep this screen open during YouTube playback.
                </p>
              </>
            ) : (
              <img
                src={currentTrack.coverUrl}
                alt={currentTrack.title}
                className={`w-full max-w-[320px] aspect-square object-cover rounded-2xl shadow-2xl transition-all duration-500 ${
                  isPlaying ? 'scale-100 shadow-purple-500/20' : 'scale-95 opacity-90'
                }`}
              />
            )}
          </div>
        )}

        {/* Track Title + Favorite & Lyrics Controls */}
        <div className="flex items-center justify-between gap-4 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold text-app-primary truncate">{currentTrack.title}</h2>
            <button
              onClick={() => openArtistProfile(currentTrack.artist)}
              className="block max-w-full text-base text-app-secondary truncate mt-1 hover:text-app-primary hover:underline text-left"
              title="View artist profile"
            >
              {currentTrack.artist}
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => toggleFavorite(currentTrack.id)}
              className="p-2 active:scale-95 transition-transform"
              title="Like"
            >
              <Heart
                className={`w-6 h-6 ${isFav ? 'text-app-primary fill-current' : 'text-app-secondary'}`}
              />
            </button>

            <button
              onClick={() => setShowAddToPlaylist(true)}
              className="p-2 text-app-secondary hover:text-app-primary active:scale-95 transition-transform"
              title="Add to playlist"
            >
              <ListPlus className="w-6 h-6" />
            </button>

            <button
              onClick={() => {
                if (!currentTrack.isYouTube) setShowLyrics(v => !v);
              }}
              disabled={currentTrack.isYouTube}
              className={`p-2 transition-transform active:scale-95 ${
                currentTrack.isYouTube
                  ? 'text-app-secondary opacity-35 cursor-not-allowed'
                  : showLyrics
                    ? 'text-app-primary font-bold'
                    : 'text-app-secondary hover:text-app-primary'
              }`}
              title={currentTrack.isYouTube ? 'Keep the video visible during YouTube playback' : 'Toggle Lyrics'}
            >
              <Mic className="w-6 h-6" />
            </button>

            <button
              onClick={() => setShowOptions(true)}
              className="p-2 text-app-secondary hover:text-app-primary active:scale-95 transition-transform"
              title="More options"
            >
              <MoreVertical className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Audio Progress Slider Bar */}
        <div className="pt-5">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={shownTime}
            onChange={e => setDragTime(parseFloat(e.target.value))}
            onMouseUp={commitSeek}
            onTouchEnd={commitSeek}
            className="w-full accent-[var(--text-primary)] accent-white h-1.5 rounded-lg cursor-pointer bg-app-card"
          />
          <div className="flex justify-between text-xs text-app-secondary mt-2 font-mono">
            <span>{formatTime(shownTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Main Playback Control Bar (Repeat, Prev, Play/Pause, Next, Shuffle) */}
        <div className="flex items-center justify-between pt-6 pb-2">
          <button
            onClick={toggleRepeatMode}
            className={`p-2.5 rounded-full transition-all ${
              repeatMode !== 'off' ? 'text-app-primary bg-app-card' : 'text-app-secondary hover:text-app-primary'
            }`}
            title={`Repeat: ${repeatMode}`}
          >
            {repeatMode === 'one' ? (
              <Repeat1 className="w-6 h-6 text-app-primary" />
            ) : (
              <Repeat className="w-6 h-6" />
            )}
          </button>

          <button
            onClick={previousTrack}
            className="p-3 text-app-primary hover:scale-110 active:scale-95 transition-transform"
            title="Previous"
          >
            <SkipBack className="w-8 h-8 fill-current" />
          </button>

          <button
            onClick={togglePlay}
            className="p-4 bg-app-primary text-app-primary rounded-full hover:scale-105 active:scale-95 transition-transform shadow-xl flex items-center justify-center border border-app-theme"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isResolvingStream && !isPlaying ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-8 h-8 fill-current" />
            ) : (
              <Play className="w-8 h-8 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={nextTrack}
            className="p-3 text-app-primary hover:scale-110 active:scale-95 transition-transform"
            title="Next"
          >
            <SkipForward className="w-8 h-8 fill-current" />
          </button>

          <button
            onClick={toggleShuffle}
            className={`p-2.5 rounded-full transition-all ${
              isShuffle ? 'text-app-primary bg-app-card' : 'text-app-secondary hover:text-app-primary'
            }`}
            title="Shuffle"
          >
            <Shuffle className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3 LINES QUEUE OVERLAY DRAWER SHEET (Overlays song view on Mobile when clicked) */}
      {/* ========================================================================= */}
      {showQueueOverlay && (
        <div
          className="absolute inset-0 z-50 bg-black/75 backdrop-blur-md flex flex-col justify-end animate-in fade-in duration-200"
          onClick={() => setShowQueueOverlay(false)}
        >
          <div
            className="w-full max-h-[80vh] bg-app-surface border-t border-app-theme rounded-t-3xl p-5 flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-300"
            onClick={e => e.stopPropagation()}
          >
            {/* Sheet Handle & Header */}
            <div className="flex items-center justify-between pb-4 border-b border-app-theme">
              <div className="flex items-center gap-2">
                <List className="w-5 h-5 text-app-primary" />
                <h3 className="text-lg font-bold text-app-primary">
                  Up Next Queue • {upNextTracks.length} songs
                </h3>
              </div>
              <button
                onClick={() => setShowQueueOverlay(false)}
                className="p-1.5 text-app-secondary hover:text-app-primary rounded-full"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Queue Songs Scroll Area */}
            <div className="flex-1 overflow-y-auto py-3 space-y-1.5 no-scrollbar">
              {upNextTracks.map((t, idx) => {
                const isSelected = t.id === currentTrack.id;
                return (
                  <div
                    key={`q-overlay-${t.id}-${idx}`}
                    onClick={() => {
                      if (queue.length > 0) {
                        playQueue(queue, idx);
                      } else {
                        playTrack(t);
                      }
                      setShowQueueOverlay(false);
                    }}
                    className={`w-full flex items-center gap-3.5 p-2.5 rounded-2xl transition-colors cursor-pointer ${
                      isSelected ? 'bg-app-card border border-app-theme' : 'hover:bg-app-card/50'
                    }`}
                  >
                    <img
                      src={t.coverUrl}
                      alt={t.title}
                      className="w-12 h-12 rounded-xl object-cover shrink-0"
                    />

                    <div className="min-w-0 flex-1">
                      <p className={`text-base font-semibold truncate ${isSelected ? 'text-app-primary font-bold' : 'text-app-primary'}`}>
                        {t.title}
                      </p>
                      <p className="text-xs text-app-secondary truncate mt-0.5">{t.artist}</p>
                    </div>

                    {queue.length > 0 && (
                      <div className="flex flex-col shrink-0">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            reorderQueue(idx, idx - 1);
                          }}
                          disabled={idx === 0}
                          className="p-1 text-app-secondary hover:text-app-primary disabled:opacity-20"
                          title="Move Up"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            reorderQueue(idx, idx + 1);
                          }}
                          disabled={idx === upNextTracks.length - 1}
                          className="p-1 text-app-secondary hover:text-app-primary disabled:opacity-20"
                          title="Move Down"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
