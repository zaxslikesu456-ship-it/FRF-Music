import React, { useState } from 'react';
import { ChevronLeft, Play, Shuffle, Music, ArrowDownAZ, Search, X } from 'lucide-react';

interface PlaylistHeroProps {
  // Omit title/subtitle for a header with just the artwork and controls.
  title?: string;
  subtitle?: string;
  count: number;
  onBack?: () => void;
  onPlay: () => void;
  playDisabled?: boolean;
  isShuffle: boolean;
  onShuffle: () => void;
  sortAz: boolean;
  onToggleSort: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  // Shorter artwork area for screens that already have a header above it.
  compact?: boolean;
}

// Gradient hero with a solid music note, play/shuffle, count + A-Z sort +
// search. Shared by the Downloads page and the Library songs tab.
export const PlaylistHero: React.FC<PlaylistHeroProps> = ({
  title,
  subtitle,
  count,
  onBack,
  onPlay,
  playDisabled,
  isShuffle,
  onShuffle,
  sortAz,
  onToggleSort,
  query,
  onQueryChange,
  compact,
}) => {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="relative overflow-hidden">
      <div
        className={`relative ${compact ? 'h-52' : 'h-72'} flex items-center justify-center`}
        style={{
          background:
            'radial-gradient(120% 80% at 85% 70%, #e4505a 0%, transparent 55%), radial-gradient(120% 90% at 10% 0%, #6a3cc4 0%, transparent 60%), linear-gradient(180deg, #b0309a 0%, #d6336c 55%, #000 100%)',
        }}
      >
        {onBack && (
          <button onClick={onBack} className="absolute top-4 left-3 p-1 text-white" title="Back">
            <ChevronLeft className="w-7 h-7" />
          </button>
        )}
        <svg
          viewBox="0 0 100 100"
          className={`${compact ? 'w-28 h-28' : 'w-36 h-36'} text-white/95 drop-shadow-lg`}
          fill="currentColor"
        >
          <path d="M34 14 L84 4 Q88 3 88 8 V66 A14 12 0 1 1 80 55 V28 L42 35 V74 A14 12 0 1 1 34 63 Z" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-black" />
      </div>

      <div className="bg-black px-4 pt-4 pb-3">
        <div className="flex items-center gap-6 text-white">
          <button onClick={onPlay} disabled={playDisabled} className="disabled:opacity-40" title="Play all">
            <span className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center">
              <Play className="w-5 h-5 fill-current ml-0.5" />
            </span>
          </button>
          <button
            onClick={onShuffle}
            className={isShuffle ? 'text-app-highlight' : 'text-white'}
            title="Shuffle"
          >
            <Shuffle className="w-6 h-6" />
          </button>
        </div>

        {title && <h1 className="text-4xl font-black text-white tracking-tight mt-5">{title}</h1>}
        {subtitle && <p className="text-white/80 text-base mt-3">{subtitle}</p>}

        <div className={`flex items-center justify-between ${title ? 'mt-6' : 'mt-4'} text-white/60`}>
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-1.5 text-sm">
              {count} <Music className="w-4 h-4" />
            </span>
            <button
              onClick={onToggleSort}
              className={sortAz ? 'text-app-highlight' : ''}
              title="Sort A-Z"
            >
              <ArrowDownAZ className="w-6 h-6" />
            </button>
          </div>
          <button
            onClick={() => {
              setSearchOpen(v => !v);
              onQueryChange('');
            }}
            className={searchOpen ? 'text-app-highlight' : ''}
            title="Search"
          >
            <Search className="w-6 h-6" />
          </button>
        </div>

        {searchOpen && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
            <Search className="w-4 h-4 text-white/60 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              placeholder="Search"
              className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/40"
            />
            {query && (
              <button onClick={() => onQueryChange('')} className="text-white/60" title="Clear">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
