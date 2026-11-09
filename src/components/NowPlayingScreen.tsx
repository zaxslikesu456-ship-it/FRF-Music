import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t as tr } from '../i18n';
import { flyCover, miniCoverRect } from '../utils/coverTransition';
import { onBackButton } from '../utils/backButton';
import { AudioVisualizer } from './AudioVisualizer';
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
  ArrowUp,
  ArrowDown,
  Loader2,
  X,
  Sliders,
  Video as VideoIcon,
  Timer,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { LyricsPanel } from './LyricsPanel';
import { CastButton, CastingLabel } from './CastButton';
import { useAudio } from '../context/AudioContext';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';

export type PlayerCenterMode = 'artwork' | 'lyrics' | 'video';


export const NowPlayingScreen: React.FC = () => {
  const {
    currentTrack,
    settings,
    artColors,
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
    setVideoCompanion,
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
    removeFromQueue,
    isResolvingStream,
    setIsEqualizerOpen,
    volume,
    setVolume,
    sleepSecondsRemaining,
    sleepEndOfSong,
    setSleepTimer,
  } = useAudio();

  const lastNonZeroVolumeRef = useRef<number>(volume || 0.8);
  useEffect(() => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
    }
  }, [volume]);

  const [showQueueOverlay, setShowQueueOverlay] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [centerMode, setCenterMode] = useState<PlayerCenterMode>('artwork');
  // This screen stays mounted while closed, so it used to reopen on whatever
  // view was last used (lyrics or video) for the next song. It now always opens
  // on the cover art; the view only changes when you pick one.
  useEffect(() => {
    if (isPlayerOpen) setCenterMode('artwork');
  }, [isPlayerOpen]);
  const [bounce, setBounce] = useState(0);
  const artRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Double-tap the artwork to like the track, with a heart pop animation.
  const [heartPop, setHeartPop] = useState(false);
  // Tapping a long title shows all of it (two lines are shown otherwise).
  const [fullTitleId, setFullTitleId] = useState<string | null>(null);
  const lastArtworkTap = useRef(0);
  const handleArtworkTap = () => {
    const now = Date.now();
    if (now - lastArtworkTap.current < 300) {
      lastArtworkTap.current = 0;
      if (!favorites.includes(currentTrack?.id || '')) {
        toggleFavorite(currentTrack!.id, currentTrack!);
      }
      setHeartPop(true);
      window.setTimeout(() => setHeartPop(false), 800);
    } else {
      lastArtworkTap.current = now;
    }
  };

  const videoSlotRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Ask for the picture while the video view is open (the audio keeps coming
  // from the app's own engine; the video runs muted beside it).
  useEffect(() => {
    if (centerMode !== 'video' || !isPlayerOpen) return;
    setVideoCompanion(true);
    return () => setVideoCompanion(false);
  }, [centerMode, isPlayerOpen]);

  // On phones the YouTube player shows no controls of its own (they drew its
  // logo and title over the video), so the app draws play/pause and ±10 s on
  // top of it. A tap shows them; they fade after a few seconds.
  const [videoRect, setVideoRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [videoControlsVisible, setVideoControlsVisible] = useState(false);
  const videoControlsTimerRef = useRef<number | null>(null);
  const showVideoControls = () => {
    setVideoControlsVisible(true);
    if (videoControlsTimerRef.current) window.clearTimeout(videoControlsTimerRef.current);
    videoControlsTimerRef.current = window.setTimeout(() => {
      videoControlsTimerRef.current = null;
      setVideoControlsVisible(false);
    }, 3000);
  };
  const hideVideoControls = () => {
    if (videoControlsTimerRef.current) window.clearTimeout(videoControlsTimerRef.current);
    videoControlsTimerRef.current = null;
    setVideoControlsVisible(false);
  };
  useEffect(
    () => () => {
      if (videoControlsTimerRef.current) window.clearTimeout(videoControlsTimerRef.current);
    },
    []
  );

  // Position YouTube player element over the video slot when in Video view mode
  useEffect(() => {
    const ytEl = document.getElementById('yt-hidden-player');
    if (!ytEl) return;

    if (centerMode === 'video' && videoSlotRef.current && isPlayerOpen) {
      const updatePosition = () => {
        if (!videoSlotRef.current) return;
        const rect = videoSlotRef.current.getBoundingClientRect();
        setVideoRect(prev =>
          prev &&
          prev.left === rect.left &&
          prev.top === rect.top &&
          prev.width === rect.width &&
          prev.height === rect.height
            ? prev
            : { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        );
        ytEl.style.position = 'fixed';
        ytEl.style.left = `${rect.left}px`;
        ytEl.style.top = `${rect.top}px`;
        ytEl.style.width = `${rect.width}px`;
        ytEl.style.height = `${rect.height}px`;
        ytEl.style.opacity = '1';
        // On phones a touch makes the embed draw its own chrome (big YouTube
        // logo, title bar, CC/settings) over the video. The app has its own
        // controls, so the video ignores touches there.
        ytEl.style.pointerEvents = Capacitor.isNativePlatform() ? 'none' : 'auto';
        ytEl.style.zIndex = '50';
        ytEl.style.borderRadius = '1rem';
        ytEl.style.overflow = 'hidden';
      };

      updatePosition();
      const interval = setInterval(updatePosition, 250);
      window.addEventListener('resize', updatePosition);

      return () => {
        clearInterval(interval);
        window.removeEventListener('resize', updatePosition);
        setVideoRect(null);
        ytEl.style.position = 'fixed';
        ytEl.style.left = '-10000px';
        ytEl.style.top = '0';
        ytEl.style.width = '200px';
        ytEl.style.height = '200px';
        ytEl.style.opacity = '0';
        ytEl.style.pointerEvents = 'none';
        ytEl.style.zIndex = '-1';
      };
    } else {
      ytEl.style.position = 'fixed';
      ytEl.style.left = '-10000px';
      ytEl.style.top = '0';
      ytEl.style.width = '200px';
      ytEl.style.height = '200px';
      ytEl.style.opacity = '0';
      ytEl.style.pointerEvents = 'none';
      ytEl.style.zIndex = '-1';
    }
  }, [centerMode, isPlayerOpen]);

  // Cover grows out of the mini player when the screen opens...
  useLayoutEffect(() => {
    if (!isPlayerOpen || centerMode !== 'artwork' || !artRef.current) return;
    const from = miniCoverRect();
    if (from) void flyCover(artRef.current, from, 'open');
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlayerOpen]);

  // ...and shrinks back into it when it closes, while the screen fades out.
  const closePlayer = () => {
    const from = miniCoverRect();
    const el = artRef.current;
    const root = rootRef.current;
    if (!from || !el || centerMode !== 'artwork') {
      setIsPlayerOpen(false);
      return;
    }
    root?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-in', fill: 'forwards' });
    void flyCover(el, from, 'close').then(() => setIsPlayerOpen(false));
  };

  // Phone back button closes Now Playing (the cover shrinks back as usual).
  const closeRef = useRef(closePlayer);
  closeRef.current = closePlayer;
  useEffect(() => {
    if (!isPlayerOpen) return;
    return onBackButton(() => closeRef.current());
  }, [isPlayerOpen]);

  if (!isPlayerOpen || !currentTrack) return null;

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
    <div ref={rootRef} className="fixed inset-0 z-40 bg-app-primary max-w-xl mx-auto flex flex-col select-none overflow-hidden animate-in fade-in duration-300">
      <AddToPlaylistModal
        track={showAddToPlaylist ? currentTrack : null}
        onClose={() => setShowAddToPlaylist(false)}
      />
      <TrackOptionsMenuModal
        track={showOptions ? currentTrack : null}
        onClose={() => setShowOptions(false)}
      />

      {/* Blurred album art behind everything (cover art and lyrics), tinted with
          the cover's own colour. It cross-fades when the song changes. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <img
          key={currentTrack.coverUrl}
          src={currentTrack.coverUrl}
          alt=""
          className="now-bg absolute inset-0 w-full h-full object-cover blur-[70px] scale-150 opacity-[0.65]"
        />
        {settings.albumArtColors !== false && artColors && (
          <div
            className="absolute inset-0 transition-[background] duration-700"
            style={{ background: `linear-gradient(to bottom, ${artColors.dark} 0%, ${artColors.dark}cc 35%, transparent 75%)` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/35 to-black/90" />
      </div>

      <div
        className="relative flex flex-col flex-1 overflow-hidden px-6 pb-6"
        onTouchStart={e => {
          touchStartX.current = e.touches[0].clientX;
          touchStartY.current = e.touches[0].clientY;
        }}
        onTouchEnd={e => {
          if (touchStartX.current === null || touchStartY.current === null) return;
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          const dy = e.changedTouches[0].clientY - touchStartY.current;
          touchStartX.current = null;
          touchStartY.current = null;

          // Horizontal swipe navigation (Artwork <-> Lyrics <-> Video)
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.1) {
            if (dx < 0) {
              // Swipe Left: Advance from Artwork -> Lyrics -> Video
              if (centerMode === 'artwork') setCenterMode('lyrics');
              else if (centerMode === 'lyrics') setCenterMode('video');
            } else {
              // Swipe Right: Return from Video -> Lyrics -> Artwork
              if (centerMode === 'video') setCenterMode('lyrics');
              else if (centerMode === 'lyrics') setCenterMode('artwork');
            }
          }
        }}
      >
        {/* Top Navigation Header */}
        <div className="flex items-center justify-between safe-area-player-top pb-2 px-1">
          <button
            onClick={closePlayer}
            className="p-2.5 text-app-primary hover:scale-110 active:scale-95 transition-transform"
            title={tr("Minimize")}
          >
            <ChevronDown className="w-7 h-7" />
          </button>

          <div className="text-center min-w-0 flex-1 px-2">
            {/* Song actions, in the middle of the top bar. */}
            <div className="flex items-center justify-center gap-1 text-app-secondary">
              <CastButton className="p-2 hover:text-app-primary active:scale-95 transition-all" />
              <button
                onClick={() => setShowAddToPlaylist(true)}
                className="p-2 hover:text-app-primary active:scale-95 transition-all"
                title={tr("Add to playlist")}
              >
                <ListPlus className="w-5 h-5" />
              </button>
              <button
                onClick={() => setIsEqualizerOpen(true)}
                className="p-2 hover:text-app-primary active:scale-95 transition-all"
                title={tr("Studio Equalizer")}
              >
                <Sliders className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowQueueOverlay(v => !v)}
                className={`p-2 active:scale-95 transition-all ${showQueueOverlay ? 'text-app-primary' : 'hover:text-app-primary'}`}
                title={tr("Queue Sheet")}
              >
                <List className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowOptions(true)}
                className="p-2 hover:text-app-primary active:scale-95 transition-all"
                title={tr("More options")}
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>
            {sleepEndOfSong ? (
              <button
                onClick={() => setSleepTimer(null)}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-app-secondary bg-app-card/70 rounded-full px-2 py-0.5 active:scale-95 transition-transform"
                title={tr("Playback stops after this song — tap to cancel")}
              >
                <Timer className="w-3 h-3" />
                {tr("Ends after this song")}
              </button>
            ) : (
              sleepSecondsRemaining != null &&
              sleepSecondsRemaining > 0 && (
                <button
                  onClick={() => setSleepTimer(null)}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-app-secondary bg-app-card/70 rounded-full px-2 py-0.5 active:scale-95 transition-transform"
                  title={tr("Sleep timer ends soon — tap to cancel")}
                >
                  <Timer className="w-3 h-3" />
                  {formatTime(sleepSecondsRemaining)}
                </button>
              )
            )}
          </div>

          <button
            onClick={stopTrack}
            className="p-2.5 text-app-secondary hover:text-red-400 transition-colors"
            title={tr("Stop & Close Song")}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* 3-View Mode Dots Indicator (Artwork • Lyrics • Video) */}
        <div className="flex items-center justify-center gap-2 py-1">
          <button
            onClick={() => setCenterMode('artwork')}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              centerMode === 'artwork' ? 'w-6 bg-app-highlight' : 'w-1.5 bg-white/20 hover:bg-white/50'
            }`}
            title={tr("Artwork")}
          />
          <button
            onClick={() => setCenterMode('lyrics')}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              centerMode === 'lyrics' ? 'w-6 bg-app-highlight' : 'w-1.5 bg-white/20 hover:bg-white/50'
            }`}
            title={tr("Lyrics")}
          />
          <button
            onClick={() => setCenterMode('video')}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              centerMode === 'video' ? 'w-6 bg-app-highlight' : 'w-1.5 bg-white/20 hover:bg-white/50'
            }`}
            title={tr("Video")}
          />
        </div>

        {/* Main Center Section: Artwork | Synchronized Lyrics | Live YouTube Video */}
        {centerMode === 'lyrics' ? (
          <LyricsPanel className="flex-1 min-h-0" />
        ) : centerMode === 'video' ? (
          <div className="flex-1 flex flex-col items-center justify-center py-4 min-h-0 animate-in fade-in duration-200">
            <div
              ref={videoSlotRef}
              id="now-playing-video-slot"
              className="w-full max-w-[360px] aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-black relative flex items-center justify-center"
            >
              {/* Fallback poster while video stream positions */}
              <img
                src={currentTrack.coverUrl}
                alt=""
                className="w-full h-full object-cover opacity-30"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center pointer-events-none">
                <VideoIcon className="w-8 h-8 text-app-primary opacity-80" />
                <span className="text-xs text-app-secondary">
                  {tr("Live YouTube Video Player")}
                </span>
              </div>
            </div>
            <p className="text-xs text-app-secondary/60 mt-3 text-center">
              {Capacitor.isNativePlatform() ? `${tr("Tap the video for controls")} • ` : ''}{tr("Swipe right to return to lyrics or cover art")}
            </p>
            {Capacitor.isNativePlatform() &&
              videoRect &&
              createPortal(
                // Sits just above the YouTube player (z 50), in the same spot.
                <div
                  onClick={() => (videoControlsVisible ? hideVideoControls() : showVideoControls())}
                  style={{
                    position: 'fixed',
                    left: videoRect.left,
                    top: videoRect.top,
                    width: videoRect.width,
                    height: videoRect.height,
                    zIndex: 51,
                    borderRadius: '1rem',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    className={`absolute inset-0 flex items-center justify-center gap-10 bg-black/40 transition-opacity duration-200 ${
                      videoControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  >
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        seekTo(Math.max(0, currentTime - 10));
                        showVideoControls();
                      }}
                      className="p-2 text-white active:scale-95"
                      aria-label={tr("Back 10 seconds")}
                    >
                      <RotateCcw className="w-7 h-7" />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        togglePlay();
                        showVideoControls();
                      }}
                      className="p-3 rounded-full bg-white/90 text-black active:scale-95"
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? <Pause className="w-7 h-7 fill-current" /> : <Play className="w-7 h-7 fill-current" />}
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        seekTo(duration > 0 ? Math.min(duration - 1, currentTime + 10) : currentTime + 10);
                        showVideoControls();
                      }}
                      className="p-2 text-white active:scale-95"
                      aria-label={tr("Forward 10 seconds")}
                    >
                      <RotateCw className="w-7 h-7" />
                    </button>
                    <div className="absolute left-3 right-3 bottom-2.5 h-1 rounded-full bg-white/30 overflow-hidden">
                      <div
                        className="h-full bg-white"
                        style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </div>,
                document.body
              )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-4 min-h-0 animate-in fade-in duration-200">
            {/* The cover shrinks to the height that is left, so on short phones it
                no longer slides up under the header. */}
            <div className="w-full flex-1 min-h-0 flex items-center justify-center" style={{ containerType: 'size' }}>
            <div className="relative" style={{ width: 'min(320px, 100cqw, 100cqh)' }}>
            <AudioVisualizer variant="ring" />
            <div
              ref={artRef}
              onClick={handleArtworkTap}
              className="relative w-full aspect-square rounded-2xl overflow-hidden shadow-2xl border border-white/10 group cursor-pointer active:scale-[0.99] transition-transform"
              style={artColors ? { boxShadow: `0 24px 60px -12px ${artColors.accent}55` } : undefined}
            >
              <img
                src={currentTrack.coverUrl}
                alt={currentTrack.title}
                className={`w-full h-full object-cover transition-all duration-700 ${
                  isPlaying ? 'cover-drift pause-when-hidden' : 'scale-95 opacity-90'
                }`}
              />
              <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-2xl pointer-events-none" />
              {heartPop && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Heart className="w-24 h-24 text-app-accent fill-current drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] animate-[heartPop_0.8s_ease-out_forwards]" />
                </div>
              )}
            </div>
            </div>
            </div>
            <AudioVisualizer className="max-w-[320px] mt-3 shrink-0" height={44} />
          </div>
        )}

        {/* Track Title + Favorite & Lyrics Controls */}
        <div className="flex items-center justify-between gap-4 pt-3">
          <div className="min-w-0 flex-1">
            <h2
              onClick={() => setFullTitleId(id => (id === currentTrack.id ? null : currentTrack.id))}
              className={`${currentTrack.title.length > 30 ? 'text-xl' : 'text-2xl'} font-bold text-app-primary tracking-tight leading-tight break-words cursor-pointer ${
                fullTitleId === currentTrack.id ? '' : 'line-clamp-2'
              }`}
              title={currentTrack.title}
            >
              {currentTrack.title}
            </h2>
            <button
              onClick={() => openArtistProfile(currentTrack.artist)}
              className="block max-w-full text-base text-app-secondary truncate mt-0.5 hover:text-app-primary hover:underline text-left"
              title={tr("View artist profile")}
            >
              {currentTrack.artist}
            </button>
            <CastingLabel className="!justify-start mt-1" />
          </div>
          <button
            onClick={() => toggleFavorite(currentTrack.id, currentTrack)}
            className="p-2 -mr-2 shrink-0 active:scale-95 transition-transform"
            title={tr("Like")}
          >
            <Heart
              className={`w-7 h-7 transition-colors ${
                favorites.includes(currentTrack.id) ? 'text-app-accent fill-current' : 'text-app-secondary hover:text-app-primary'
              }`}
            />
          </button>
        </div>

        {/* Audio Progress Slider Bar */}
        <div className="pt-4">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={shownTime}
            onChange={e => setDragTime(parseFloat(e.target.value))}
            onMouseUp={commitSeek}
            onTouchEnd={commitSeek}
            className="w-full accent-[var(--bg-highlight)] h-1.5 rounded-lg cursor-pointer bg-app-card"
          />
          <div className="flex justify-between text-xs text-app-secondary mt-2 font-mono">
            <span>{formatTime(shownTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Main Playback Control Bar (Repeat, Prev, Play/Pause, Next, Shuffle) */}
        <div className="flex items-center justify-between pt-5 pb-1">
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
            title={tr("Previous")}
          >
            <SkipBack className="w-8 h-8 fill-current" />
          </button>

          <button
            key={bounce}
            onClick={() => {
              setBounce(b => b + 1);
              togglePlay();
            }}
            className={`p-4 bg-app-highlight text-app-inverse rounded-full hover:scale-105 transition-transform shadow-xl flex items-center justify-center ${
              bounce > 0 ? 'play-bounce' : ''
            }`}
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
            title={tr("Next")}
          >
            <SkipForward className="w-8 h-8 fill-current" />
          </button>

          <button
            onClick={toggleShuffle}
            className={`p-2.5 rounded-full transition-all ${
              isShuffle ? 'text-app-primary bg-app-card' : 'text-app-secondary hover:text-app-primary'
            }`}
            title={tr("Shuffle")}
          >
            <Shuffle className="w-6 h-6" />
          </button>
        </div>

        {/* Mobile Volume Slider Bar */}
        <div className="flex items-center gap-3 pt-3 px-1 select-none">
          <button
            onClick={() => {
              if (volume > 0) {
                lastNonZeroVolumeRef.current = volume;
                setVolume(0);
              } else {
                setVolume(lastNonZeroVolumeRef.current || 0.8);
              }
            }}
            className="p-1.5 text-app-secondary hover:text-app-primary active:scale-95 transition-all"
            title={volume === 0 ? 'Unmute' : 'Mute'}
          >
            {volume === 0 ? (
              <VolumeX className="w-5 h-5 text-red-400" />
            ) : volume < 0.35 ? (
              <Volume className="w-5 h-5" />
            ) : volume < 0.7 ? (
              <Volume1 className="w-5 h-5" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            className="flex-1 accent-[var(--bg-highlight)] h-1.5 rounded-lg cursor-pointer bg-app-card"
            title={`Volume: ${Math.round(volume * 100)}%`}
          />

          <span className="text-[11px] font-mono text-app-secondary w-9 text-right shrink-0">
            {Math.round(volume * 100)}%
          </span>
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
                      <p className={`text-base font-semibold truncate ${isSelected ? 'text-app-accent font-bold' : 'text-app-primary'}`}>
                        {t.title}
                      </p>
                      <p className="text-xs text-app-secondary truncate mt-0.5">{t.artist}</p>
                    </div>

                    {queue.length > 0 && (
                      <div className="flex items-center gap-1 shrink-0">
                        <div className="flex flex-col">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              reorderQueue(idx, idx - 1);
                            }}
                            disabled={idx === 0}
                            className="p-1 text-app-secondary hover:text-app-primary disabled:opacity-20"
                            title={tr("Move Up")}
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
                            title={tr("Move Down")}
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                        </div>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            removeFromQueue(idx);
                          }}
                          className="p-1.5 text-app-secondary hover:text-red-400 transition-colors"
                          title={tr("Remove from queue")}
                        >
                          <X className="w-4 h-4" />
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
