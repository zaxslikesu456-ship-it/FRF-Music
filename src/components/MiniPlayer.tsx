import React, { useRef, useState } from 'react';
import { t as tr } from '../i18n';
import { Play, Pause, SkipForward, Loader2, X, PanelRightOpen } from 'lucide-react';
import { useAudio } from '../context/AudioContext';

// onShowPanel: on PC, when the side player is hidden this bar stands in for it,
// with a button to bring the side player back.
export const MiniPlayer: React.FC<{ onShowPanel?: () => void }> = ({ onShowPanel }) => {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    currentTime,
    duration,
    setIsPlayerOpen,
    isResolvingStream,
    stopTrack,
    settings,
    artColors,
  } = useAudio();
  const tint = settings.albumArtColors !== false && artColors ? artColors.dark : null;

  // Swipe the mini-player down to dismiss the current song.
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);

  if (!currentTrack) return null;

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const onTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current == null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    // Only track downward drags; upward is handled by the tap-to-open button.
    setDragY(dy > 0 ? dy : 0);
  };
  const onTouchEnd = () => {
    if (dragY > 90) stopTrack();
    setDragY(0);
    dragStartY.current = null;
  };

  return (
    <div
      className="w-full bg-app-primary z-30 anim-rise border-t border-app touch-none"
      style={{
        // Tinted with the cover's colour.
        background: tint ? `linear-gradient(to right, ${tint}, var(--bg-primary))` : undefined,
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        opacity: dragY > 0 ? Math.max(0.3, 1 - dragY / 260) : undefined,
        transition: dragY > 0 ? 'none' : 'transform 0.2s ease, opacity 0.2s ease',
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Thin progress line */}
      <div className="w-full bg-app-card h-0.5">
        <div
          className="bg-app-highlight h-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setIsPlayerOpen(true)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left group active:scale-[0.99] transition-transform"
        >
          <img
            key={`img-${currentTrack.id}`}
            data-mini-cover
            src={currentTrack.coverUrl}
            alt={currentTrack.title}
            className="w-11 h-11 rounded-lg object-cover shrink-0 anim-art-swap shadow-sm group-hover:scale-105 transition-transform duration-300"
          />
          <div key={`meta-${currentTrack.id}`} className="min-w-0 flex-1 anim-track-meta">
            <h4 className="text-base font-semibold text-app-primary truncate flex items-center gap-2">
              <span className="truncate">{currentTrack.title}</span>
              {isPlaying && (
                <span className="eq pause-when-hidden" aria-hidden="true"><span /><span /><span /></span>
              )}
            </h4>
            <p className="text-xs text-app-secondary truncate">{currentTrack.artist}</p>
          </div>
        </button>

        <button
          onClick={togglePlay}
          className="p-1.5 text-app-primary active:scale-90 transition-transform"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isResolvingStream && !isPlaying ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-6 h-6 fill-current" />
          ) : (
            <Play className="w-6 h-6 fill-current" />
          )}
        </button>

        <button
          onClick={nextTrack}
          className="p-1.5 text-app-primary active:scale-90 transition-transform"
          title={tr("Next")}
        >
          <SkipForward className="w-6 h-6 fill-current" />
        </button>

        {onShowPanel && (
          <button
            onClick={onShowPanel}
            className="p-1.5 text-app-secondary hover:text-app-primary active:scale-90 transition-all"
            title={tr("Show the player panel")}
          >
            <PanelRightOpen className="w-5 h-5" />
          </button>
        )}

        {/* Take off / Close current song button */}
        <button
          onClick={stopTrack}
          className="p-1.5 text-app-secondary hover:text-app-primary active:scale-90 transition-all"
          title={tr("Stop & Close Song")}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
