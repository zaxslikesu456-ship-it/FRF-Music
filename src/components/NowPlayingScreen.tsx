import React, { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { t as tr } from '../i18n';
import { flyCover, miniCoverRect } from '../utils/coverTransition';
import { onBackButton } from '../utils/backButton';
import { AudioVisualizer } from './AudioVisualizer';
import { parseLrc, lineProgress } from '../utils/lyricsSync';
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
  Video as VideoIcon,
  Timer,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  Share2,
  Copy,
  Check,
  LocateFixed,
  RotateCcw,
  RotateCw,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { LyricCardModal } from './LyricCardModal';
import type { LyricCardInput } from '../utils/lyricCard';
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
  const [rawLyrics, setRawLyrics] = useState<string | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricCard, setLyricCard] = useState<LyricCardInput | null>(null);
  const [bounce, setBounce] = useState(0);
  const artRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Double-tap the artwork to like the track, with a heart pop animation.
  const [heartPop, setHeartPop] = useState(false);
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

  const activeLyricRef = useRef<HTMLParagraphElement | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const videoSlotRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Length of the recording being played, used to pick the lyrics version that
  // is in time with it. 0 until the player knows it; the lyrics are looked up
  // again once it does.
  const songLength = duration > 1 ? Math.round(duration) : 0;
  const lyricsForTrackRef = useRef<string | null>(null);

  // Fetch lyrics when track changes or user opens lyrics view
  useEffect(() => {
    if (centerMode !== 'lyrics' || !currentTrack) return;
    let mounted = true;
    // Same song, length just became known: keep showing the current lyrics
    // while the better-timed version loads.
    const sameTrack = lyricsForTrackRef.current === currentTrack.id;
    if (!sameTrack) {
      setLyricsLoading(true);
      setRawLyrics(null);
    }
    fetchLyrics(currentTrack.title, currentTrack.artist, songLength).then(text => {
      if (mounted) {
        lyricsForTrackRef.current = currentTrack.id;
        if (text || !sameTrack) setRawLyrics(text);
        setLyricsLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [centerMode, currentTrack, songLength]);

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

  // Parse timed LRC synced lines
  const syncedLyrics = useMemo(() => {
    if (!rawLyrics) return [];
    return parseLrc(rawLyrics);
  }, [rawLyrics]);

  // Per-song timing nudge for lyrics that are still a little early or late.
  // Positive = lyrics shown later. Saved per track.
  const LYRIC_OFFSETS_KEY = 'bw_lyric_offsets';
  const [lyricOffset, setLyricOffset] = useState(0);
  useEffect(() => {
    try {
      const map = JSON.parse(localStorage.getItem(LYRIC_OFFSETS_KEY) || '{}');
      setLyricOffset(currentTrack ? Number(map[currentTrack.id]) || 0 : 0);
    } catch {
      setLyricOffset(0);
    }
  }, [currentTrack?.id]);
  const nudgeLyrics = (delta: number) => {
    if (!currentTrack) return;
    const trackId = currentTrack.id;
    // Builds on the latest value so quick repeated taps all count.
    setLyricOffset(prev => {
      const next = Math.round((prev + delta) * 10) / 10;
      try {
        const map = JSON.parse(localStorage.getItem(LYRIC_OFFSETS_KEY) || '{}');
        if (next === 0) delete map[trackId];
        else map[trackId] = next;
        localStorage.setItem(LYRIC_OFFSETS_KEY, JSON.stringify(map));
      } catch {
        // storage unavailable: the nudge still applies for now
      }
      return next;
    });
  };
  const lyricTime = currentTime - lyricOffset;

  // Determine currently active lyric line index based on playback currentTime
  const activeLyricIndex = useMemo(() => {
    if (syncedLyrics.length === 0) return -1;
    let index = -1;
    for (let i = 0; i < syncedLyrics.length; i++) {
      if (lyricTime >= syncedLyrics[i].time) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }, [syncedLyrics, lyricTime]);

  // Follow mode (like Spotify): the lyrics scroll by themselves so the line
  // being sung stays in the middle. Scrolling by hand pauses it; it picks up
  // again after a few seconds, or straight away from "Back to current line".
  const [followLyrics, setFollowLyrics] = useState(
    () => localStorage.getItem('bw_lyrics_follow') !== '0'
  );
  const [followPaused, setFollowPaused] = useState(false);
  const followResumeTimerRef = useRef<number | null>(null);

  const scrollToActiveLine = (smooth: boolean) => {
    const box = lyricsContainerRef.current;
    const line = activeLyricRef.current;
    if (!box || !line) return;
    const boxRect = box.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const top = box.scrollTop + (lineRect.top - boxRect.top) - (box.clientHeight - lineRect.height) / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  };

  const resumeFollow = () => {
    if (followResumeTimerRef.current) window.clearTimeout(followResumeTimerRef.current);
    followResumeTimerRef.current = null;
    setFollowPaused(false);
    scrollToActiveLine(true);
  };

  const pauseFollowForManualScroll = (e: React.SyntheticEvent) => {
    if (!followLyrics) return;
    // Taps on the Follow / Copy / Share buttons are not scrolling.
    if ((e.target as HTMLElement | null)?.closest?.('button')) return;
    setFollowPaused(true);
    if (followResumeTimerRef.current) window.clearTimeout(followResumeTimerRef.current);
    followResumeTimerRef.current = window.setTimeout(() => {
      followResumeTimerRef.current = null;
      setFollowPaused(false);
    }, 6000);
  };

  const toggleFollowLyrics = () => {
    const next = !followLyrics;
    setFollowLyrics(next);
    localStorage.setItem('bw_lyrics_follow', next ? '1' : '0');
    if (next) resumeFollow();
  };

  useEffect(
    () => () => {
      if (followResumeTimerRef.current) window.clearTimeout(followResumeTimerRef.current);
    },
    []
  );

  // Keep the line being sung in the middle while following.
  useEffect(() => {
    if (centerMode !== 'lyrics' || !followLyrics || followPaused) return;
    scrollToActiveLine(true);
  }, [activeLyricIndex, centerMode, followLyrics, followPaused]);

  // Copy the whole lyrics (every line), not just one line.
  const [lyricsCopied, setLyricsCopied] = useState(false);
  const copyLyrics = async () => {
    const text =
      syncedLyrics.length > 0
        ? syncedLyrics.map(l => l.text).filter(Boolean).join('\n')
        : (rawLyrics || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n');
    if (!text) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Older WebViews: fall back to a temporary textarea.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (ok) {
      setLyricsCopied(true);
      window.setTimeout(() => setLyricsCopied(false), 1800);
    }
  };

  // Build a share card around the line that is playing now (or the first line).
  const shareLyric = () => {
    if (!currentTrack) return;
    let lines: string[];
    let at: number;
    if (syncedLyrics.length > 0) {
      lines = syncedLyrics.map(l => l.text).filter(Boolean);
      const cur = syncedLyrics[Math.max(0, activeLyricIndex)]?.text || lines[0];
      at = Math.max(0, lines.indexOf(cur));
    } else {
      lines = (rawLyrics || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      at = 0;
    }
    if (lines.length === 0) return;
    setLyricCard({
      title: currentTrack.title,
      artist: currentTrack.artist,
      coverUrl: currentTrack.coverUrl,
      before: lines.slice(Math.max(0, at - 1), at),
      line: lines[at],
      after: lines.slice(at + 1, at + 3),
    });
  };

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
    <div ref={rootRef} className="fixed inset-0 z-40 bg-app-primary max-w-xl mx-auto flex flex-col select-none overflow-hidden animate-in fade-in duration-300">
      <LyricCardModal input={lyricCard} onClose={() => setLyricCard(null)} />
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

          <div className="text-center min-w-0 px-2">
            <p className="text-xs text-app-secondary truncate font-medium tracking-wider uppercase">
              {queue.length > 0 ? 'Playing from Queue' : 'Now Playing'}
            </p>
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

          <div className="flex items-center gap-1">
            {/* Equalizer & Sound FX */}
            <button
              onClick={() => setIsEqualizerOpen(true)}
              className="p-2 text-app-secondary hover:text-app-primary hover:scale-105 active:scale-95 transition-all"
              title={tr("Studio Equalizer")}
            >
              <Sliders className="w-5 h-5" />
            </button>

            {/* 3 Lines Icon (Up Next Queue) */}
            <button
              onClick={() => setShowQueueOverlay(v => !v)}
              className={`p-2 transition-colors ${
                showQueueOverlay ? 'text-app-primary font-bold scale-110' : 'text-app-secondary hover:text-app-primary'
              }`}
              title={tr("Queue Sheet")}
            >
              <List className="w-6 h-6" />
            </button>

            {/* 3 Dots Options */}
            <button
              onClick={() => setShowOptions(true)}
              className="p-2 text-app-secondary hover:text-app-primary transition-colors"
              title={tr("Track Options")}
            >
              <MoreVertical className="w-6 h-6" />
            </button>

            {/* Stop & Close Song */}
            <button
              onClick={stopTrack}
              className="p-2 text-app-secondary hover:text-red-400 transition-colors"
              title={tr("Stop & Close Song")}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
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
          <div
            ref={lyricsContainerRef}
            className="flex-1 min-h-0 overflow-y-auto w-full py-4 no-scrollbar space-y-5 px-2 animate-in fade-in duration-200 select-text"
            style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
            onTouchStart={pauseFollowForManualScroll}
            onWheel={pauseFollowForManualScroll}
          >
            <div className="flex flex-wrap items-center justify-center gap-2 pb-1">
              <p className="text-center text-xs text-app-secondary tracking-wide uppercase">
                {syncedLyrics.length > 0 ? tr("Synced Lyrics") : tr("Lyrics")}
              </p>
              {!lyricsLoading && syncedLyrics.length > 0 && (
                <button
                  onClick={toggleFollowLyrics}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold ${
                    followLyrics ? 'border-transparent' : 'bg-app-card border-app-theme text-app-secondary'
                  }`}
                  // On: inverted colours (readable in every theme).
                  style={followLyrics ? { background: 'var(--text-primary)', color: 'var(--bg-primary)' } : undefined}
                  title={followLyrics ? 'Stop following the lyrics' : 'Follow the lyrics as they play'}
                  aria-pressed={followLyrics}
                >
                  <LocateFixed className="w-3.5 h-3.5" /> {tr("Follow")}
                </button>
              )}
              {!lyricsLoading && syncedLyrics.length > 0 && (
                <div
                  className="flex items-center rounded-full bg-app-card border border-app-theme text-xs font-semibold text-app-primary"
                  title={tr("Lyrics early or late? Nudge them for this song")}
                >
                  <button
                    onClick={() => nudgeLyrics(-0.5)}
                    className="px-2.5 py-1"
                    aria-label={tr("Show lyrics earlier")}
                  >
                    −
                  </button>
                  <span className="min-w-[3.2rem] text-center tabular-nums text-app-secondary">
                    {lyricOffset === 0 ? tr("Timing") : `${lyricOffset > 0 ? '+' : ''}${lyricOffset.toFixed(1)}s`}
                  </span>
                  <button
                    onClick={() => nudgeLyrics(0.5)}
                    className="px-2.5 py-1"
                    aria-label={tr("Show lyrics later")}
                  >
                    +
                  </button>
                </div>
              )}
              {!lyricsLoading && (syncedLyrics.length > 0 || rawLyrics) && (
                <button
                  onClick={copyLyrics}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-app-card border border-app-theme text-xs font-semibold text-app-primary"
                  title={tr("Copy all lyrics")}
                >
                  {lyricsCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {lyricsCopied ? tr("Copied") : tr("Copy")}
                </button>
              )}
              {!lyricsLoading && (syncedLyrics.length > 0 || rawLyrics) && (
                <button
                  onClick={shareLyric}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-app-card border border-app-theme text-xs font-semibold text-app-primary"
                  title={tr("Share a lyric card")}
                >
                  <Share2 className="w-3.5 h-3.5" /> {tr("Share")}
                </button>
              )}
            </div>

            {lyricsLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-app-primary" />
                <p className="text-app-secondary text-sm">{tr("Fetching lyrics...")}</p>
              </div>
            ) : syncedLyrics.length > 0 ? (
              syncedLyrics.map((line, idx) => {
                const isActive = idx === activeLyricIndex;
                // Karaoke: the line that is being sung fills in with the accent
                // colour from left to right (the fill eases between progress ticks).
                const fill = isActive ? lineProgress(line, syncedLyrics[idx + 1], lyricTime + 0.25) : 0;
                return (
                  <p
                    key={`lyric-${idx}`}
                    ref={isActive ? activeLyricRef : null}
                    onClick={() => {
                      seekTo(Math.max(0, line.time + lyricOffset));
                      // Jumping to a line means "carry on from here".
                      if (followLyrics) resumeFollow();
                    }}
                    className={`text-center transition-all duration-300 cursor-pointer select-text leading-relaxed ${
                      isActive
                        ? 'font-extrabold text-xl md:text-2xl scale-105'
                        : idx < activeLyricIndex
                          ? 'text-app-primary text-base opacity-50 hover:opacity-80'
                          : 'text-app-secondary text-base opacity-40 hover:opacity-80 hover:scale-100'
                    }`}
                  >
                    {isActive ? (
                      <span
                        className="karaoke-line"
                        style={{ backgroundSize: `${Math.round(fill * 1000) / 10}% 100%, 100% 100%` }}
                      >
                        {line.text}
                      </span>
                    ) : (
                      line.text
                    )}
                  </p>
                );
              }).concat(
                followLyrics && followPaused ? (
                  <div key="lyrics-resume" className="sticky bottom-2 flex justify-center pointer-events-none">
                    <button
                      onClick={resumeFollow}
                      className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold shadow-lg"
                      style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}
                    >
                      <LocateFixed className="w-3.5 h-3.5" /> {tr("Back to current line")}
                    </button>
                  </div>
                ) : (
                  []
                )
              )
            ) : rawLyrics ? (
              <div className="space-y-3 py-2 px-2">
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
                {tr("No lyrics found for this song")}
              </div>
            )}
          </div>
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
            <div className="relative w-full max-w-[320px] flex items-center justify-center">
            <AudioVisualizer variant="ring" />
            <div
              ref={artRef}
              onClick={handleArtworkTap}
              className="relative w-full max-w-[320px] aspect-square rounded-2xl overflow-hidden shadow-2xl border border-white/10 group cursor-pointer active:scale-[0.99] transition-transform"
              style={artColors ? { boxShadow: `0 24px 60px -12px ${artColors.accent}55` } : undefined}
            >
              <img
                src={currentTrack.coverUrl}
                alt={currentTrack.title}
                className={`w-full h-full object-cover transition-all duration-700 ${
                  isPlaying ? 'cover-drift' : 'scale-95 opacity-90'
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
            <AudioVisualizer className="max-w-[320px] mt-3" height={44} />
            <p className="text-[11px] text-app-secondary/50 mt-3">{tr("Double-tap artwork to like")}</p>
          </div>
        )}

        {/* Track Title + Favorite & Lyrics Controls */}
        <div className="flex items-center justify-between gap-4 pt-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold text-app-primary truncate tracking-tight">
              {currentTrack.title}
            </h2>
            <button
              onClick={() => openArtistProfile(currentTrack.artist)}
              className="block max-w-full text-base text-app-secondary truncate mt-0.5 hover:text-app-primary hover:underline text-left"
              title={tr("View artist profile")}
            >
              {currentTrack.artist}
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => toggleFavorite(currentTrack.id, currentTrack)}
              className="p-2 active:scale-95 transition-transform"
              title={tr("Like")}
            >
              <Heart
                className={`w-6 h-6 transition-colors ${
                  isFav ? 'text-app-accent fill-current' : 'text-app-secondary hover:text-app-primary'
                }`}
              />
            </button>

            <button
              onClick={() => setShowAddToPlaylist(true)}
              className="p-2 text-app-secondary hover:text-app-primary active:scale-95 transition-transform"
              title={tr("Add to playlist")}
            >
              <ListPlus className="w-6 h-6" />
            </button>

            {/* Lyrics Button */}
            <button
              onClick={() => setCenterMode(m => (m === 'lyrics' ? 'artwork' : 'lyrics'))}
              className={`p-2 transition-transform active:scale-95 ${
                centerMode === 'lyrics' ? 'text-app-primary font-bold scale-110' : 'text-app-secondary hover:text-app-primary'
              }`}
              title={tr("Toggle Lyrics")}
            >
              <Mic className="w-6 h-6" />
            </button>

            {/* Video Button */}
            <button
              onClick={() => setCenterMode(m => (m === 'video' ? 'artwork' : 'video'))}
              className={`p-2 transition-transform active:scale-95 ${
                centerMode === 'video' ? 'text-app-primary font-bold scale-110' : 'text-app-secondary hover:text-app-primary'
              }`}
              title={tr("Toggle Video")}
            >
              <VideoIcon className="w-6 h-6" />
            </button>

            <button
              onClick={() => setShowOptions(true)}
              className="p-2 text-app-secondary hover:text-app-primary active:scale-95 transition-transform"
              title={tr("More options")}
            >
              <MoreVertical className="w-6 h-6" />
            </button>
          </div>
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
