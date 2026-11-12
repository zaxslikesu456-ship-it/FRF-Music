import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { t as tr } from '../i18n';
import { useAudio } from '../context/AudioContext';
import { isTauriRuntime } from '../utils/http';
import { onBackButton } from '../utils/backButton';
import { LyricsPanel } from './LyricsPanel';

const formatTime = (secs: number) => {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

/**
 * Lyrics over the whole window. On a wide screen (the PC app) the song's cover
 * and controls are on the left and the lyrics run down the right; on a phone the
 * cover is small at the top and the lyrics fill the rest.
 */
export const LyricsFullscreen: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { currentTrack, currentTime, duration, isPlaying, togglePlay, nextTrack, previousTrack, seekTo } = useAudio();

  // The parent re-renders constantly (the lyrics clock), so the handler is read from a ref.
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  // Escape / the phone's back button close it. On the PC app the whole window
  // goes fullscreen too (and returns when this closes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const offBack = onBackButton(() => closeRef.current());
    let wentFullscreen = false;
    if (isTauriRuntime() && !document.fullscreenElement) {
      document.documentElement
        .requestFullscreen?.()
        .then(() => {
          wentFullscreen = true;
        })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      offBack();
      if (wentFullscreen || document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  if (!currentTrack) return null;
  const total = Math.max(duration || currentTrack.duration || 0, 1);

  return createPortal(
    <div className="fixed inset-0 z-[150] bg-app-primary text-app-primary overflow-hidden animate-in fade-in duration-200">
      {/* The cover, blurred, as the backdrop */}
      {currentTrack.coverUrl && (
        <img
          src={currentTrack.coverUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-40 pointer-events-none"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/60 pointer-events-none" />

      <div className="relative h-full flex flex-col md:flex-row gap-3 md:gap-14 px-5 md:px-14 pt-[max(env(safe-area-inset-top,0px),16px)] pb-[max(env(safe-area-inset-bottom,0px),16px)] md:py-10">
        <button
          onClick={onClose}
          className="absolute top-[max(env(safe-area-inset-top,0px),16px)] md:top-6 right-4 md:right-8 z-10 p-2.5 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-md active:scale-95 transition-all"
          title={tr('Close fullscreen lyrics')}
        >
          <Minimize2 className="w-5 h-5" />
        </button>

        {/* Song: cover, title, controls (big and on the left for a wide window) */}
        <div className="shrink-0 md:w-[38%] md:max-w-[480px] flex md:flex-col items-center md:items-stretch md:justify-center gap-4 md:gap-6 pr-14 md:pr-0">
          <img
            src={currentTrack.coverUrl}
            alt={currentTrack.title}
            className="w-14 h-14 md:w-full md:h-auto md:aspect-square rounded-lg md:rounded-2xl object-cover shadow-2xl shrink-0"
          />
          <div className="min-w-0 flex-1 md:flex-none">
            <h2 className="text-base md:text-3xl font-extrabold truncate md:whitespace-normal md:line-clamp-2 drop-shadow">
              {currentTrack.title}
            </h2>
            <p className="text-sm md:text-lg text-app-secondary truncate">{currentTrack.artist}</p>
          </div>

          <div className="hidden md:block">
            <input
              type="range"
              min={0}
              max={total}
              step={1}
              value={Math.min(currentTime, total)}
              onChange={e => seekTo(parseFloat(e.target.value))}
              className="w-full h-1 accent-[var(--bg-highlight)] cursor-pointer"
            />
            <div className="flex justify-between text-xs text-app-secondary pt-1 tabular-nums">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(total)}</span>
            </div>
            <div className="flex items-center justify-center gap-7 pt-4">
              <button onClick={previousTrack} className="text-app-primary hover:scale-110 transition-transform" title={tr('Previous')}>
                <SkipBack className="w-7 h-7 fill-current" />
              </button>
              <button
                onClick={togglePlay}
                className="w-14 h-14 rounded-full bg-app-highlight text-app-inverse flex items-center justify-center hover:scale-105 transition-transform"
                title={isPlaying ? tr('Pause') : tr('Play')}
              >
                {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
              </button>
              <button onClick={nextTrack} className="text-app-primary hover:scale-110 transition-transform" title={tr('Next')}>
                <SkipForward className="w-7 h-7 fill-current" />
              </button>
            </div>
          </div>
        </div>

        {/* Lyrics */}
        <div className="flex-1 min-h-0 min-w-0">
          <LyricsPanel fullscreen className="h-full" />
        </div>

        {/* Phone: a play/pause bar under the lyrics (the PC has the big controls) */}
        <div className="md:hidden shrink-0 flex items-center justify-center gap-8 pt-1">
          <button onClick={previousTrack} className="text-app-primary" title={tr('Previous')}>
            <SkipBack className="w-6 h-6 fill-current" />
          </button>
          <button
            onClick={togglePlay}
            className="w-12 h-12 rounded-full bg-app-highlight text-app-inverse flex items-center justify-center"
            title={isPlaying ? tr('Pause') : tr('Play')}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>
          <button onClick={nextTrack} className="text-app-primary" title={tr('Next')}>
            <SkipForward className="w-6 h-6 fill-current" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
