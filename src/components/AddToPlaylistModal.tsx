import React, { useState } from 'react';
import { X, Plus, Check, ListMusic } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import type { Track } from '../types/music';

interface AddToPlaylistModalProps {
  track: Track | null;
  onClose: () => void;
}

export const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({ track, onClose }) => {
  const { playlists, createPlaylist, addTrackToPlaylist } = useAudio();
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [addedIds, setAddedIds] = useState<string[]>([]);

  if (!track) return null;

  const handleToggleAdd = (playlistId: string) => {
    addTrackToPlaylist(playlistId, track);
    setAddedIds(prev => [...prev, playlistId]);
  };

  const handleCreateAndAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const newId = createPlaylist(newPlaylistName.trim());
    addTrackToPlaylist(newId, track);
    setAddedIds(prev => [...prev, newId]);
    setNewPlaylistName('');
    setShowCreate(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-app-surface border border-app-theme rounded-3xl p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-app-theme">
          <div className="min-w-0 pr-2">
            <h3 className="text-sm font-bold text-app-primary uppercase tracking-wider">ADD TO PLAYLIST</h3>
            <p className="text-xs text-app-secondary font-mono truncate mt-0.5">{track.title}</p>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-app-card border border-app-theme text-app-secondary hover:text-app-primary flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Create New Playlist Form */}
        {showCreate ? (
          <form onSubmit={handleCreateAndAdd} className="space-y-3 pt-1">
            <input
              type="text"
              placeholder="New Playlist Name..."
              value={newPlaylistName}
              onChange={e => setNewPlaylistName(e.target.value)}
              autoFocus
              className="w-full bg-app-card border border-app-theme rounded-xl py-2.5 px-3 text-xs font-mono text-app-primary focus:outline-none focus:border-app-highlight"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 text-xs font-mono text-app-secondary hover:text-app-primary"
              >
                CANCEL
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-bold bg-app-highlight text-app-inverse rounded-xl hover:opacity-90"
              >
                CREATE & SAVE
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full py-2.5 bg-app-card border border-app-theme hover:border-app-highlight text-xs font-mono font-bold text-app-primary rounded-xl flex items-center justify-center gap-2 transition-all"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>CREATE NEW PLAYLIST</span>
          </button>
        )}

        {/* Playlists List */}
        <div className="space-y-2 max-h-60 overflow-y-auto pt-1">
          {playlists.length === 0 ? (
            <p className="text-xs text-app-secondary font-mono text-center py-4">No custom playlists created yet.</p>
          ) : (
            playlists.map(p => {
              const isAlreadyIn = p.trackIds.includes(track.id) || addedIds.includes(p.id);
              return (
                <div
                  key={p.id}
                  onClick={() => !isAlreadyIn && handleToggleAdd(p.id)}
                  className={`p-3 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
                    isAlreadyIn
                      ? 'bg-app-surface border-app-highlight text-app-primary font-bold cursor-default'
                      : 'bg-app-card border-app-theme text-app-secondary hover:border-app-highlight hover:text-app-primary'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <ListMusic className="w-4 h-4 text-app-secondary" />
                    <div>
                      <h4 className="text-xs font-bold">{p.name}</h4>
                      <p className="text-[10px] text-app-secondary font-mono">{p.trackIds.length} tracks</p>
                    </div>
                  </div>

                  {isAlreadyIn ? (
                    <span className="text-[10px] font-mono text-app-inverse bg-app-highlight px-2 py-0.5 rounded font-bold flex items-center gap-1">
                      <Check className="w-3 h-3 stroke-[3]" /> ADDED
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-app-secondary hover:text-app-primary">+ ADD</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
