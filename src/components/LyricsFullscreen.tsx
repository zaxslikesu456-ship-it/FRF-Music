import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EyeOff, GripVertical, Minimize2, Minus, Pause, Play, Plus, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
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

// Where the cover (c) and the lyrics (l) sit and how big they are, kept between uses.
interface Layout {
  cx: number;
  cy: number;
  cScale: number;
  lx: number;
  ly: number;
  lScale: number;
}
const DEFAULT_LAYOUT: Layout = { cx: 0, cy: 0, cScale: 1, lx: 0, ly: 0, lScale: 1 };
const LAYOUT_KEY = 'bw_lyrics_fs_layout_v1';
const SCALE_MIN = 0.4;
const SCALE_MAX = 1.8;

function loadLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    return {
      cx: num(raw.cx, 0),
      cy: num(raw.cy, 0),
      cScale: Math.min(SCALE_MAX, Math.max(SCALE_MIN, num(raw.cScale, 1))),
      lx: num(raw.lx, 0),
      ly: num(raw.ly, 0),
      lScale: Math.min(SCALE_MAX, Math.max(SCALE_MIN, num(raw.lScale, 1))),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/**
 * Lyrics over the whole window. On a wide screen (the PC app) the song's cover
 * and controls are on the left and the lyrics run down the right; each can be
 * dragged anywhere and made bigger or smaller, and every button can be hidden
 * (press H, or move to the top-right corner, to bring them back). On a phone the
 * cover is small at the top and the lyrics fill the rest.
 */
export const LyricsFullscreen: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { currentTrack, currentTime, duration, isPlaying, togglePlay, nextTrack, previousTrack, seekTo } = useAudio();
  const viewportWidth = useViewportWidth();
  const wide = viewportWidth >= 768;

  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [hint, setHint] = useState(false);
  const hintTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // storage unavailable: the layout just is not remembered
    }
  }, [layout]);

  const hideControls = useCallback(() => {
    setControlsHidden(true);
    setHint(true);
    if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setHint(false), 3000);
  }, []);
  const showControls = useCallback(() => {
    setControlsHidden(false);
    setHint(false);
  }, []);
  useEffect(
    () => () => {
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    },
    []
  );
  const hiddenRef = useRef(false);
  hiddenRef.current = controlsHidden;

  // The parent re-renders constantly (the lyrics clock), so the handler is read from a ref.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Escape / the phone's back button close it; H hides or shows the buttons. On
  // the PC app the whole window goes fullscreen too (and returns when this closes).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      else if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (hiddenRef.current) showControls();
        else hideControls();
      }
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
  }, [hideControls, showControls]);

  // Drag the grip to move the cover or the lyrics.
  const startDrag = (which: 'c' | 'l') => (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = which === 'c' ? layout.cx : layout.lx;
    const oy = which === 'c' ? layout.cy : layout.ly;
    const limitX = window.innerWidth * 0.9;
    const limitY = window.innerHeight * 0.9;
    const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
    const move = (ev: PointerEvent) => {
      const nx = clamp(ox + ev.clientX - sx, limitX);
      const ny = clamp(oy + ev.clientY - sy, limitY);
      setLayout(p => (which === 'c' ? { ...p, cx: nx, cy: ny } : { ...p, lx: nx, ly: ny }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const resize = (which: 'c' | 'l', delta: number) =>
    setLayout(p => {
      const key = which === 'c' ? 'cScale' : 'lScale';
      const next = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, p[key] + delta)) * 100) / 100;
      return { ...p, [key]: next };
    });

  if (!currentTrack) return null;
  const total = Math.max(duration || currentTrack.duration || 0, 1);

  // Width of the cover column on a wide window (a phone keeps its small cover).
  const coverWidth = Math.round(Math.min(480, viewportWidth * 0.38) * layout.cScale);

  const sizeButtons = (which: 'c' | 'l', label: string) => (
    <div
      className="inline-flex items-center rounded-full bg-black/40 backdrop-blur-md text-white text-xs font-semibold select-none"
      title={label}
    >
      <span
        onPointerDown={startDrag(which)}
        className="pl-2 pr-1 py-1.5 cursor-grab active:cursor-grabbing touch-none"
        title={tr('Drag to move')}
      >
        <GripVertical className="w-4 h-4" />
      </span>
      <button onClick={() => resize(which, -0.1)} className="px-1.5 py-1.5 hover:text-app-highlight" title={tr('Smaller')}>
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="min-w-[2.6rem] text-center tabular-nums">
        {Math.round((which === 'c' ? layout.cScale : layout.lScale) * 100)}%
      </span>
      <button onClick={() => resize(which, 0.1)} className="px-1.5 py-1.5 hover:text-app-highlight" title={tr('Bigger')}>
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );

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

      {/* Top-right: hide the buttons / reset the layout / close. With the buttons
          hidden only an almost invisible spot is left to bring them back. */}
      {controlsHidden ? (
        <button
          onClick={showControls}
          className="absolute top-0 right-0 z-30 w-16 h-16 flex items-start justify-end p-4 opacity-0 hover:opacity-80 transition-opacity text-white"
          title={tr('Show the buttons (H)')}
        >
          <EyeOff className="w-5 h-5" />
        </button>
      ) : (
        <div className="absolute top-[max(env(safe-area-inset-top,0px),16px)] md:top-6 right-4 md:right-8 z-30 flex items-center gap-2">
          {wide && (
            <button
              onClick={() => setLayout(DEFAULT_LAYOUT)}
              className="p-2.5 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-md active:scale-95 transition-all"
              title={tr('Reset the layout')}
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={hideControls}
            className="p-2.5 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-md active:scale-95 transition-all"
            title={tr('Hide the buttons (H)')}
          >
            <EyeOff className="w-5 h-5" />
          </button>
          <button
            onClick={onClose}
            className="p-2.5 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-md active:scale-95 transition-all"
            title={tr('Close fullscreen lyrics')}
          >
            <Minimize2 className="w-5 h-5" />
          </button>
        </div>
      )}

      {hint && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-black/60 text-white text-xs font-semibold backdrop-blur-md animate-in fade-in duration-200 pointer-events-none">
          {tr('Buttons hidden. Press H to show them, Esc to close.')}
        </div>
      )}

      <div className="relative h-full flex flex-col md:flex-row gap-3 md:gap-14 px-5 md:px-14 pt-[max(env(safe-area-inset-top,0px),16px)] pb-[max(env(safe-area-inset-bottom,0px),16px)] md:py-10">
        {/* Song: cover, title, controls (big and on the left for a wide window) */}
        <div
          className="shrink-0 flex md:flex-col items-center md:items-stretch md:justify-center gap-4 md:gap-6 pr-14 md:pr-0 relative z-10"
          style={
            wide
              ? { width: coverWidth, transform: `translate(${layout.cx}px, ${layout.cy}px)` }
              : undefined
          }
        >
          {wide && !controlsHidden && <div className="self-start">{sizeButtons('c', tr('Cover'))}</div>}
          <img
            src={currentTrack.coverUrl}
            alt={currentTrack.title}
            className="w-14 h-14 md:w-full md:h-auto md:aspect-square rounded-lg md:rounded-2xl object-cover shadow-2xl shrink-0"
          />
          <div className="min-w-0 flex-1 md:flex-none">
            <h2
              className="text-base md:font-extrabold font-extrabold truncate md:whitespace-normal md:line-clamp-2 drop-shadow"
              style={wide ? { fontSize: Math.max(14, Math.round(30 * layout.cScale)) } : undefined}
            >
              {currentTrack.title}
            </h2>
            <p
              className="text-sm text-app-secondary truncate"
              style={wide ? { fontSize: Math.max(11, Math.round(18 * layout.cScale)) } : undefined}
            >
              {currentTrack.artist}
            </p>
          </div>

          {!controlsHidden && (
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
          )}
        </div>

        {/* Lyrics */}
        <div
          className="flex-1 min-h-0 min-w-0 flex flex-col relative z-10"
          style={wide ? { transform: `translate(${layout.lx}px, ${layout.ly}px)` } : undefined}
        >
          {wide && !controlsHidden && <div className="self-start pb-2">{sizeButtons('l', tr('Lyrics'))}</div>}
          <LyricsPanel
            fullscreen
            className="flex-1 min-h-0"
            fontScale={wide ? layout.lScale : 1}
            hideControls={controlsHidden}
          />
        </div>

        {/* Phone: a play/pause bar under the lyrics (the PC has the big controls) */}
        {!controlsHidden && (
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
        )}
      </div>
    </div>,
    document.body
  );
};
