import React, { useState, useMemo } from 'react';
import {
  ChevronLeft,
  Play,
  Shuffle,
  Download,
  MoreVertical,
  BarChart3,
  Edit3,
  Trash2,
  ArrowUp,
  ArrowDown,
  Music2,
  ListPlus,
  Check,
  Share2,
  Search,
  Timer,
  ArrowUpDown,
  X,
} from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import type { Track } from '../types/music';

interface PlaylistDetailViewProps {
  title: string;
  subtitle: string;
  coverUrl?: string;
  tracks: Track[];
  onBack: () => void;
  playlistId?: string;
  onRemoveTrack?: (trackId: string) => void;
  onDownloadAll?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onMoveTrack?: (from: number, to: number) => void;
}

const formatDuration = (secs: number) => {
  if (!secs || isNaN(secs)) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export const PlaylistDetailView: React.FC<PlaylistDetailViewProps> = ({
  title,
  subtitle,
  coverUrl,
  tracks,
  onBack,
  playlistId,
  onRemoveTrack,
  onDownloadAll,
  onRename,
  onDelete,
  onMoveTrack,
}) => {
  const { playQueue, currentTrack, isPlaying, isShuffle, toggleShuffle } = useAudio();
  const [selectedTrackForMenu, setSelectedTrackForMenu] = useState<Track | null>(null);
  const [showTopMenu, setShowTopMenu] = useState(false);
  const [isSortedAZ, setIsSortedAZ] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [isCheckSaved, setIsCheckSaved] = useState(true);

  // Compute total duration
  const totalDurationSecs = useMemo(() => {
    return tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  }, [tracks]);

  const formattedTotalTime = useMemo(() => {
    if (!totalDurationSecs) return '0m';
    const hrs = Math.floor(totalDurationSecs / 3600);
    const mins = Math.floor((totalDurationSecs % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }, [totalDurationSecs]);

  // Sort & Filter tracks
  const processedTracks = useMemo(() => {
    let list = [...tracks];
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      list = list.filter(
        t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
      );
    }
    if (isSortedAZ) {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [tracks, searchFilter, isSortedAZ]);

  const handlePlayAll = () => {
    if (processedTracks.length === 0) return;
    if (isShuffle) toggleShuffle();
    playQueue(processedTracks, 0);
  };

  const handleShuffleAll = () => {
    if (processedTracks.length === 0) return;
    if (!isShuffle) toggleShuffle();
    playQueue(processedTracks, 0);
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: title,
        text: `Check out playlist "${title}" on FRF Music!`,
      }).catch(() => {});
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto pb-52 bg-transparent text-white relative">
      <TrackOptionsMenuModal
        track={selectedTrackForMenu}
        playlistId={playlistId}
        onRemoveFromPlaylist={onRemoveTrack}
        onClose={() => setSelectedTrackForMenu(null)}
      />

      {/* Mobile-Native Playlist Options Bottom Sheet Modal */}
      {showTopMenu && (
        <div
          className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-end justify-center animate-in fade-in duration-150"
          onClick={() => setShowTopMenu(false)}
        >
          <div
            className="w-full max-w-md bg-zinc-900 border-t border-zinc-800 rounded-t-3xl px-6 pt-4 pb-28 shadow-2xl space-y-2 animate-in slide-in-from-bottom duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 rounded-full bg-zinc-700 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white text-center pb-3 border-b border-zinc-800/80 truncate">
              {title} Options
            </h3>
            {onRename && (
              <button
                onClick={() => {
                  setShowTopMenu(false);
                  onRename();
                }}
                className="w-full flex items-center gap-4 py-3.5 text-left border-b border-zinc-800/40 text-white hover:bg-white/5 px-2 rounded-xl transition-colors"
              >
                <Edit3 className="w-5 h-5 text-zinc-400" />
                <span className="text-base font-medium">Rename Playlist</span>
              </button>
            )}
            {onDownloadAll && (
              <button
                onClick={() => {
                  setShowTopMenu(false);
                  onDownloadAll();
                }}
                className="w-full flex items-center gap-4 py-3.5 text-left border-b border-zinc-800/40 text-white hover:bg-white/5 px-2 rounded-xl transition-colors"
              >
                <Download className="w-5 h-5 text-zinc-400" />
                <span className="text-base font-medium">Download All Tracks</span>
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => {
                  setShowTopMenu(false);
                  onDelete();
                }}
                className="w-full flex items-center gap-4 py-3.5 text-left text-red-400 hover:bg-red-500/10 px-2 rounded-xl transition-colors font-semibold"
              >
                <Trash2 className="w-5 h-5 text-red-400" />
                <span className="text-base font-medium">Delete Playlist</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. ARTWORK / GRADIENT HEADER (Matches Screenshot Gradient & Big Music Note) */}
      {/* ========================================================================= */}
      <div className="relative w-full h-80 shrink-0 bg-gradient-to-tr from-purple-900 via-pink-600 to-rose-500 flex items-center justify-center overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center transform hover:scale-105 transition-transform duration-500">
            <Music2 className="w-36 h-36 text-white/90 drop-shadow-2xl" strokeWidth={1.5} />
          </div>
        )}

        {/* Bottom Fade Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black" />

        {/* Top Header Buttons: Back & Three Dots */}
        <button
          onClick={onBack}
          className="absolute top-4 left-4 p-2 text-white/90 hover:text-white rounded-full bg-black/20 backdrop-blur-md active:scale-95 transition-all"
          title="Back"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <button
          onClick={() => setShowTopMenu(v => !v)}
          className="absolute top-4 right-4 p-2 text-white/90 hover:text-white rounded-full bg-black/20 backdrop-blur-md active:scale-95 transition-all"
          title="Playlist Options"
        >
          <MoreVertical className="w-6 h-6" />
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 2. ACTION ROW (Play, Queue, Shuffle, Check, Share) */}
      {/* ========================================================================= */}
      <div className="px-6 pt-3 flex items-center justify-start gap-7">
        <button
          onClick={handlePlayAll}
          className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg"
          title="Play All"
        >
          <Play className="w-5 h-5 fill-current ml-0.5" />
        </button>

        <button
          onClick={handleShuffleAll}
          className="p-1.5 text-zinc-300 hover:text-white active:scale-95 transition-transform"
          title="Shuffle Play"
        >
          <Shuffle className="w-6 h-6" />
        </button>

        <button
          onClick={handlePlayAll}
          className="p-1.5 text-zinc-300 hover:text-white active:scale-95 transition-transform"
          title="Queue Playlist"
        >
          <ListPlus className="w-6 h-6" />
        </button>

        <button
          onClick={() => setIsCheckSaved(v => !v)}
          className="p-1.5 text-zinc-300 hover:text-white active:scale-95 transition-transform"
          title="Saved to Library"
        >
          <Check className={`w-6 h-6 ${isCheckSaved ? 'text-white font-bold' : 'text-zinc-500'}`} />
        </button>

        <button
          onClick={handleShare}
          className="p-1.5 text-zinc-300 hover:text-white active:scale-95 transition-transform"
          title="Share Playlist"
        >
          <Share2 className="w-6 h-6" />
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 3. PLAYLIST TITLE & SUBTITLE */}
      {/* ========================================================================= */}
      <div className="px-6 pt-4">
        <h1 className="text-4xl font-bold text-white tracking-tight leading-tight">{title}</h1>
        <p className="text-sm font-medium text-zinc-400 mt-1">{subtitle || 'Library Playlist'}</p>
      </div>

      {/* ========================================================================= */}
      {/* 4. UTILITY & SORT BAR (0🎵 A-Z ⏱️ | ↓ 🔍 ⋮) */}
      {/* ========================================================================= */}
      <div className="px-6 pt-6 pb-3 flex items-center justify-between text-zinc-400 border-b border-zinc-900">
        {/* Left Side Controls */}
        <div className="flex items-center gap-4 text-xs font-semibold">
          <span className="flex items-center gap-1.5 text-zinc-300">
            <span>{tracks.length}</span>
            <Music2 className="w-3.5 h-3.5" />
          </span>

          <button
            onClick={() => setIsSortedAZ(v => !v)}
            className={`flex items-center gap-1 hover:text-white transition-colors ${
              isSortedAZ ? 'text-white font-bold' : ''
            }`}
            title="Sort A-Z"
          >
            <span>A-Z</span>
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>

          <span className="flex items-center gap-1 text-zinc-400">
            <Timer className="w-3.5 h-3.5" />
            <span>{formattedTotalTime}</span>
          </span>
        </div>

        {/* Right Side Controls */}
        <div className="flex items-center gap-4">
          {onDownloadAll && (
            <button
              onClick={onDownloadAll}
              className="p-1 hover:text-white transition-colors"
              title="Download All"
            >
              <Download className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setShowSearch(v => !v)}
            className="p-1 hover:text-white transition-colors"
            title="Search Playlist"
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowTopMenu(v => !v)}
            className="p-1 hover:text-white transition-colors"
            title="Options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Input Bar (if open) */}
      {showSearch && (
        <div className="px-6 py-2 bg-zinc-900/80 flex items-center gap-2 border-b border-zinc-800">
          <Search className="w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search tracks in playlist..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
            autoFocus
          />
          {searchFilter && (
            <button onClick={() => setSearchFilter('')} className="p-1 text-zinc-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. EMPTY PLAYLIST STATE OR TRACK LIST */}
      {/* ========================================================================= */}
      {tracks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-28">
          <p className="text-base font-medium text-zinc-500 tracking-wide">Empty playlist!</p>
        </div>
      ) : (
        <div className="px-2 pt-2 space-y-1">
          {processedTracks.map((t, idx) => {
            const isCurrent = currentTrack?.id === t.id;
            return (
              <div
                key={`${t.id}-${idx}`}
                onClick={() => playQueue(processedTracks, idx)}
                className="w-full flex items-center gap-3.5 p-2 rounded-xl text-left hover:bg-white/5 cursor-pointer transition-colors group"
              >
                <img
                  src={t.coverUrl}
                  alt={t.title}
                  loading="lazy"
                  className="w-13 h-13 rounded-lg object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-base font-semibold truncate ${isCurrent ? 'text-white font-bold' : 'text-zinc-100'}`}>
                    {t.title}
                  </p>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">{t.artist}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {onMoveTrack && (
                    <span className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={e => {
                          e.stopPropagation();
                          onMoveTrack(idx, idx - 1);
                        }}
                        className={`p-0.5 text-zinc-500 hover:text-white ${idx === 0 ? 'opacity-30' : ''}`}
                        title="Move up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={e => {
                          e.stopPropagation();
                          onMoveTrack(idx, idx + 1);
                        }}
                        className={`p-0.5 text-zinc-500 hover:text-white ${idx === processedTracks.length - 1 ? 'opacity-30' : ''}`}
                        title="Move down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </span>
                    </span>
                  )}

                  {isCurrent && isPlaying && (
                    <BarChart3 className="w-5 h-5 text-white fill-white/20 animate-pulse" />
                  )}

                  <span className="text-xs text-zinc-400 font-mono">{formatDuration(t.duration)}</span>

                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedTrackForMenu(t);
                    }}
                    className="p-1.5 text-zinc-400 hover:text-white"
                    title="More Options"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
