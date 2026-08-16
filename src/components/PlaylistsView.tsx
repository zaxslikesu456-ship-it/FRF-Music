import React, { useState } from 'react';
import { Plus, ListMusic, Heart, Play, Trash2, Edit3, X, Disc } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { PlaylistDetailView } from './PlaylistDetailView';
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
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    playPlaylist,
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

  // Dedicated FULL SCREEN Playlist Detail View using restored unified UI
  if (selectedPlaylistId) {
    const isFavView = selectedPlaylistId === 'favorites';
    const title = isFavView ? 'Favorites' : selectedPlaylist?.name || 'Playlist';
    const desc = isFavView ? 'Your favorited tracks' : selectedPlaylist?.description || 'Custom Playlist';
    const back = () => setSelectedPlaylistId(null);

    return (
      <PlaylistDetailView
        title={title}
        subtitle={desc}
        coverUrl={playlistTracks[0]?.coverUrl}
        tracks={playlistTracks}
        onBack={back}
        playlistId={isFavView ? undefined : selectedPlaylistId}
        onAddTrack={t => {
          if (!isFavView && selectedPlaylistId) {
            addTrackToPlaylist(selectedPlaylistId, t);
          }
        }}
        onRemoveTrack={trackId => {
          if (isFavView) {
            removeTrackFromPlaylist('favorites', trackId);
          } else if (selectedPlaylistId) {
            removeTrackFromPlaylist(selectedPlaylistId, trackId);
          }
        }}
        onMoveTrack={(from, to) => {
          if (!isFavView && selectedPlaylistId) {
            reorderPlaylistTracks(selectedPlaylistId, from, to);
          }
        }}
        onRename={
          !isFavView && selectedPlaylist
            ? () => {
                const name = prompt('Rename playlist', selectedPlaylist.name);
                if (name && name.trim()) renamePlaylist(selectedPlaylist.id, name.trim());
              }
            : undefined
        }
        onDelete={
          !isFavView && selectedPlaylist
            ? () => {
                if (confirm(`Delete playlist "${selectedPlaylist.name}"?`)) {
                  deletePlaylist(selectedPlaylist.id);
                  back();
                }
              }
            : undefined
        }
      />
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
