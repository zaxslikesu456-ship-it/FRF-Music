import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { t as tr } from '../i18n';
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
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { fetchSimilarSongs, fetchArtistTopSongs } from '../utils/ytMusicApi';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import { encodeShareCode, shareMessage, songFromTrack } from '../utils/playlistShare';
import { copyText } from '../utils/clipboard';
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

// Each playlist's last suggestions (by its song list), kept while the app runs.
const suggestionCache = new Map<string, { track: Track; reason: string }[]>();

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
    searchYTMusic,
    addTrackToPlaylist,
    addTrackToLibrary,
  } = useAudio();

  const [selectedTrackForMenu, setSelectedTrackForMenu] = useState<Track | null>(null);
  const [showTopMenu, setShowTopMenu] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const [isSortedAZ, setIsSortedAZ] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [isCheckSaved, setIsCheckSaved] = useState(true);

  // Persistent added & removed tracks so added songs NEVER disappear or flash
  const [addedTracks, setAddedTracks] = useState<Track[]>([]);
  const [removedTrackIds, setRemovedTrackIds] = useState<Set<string>>(new Set());

  // Merge tracks prop with addedTracks
  const allActiveTracks = useMemo(() => {
    const base = tracks.filter(t => !removedTrackIds.has(t.id));
    const baseIds = new Set(base.map(t => t.id));
    const extra = addedTracks.filter(t => !baseIds.has(t.id) && !removedTrackIds.has(t.id));
    return [...base, ...extra];
  }, [tracks, addedTracks, removedTrackIds]);

  // Suggested Songs State
  const [suggestedTracks, setSuggestedTracks] = useState<{ track: Track; reason: string }[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [addedTrackIds, setAddedTrackIds] = useState<Set<string>>(new Set());

  // Fixed authentic playlist cover: never replaced by random added songs, never unsplash photo
  const playlistCover = useMemo(() => {
    if (coverUrl && !coverUrl.includes('unsplash')) return coverUrl;
    if (tracks && tracks.length > 0 && tracks[0]?.coverUrl && !tracks[0].coverUrl.includes('unsplash')) {
      return tracks[0].coverUrl;
    }
    return '';
  }, [coverUrl, tracks]);

  // Compute total duration
  const totalDurationSecs = useMemo(() => {
    return allActiveTracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  }, [allActiveTracks]);

  const formattedTotalTime = useMemo(() => {
    if (!totalDurationSecs) return '0m';
    const hrs = Math.floor(totalDurationSecs / 3600);
    const mins = Math.floor((totalDurationSecs % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }, [totalDurationSecs]);

  // Sort & Filter tracks
  const processedTracks = useMemo(() => {
    let list = [...allActiveTracks];
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
  }, [allActiveTracks, searchFilter, isSortedAZ]);

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

  // Shares the whole playlist as a code that can be pasted in any chat and imported
  // from Library > Import playlist. The code is also copied, so it still works
  // when the phone has no share sheet.
  const handleShare = async () => {
    const songs = processedTracks.filter(t => t.youtubeId || t.title).map(songFromTrack);
    if (songs.length === 0) return;
    const code = await encodeShareCode({ name: title, songs });
    const message = shareMessage(title, songs.length, code);
    const copied = await copyText(message);
    const canShare = typeof navigator.share === 'function';
    setShareNote(
      copied
        ? `Copied! Share it with a friend (${songs.length} songs)`
        : canShare
          ? 'Choose where to send the playlist'
          : 'Could not copy the share code'
    );
    window.setTimeout(() => setShareNote(''), 3500);
    if (canShare) {
      navigator.share({ title, text: message }).catch(() => {});
    }
  };

  // Suggestions that match this playlist: popular songs by its own artists,
  // then YouTube Music's radio ("songs like this") for a few of its songs.
  //
  // This used to restart on every player update — the search function it
  // depended on is recreated on each render, so every song switch (and every
  // playback tick) fetched again with different seeds and replaced the list.
  // Now it only runs when the playlist changes or you tap Refresh, all requests
  // run at once, results show as soon as the first ones arrive, a newer run
  // makes an older one's late results be ignored, and the list is remembered
  // for the playlist so reopening it is instant.
  const suggestionRoundRef = React.useRef(0);
  const suggestionRunRef = React.useRef(0);
  const allActiveTracksRef = React.useRef(allActiveTracks);
  allActiveTracksRef.current = allActiveTracks;
  const searchRef = React.useRef(searchYTMusic);
  searchRef.current = searchYTMusic;
  const playlistKey = tracks.map(t => t.id).join('|');

  const fetchSuggestions = useCallback(async (useCache = false) => {
    const current = allActiveTracksRef.current;
    const run = ++suggestionRunRef.current;
    const isLatest = () => run === suggestionRunRef.current;
    if (current.length === 0) {
      setSuggestedTracks([]);
      setIsLoadingSuggestions(false);
      return;
    }
    const cacheKey = current.map(t => t.id).join('|');
    if (useCache) {
      const cached = suggestionCache.get(cacheKey);
      if (cached) {
        setSuggestedTracks(cached);
        setIsLoadingSuggestions(false);
        return;
      }
    }
    setIsLoadingSuggestions(true);

    const existingIds = new Set(current.map(t => t.id));
    const existingKeys = new Set(current.map(t => `${t.title}|${t.artist}`.toLowerCase()));
    const isNew = (t: Track) =>
      !existingIds.has(t.id) && !existingKeys.has(`${t.title}|${t.artist}`.toLowerCase());

    // Seeds: three songs spread across the playlist, different on each Refresh.
    const pool = current.filter(t => t.youtubeId);
    const round = suggestionRoundRef.current++;
    const step = Math.max(1, Math.floor(pool.length / 3));
    const seeds: Track[] = [];
    for (let k = 0; k < Math.min(3, pool.length); k++) {
      const s = pool[(round + k * step) % pool.length];
      if (!seeds.includes(s)) seeds.push(s);
    }

    // The playlist's own artists, by how much of the playlist they make up.
    const artistCounts: Record<string, number> = {};
    current.forEach(t => {
      const a = (t.artist || '').split(/,|&| feat\.? | ft\.? /i)[0].trim();
      if (a && !['Unknown Artist', 'YouTube Artist', 'Local Audio'].includes(a)) {
        artistCounts[a] = (artistCounts[a] || 0) + 1;
      }
    });
    const playlistArtists = Object.keys(artistCounts).sort((a, b) => artistCounts[b] - artistCounts[a]);
    const playlistArtistSet = new Set(playlistArtists.map(a => a.toLowerCase()));
    const byPlaylistArtist = (t: Track) =>
      t.artist.toLowerCase().split(/,|&| feat\.? | ft\.? /i).some(a => playlistArtistSet.has(a.trim()));
    // Up to three artists (rotating on Refresh).
    const artistPick = playlistArtists.length
      ? Array.from({ length: Math.min(3, playlistArtists.length) }, (_, k) => playlistArtists[(round + k) % playlistArtists.length])
      : [];

    // Everything is requested at once; the list is rebuilt as each answer arrives.
    const topLists: (Track[] | undefined)[] = artistPick.map(() => undefined);
    const radios: (Track[] | undefined)[] = seeds.map(() => undefined);

    const compose = (): { track: Track; reason: string }[] => {
      const suggestions: { track: Track; reason: string }[] = [];
      const taken = new Set<string>();
      const push = (t: Track, reason: string) => {
        if (taken.has(t.id) || !isNew(t)) return false;
        taken.add(t.id);
        suggestions.push({ track: t, reason });
        return true;
      };
      // About six from the playlist's artists, taking turns so one doesn't take over.
      const queues = topLists.map((list, k) => ({ artist: artistPick[k], songs: (list || []).filter(isNew) }));
      let added = 0;
      for (let pass = 0; added < 6 && queues.some(q => q.songs.length > 0) && pass < 10; pass++) {
        for (const q of queues) {
          const t = q.songs.shift();
          if (t && push(t, tr('More from {artist}', { artist: q.artist }))) added++;
          if (added >= 6) break;
        }
      }
      // The rest: the closest radio songs (several seeds agreeing ranks higher;
      // the playlist's own artists count double), at most two per artist.
      const scored = new Map<string, { track: Track; score: number; seed: Track }>();
      radios.forEach((list, i) => {
        (list || []).forEach((t, pos) => {
          if (!isNew(t)) return;
          const add = (1 + 0.5 * (1 - Math.min(pos, 50) / 50)) * (byPlaylistArtist(t) ? 2 : 1);
          const prev = scored.get(t.id);
          if (prev) prev.score += add;
          else scored.set(t.id, { track: t, score: add, seed: seeds[i] });
        });
      });
      const perArtist: Record<string, number> = {};
      for (const x of [...scored.values()].sort((a, b) => b.score - a.score)) {
        if (suggestions.length >= 10) break;
        const a = x.track.artist.toLowerCase();
        if ((perArtist[a] || 0) >= 2) continue;
        if (push(x.track, tr('Like "{song}"', { song: x.seed.title }))) perArtist[a] = (perArtist[a] || 0) + 1;
      }
      return suggestions;
    };

    const show = () => {
      if (!isLatest()) return;
      const list = compose();
      if (list.length > 0) setSuggestedTracks(list);
    };

    await Promise.allSettled([
      ...artistPick.map((a, k) =>
        fetchArtistTopSongs(a)
          .then(list => {
            topLists[k] = list;
          })
          .catch(() => {
            topLists[k] = [];
          })
          .finally(show)
      ),
      ...seeds.map((s, i) =>
        fetchSimilarSongs(s.youtubeId!)
          .then(list => {
            radios[i] = list;
          })
          .catch(() => {
            radios[i] = [];
          })
          .finally(show)
      ),
    ]);
    if (!isLatest()) return;

    let final = compose();
    // Nothing from YouTube Music at all: search the main artist.
    if (final.length === 0 && playlistArtists[0]) {
      const found = await searchRef.current(playlistArtists[0]).catch(() => [] as Track[]);
      if (!isLatest()) return;
      final = found
        .filter(isNew)
        .slice(0, 10)
        .map(t => ({ track: t, reason: tr('More from {artist}', { artist: playlistArtists[0] }) }));
    }
    setSuggestedTracks(final);
    if (final.length > 0) suggestionCache.set(cacheKey, final);
    setIsLoadingSuggestions(false);
  }, []);

  // Only when the playlist's songs change (opening it, adding a song) — not on
  // every player update. Reopening a playlist shows its remembered list.
  useEffect(() => {
    suggestionRoundRef.current = 0;
    void fetchSuggestions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistKey]);
  useEffect(
    () => () => {
      // Leaving the playlist: drop any answers still on the way.
      suggestionRunRef.current++;
    },
    []
  );

  const handleAddSuggested = (track: Track) => {
    // 1. Persist in local added tracks state so it stays in UI forever
    setAddedTracks(prev => {
      if (prev.some(t => t.id === track.id)) return prev;
      return [...prev, track];
    });
    setRemovedTrackIds(prev => {
      const next = new Set(prev);
      next.delete(track.id);
      return next;
    });

    // 2. Register with user library
    addTrackToLibrary(track);

    // 3. Save to playlist
    if (playlistId) {
      addTrackToPlaylist(playlistId, track);
    }
    if (onAddTrack) {
      onAddTrack(track);
    }

    // 4. Mark track as added in UI
    setAddedTrackIds(prev => new Set(prev).add(track.id));
  };

  const handleRemoveTrackItem = (trackId: string) => {
    setRemovedTrackIds(prev => new Set(prev).add(trackId));
    setAddedTracks(prev => prev.filter(t => t.id !== trackId));
    if (onRemoveTrack) {
      onRemoveTrack(trackId);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto pb-52 bg-transparent text-white relative">
      <TrackOptionsMenuModal
        track={selectedTrackForMenu}
        onClose={() => setSelectedTrackForMenu(null)}
        onRemoveFromPlaylist={onRemoveTrack ? handleRemoveTrackItem : undefined}
      />

      {/* ========================================================================= */}
      {/* 1. HERO COVER & TOP NAVIGATION */}
      {/* ========================================================================= */}
      <div className="relative h-84 sm:h-96 shrink-0 overflow-hidden select-none">
        {/* Ambient Blur Backdrop */}
        {playlistCover ? (
          <img
            src={playlistCover}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-70"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/60 via-zinc-950/90 to-black" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-black" />

        {/* Top Back & Actions Row (Safely lowered below iPhone Dynamic Island / Notch) */}
        <div className="absolute top-[calc(max(env(safe-area-inset-top,0px),48px)+12px)] inset-x-4 flex items-center justify-between z-10">
          <button
            onClick={onBack}
            className="p-3 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 active:scale-95 transition-all shadow-lg"
            title={tr("Back")}
          >
            <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
          </button>

          <div className="flex items-center gap-2">
            {onRename && (
              <button
                onClick={onRename}
                className="p-2.5 rounded-full bg-black/50 backdrop-blur-md text-zinc-300 hover:text-white active:scale-95 transition-all"
                title={tr("Rename Playlist")}
              >
                <Edit3 className="w-4 h-4" />
              </button>
            )}

            {onDelete && (
              <button
                onClick={onDelete}
                className="p-2.5 rounded-full bg-black/50 backdrop-blur-md text-zinc-300 hover:text-red-400 active:scale-95 transition-all"
                title={tr("Delete Playlist")}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setShowTopMenu(v => !v)}
                className="p-2.5 rounded-full bg-black/50 backdrop-blur-md text-zinc-300 hover:text-white active:scale-95 transition-all"
                title={tr("Playlist Options")}
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              {showTopMenu && (
                <div
                  className="absolute right-0 mt-2 w-48 rounded-2xl bg-zinc-900/95 border border-white/10 p-1.5 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl"
                  onClick={e => e.stopPropagation()}
                >
                  {onDownloadAll && (
                    <button
                      onClick={() => {
                        setShowTopMenu(false);
                        onDownloadAll();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left text-xs font-semibold text-zinc-200"
                    >
                      <Download className="w-4 h-4" />
                      <span>{tr("Download All")}</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setShowTopMenu(false);
                      handleShare();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left text-xs font-semibold text-zinc-200"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>{tr("Share Playlist")}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center Artwork Thumbnail */}
        <div className="absolute inset-0 flex items-center justify-center pt-8 pointer-events-none">
          <div className="w-36 h-36 sm:w-40 sm:h-40 rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] border border-white/10 bg-zinc-900/90 flex items-center justify-center">
            {playlistCover ? (
              <img src={playlistCover} alt={title} className="w-full h-full object-cover" />
            ) : (
              <Music2 className="w-14 h-14 text-zinc-600 stroke-[1.5]" />
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. PLAYBACK ACTION BAR */}
      {/* ========================================================================= */}
      <div className="px-6 pt-2 flex items-center justify-between">
        <button
          onClick={handlePlayAll}
          disabled={allActiveTracks.length === 0}
          className="w-12 h-12 rounded-full bg-app-highlight text-app-inverse flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg disabled:opacity-40"
          title={tr("Play All")}
        >
          <Play className="w-5 h-5 fill-current ml-0.5" />
        </button>

        <button
          onClick={handleShuffleAll}
          disabled={allActiveTracks.length === 0}
          className="p-2 text-zinc-300 hover:text-white active:scale-95 transition-transform disabled:opacity-40"
          title={tr("Shuffle Play")}
        >
          <Shuffle className="w-6 h-6" />
        </button>

        <button
          onClick={handlePlayAll}
          disabled={allActiveTracks.length === 0}
          className="p-2 text-zinc-300 hover:text-white active:scale-95 transition-transform disabled:opacity-40"
          title={tr("Queue Playlist")}
        >
          <ListPlus className="w-6 h-6" />
        </button>

        <button
          onClick={() => {
            setIsCheckSaved(v => !v);
            allActiveTracks.forEach(t => addTrackToLibrary(t));
          }}
          className="p-2 text-zinc-300 hover:text-white active:scale-95 transition-transform"
          title={tr("Saved to Library")}
        >
          <Check className={`w-6 h-6 ${isCheckSaved ? 'text-white font-bold' : 'text-zinc-500'}`} />
        </button>

        <button
          onClick={handleShare}
          className="p-2 text-zinc-300 hover:text-white active:scale-95 transition-transform"
          title={tr("Share Playlist")}
        >
          <Share2 className="w-6 h-6" />
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 3. PLAYLIST TITLE & SUBTITLE */}
      {/* ========================================================================= */}
      <div className="px-6 pt-4">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
          {title}
        </h1>
        <p className="text-sm font-semibold text-zinc-400 mt-1 uppercase tracking-wider">
          {subtitle || 'Library Playlist'}
        </p>
      </div>

      {/* ========================================================================= */}
      {/* 4. UTILITY & SORT BAR (0🎵 A-Z ⏱️ | ↓ 🔍 ⋮) */}
      {/* ========================================================================= */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between text-zinc-400 border-b border-white/5">
        {/* Left Side Controls */}
        <div className="flex items-center gap-4 text-xs font-semibold">
          <span className="flex items-center gap-1.5 text-zinc-200">
            <span>{allActiveTracks.length}</span>
            <Music2 className="w-3.5 h-3.5" />
          </span>

          <button
            onClick={() => setIsSortedAZ(v => !v)}
            className={`flex items-center gap-1 transition-colors ${
              isSortedAZ ? 'text-white font-bold' : 'hover:text-white'
            }`}
            title={tr("Sort A-Z")}
          >
            <span>{tr("A-Z")}</span>
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>

          <span className="flex items-center gap-1 text-zinc-400">
            <Timer className="w-3.5 h-3.5" />
            <span>{formattedTotalTime}</span>
          </span>
        </div>

        {/* Right Side Controls */}
        <div className="flex items-center gap-3">
          {onDownloadAll && (
            <button
              onClick={onDownloadAll}
              className="p-1.5 hover:text-white transition-colors"
              title={tr("Download All")}
            >
              <Download className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setShowSearch(v => !v)}
            className={`p-1.5 rounded-lg transition-colors ${
              showSearch ? 'bg-app-highlight text-app-inverse' : 'hover:text-white'
            }`}
            title={tr("Search Playlist")}
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowTopMenu(v => !v)}
            className="p-1.5 hover:text-white transition-colors"
            title={tr("Options")}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {shareNote && (
        <div className="mx-6 mb-2 px-4 py-2 rounded-xl bg-app-highlight text-app-inverse text-xs font-semibold text-center">
          {shareNote}
        </div>
      )}

      {/* Search Input Bar (if open) */}
      {showSearch && (
        <div className="px-6 py-2 bg-zinc-900/80 flex items-center gap-2 border-b border-white/10 animate-in fade-in duration-150">
          <Search className="w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder={tr("Search tracks in playlist...")}
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
            autoFocus
          />
          {searchFilter && (
            <button onClick={() => setSearchFilter('')} className="p-1 text-zinc-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. EMPTY PLAYLIST STATE OR TRACK LIST */}
      {/* ========================================================================= */}
      {allActiveTracks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center px-4">
          <Music2 className="w-12 h-12 text-zinc-600 mb-3" />
          <p className="text-base font-semibold text-zinc-400">{tr("Empty playlist!")}</p>
          <p className="text-xs text-zinc-500 mt-1">{tr("Check out suggested songs below to add tracks.")}</p>
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
                  <p className={`text-sm sm:text-base font-semibold truncate ${isCurrent ? 'text-app-accent font-bold' : 'text-zinc-100'}`}>
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
                        title={tr("Move up")}
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
                        title={tr("Move down")}
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
                        handleRemoveTrackItem(t.id);
                      }}
                      className="p-1.5 text-zinc-500 hover:text-red-400"
                      title={tr("Remove from Playlist")}
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
                    title={tr("More Options")}
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
      {/* 6. SUGGESTED SONGS SECTION (Clean Dark Aesthetic) */}
      {/* ========================================================================= */}
      <div className="mt-8 pt-6 border-t border-white/10 px-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
              {tr("Suggested Songs")}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">{tr("Recommended tracks matching this playlist")}</p>
          </div>

          <button
            onClick={() => void fetchSuggestions()}
            disabled={isLoadingSuggestions}
            className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white px-3 py-1.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700 active:scale-95 transition-all disabled:opacity-50"
            title={tr("Refresh Recommendations")}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSuggestions ? 'animate-spin' : ''}`} />
            <span>{isLoadingSuggestions ? 'Finding...' : 'Refresh'}</span>
          </button>
        </div>

        {isLoadingSuggestions && suggestedTracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-zinc-500">
            <RefreshCw className="w-5 h-5 animate-spin text-zinc-400" />
            <p className="text-xs">{tr("Discovering matching tracks...")}</p>
          </div>
        ) : suggestedTracks.length === 0 ? (
          <div className="p-5 text-center bg-zinc-900/40 rounded-xl border border-white/5">
            <p className="text-xs text-zinc-500">{tr("No suggestions right now. Tap Refresh to discover more.")}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {suggestedTracks.map(({ track: t, reason }) => {
              const inPlaylist = addedTrackIds.has(t.id) || allActiveTracks.some((x: Track) => x.id === t.id);

              return (
                <div
                  key={t.id}
                  className="p-2.5 rounded-xl bg-zinc-900/60 hover:bg-zinc-800/80 border border-white/5 flex items-center justify-between transition-colors group"
                >
                  <div
                    onClick={() => playQueue(suggestedTracks.map(x => x.track), suggestedTracks.findIndex(x => x.track.id === t.id))}
                    className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                  >
                    <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 border border-white/5">
                      <img
                        src={t.coverUrl}
                        alt={t.title}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Play className="w-3.5 h-3.5 text-white fill-white" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{t.title}</p>
                      <p className="text-xs text-zinc-400 truncate">{t.artist}</p>
                      <p className="text-[10px] text-zinc-500 truncate mt-0.5">{reason}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pl-2">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedTrackForMenu(t);
                      }}
                      className="p-1.5 text-zinc-500 hover:text-white rounded"
                      title={tr("Track Options")}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {inPlaylist ? (
                      <span className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-400 text-xs font-semibold">
                        <Check className="w-3.5 h-3.5 text-zinc-300" />
                        <span>{tr("Added")}</span>
                      </span>
                    ) : (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleAddSuggested(t);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-app-highlight text-app-inverse hover:scale-105 text-xs font-semibold active:scale-95 transition-all shadow-md"
                        title={tr("Add to playlist")}
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>{tr("Add")}</span>
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
