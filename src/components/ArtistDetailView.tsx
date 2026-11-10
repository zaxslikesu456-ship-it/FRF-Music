import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t as tr } from '../i18n';
import { ChevronLeft, Play, Shuffle, MoreVertical, Disc3, Heart, Loader2 } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import {
  searchYouTubeMusic,
  searchYouTubeMusicVideos,
  searchYouTubeMusicArtists,
  loadMoreSearchResults,
  fetchArtistPage,
  fetchReleaseTracks,
  isByArtist,
  type ArtistPage,
  type ArtistRelease,
} from '../utils/ytMusicApi';
import { PlaylistDetailView } from './PlaylistDetailView';
import { TrackOptionsMenuModal } from './TrackOptionsMenuModal';
import type { Track } from '../types/music';
import { getArtistBio, type ArtistBio } from '../utils/artistBio';

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
  const [topSongs, setTopSongs] = useState<Track[]>([]);
  // About: description (YouTube Music, or Wikipedia when that is only a link) and audience numbers.
  const [about, setAbout] = useState<ArtistPage | null>(null);
  const [bio, setBio] = useState<ArtistBio | null>(null);
  const [bioOpen, setBioOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // The artist's own videos and releases, from their YouTube Music page.
  const [pageVideos, setPageVideos] = useState<Track[] | null>(null);
  const [albumList, setAlbumList] = useState<ArtistRelease[]>([]);
  const [singleList, setSingleList] = useState<ArtistRelease[]>([]);
  const [showAllPopular, setShowAllPopular] = useState(false);
  const [showAllAlbums, setShowAllAlbums] = useState(false);
  const [openRelease, setOpenRelease] = useState<{ release: ArtistRelease; tracks: Track[]; loading: boolean } | null>(null);
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  // Header: the artist's photo, wide, fading and drifting as the page scrolls.
  const [photo, setPhoto] = useState('');
  const [scrollY, setScrollY] = useState(0);
  useEffect(() => {
    let live = true;
    setPhoto('');
    searchYouTubeMusicArtists(artistName)
      .then(list => {
        const norm = artistName.toLowerCase().trim();
        const hit = list.find(a => a.name.toLowerCase().trim() === norm) || list[0];
        // YouTube Music hands out small thumbnails; ask for a large one.
        if (live && hit?.thumbnail) setPhoto(hit.thumbnail.replace(/=w\d+-h\d+/, '=w1200-h1200'));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [artistName]);
  // More songs load as you scroll to the bottom (further pages of the search).
  const [loadingMore, setLoadingMore] = useState(false);
  const [noMore, setNoMore] = useState(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setNoMore(false);
    searchYouTubeMusic(artistName)
      .then(results => {
        // Search mixes in other artists with similar names; keep this artist's songs.
        if (mounted) setExtraTracks((results || []).filter(t => isByArtist(t, artistName)));
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    setTopSongs([]);
    setAbout(null);
    setBio(null);
    setBioOpen(false);
    setPageVideos(null);
    setAlbumList([]);
    setSingleList([]);
    setShowAllPopular(false);
    setShowAllAlbums(false);
    setOpenRelease(null);
    setVideos([]);
    fetchArtistPage(artistName)
      .then(page => {
        if (!mounted || !page) return;
        setTopSongs(page.topSongs);
        setAbout(page);
        setPageVideos(page.videos);
        setAlbumList(page.albums);
        setSingleList(page.singles);
        return getArtistBio(page.name, page.description).then(b => {
          if (mounted) setBio(b);
        });
      })
      .catch(() => {});
    // Only used when the artist's page has no videos of its own.
    searchYouTubeMusicVideos(artistName)
      .then(results => {
        if (mounted) setVideos((results || []).filter(t => isByArtist(t, artistName)));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [artistName]);

  const allTracks = useMemo(() => {
    const map = new Map<string, Track>();
    localTracks.forEach(t => map.set(t.id, t));
    topSongs.forEach(t => map.set(t.id, t));
    extraTracks.forEach(t => map.set(t.id, t));
    return Array.from(map.values());
  }, [localTracks, topSongs, extraTracks]);

  const allTracksRef = useRef<Track[]>([]);
  allTracksRef.current = allTracks;

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

  // YouTube Music's own most-popular order; the id hash is only a stand-in
  // while that list loads or when the artist has none.
  const popularAll = useMemo(
    () =>
      topSongs.length > 0
        ? topSongs
        : [...allTracks].sort((a, b) => popularity(b) - popularity(a)).slice(0, 5),
    [topSongs, allTracks]
  );
  const popular = showAllPopular ? popularAll : popularAll.slice(0, 5);

  // The artist's own videos; a search is only a stand-in when their page has none.
  const shownVideos = pageVideos && pageVideos.length > 0 ? pageVideos : pageVideos === null ? [] : videos;

  const derivedAlbums = useMemo(() => {
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

  // Further pages mix in other artists' songs, so only this artist's are kept.
  // A few pages in a row with nothing new means that is everything.
  const emptyPagesRef = useRef(0);
  const loadMore = async () => {
    if (loadingMoreRef.current || noMore || loading) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await loadMoreSearchResults(artistName);
      if (page.length === 0) {
        setNoMore(true);
        return;
      }
      const mine = page.filter(t => isByArtist(t, artistName));
      const shown = new Set(allTracksRef.current.map(t => t.id));
      const fresh = mine.filter(t => !shown.has(t.id));
      if (fresh.length) setExtraTracks(prev => [...prev, ...fresh.filter(t => !prev.some(p => p.id === t.id))]);
      emptyPagesRef.current = fresh.length > 0 ? 0 : emptyPagesRef.current + 1;
      if (emptyPagesRef.current >= 3) setNoMore(true);
    } catch {
      setNoMore(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrollY(el.scrollTop);
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 600) void loadMore();
  };

  const openReleasePage = (release: ArtistRelease) => {
    setOpenRelease({ release, tracks: [], loading: true });
    fetchReleaseTracks(release, artistName)
      .then(tracks => setOpenRelease(cur => (cur && cur.release.browseId === release.browseId ? { release, tracks, loading: false } : cur)))
      .catch(() => setOpenRelease(cur => (cur && cur.release.browseId === release.browseId ? { release, tracks: [], loading: false } : cur)));
  };

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

  if (openRelease) {
    const r = openRelease.release;
    return (
      <PlaylistDetailView
        title={r.title}
        subtitle={[artistName, r.kind, r.year].filter(Boolean).join(' • ')}
        coverUrl={r.coverUrl}
        tracks={openRelease.tracks}
        onBack={() => setOpenRelease(null)}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto pb-28 bg-app-primary" onScroll={handleScroll}>
      <TrackOptionsMenuModal track={menuTrack} onClose={() => setMenuTrack(null)} />

      {/* Compact bar: appears with the artist's name once the photo scrolls away */}
      <div
        className="sticky top-0 z-20 -mb-[calc(max(env(safe-area-inset-top,0px),48px)+56px)] flex items-center gap-3 px-4 pt-[calc(max(env(safe-area-inset-top,0px),48px))] h-[calc(max(env(safe-area-inset-top,0px),48px)+56px)] select-none transition-colors"
        style={{ backgroundColor: `rgba(10, 10, 10, ${Math.min(0.92, Math.max(0, (scrollY - 140) / 120))})` }}
      >
        <button
          onClick={onBack}
          className="p-2.5 rounded-full bg-black/35 hover:bg-black/50 active:scale-95 text-white cursor-pointer transition-all backdrop-blur-md"
          title={tr("Back")}
        >
          <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
        </button>
        <p
          className="text-lg font-bold text-white truncate transition-opacity"
          style={{ opacity: Math.min(1, Math.max(0, (scrollY - 200) / 80)) }}
        >
          {artistName}
        </p>
      </div>

      {/* Header: wide artist photo with the name over it */}
      <div className="relative h-[320px] md:h-[360px] overflow-hidden select-none shrink-0">
        {(photo || allTracks[0]?.coverUrl) && (
          <img
            src={photo || allTracks[0]?.coverUrl}
            alt={artistName}
            className="absolute inset-0 w-full h-full object-cover object-[center_25%] will-change-transform"
            style={{
              transform: `translateY(${scrollY * 0.35}px) scale(${1 + Math.min(scrollY, 300) / 1500})`,
              opacity: Math.max(0.15, 1 - scrollY / 380),
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-app-primary" />
        <div className="absolute left-5 right-5 bottom-4">
          <h1 className="text-4xl md:text-5xl font-black text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] truncate">
            {artistName}
          </h1>
          <p className="text-sm text-white/80 mt-1">
            {allTracks.length} songs{loading ? ' • loading more...' : ''}
            {likedSongsByArtist.length > 0 ? ` • ${likedSongsByArtist.length} liked` : ''}
          </p>
        </div>
      </div>

      <div className="relative pb-6 px-5 select-none">
        {/* Action Row */}
        <div className="flex items-center justify-start gap-6 pt-4">
          <button onClick={handlePlayAll} className="p-3 rounded-full bg-app-highlight text-app-inverse hover:scale-110 active:scale-95 transition-transform shadow-lg" title={tr("Play All")}>
            <Play className="w-6 h-6 fill-current ml-0.5" />
          </button>
          <button onClick={handleShuffle} className="p-3 text-app-primary cursor-pointer hover:scale-110 active:scale-95 transition-transform" title={tr("Shuffle")}>
            <Shuffle className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* About the artist */}
      {(bio || about?.monthlyAudience || about?.subscribers) && (
        <div className="px-5 pb-6">
          <h2 className="text-xl font-bold text-app-primary pb-2">{tr('About')}</h2>
          {(about?.monthlyAudience || about?.subscribers || about?.views) && (
            <p className="text-sm text-app-secondary pb-2">
              {[about?.monthlyAudience, about?.subscribers && tr('{count} subscribers', { count: about.subscribers }), about?.views]
                .filter(Boolean)
                .join(' • ')}
            </p>
          )}
          {bio && (
            <>
              <p
                className={`text-sm text-app-primary leading-relaxed whitespace-pre-line select-text ${bioOpen ? '' : 'line-clamp-4'}`}
                style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
              >
                {bio.text}
              </p>
              <div className="flex items-center gap-4 pt-1.5">
                {bio.text.length > 260 && (
                  <button onClick={() => setBioOpen(v => !v)} className="text-sm font-semibold text-app-primary hover:underline">
                    {bioOpen ? tr('Show less') : tr('Show more')}
                  </button>
                )}
                {bio.source === 'wikipedia' && bio.url && (
                  <a
                    href={bio.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-app-secondary hover:text-app-primary hover:underline"
                  >
                    {tr('From Wikipedia')}
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      )}

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
                    <p className={`text-base font-semibold truncate ${isCurrent ? 'text-app-accent font-bold' : 'text-app-primary'}`}>
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
                      toggleFavorite(t.id, t);
                    }}
                    className="p-2 shrink-0 cursor-pointer"
                    title={tr("Like")}
                  >
                    <Heart className={`w-5 h-5 ${isFav ? 'text-app-accent fill-current' : 'text-app-secondary'}`} />
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
                    title={tr("More Options")}
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
          <h2 className="text-xl font-bold text-app-primary px-2 pb-3">{tr("Most popular")}</h2>
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
                    title={tr("More Options")}
                  >
                    <MoreVertical className="w-5 h-5" />
                  </span>
                </button>
              );
            })}
          </div>
          {popularAll.length > 5 && (
            <button
              onClick={() => setShowAllPopular(v => !v)}
              className="mx-2 mt-2 text-sm font-semibold text-app-secondary hover:text-app-primary"
            >
              {showAllPopular ? tr('Show less') : tr('Show all {count}', { count: popularAll.length })}
            </button>
          )}
        </div>
      )}

      {/* Videos */}
      {shownVideos.length > 0 && (
        <div className="px-5 pt-8">
          <h2 className="text-xl font-bold text-app-primary pb-4">{tr("Videos")}</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
            {shownVideos.map((v, idx) => (
              <button
                key={`${v.id}-${idx}`}
                onClick={() => playQueue(shownVideos, idx)}
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
      {albumList.length > 0 && (
        <div className="px-5 pt-8">
          <div className="flex items-baseline justify-between pb-4">
            <h2 className="text-xl font-bold text-app-primary">{tr('Albums')}</h2>
            {albumList.length > 8 && (
              <button onClick={() => setShowAllAlbums(v => !v)} className="text-sm font-semibold text-app-secondary hover:text-app-primary">
                {showAllAlbums ? tr('Show less') : tr('Show all {count}', { count: albumList.length })}
              </button>
            )}
          </div>
          <div className={showAllAlbums ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4' : 'flex gap-4 overflow-x-auto pb-2 no-scrollbar'}>
            {(showAllAlbums ? albumList : albumList.slice(0, 12)).map(r => (
              <button key={r.browseId} onClick={() => openReleasePage(r)} className={showAllAlbums ? 'text-left' : 'w-36 shrink-0 text-left'}>
                <div className={`${showAllAlbums ? 'w-full aspect-square' : 'w-36 h-36'} rounded-xl bg-app-card overflow-hidden flex items-center justify-center`}>
                  {r.coverUrl ? <img src={r.coverUrl} alt={r.title} loading="lazy" className="w-full h-full object-cover" /> : <Disc3 className="w-10 h-10 text-app-primary" />}
                </div>
                <p className="text-sm font-semibold text-app-primary mt-2 truncate">{r.title}</p>
                <p className="text-xs text-app-secondary truncate">{[r.year, r.kind].filter(Boolean).join(' • ')}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {singleList.length > 0 && (
        <div className="px-5 pt-8">
          <h2 className="text-xl font-bold text-app-primary pb-4">{tr('Singles & EPs')}</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
            {singleList.map(r => (
              <button key={r.browseId} onClick={() => openReleasePage(r)} className="w-36 shrink-0 text-left">
                <div className="w-36 h-36 rounded-xl bg-app-card overflow-hidden flex items-center justify-center">
                  {r.coverUrl ? <img src={r.coverUrl} alt={r.title} loading="lazy" className="w-full h-full object-cover" /> : <Disc3 className="w-10 h-10 text-app-primary" />}
                </div>
                <p className="text-sm font-semibold text-app-primary mt-2 truncate">{r.title}</p>
                <p className="text-xs text-app-secondary truncate">{[r.year, r.kind].filter(Boolean).join(' • ')}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Albums from the songs on hand (your own music, or when the page has none) */}
      {albumList.length === 0 && singleList.length === 0 && derivedAlbums.length > 0 && (
        <div className="px-5 pt-8">
          <h2 className="text-xl font-bold text-app-primary pb-4">{tr("Records")}</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
            {derivedAlbums.map(([name, albumTracks]) => (
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
        <h2 className="text-xl font-bold text-app-primary px-2 pb-3">{tr("Songs")}</h2>
        {allTracks.length === 0 && loading ? (
          <p className="text-center text-sm text-app-secondary py-10">{tr("Loading songs...")}</p>
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
                    title={tr("More Options")}
                  >
                    <MoreVertical className="w-5 h-5" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {allTracks.length > 0 && (
          <div className="py-6 flex justify-center">
            {loadingMore ? (
              <Loader2 className="w-6 h-6 animate-spin text-app-secondary" />
            ) : noMore ? (
              <p className="text-sm text-app-secondary">{tr("That's all the songs found")}</p>
            ) : (
              <button
                onClick={() => void loadMore()}
                className="px-4 py-2 rounded-full bg-app-card border border-app-theme text-sm font-semibold text-app-primary"
              >
                {tr("Load more songs")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
