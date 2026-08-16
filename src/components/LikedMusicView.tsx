import React from 'react';
import { Heart, Play, Pause, Shuffle, Clock, ChevronLeft } from 'lucide-react';
import { useAudio } from '../context/AudioContext';

export const LikedMusicView: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const { tracks, favorites, favoriteTracks, toggleFavorite, playQueue, currentTrack, isPlaying, toggleShuffle, isShuffle } = useAudio();

  const likedTracks = favoriteTracks.length > 0 ? favoriteTracks : tracks.filter(t => favorites.includes(t.id));

  const formatDuration = (secs: number) => {
    if (!secs || isNaN(secs)) return '--:--';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const playAllLiked = () => {
    playQueue(likedTracks, 0);
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto w-full">
      {/* Header Banner */}
      <div className="flex items-center justify-between pt-1 pb-3 border-b border-app-theme">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="p-1 text-app-primary" title="Back">
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          <div className="w-12 h-12 rounded-2xl bg-app-highlight text-app-inverse flex items-center justify-center font-bold shadow-lg">
            <Heart className="w-6 h-6 fill-current stroke-current" />
          </div>
          <div>
            <h1 className="text-xl font-black text-app-primary tracking-tight uppercase">LIKED MUSIC</h1>
            <p className="text-xs text-app-secondary font-mono">{likedTracks.length} Favorited Tracks</p>
          </div>
        </div>

        {likedTracks.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={toggleShuffle}
              className={`p-2.5 rounded-xl border transition-all ${
                isShuffle ? 'bg-app-highlight text-app-inverse font-bold border-app-highlight' : 'bg-app-surface border-app-theme text-app-secondary hover:text-app-primary'
              }`}
              title="Shuffle Liked Songs"
            >
              <Shuffle className="w-4 h-4" />
            </button>

            <button
              onClick={playAllLiked}
              className="flex items-center gap-2 bg-app-highlight text-app-inverse px-4 py-2 rounded-xl font-bold text-xs hover:opacity-90 active:scale-95 transition-all shadow-md"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>PLAY ALL</span>
            </button>
          </div>
        )}
      </div>

      {/* Empty State */}
      {likedTracks.length === 0 ? (
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
        /* Liked Tracks Listing */
        <div className="space-y-2">
          {likedTracks.map((track, index) => {
            const isCurrent = currentTrack?.id === track.id;

            return (
              <div
                key={track.id}
                onClick={() => playQueue(likedTracks, index)}
                className={`group p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between cursor-pointer ${
                  isCurrent
                    ? 'bg-app-surface border-app-highlight text-app-primary font-bold shadow-lg'
                    : 'bg-app-card border-app-theme text-app-secondary hover:border-app-highlight hover:text-app-primary'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-6 text-center font-mono text-xs text-app-secondary shrink-0">
                    {isCurrent && isPlaying ? (
                      <div className="flex items-end justify-center gap-0.5 h-4">
                        <span className="w-0.5 h-full bg-app-highlight animate-pulse" />
                        <span className="w-0.5 h-1/2 bg-app-highlight animate-pulse delay-75" />
                        <span className="w-0.5 h-3/4 bg-app-highlight animate-pulse delay-150" />
                      </div>
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </div>

                  <div className="w-12 h-12 rounded-full overflow-hidden bg-app-surface border border-app-theme shrink-0 relative shadow-md">
                    <img src={track.coverUrl} alt={track.title} className="w-full h-full object-cover" />
                    {isCurrent && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        {isPlaying ? <Pause className="w-4 h-4 text-app-primary" /> : <Play className="w-4 h-4 text-app-primary ml-0.5" />}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold truncate text-app-primary">
                      {track.title}
                    </h3>
                    <p className="text-xs text-app-secondary font-mono truncate mt-0.5">
                      {track.artist} • {track.album}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 pl-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(track.id);
                    }}
                    className="p-1.5 text-app-primary hover:opacity-80 transition-opacity"
                    title="Remove from Liked"
                  >
                    <Heart className="w-4 h-4 fill-app-highlight stroke-app-highlight" />
                  </button>
                  <div className="flex items-center gap-1 text-xs font-mono text-app-secondary">
                    <Clock className="w-3 h-3" />
                    <span>{formatDuration(track.duration)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
