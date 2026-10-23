import React, { useMemo, useState } from 'react';
import { Heart, BarChart3 } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { PlaylistHero } from './PlaylistHero';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import type { Track } from '../types/music';

export const LikedMusicView: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const { tracks, favorites, favoriteTracks, toggleFavorite, playQueue, currentTrack, isPlaying, toggleShuffle, isShuffle } = useAudio();
  const [sortAz, setSortAz] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);

  const allLiked = favoriteTracks.length > 0 ? favoriteTracks : tracks.filter(t => favorites.includes(t.id));

  // The list shown below the header: optionally searched and A-Z sorted.
  const likedTracks = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q
      ? allLiked.filter(t => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q))
      : allLiked;
    if (sortAz) list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [allLiked, query, sortAz]);

  const formatDuration = (secs: number) => {
    if (!secs || isNaN(secs)) return '--:--';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto w-full">
      <TrackOptionsMenuModal track={selectedTrack} onClose={() => setSelectedTrack(null)} />

      <div className="-mx-4 -mt-4">
        <PlaylistHero
          title="Liked Music"
          subtitle="playlist"
          count={allLiked.length}
          onBack={onBack}
          onPlay={() => playQueue(likedTracks, 0)}
          playDisabled={likedTracks.length === 0}
          isShuffle={isShuffle}
          onShuffle={toggleShuffle}
          sortAz={sortAz}
          onToggleSort={() => setSortAz(v => !v)}
          query={query}
          onQueryChange={setQuery}
        />
      </div>

      {allLiked.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-app-theme rounded-3xl my-auto space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-app-surface border border-app-theme flex items-center justify-center text-app-secondary">
            <Heart className="w-8 h-8 text-app-secondary" />
          </div>
          <div className="space-y-1 max-w-xs">
            <h3 className="text-base font-bold text-app-primary uppercase tracking-wide">NO LIKED SONGS YET</h3>
            <p className="text-xs text-app-secondary font-mono">
              Click the heart icon on any song to save it to your Liked Music collection.
            </p>
          </div>
        </div>
      ) : (
        <div className="px-2 pt-2 space-y-1">
          {likedTracks.length === 0 && (
            <p className="text-center text-sm text-app-secondary py-8">No matching songs</p>
          )}
          {likedTracks.map((track, index) => {
            const isCurrent = currentTrack?.id === track.id;
            return (
              <div
                key={track.id}
                onClick={() => playQueue(likedTracks, index)}
                className="w-full flex items-center gap-3.5 p-2 rounded-xl text-left hover:bg-white/5 cursor-pointer transition-colors group"
              >
                <img
                  src={track.coverUrl}
                  alt={track.title}
                  loading="lazy"
                  className="w-12 h-12 rounded-lg object-cover shrink-0 border border-white/5"
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm sm:text-base font-semibold truncate ${isCurrent ? 'text-white font-bold' : 'text-zinc-100'}`}>
                    {track.title}
                  </p>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">{track.artist}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {isCurrent && isPlaying && (
                    <BarChart3 className="w-5 h-5 text-white fill-white/20 animate-pulse" />
                  )}
                  <span className="text-xs text-zinc-400 font-mono">{formatDuration(track.duration)}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      toggleFavorite(track.id);
                    }}
                    className="p-1.5"
                    title="Remove from Liked"
                  >
                    <Heart className="w-4 h-4 fill-app-highlight stroke-app-highlight" />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedTrack(track);
                    }}
                    className="p-1.5 text-zinc-400 hover:text-white"
                    title="More Options"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
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
