import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Play, Shuffle, MoreVertical, Disc3, Heart } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { searchYouTubeMusic, searchYouTubeMusicVideos } from '../utils/ytMusicApi';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import type { Track } from '../types/music';

interface ArtistDetailViewProps {
  artistName: string;
  localTracks: Track[];
  onBack: () => void;
  onOpenAlbum?: (albumName: string) => void;
}

function popularity(track: Track): number {
  let h = 0;
  for (let i = 0; i < track.id.length; i++) {
    h = (h * 31 + track.id.charCodeAt(i)) >>> 0;
  }
  return h;
}

const formatDuration = (secs: number) => {
  if (!secs || isNaN(secs)) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export const ArtistDetailView: React.FC<ArtistDetailViewProps> = ({
  artistName,
  localTracks,
  onBack,
  onOpenAlbum,
}) => {
  const {
    playQueue,
    currentTrack,
    isPlaying,
    isShuffle,
    toggleShuffle,
    favorites,
    tracks: contextTracks,
    trackStore,
    toggleFavorite,
  } = useAudio();
  const [extraTracks, setExtraTracks] = useState<Track[]>([]);
  const [videos, setVideos] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    searchYouTubeMusic(artistName)
      .then(results => {
        if (mounted) setExtraTracks(results || []);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    searchYouTubeMusicVideos(artistName)
      .then(results => {
        if (mounted) setVideos(results || []);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [artistName]);

  const allTracks = useMemo(() => {
    const map = new Map<string, Track>();
    localTracks.forEach(t => map.set(t.id, t));
    extraTracks.forEach(t => map.set(t.id, t));
    return Array.from(map.values());
  }, [localTracks, extraTracks]);

  const likedSongsByArtist = useMemo(() => {
    const norm = artistName.toLowerCase().trim();
    const favSet = new Set(favorites);
    const combinedMap = new Map<string, Track>();

    contextTracks.forEach(t => {
      if (favSet.has(t.id)) combinedMap.set(t.id, t);
    });
    Object.values(trackStore).forEach(t => {
      if (t && favSet.has(t.id)) combinedMap.set(t.id, t);
    });
    allTracks.forEach(t => {
      if (favSet.has(t.id)) combinedMap.set(t.id, t);
    });

    return Array.from(combinedMap.values()).filter(t =>
      t.artist.toLowerCase().includes(norm) || norm.includes(t.artist.toLowerCase())
    );
  }, [artistName, favorites, contextTracks, trackStore, allTracks]);

  const popular = useMemo(
    () => [...allTracks].sort((a, b) => popularity(b) - popularity(a)).slice(0, 5),
    [allTracks]
  );

  const albums = useMemo(() => {
    const map = new Map<string, Track[]>();
    allTracks.forEach(t => {
      const name = t.album && t.album !== 'YouTube Music' ? t.album : '';
      if (!name) return;
      const list = map.get(name) || [];
      list.push(t);
      map.set(name, list);
    });
    return Array.from(map.entries()).slice(0, 8);
  }, [allTracks]);

  const handlePlayAll = () => {
    if (allTracks.length === 0) return;
    if (isShuffle) toggleShuffle();
    playQueue(allTracks, 0);
  };

  const handleShuffle = () => {
    if (allTracks.length === 0) return;
    if (!isShuffle) toggleShuffle();
    playQueue(allTracks, 0);
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto pb-28 bg-app-primary">
      <TrackOptionsMenuModal track={menuTrack} onClose={() => setMenuTrack(null)} />

      {/* Header */}
      <div className="relative pt-[calc(max(env(safe-area-inset-top,0px),48px)+12px)] pb-6 px-5 select-none">
        <button
          onClick={onBack}
          className="absolute top-[calc(max(env(safe-area-inset-top,0px),48px)+12px)] left-5 p-2.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-app-primary cursor-pointer transition-all shadow-md backdrop-blur-md z-10"
          title="Back"
        >
          <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
        </button>

        <div className="flex flex-col items-center pt-2">
          <div className="w-36 h-36 rounded-full bg-app-card overflow-hidden shadow-2xl border border-white/10">
            {allTracks[0]?.coverUrl && (
              <img
                src={allTracks[0].coverUrl}
                alt={artistName}
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <h1 className="text-3xl font-bold text-app-primary mt-5 text-center">{artistName}</h1>
          <p className="text-sm text-app-secondary mt-1.5">
            {allTracks.length} songs{loading ? ' • loading more...' : ''}
            {likedSongsByArtist.length > 0 ? ` • ${likedSongsByArtist.length} liked` : ''}
          </p>
        </div>

        {/* Action Row */}
        <div className="flex items-center justify-center gap-10 pt-6">
          <button onClick={handlePlayAll} className="p-3 rounded-full bg-white text-black hover:scale-110 active:scale-95 transition-transform shadow-lg" title="Play All">
            <Play className="w-6 h-6 fill-current ml-0.5" />
          </button>
          <button onClick={handleShuffle} className="p-3 text-app-primary cursor-pointer hover:scale-110 active:scale-95 transition-transform" title="Shuffle">
            <Shuffle className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Liked Songs by Artist */}
      {likedSongsByArtist.length > 0 && (
        <div className="px-3 pt-2">
          <h2 className="text-xl font-bold text-app-primary px-2 pb-3 flex items-center gap-2">
            <Heart className="w-5 h-5 text-app-highlight fill-current" />
            Liked songs by {artistName}
          </h2>
          <div className="space-y-1">
            {likedSongsByArtist.map((t, idx) => {
              const isCurrent = currentTrack?.id === t.id;
              const isFav = favorites.includes(t.id);
              return (
                <div
                  key={`liked-${t.id}-${idx}`}
                  onClick={() => playQueue(likedSongsByArtist, idx)}
                  className={`w-full flex items-center gap-4 p-2 rounded-xl text-left cursor-pointer hover:bg-app-surface/80 ${
                    isCurrent ? 'bg-app-surface border border-app-theme' : ''
                  }`}
                >
                  <img
                    src={t.coverUrl}
                    alt={t.title}
                    className="w-14 h-14 rounded-lg object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-base font-semibold truncate ${isCurrent ? 'text-app-primary font-bold' : 'text-app-primary'}`}>
                      {t.title}
                    </p>
                    <p className="text-sm text-app-secondary truncate mt-0.5">{t.artist}</p>
                  </div>
                  {isCurrent && isPlaying && (
                    <span className="eq"><span /><span /><span /></span>
                  )}
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      toggleFavorite(t.id);
                    }}
                    className="p-2 shrink-0 cursor-pointer"
                    title="Like"
                  >
                    <Heart className={`w-5 h-5 ${isFav ? 'text-app-primary fill-white' : 'text-app-secondary'}`} />
                  </button>
                  <span className="text-sm text-app-secondary shrink-0">
                    {formatDuration(t.duration)}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      setMenuTrack(t);
                    }}
                    className="p-1.5 text-app-secondary shrink-0 cursor-pointer"
                    title="More Options"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Most Popular */}
      {popular.length > 0 && (
        <div className="px-3 pt-2">
          <h2 className="text-xl font-bold text-app-primary px-2 pb-3">Most popular</h2>
          <div className="space-y-1">
            {popular.map((t, idx) => {
              const isCurrent = currentTrack?.id === t.id;
              return (
                <button
                  key={`${t.id}-${idx}`}
                  onClick={() => playQueue(allTracks, allTracks.findIndex(x => x.id === t.id))}
                  className="w-full flex items-center gap-4 p-2 rounded-xl text-left"
                >
                  <img
                    src={t.coverUrl}
                    alt={t.title}
                    className="w-14 h-14 rounded-lg object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-app-primary truncate">{t.title}</p>
                    <p className="text-sm text-app-secondary truncate mt-0.5">{t.artist}</p>
                  </div>
                  {isCurrent && isPlaying && (
                    <span className="eq"><span /><span /><span /></span>
                  )}
                  <span className="text-sm text-app-secondary shrink-0">
                    {formatDuration(t.duration)}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      setMenuTrack(t);
                    }}
                    className="p-1.5 text-app-secondary shrink-0"
                    title="More Options"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Videos */}
      {videos.length > 0 && (
        <div className="px-5 pt-8">
          <h2 className="text-xl font-bold text-app-primary pb-4">Videos</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
            {videos.slice(0, 10).map((v, idx) => (
              <button
                key={`${v.id}-${idx}`}
                onClick={() => playQueue(videos, idx)}
                className="w-56 shrink-0 text-left"
              >
                <div className="relative w-56 h-32 rounded-xl overflow-hidden bg-app-surface">
                  <img
                    src={v.coverUrl}
                    alt={v.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                      <Play className="w-5 h-5 text-app-primary fill-current ml-0.5" />
                    </span>
                  </span>
                </div>
                <p className="text-sm font-semibold text-app-primary mt-2 truncate">{v.title}</p>
                <p className="text-xs text-app-secondary truncate">{v.artist}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Records / Albums */}
      {albums.length > 0 && (
        <div className="px-5 pt-8">
          <h2 className="text-xl font-bold text-app-primary pb-4">Records</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
            {albums.map(([name, albumTracks]) => (
              <button
                key={name}
                onClick={() => onOpenAlbum?.(name)}
                className="w-36 shrink-0 text-left"
              >
                <div className="w-36 h-36 rounded-xl bg-app-card overflow-hidden flex items-center justify-center">
                  {albumTracks[0]?.coverUrl ? (
                    <img
                      src={albumTracks[0].coverUrl}
                      alt={name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Disc3 className="w-10 h-10 text-app-primary" />
                  )}
                </div>
                <p className="text-sm font-semibold text-app-primary mt-2 truncate">{name}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Songs */}
      <div className="px-3 pt-8">
        <h2 className="text-xl font-bold text-app-primary px-2 pb-3">Songs</h2>
        {allTracks.length === 0 && loading ? (
          <p className="text-center text-sm text-app-secondary py-10">Loading songs...</p>
        ) : (
          <div className="space-y-1">
            {allTracks.map((t, idx) => {
              const isCurrent = currentTrack?.id === t.id;
              return (
                <button
                  key={`${t.id}-${idx}`}
                  onClick={() => playQueue(allTracks, idx)}
                  className="w-full flex items-center gap-4 p-2 rounded-xl text-left"
                >
                  <img
                    src={t.coverUrl}
                    alt={t.title}
                    loading="lazy"
                    className="w-14 h-14 rounded-lg object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-app-primary truncate">{t.title}</p>
                    <p className="text-sm text-app-secondary truncate mt-0.5">{t.artist}</p>
                  </div>
                  {isCurrent && isPlaying && (
                    <span className="eq"><span /><span /><span /></span>
                  )}
                  <span className="text-sm text-app-secondary shrink-0">
                    {formatDuration(t.duration)}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => {
                      e.stopPropagation();
                      setMenuTrack(t);
                    }}
                    className="p-1.5 text-app-secondary shrink-0"
                    title="More Options"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
