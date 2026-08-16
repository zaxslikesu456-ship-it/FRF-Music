import React, { useState, useEffect, useCallback } from 'react';
import { Plus, ListMusic, Heart, Play, Trash2, Edit3, ChevronLeft, X, Music, Disc, ArrowUp, ArrowDown, GripVertical, MoreVertical, Sparkles, RefreshCw } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import type { Playlist, Track } from '../types/music';

// 2x2 Grid Collage Cover Component for Playlists
const PlaylistCollageIcon: React.FC<{ tracks: Track[] }> = ({ tracks }) => {
  const covers = tracks.slice(0, 4).map(t => t.coverUrl);

  if (covers.length >= 4) {
    return (
      <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-2xl border border-app-theme shadow-md">
        {covers.map((url, idx) => (
          <img key={idx} src={url} alt="Cover" className="w-full h-full object-cover" />
        ))}
      </div>
    );
  }

  if (covers.length > 0) {
    return (
      <div className="w-full h-full overflow-hidden rounded-2xl border border-app-theme shadow-md relative">
        <img src={covers[0]} alt="Cover" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/20" />
      </div>
    );
  }

  return (
    <div className="w-full h-full rounded-2xl bg-app-surface border border-app-theme flex items-center justify-center text-app-primary shadow-md">
      <Disc className="w-8 h-8 stroke-[1.5]" />
    </div>
  );
};

export const PlaylistsView: React.FC = () => {
  const {
    playlists,
    tracks,
    favorites,
    trackStore,
    downloadedTracks,
    favoriteTracks: favTrackObjs,
    recentlyPlayed,
    searchYTMusic,
    playTrack,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    playPlaylist,
    playQueue,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    reorderPlaylistTracks,
  } = useAudio();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');

  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  // Selected Playlist for FULL SCREEN Playlist View
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [showAddMusicModal, setShowAddMusicModal] = useState(false);
  const [selectedTrackForMenu, setSelectedTrackForMenu] = useState<Track | null>(null);

  // Drag & Drop reordering state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    createPlaylist(newPlaylistName.trim(), newPlaylistDesc.trim());
    setNewPlaylistName('');
    setNewPlaylistDesc('');
    setShowCreateModal(false);
  };

  const handleSaveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlaylist || !editName.trim()) return;
    renamePlaylist(editingPlaylist.id, editName.trim(), editDesc.trim());
    setEditingPlaylist(null);
  };

  const handleDelete = (playlistId: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete playlist "${name}"?`)) {
      deletePlaylist(playlistId);
      if (selectedPlaylistId === playlistId) setSelectedPlaylistId(null);
    }
  };

  const selectedPlaylist = playlists.find(p => p.id === selectedPlaylistId);
  const favoriteTracks = tracks.filter(t => favorites.includes(t.id));

  // Compute tracks strictly in order of selectedPlaylist.trackIds
  const playlistTracks = React.useMemo(() => {
    if (selectedPlaylistId === 'favorites') {
      return tracks.filter(t => favorites.includes(t.id));
    }
    if (!selectedPlaylist) return [];

    return selectedPlaylist.trackIds
      .map(id => trackStore[id] || tracks.find(t => t.id === id) || downloadedTracks.find(t => t.id === id) || favTrackObjs.find(t => t.id === id))
      .filter((t): t is Track => t !== undefined);
  }, [selectedPlaylistId, selectedPlaylist, tracks, favorites, trackStore, downloadedTracks, favTrackObjs]);

  // Recommended Songs State for Selected Playlist
  const [recommendedTracks, setRecommendedTracks] = useState<{ track: Track; topic: string }[]>([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);

  const fetchRecommendations = useCallback(async () => {
    if (!selectedPlaylistId || selectedPlaylistId === 'favorites') return;
    setIsLoadingRecs(true);

    try {
      // Gather artists/topics from playlist tracks, recently played, and favorites
      const playlistArtists = playlistTracks.map(t => t.artist).filter(Boolean);
      const recentArtists = (recentlyPlayed || []).map(t => t.artist).filter(Boolean);
      const favArtists = (favTrackObjs || []).map(t => t.artist).filter(Boolean);

      // Count artist frequencies
      const artistCounts: Record<string, number> = {};
      [...playlistArtists, ...playlistArtists, ...recentArtists, ...favArtists].forEach(artist => {
        if (artist && artist !== 'Unknown Artist' && artist !== 'Local Audio') {
          artistCounts[artist] = (artistCounts[artist] || 0) + 1;
        }
      });

      // Sort artists by frequency
      const sortedArtists = Object.keys(artistCounts).sort((a, b) => artistCounts[b] - artistCounts[a]);

      // Pick top topics
      let topicsToSearch: string[] = [];
      if (sortedArtists.length > 0) {
        topicsToSearch = sortedArtists.slice(0, 3);
      } else {
        topicsToSearch = ['Top Hits 2026', 'Popular Music', 'Hip Hop'];
      }

      const existingIds = new Set(playlistTracks.map(t => t.id));
      const newRecs: { track: Track; topic: string }[] = [];
      const seenIds = new Set<string>();

      // First check local library matching top artists
      tracks.forEach(t => {
        if (!existingIds.has(t.id) && !seenIds.has(t.id)) {
          if (sortedArtists.some(art => t.artist.toLowerCase().includes(art.toLowerCase()))) {
            seenIds.add(t.id);
            newRecs.push({ track: t, topic: `${t.artist} Topic` });
          }
        }
      });

      // Fetch from YT Music for top topics
      for (const topic of topicsToSearch.slice(0, 2)) {
        try {
          const results = await searchYTMusic(`${topic} topic songs`);
          for (const item of results) {
            if (!existingIds.has(item.id) && !seenIds.has(item.id) && newRecs.length < 12) {
              seenIds.add(item.id);
              newRecs.push({ track: item, topic: `${topic} Topic` });
            }
          }
        } catch {
          // ignore
        }
      }

      setRecommendedTracks(newRecs.slice(0, 10));
    } catch {
      // ignore
    } finally {
      setIsLoadingRecs(false);
    }
  }, [selectedPlaylistId, playlistTracks, recentlyPlayed, favTrackObjs, tracks, searchYTMusic]);

  useEffect(() => {
    void fetchRecommendations();
  }, [selectedPlaylistId]);

  // Dedicated FULL SCREEN Playlist Detail View
  if (selectedPlaylistId) {
    const isFavView = selectedPlaylistId === 'favorites';
    const title = isFavView ? 'Favorites' : selectedPlaylist?.name || 'Playlist';
    const desc = isFavView ? 'Your favorited tracks' : selectedPlaylist?.description || 'Custom Playlist';

    return (
      <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-5 max-w-3xl mx-auto w-full pb-28 animate-in fade-in duration-300">
        {/* Track Menu Options Modal (3-dot menu) */}
        <TrackOptionsMenuModal
          track={selectedTrackForMenu}
          onClose={() => setSelectedTrackForMenu(null)}
        />

        {/* Top Back Navigation Bar */}
        <div className="flex items-center justify-between pt-1 pb-2 border-b border-app-theme">
          <button
            onClick={() => setSelectedPlaylistId(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-app-surface border border-app-theme text-app-secondary hover:text-app-primary text-xs font-mono font-bold active:scale-95 transition-all shadow-sm"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>BACK TO PLAYLISTS</span>
          </button>

          {!isFavView && selectedPlaylist && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddMusicModal(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-app-highlight text-app-inverse text-xs font-mono font-bold hover:opacity-90 active:scale-95 transition-all shadow-sm"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
                <span>ADD SONGS</span>
              </button>

              <button
                onClick={() => {
                  setEditingPlaylist(selectedPlaylist);
                  setEditName(selectedPlaylist.name);
                  setEditDesc(selectedPlaylist.description || '');
                }}
                className="p-1.5 rounded-xl bg-app-surface border border-app-theme text-app-secondary hover:text-app-primary"
                title="Rename Playlist"
              >
                <Edit3 className="w-4 h-4" />
              </button>

              <button
                onClick={() => handleDelete(selectedPlaylist.id, selectedPlaylist.name)}
                className="p-1.5 rounded-xl bg-app-surface border border-app-theme text-app-secondary hover:text-app-highlight"
                title="Delete Playlist"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* HERO PLAYLIST HEADER BANNER */}
        <div className="p-5 rounded-3xl bg-app-surface border border-app-theme flex flex-col sm:flex-row items-center gap-5 shadow-2xl relative overflow-hidden">
          {/* 2x2 Grid Collage Cover Icon */}
          <div className="w-32 h-32 sm:w-36 sm:h-36 shrink-0 relative">
            {isFavView ? (
              <div className="w-full h-full rounded-2xl bg-app-highlight text-app-inverse flex items-center justify-center shadow-xl">
                <Heart className="w-16 h-16 fill-current" />
              </div>
            ) : (
              <PlaylistCollageIcon tracks={playlistTracks} />
            )}
          </div>

          {/* Playlist Info & Controls */}
          <div className="flex-1 text-center sm:text-left space-y-2 min-w-0">
            <span className="text-[10px] font-mono tracking-widest text-app-highlight uppercase font-bold">
              PLAYLIST
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-app-primary tracking-tight truncate">{title}</h1>
            <p className="text-xs text-app-secondary font-mono truncate">{desc}</p>
            <p className="text-xs text-app-secondary font-mono">
              {playlistTracks.length} Songs • Drag handles to reorder songs
            </p>

            <div className="pt-2 flex items-center justify-center sm:justify-start gap-3">
              <button
                onClick={() => playPlaylist(selectedPlaylistId)}
                className="flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-app-highlight text-app-inverse font-bold text-xs hover:opacity-90 active:scale-95 transition-all shadow-xl"
              >
                <Play className="w-4 h-4 fill-current ml-0.5" />
                <span>PLAY ALL</span>
              </button>
            </div>
          </div>
        </div>

        {/* SONG LIST WITH UP/DOWN REORDERING & DRAG & DROP */}
        <div className="space-y-2 pt-2">
          <div className="flex justify-between items-center px-1">
            <span className="text-xs font-mono text-app-secondary uppercase tracking-wider">
              SONGS IN PLAYLIST ({playlistTracks.length})
            </span>
            <span className="text-[10px] font-mono text-app-secondary">
              Use ▲ ▼ arrows or drag to reorder
            </span>
          </div>

          {playlistTracks.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-app-theme rounded-3xl space-y-2">
              <Music className="w-8 h-8 text-app-secondary mx-auto" />
              <p className="text-sm font-bold text-app-primary uppercase">No songs in playlist yet</p>
              <p className="text-xs text-app-secondary font-mono">Click "ADD SONGS" above to add tracks from your library</p>
            </div>
          ) : (
            playlistTracks.map((t, idx) => (
              <div
                key={t.id}
                draggable={!isFavView}
                onDragStart={() => setDraggedIndex(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggedIndex !== null && draggedIndex !== idx && selectedPlaylist) {
                    reorderPlaylistTracks(selectedPlaylist.id, draggedIndex, idx);
                    setDraggedIndex(null);
                  }
                }}
                onClick={() => playQueue(playlistTracks, idx)}
                className={`p-3 rounded-2xl border flex items-center justify-between cursor-pointer transition-all ${
                  draggedIndex === idx
                    ? 'opacity-50 border-app-highlight bg-app-surface scale-98'
                    : 'bg-app-card border-app-theme text-app-secondary hover:border-app-highlight hover:text-app-primary'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Drag Handle & Position Number */}
                  {!isFavView && (
                    <div className="flex items-center gap-1 text-app-secondary shrink-0">
                      <GripVertical className="w-4 h-4 cursor-grab text-app-secondary hover:text-app-primary" />
                      <span className="text-xs font-mono w-5 text-center">{idx + 1}</span>
                    </div>
                  )}

                  <img src={t.coverUrl} alt={t.title} className="w-11 h-11 rounded-xl object-cover border border-app-theme shrink-0 shadow-sm" />

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-app-primary truncate">{t.title}</p>
                    <p className="text-xs text-app-secondary font-mono truncate">{t.artist}</p>
                  </div>
                </div>

                {/* Reorder Arrows & Action Buttons */}
                <div className="flex items-center gap-1 shrink-0 pl-2">
                  {!isFavView && selectedPlaylist && (
                    <>
                      {/* Move Up Arrow */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (idx > 0) {
                            reorderPlaylistTracks(selectedPlaylist.id, idx, idx - 1);
                          }
                        }}
                        disabled={idx === 0}
                        className={`p-1.5 rounded-lg border border-app-theme text-app-secondary hover:text-app-primary active:scale-90 transition-all ${
                          idx === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:border-app-highlight'
                        }`}
                        title="Move Up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      {/* Move Down Arrow */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (idx < playlistTracks.length - 1) {
                            reorderPlaylistTracks(selectedPlaylist.id, idx, idx + 1);
                          }
                        }}
                        disabled={idx === playlistTracks.length - 1}
                        className={`p-1.5 rounded-lg border border-app-theme text-app-secondary hover:text-app-primary active:scale-90 transition-all ${
                          idx === playlistTracks.length - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:border-app-highlight'
                        }`}
                        title="Move Down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}

                  {/* Play Song */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playQueue(playlistTracks, idx);
                    }}
                    className="w-8 h-8 rounded-full bg-app-highlight text-app-inverse flex items-center justify-center hover:scale-105 active:scale-95 transition-all ml-1"
                    title="Play Song"
                  >
                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                  </button>

                  {/* 3-Dot Track Options Menu (download, favorite, add to playlist...) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTrackForMenu(t);
                    }}
                    className="p-1.5 text-app-secondary hover:text-app-primary active:scale-95 transition-all"
                    title="More Options"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>

                  {/* Remove Song from Playlist */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (selectedPlaylistId) {
                        removeTrackFromPlaylist(selectedPlaylistId, t.id);
                      }
                    }}
                    className="p-1.5 text-app-secondary hover:text-app-highlight active:scale-95 transition-all ml-1"
                    title="Remove from Playlist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* RECOMMENDED SONGS BASED ON YOUR TOPICS & LISTENING HISTORY */}
        {!isFavView && selectedPlaylist && (
          <div className="pt-6 space-y-3 border-t border-app-theme mt-6">
            <div className="flex justify-between items-center px-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-app-highlight animate-pulse" />
                <span className="text-xs font-mono text-app-primary font-bold uppercase tracking-wider">
                  RECOMMENDED FOR THIS PLAYLIST
                </span>
              </div>

              <button
                onClick={() => void fetchRecommendations()}
                disabled={isLoadingRecs}
                className="flex items-center gap-1 text-[10px] font-mono text-app-secondary hover:text-app-primary border border-app-theme px-2.5 py-1 rounded-xl active:scale-95 transition-all"
                title="Refresh Recommendations"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingRecs ? 'animate-spin' : ''}`} />
                <span>{isLoadingRecs ? 'SEARCHING...' : 'REFRESH'}</span>
              </button>
            </div>

            {isLoadingRecs && recommendedTracks.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-app-theme rounded-3xl">
                <RefreshCw className="w-6 h-6 text-app-highlight animate-spin mx-auto mb-2" />
                <p className="text-xs font-mono text-app-secondary">Fetching topics you listen to...</p>
              </div>
            ) : recommendedTracks.length === 0 ? (
              <div className="p-6 text-center border border-dashed border-app-theme rounded-3xl">
                <p className="text-xs font-mono text-app-secondary">No topic recommendations found for this playlist yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recommendedTracks.map(({ track: t, topic }) => {
                  const inPlaylist = selectedPlaylist.trackIds.includes(t.id);
                  return (
                    <div
                      key={t.id}
                      className="p-3 rounded-2xl border border-app-theme bg-app-card flex items-center justify-between hover:border-app-highlight transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <img
                          src={t.coverUrl}
                          alt={t.title}
                          className="w-11 h-11 rounded-xl object-cover border border-app-theme shrink-0 shadow-sm"
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          {/* LINE 1: Title */}
                          <p className="text-sm font-bold text-app-primary truncate leading-tight">{t.title}</p>
                          {/* LINE 2: Artist */}
                          <p className="text-xs text-app-secondary font-mono truncate leading-tight">{t.artist}</p>
                          {/* LINE 3: Topic / Category */}
                          <p className="text-[10px] text-app-highlight font-mono truncate leading-tight">
                            {t.album ? `Recommended Topic • ${t.album}` : `Recommended Topic • ${topic}`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 pl-2">
                        {/* Play Preview */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            playTrack(t);
                          }}
                          className="w-8 h-8 rounded-full bg-app-surface border border-app-theme text-app-primary flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-sm"
                          title="Play Song"
                        >
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </button>

                        {/* 3-Dot Track Options Menu */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTrackForMenu(t);
                          }}
                          className="p-1.5 text-app-secondary hover:text-app-primary active:scale-95 transition-all"
                          title="More Options"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>

                        {/* Add to Playlist Button */}
                        {inPlaylist ? (
                          <span className="px-2.5 py-1 rounded-xl bg-app-surface text-app-secondary text-[10px] font-mono border border-app-theme font-bold">
                            ADDED
                          </span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addTrackToPlaylist(selectedPlaylist.id, t);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-app-highlight text-app-inverse text-xs font-mono font-bold hover:opacity-90 active:scale-95 transition-all shadow-sm"
                          >
                            <Plus className="w-3.5 h-3.5 stroke-[3]" />
                            <span>ADD</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Add Music Modal */}
        {showAddMusicModal && selectedPlaylist && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-app-surface border border-app-theme rounded-3xl p-5 w-full max-w-md space-y-3 shadow-2xl max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between pb-2 border-b border-app-theme">
                <h3 className="text-sm font-extrabold text-app-primary uppercase tracking-wide">
                  ADD MUSIC TO "{selectedPlaylist.name}"
                </h3>
                <button
                  onClick={() => setShowAddMusicModal(false)}
                  className="p-1 rounded-full text-app-secondary hover:text-app-primary"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {tracks.map(t => {
                  const inPlaylist = selectedPlaylist.trackIds.includes(t.id);
                  return (
                    <div
                      key={t.id}
                      className="p-2.5 rounded-xl border border-app-theme bg-app-card flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img src={t.coverUrl} alt={t.title} className="w-9 h-9 rounded-lg object-cover" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-app-primary truncate">{t.title}</p>
                          <p className="text-[10px] text-app-secondary font-mono truncate">{t.artist}</p>
                        </div>
                      </div>

                      {inPlaylist ? (
                        <button
                          onClick={() => removeTrackFromPlaylist(selectedPlaylist.id, t.id)}
                          className="px-2.5 py-1 rounded-lg bg-app-surface text-app-secondary text-[10px] font-mono hover:text-app-highlight border border-app-theme"
                        >
                          REMOVE
                        </button>
                      ) : (
                        <button
                          onClick={() => addTrackToPlaylist(selectedPlaylist.id, t.id)}
                          className="px-2.5 py-1 rounded-lg bg-app-highlight text-app-inverse text-[10px] font-mono font-bold hover:opacity-90 active:scale-95"
                        >
                          + ADD
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-app-theme flex justify-end">
                <button
                  onClick={() => setShowAddMusicModal(false)}
                  className="px-4 py-2 rounded-xl bg-app-highlight text-app-inverse text-xs font-mono font-bold"
                >
                  DONE
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // MAIN PLAYLIST LIST VIEW
  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto w-full pb-28">
      {/* Header */}
      <div className="flex items-center justify-between pt-1 pb-2 border-b border-app-theme">
        <div>
          <h1 className="text-xl font-black text-app-primary tracking-tight uppercase">PLAYLIST MANAGER</h1>
          <p className="text-xs text-app-secondary font-mono">{playlists.length + 1} Playlists Total</p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 bg-app-highlight text-app-inverse px-3.5 py-2 rounded-xl font-bold text-xs hover:opacity-90 active:scale-95 transition-all shadow-md"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>NEW PLAYLIST</span>
        </button>
      </div>

      {/* Create Playlist Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-app-surface border border-app-theme rounded-3xl p-5 w-full max-w-md space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-2 border-b border-app-theme">
              <h3 className="text-base font-extrabold text-app-primary uppercase tracking-wide">CREATE NEW PLAYLIST</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-full text-app-secondary hover:text-app-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="text-xs font-mono text-app-secondary uppercase">Playlist Title</label>
                <input
                  type="text"
                  value={newPlaylistName}
                  onChange={e => setNewPlaylistName(e.target.value)}
                  placeholder="e.g., Midnight Vibes, Gym Hits..."
                  autoFocus
                  required
                  className="w-full mt-1 bg-app-card border border-app-theme rounded-xl py-2.5 px-3.5 text-sm text-app-primary placeholder:text-app-secondary focus:outline-none focus:border-app-highlight font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-app-secondary uppercase">Description (Optional)</label>
                <input
                  type="text"
                  value={newPlaylistDesc}
                  onChange={e => setNewPlaylistDesc(e.target.value)}
                  placeholder="Short description..."
                  className="w-full mt-1 bg-app-card border border-app-theme rounded-xl py-2.5 px-3.5 text-sm text-app-primary placeholder:text-app-secondary focus:outline-none focus:border-app-highlight font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-app-theme text-xs font-mono text-app-secondary hover:text-app-primary"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-app-highlight text-app-inverse text-xs font-mono font-bold hover:opacity-90 active:scale-95 transition-all shadow-md"
                >
                  CREATE PLAYLIST
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit / Rename Playlist Modal */}
      {editingPlaylist && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-app-surface border border-app-theme rounded-3xl p-5 w-full max-w-md space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-2 border-b border-app-theme">
              <h3 className="text-base font-extrabold text-app-primary uppercase tracking-wide">RENAME PLAYLIST</h3>
              <button
                onClick={() => setEditingPlaylist(null)}
                className="p-1 rounded-full text-app-secondary hover:text-app-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRename} className="space-y-3">
              <div>
                <label className="text-xs font-mono text-app-secondary uppercase">Playlist Title</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  required
                  className="w-full mt-1 bg-app-card border border-app-theme rounded-xl py-2.5 px-3.5 text-sm text-app-primary focus:outline-none focus:border-app-highlight font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-mono text-app-secondary uppercase">Description</label>
                <input
                  type="text"
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  className="w-full mt-1 bg-app-card border border-app-theme rounded-xl py-2.5 px-3.5 text-sm text-app-primary focus:outline-none focus:border-app-highlight font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingPlaylist(null)}
                  className="px-4 py-2 rounded-xl border border-app-theme text-xs font-mono text-app-secondary hover:text-app-primary"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-app-highlight text-app-inverse text-xs font-mono font-bold hover:opacity-90 active:scale-95 transition-all shadow-md"
                >
                  SAVE CHANGES
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Favorites Special Playlist Card */}
      <div
        onClick={() => setSelectedPlaylistId('favorites')}
        className="p-4 rounded-3xl bg-app-surface border border-app-theme flex items-center justify-between cursor-pointer hover:border-app-highlight transition-all group shadow-lg"
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-16 h-16 rounded-2xl bg-app-highlight text-app-inverse flex items-center justify-center font-bold shadow-md shrink-0">
            <Heart className="w-8 h-8 fill-current" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold text-app-primary truncate">Favorites</h3>
            <p className="text-xs text-app-secondary font-mono truncate">{favoriteTracks.length} tracks favorited</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              playPlaylist('favorites');
            }}
            className="w-10 h-10 rounded-full bg-app-highlight text-app-inverse flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all"
            title="Play Favorites"
          >
            <Play className="w-4 h-4 fill-current ml-0.5" />
          </button>
        </div>
      </div>

      {/* Custom User Playlists List with 2x2 Grid Collage Cover Icons */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-mono text-app-secondary uppercase tracking-wider px-1">YOUR PLAYLISTS ({playlists.length})</h3>

        {playlists.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-app-theme rounded-2xl">
            <ListMusic className="w-8 h-8 text-app-secondary mx-auto mb-2" />
            <p className="text-xs text-app-secondary font-mono">No custom playlists created yet</p>
          </div>
        ) : (
          playlists.map(pl => {
            const plTracks = tracks.filter(t => pl.trackIds.includes(t.id));

            return (
              <div
                key={pl.id}
                onClick={() => setSelectedPlaylistId(pl.id)}
                className="p-4 rounded-3xl bg-app-card border border-app-theme flex items-center justify-between cursor-pointer hover:border-app-highlight transition-all group shadow-md"
              >
                <div className="flex items-center gap-4 min-w-0">
                  {/* 2x2 Grid Collage Icon for Playlist */}
                  <div className="w-16 h-16 shrink-0 relative">
                    <PlaylistCollageIcon tracks={plTracks} />
                  </div>

                  <div className="min-w-0">
                    <h4 className="text-base font-bold text-app-primary truncate">{pl.name}</h4>
                    <p className="text-xs text-app-secondary font-mono truncate">{pl.trackIds.length} tracks • {pl.description || 'Custom Playlist'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Play Entire Playlist */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playPlaylist(pl.id);
                    }}
                    className="w-9 h-9 rounded-full bg-app-highlight text-app-inverse flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow"
                    title="Play Playlist"
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </button>

                  {/* Edit / Rename Playlist */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingPlaylist(pl);
                      setEditName(pl.name);
                      setEditDesc(pl.description || '');
                    }}
                    className="p-2 rounded-full text-app-secondary hover:text-app-primary hover:bg-app-surface transition-all"
                    title="Rename Playlist"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>

                  {/* Delete Playlist */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(pl.id, pl.name);
                    }}
                    className="p-2 rounded-full text-app-secondary hover:text-app-highlight hover:bg-app-surface transition-all"
                    title="Delete Playlist"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
