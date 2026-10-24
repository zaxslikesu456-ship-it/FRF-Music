import React, { useRef, useState } from 'react';
import { Play, Pause, SkipForward, Loader2, X } from 'lucide-react';
import { useAudio } from '../context/AudioContext';

export const MiniPlayer: React.FC = () => {
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
  } = useAudio();

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
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <img
            src={currentTrack.coverUrl}
            alt={currentTrack.title}
            className="w-11 h-11 rounded-lg object-cover shrink-0"
          />
          <div className="min-w-0 flex-1">
            <h4 className="text-base font-semibold text-app-primary truncate">
              {currentTrack.title}
            </h4>
            <p className="text-xs text-app-secondary truncate">{currentTrack.artist}</p>
          </div>
        </button>

        <button onClick={togglePlay} className="p-1.5 text-app-primary" title={isPlaying ? 'Pause' : 'Play'}>
          {isResolvingStream && !isPlaying ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : isPlaying ? (
            <Pause className="w-6 h-6 fill-current" />
          ) : (
            <Play className="w-6 h-6 fill-current" />
          )}
        </button>

        <button onClick={nextTrack} className="p-1.5 text-app-primary" title="Next">
          <SkipForward className="w-6 h-6 fill-current" />
        </button>

        {/* Take off / Close current song button */}
        <button
          onClick={stopTrack}
          className="p-1.5 text-app-secondary hover:text-app-primary transition-colors"
          title="Stop & Close Song"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
