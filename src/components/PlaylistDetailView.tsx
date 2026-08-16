import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
  Check,
  Share2,
  Search,
  ArrowUpDown,
  X,
  Sparkles,
  RefreshCw,
  Plus,
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
  onAddTrack?: (track: Track) => void;
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
  onAddTrack,
}) => {
  const {
    playQueue,
    currentTrack,
    isPlaying,
    isShuffle,
    toggleShuffle,
    tracks: allLibraryTracks,
    recentlyPlayed,
    favorites,
    searchYTMusic,
    playTrack,
    addTrackToPlaylist,
    playlists,
  } = useAudio();

  const [selectedTrackForMenu, setSelectedTrackForMenu] = useState<Track | null>(null);
  const [showTopMenu, setShowTopMenu] = useState(false);
  const [isSortedAZ, setIsSortedAZ] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  // Suggested Songs State
  const [suggestedTracks, setSuggestedTracks] = useState<{ track: Track; reason: string }[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [addedTrackIds, setAddedTrackIds] = useState<Set<string>>(new Set());

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

  // Fetch smart suggestions based on playlist tracks and user listening history
  const fetchSuggestions = useCallback(async () => {
    setIsLoadingSuggestions(true);
    try {
      const existingIds = new Set(tracks.map(t => t.id));
      const playlistArtists = tracks.map(t => t.artist).filter(Boolean);
      const recentArtists = (recentlyPlayed || []).map(t => t.artist).filter(Boolean);
      const favArtists = (allLibraryTracks || []).filter(t => favorites.includes(t.id)).map(t => t.artist);

      // Collect artist mentions with weighting
      const artistCounts: Record<string, number> = {};
      [...playlistArtists, ...playlistArtists, ...recentArtists, ...favArtists].forEach(a => {
        if (a && a !== 'Unknown Artist' && a !== 'YouTube Artist' && a !== 'Local Audio') {
          artistCounts[a] = (artistCounts[a] || 0) + 1;
        }
      });

      const topArtists = Object.keys(artistCounts).sort((a, b) => artistCounts[b] - artistCounts[a]);
      const suggestions: { track: Track; reason: string }[] = [];
      const seenIds = new Set<string>();

      // 1. First add matching tracks from library not yet in playlist
      allLibraryTracks.forEach(t => {
        if (!existingIds.has(t.id) && !seenIds.has(t.id)) {
          if (topArtists.some(art => t.artist.toLowerCase().includes(art.toLowerCase()))) {
            seenIds.add(t.id);
            suggestions.push({ track: t, reason: `From your library • ${t.artist}` });
          }
        }
      });

      // 2. Fetch fresh tracks from YT Music
      const searchQueries = topArtists.length > 0
        ? topArtists.slice(0, 3).map(a => ({ query: `${a} popular songs`, reason: `Similar to ${a}` }))
        : [
            { query: `${title} music playlist songs`, reason: 'Based on playlist mood' },
            { query: 'top trending hits 2026', reason: 'Trending now' },
          ];

      for (const { query, reason } of searchQueries.slice(0, 2)) {
        try {
          const results = await searchYTMusic(query);
          for (const item of results) {
            if (!existingIds.has(item.id) && !seenIds.has(item.id) && suggestions.length < 12) {
              seenIds.add(item.id);
              suggestions.push({ track: item, reason });
            }
          }
        } catch {
          // ignore
        }
      }

      setSuggestedTracks(suggestions.slice(0, 10));
    } catch {
      // ignore
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [tracks, recentlyPlayed, favorites, allLibraryTracks, title, searchYTMusic]);

  useEffect(() => {
    void fetchSuggestions();
  }, [fetchSuggestions]);

  const handleAddSuggested = (track: Track) => {
    if (playlistId) {
      addTrackToPlaylist(playlistId, track);
      setAddedTrackIds(prev => new Set(prev).add(track.id));
    } else if (onAddTrack) {
      onAddTrack(track);
      setAddedTrackIds(prev => new Set(prev).add(track.id));
    }
  };

  const targetPlaylist = playlistId ? playlists.find(p => p.id === playlistId) : null;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto pb-52 bg-transparent text-white relative">
      <TrackOptionsMenuModal
        track={selectedTrackForMenu}
        onClose={() => setSelectedTrackForMenu(null)}
      />

      {/* TOP BAR / NAVIGATION */}
      <div className="flex items-center justify-between px-4 py-3 sticky top-0 z-30 bg-black/40 backdrop-blur-md">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-white/10 active:scale-95 transition-all text-white"
          title="Back"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <div className="flex items-center gap-1">
          {onRename && (
            <button
              onClick={onRename}
              className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all text-zinc-300 hover:text-white"
              title="Edit Playlist Details"
            >
              <Edit3 className="w-5 h-5" />
            </button>
          )}

          {onDelete && (
            <button
              onClick={onDelete}
              className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all text-zinc-300 hover:text-red-400"
              title="Delete Playlist"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}

          <div className="relative">
            <button
              onClick={() => setShowTopMenu(v => !v)}
              className="p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all text-zinc-300 hover:text-white"
              title="More Actions"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {showTopMenu && (
              <div
                className="absolute right-0 mt-2 w-56 rounded-2xl bg-zinc-900/95 border border-white/10 p-2 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl"
                onClick={e => e.stopPropagation()}
              >
                {onDownloadAll && (
                  <button
                    onClick={() => {
                      setShowTopMenu(false);
                      onDownloadAll();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left text-sm text-zinc-200"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download All Songs</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    setShowTopMenu(false);
                    handleShare();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left text-sm text-zinc-200"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Share Playlist</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* HERO HEADER */}
      <div className="px-5 pt-2 pb-6 flex gap-5 items-center">
        <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl overflow-hidden shadow-2xl bg-zinc-900 border border-white/10 shrink-0 relative flex items-center justify-center">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <Music2 className="w-12 h-12 text-zinc-600" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight truncate leading-tight">
            {title}
          </h1>
          <p className="text-sm text-zinc-400 mt-1 line-clamp-2">{subtitle}</p>

          <div className="flex items-center gap-2 mt-3 text-xs text-zinc-400 font-medium">
            <span>{tracks.length} songs</span>
            <span>•</span>
            <span>{formattedTotalTime}</span>
          </div>
        </div>
      </div>

      {/* ACTION BAR (Play, Shuffle, Filter) */}
      <div className="px-5 py-3 flex items-center justify-between border-y border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={handlePlayAll}
            disabled={tracks.length === 0}
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-white text-black font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-lg disabled:opacity-40"
          >
            <Play className="w-4 h-4 fill-black" />
            <span>Play</span>
          </button>

          <button
            onClick={handleShuffleAll}
            disabled={tracks.length === 0}
            className="p-3 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-white active:scale-95 transition-all disabled:opacity-40"
            title="Shuffle"
          >
            <Shuffle className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSearch(v => !v)}
            className={`p-2.5 rounded-full transition-all ${
              showSearch ? 'bg-white text-black' : 'bg-zinc-800/80 text-zinc-300 hover:text-white'
            }`}
            title="Search in playlist"
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsSortedAZ(v => !v)}
            className={`p-2.5 rounded-full transition-all ${
              isSortedAZ ? 'bg-white text-black' : 'bg-zinc-800/80 text-zinc-300 hover:text-white'
            }`}
            title="Sort A-Z"
          >
            <ArrowUpDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* FILTER SEARCH INPUT */}
      {showSearch && (
        <div className="px-5 pt-3 animate-in fade-in duration-200">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-3.5 text-zinc-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              placeholder="Find in playlist..."
              className="w-full bg-zinc-900/90 border border-white/10 rounded-xl py-2 pl-10 pr-9 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/30"
              autoFocus
            />
            {searchFilter && (
              <button
                onClick={() => setSearchFilter('')}
                className="absolute right-3 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* TRACKS LIST */}
      {tracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <Music2 className="w-12 h-12 text-zinc-600 mb-3" />
          <p className="text-base font-semibold text-zinc-300">This playlist is empty</p>
          <p className="text-xs text-zinc-500 mt-1">Check out the suggested songs below to start building it!</p>
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
                  className="w-12 h-12 rounded-lg object-cover shrink-0 border border-white/5"
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

                  {onRemoveTrack && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => {
                        e.stopPropagation();
                        onRemoveTrack(t.id);
                      }}
                      className="p-1.5 text-zinc-400 hover:text-red-400"
                      title="Remove from Playlist"
                    >
                      <Trash2 className="w-4 h-4" />
                    </span>
                  )}

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

      {/* ========================================================================= */}
      {/* 🌟 SUGGESTED SONGS SECTION (Personalized Recommendations at the bottom) */}
      {/* ========================================================================= */}
      <div className="mt-8 pt-6 border-t border-white/10 px-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
            <h2 className="text-sm font-bold tracking-wider text-zinc-200 uppercase font-mono">
              Suggested Songs
            </h2>
          </div>

          <button
            onClick={() => void fetchSuggestions()}
            disabled={isLoadingSuggestions}
            className="flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-white px-2.5 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 active:scale-95 transition-all disabled:opacity-50"
            title="Refresh Recommendations"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSuggestions ? 'animate-spin' : ''}`} />
            <span>{isLoadingSuggestions ? 'Finding...' : 'Refresh'}</span>
          </button>
        </div>

        <p className="text-xs text-zinc-400">
          Based on the artists in this playlist and songs you listen to.
        </p>

        {isLoadingSuggestions && suggestedTracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-500">
            <RefreshCw className="w-6 h-6 animate-spin text-purple-400" />
            <p className="text-xs font-mono">Discovering matching songs...</p>
          </div>
        ) : suggestedTracks.length === 0 ? (
          <div className="p-6 text-center bg-zinc-900/40 rounded-2xl border border-white/5">
            <p className="text-xs text-zinc-500">No suggestions right now. Tap Refresh to try again.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {suggestedTracks.map(({ track: t, reason }) => {
              const inPlaylist = (targetPlaylist?.trackIds.includes(t.id)) || addedTrackIds.has(t.id);

              return (
                <div
                  key={t.id}
                  className="p-2.5 rounded-2xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-white/5 hover:border-purple-500/30 flex items-center justify-between transition-all group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <img
                      src={t.coverUrl}
                      alt={t.title}
                      className="w-11 h-11 rounded-xl object-cover border border-white/5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{t.title}</p>
                      <p className="text-xs text-zinc-400 truncate">{t.artist}</p>
                      <p className="text-[10px] text-purple-400/90 font-medium truncate mt-0.5">
                        ✨ {reason}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pl-2">
                    {/* Play Preview Button */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        playTrack(t);
                      }}
                      className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-white text-zinc-200 hover:text-black flex items-center justify-center transition-all active:scale-95"
                      title="Play Song"
                    >
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    </button>

                    {/* 3-Dot Options Button */}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedTrackForMenu(t);
                      }}
                      className="p-1.5 text-zinc-400 hover:text-white"
                      title="Track Options"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {/* Add to Playlist Button */}
                    {inPlaylist ? (
                      <span className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-zinc-800 text-zinc-400 text-xs font-mono font-bold">
                        <Check className="w-3 h-3 text-green-400" />
                        <span>Added</span>
                      </span>
                    ) : (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleAddSuggested(t);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white text-black hover:bg-purple-300 text-xs font-bold font-mono active:scale-95 transition-all shadow-md"
                        title="Add to this playlist"
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[3]" />
                        <span>Add</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
