import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { PlayCircle, Loader2 } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { searchYouTubeMusic, getCachedSearch } from '../utils/ytMusicApi';
import type { Track } from '../types/music';

interface Shelf {
  title: string;
  tracks: Track[];
}

const ALL_INFINITE_SHELVES: { title: string; query: string }[] = [
  { title: 'Top Hits', query: 'billboard top 100 hits' },
  { title: 'Hip-Hop & Rap Heat', query: 'trending hip hop rap' },
  { title: 'New Releases', query: 'new rap hip hop releases' },
  { title: 'Essential Anthems', query: 'popular rap anthems' },
  { title: 'Viral & Trending Now', query: 'viral hits trending music' },
  { title: 'Synthwave & Cyberpunk Vibes', query: 'synthwave electronic cyberpunk retrowave' },
  { title: 'Chill & Lo-Fi Beats', query: 'chill lofi hip hop study beats' },
  { title: 'Pop & Dance Energy', query: 'dance pop party energy hits' },
  { title: 'Rock & Alternative Classics', query: 'classic rock alternative indie anthems' },
  { title: 'R&B & Soul Sessions', query: 'smooth rb soul contemporary groove' },
  { title: 'Indie & Bedroom Pop', query: 'indie bedroom pop aesthetic songs' },
  { title: 'Electronic & Festival Anthems', query: 'electronic dance music edm drops' },
  { title: 'Late Night Melancholy', query: 'late night moody melancholic vibes' },
  { title: 'Workout & Power Hype', query: 'gym workout motivation hype pump' },
  { title: 'Global Top 50 Charts', query: 'global top 50 music charts' },
  { title: 'Acoustic & Unplugged', query: 'acoustic guitar singer songwriter unplugged' },
  { title: 'Latin & Reggaeton Wave', query: 'reggaeton latino hits party' },
  { title: 'Jazz & Coffeehouse Sessions', query: 'smooth jazz coffee shop study' },
  { title: 'Y2K & 2000s Nostalgia', query: '2000s pop rock r&b nostalgia hits' },
  { title: 'Gaming & Cyber Electro', query: 'gaming electro bass boost epic' },
  { title: 'Deep Focus & Ambient Flow', query: 'ambient atmospheric deep focus' },
  { title: 'Club & Bass Bangers', query: 'club bass trap heavy beat' },
  { title: 'Heavy Metal & Hard Rock', query: 'metal hard rock guitar riffs' },
  { title: 'Peaceful Piano & Strings', query: 'calm piano instrumental peaceful' },
];

export const HomeView: React.FC = () => {
  const {
    tracks,
    favoriteTracks,
    recentlyPlayed,
    downloads,
    playQueue,
    settings,
    setActiveTab,
    currentTrack,
  } = useAudio();

  // Dynamic Icon & Text Sizing Helpers based on settings.iconSize and compactView
  const isCompact = settings.iconSize === 'compact' || settings.compactView;
  const isLarge = settings.iconSize === 'large';

  // Responsive styling classes for icon and text size
  const avatarClass = isCompact
    ? 'w-9 h-9 text-sm'
    : isLarge
    ? 'w-14 h-14 text-xl'
    : 'w-11 h-11 text-lg';

  const headerTitleClass = isCompact
    ? 'text-sm font-bold text-app-primary truncate'
    : isLarge
    ? 'text-lg font-bold text-app-primary truncate'
    : 'text-base font-bold text-app-primary truncate';

  const quickPickImgClass = isCompact
    ? 'w-12 h-12 rounded-lg'
    : isLarge
    ? 'w-20 h-20 rounded-2xl'
    : 'w-16 h-16 rounded-xl';

  const quickPickTitleClass = isCompact
    ? 'text-xs font-semibold text-app-primary truncate'
    : isLarge
    ? 'text-lg font-bold text-app-primary truncate'
    : 'text-base font-semibold text-app-primary truncate';

  const quickPickArtistClass = isCompact
    ? 'text-[11px] text-app-secondary truncate'
    : isLarge
    ? 'text-base text-app-secondary truncate'
    : 'text-sm text-app-secondary truncate';

  const shelfCardClass = isCompact
    ? 'w-32 shrink-0 text-left'
    : isLarge
    ? 'w-52 shrink-0 text-left'
    : 'w-40 shrink-0 text-left';

  const shelfImgContainerClass = isCompact
    ? 'relative w-32 h-36 rounded-lg overflow-hidden bg-app-surface'
    : isLarge
    ? 'relative w-52 h-56 rounded-2xl overflow-hidden bg-app-surface'
    : 'relative w-40 h-44 rounded-xl overflow-hidden bg-app-surface';

  const shelfTitleClass = isCompact
    ? 'text-xs font-semibold text-app-primary mt-1.5 truncate'
    : isLarge
    ? 'text-lg font-bold text-app-primary mt-2.5 truncate'
    : 'text-base font-semibold text-app-primary mt-2 truncate';

  const shelfArtistClass = isCompact
    ? 'text-[11px] text-app-secondary truncate'
    : isLarge
    ? 'text-base text-app-secondary truncate'
    : 'text-sm text-app-secondary truncate';

  const shelfSectionHeaderClass = isCompact
    ? 'text-lg font-bold text-app-primary px-5 pb-2.5'
    : isLarge
    ? 'text-3xl font-extrabold text-app-primary px-5 pb-4'
    : 'text-2xl font-bold text-app-primary px-5 pb-4';

  const quickPicksHeaderClass = isCompact
    ? 'text-xl font-bold text-app-primary px-5 pt-3 pb-3'
    : isLarge
    ? 'text-4xl font-extrabold text-app-primary px-5 pt-5 pb-5'
    : 'text-3xl font-bold text-app-primary px-5 pt-4 pb-4';

  // Suggestions based on what's playing / last played
  const seedArtist = currentTrack?.artist || recentlyPlayed[0]?.artist || '';
  const [suggestion, setSuggestion] = useState<{ artist: string; tracks: Track[] } | null>(null);

  useEffect(() => {
    if (!seedArtist) return;
    let mounted = true;
    searchYouTubeMusic(seedArtist).then(results => {
      if (mounted && results && results.length > 0) {
        setSuggestion({ artist: seedArtist, tracks: results });
      }
    }).catch(() => {});
    return () => {
      mounted = false;
    };
  }, [seedArtist]);

  const [apiPicks, setApiPicks] = useState<Track[]>([]);
  const [apiShelves, setApiShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedQueryIndex, setLoadedQueryIndex] = useState(4);
  const loadingMoreRef = useRef(false);

  const allKnown = useMemo(() => {
    const map = new Map<string, Track>();
    recentlyPlayed.forEach(t => map.set(t.id, t));
    favoriteTracks.forEach(t => map.set(t.id, t));
    tracks.forEach(t => map.set(t.id, t));
    return Array.from(map.values());
  }, [tracks, favoriteTracks, recentlyPlayed]);

  // Initial Shelves Load
  useEffect(() => {
    let mounted = true;

    // Show cached content instantly so the app never sits on a spinner
    const cachedPicks = getCachedSearch('top hits popular songs');
    if (cachedPicks && cachedPicks.length > 0) {
      setApiPicks(cachedPicks);
      setLoading(false);
    }
    const cachedShelves: Shelf[] = [];
    ALL_INFINITE_SHELVES.slice(0, 4).forEach(s => {
      const c = getCachedSearch(s.query);
      if (c && c.length > 0) cachedShelves.push({ title: s.title, tracks: c });
    });
    if (cachedShelves.length > 0) setApiShelves(cachedShelves);

    // Safety timeout
    const safety = window.setTimeout(() => {
      if (mounted) setLoading(false);
    }, 15000);

    const loadInitial = async () => {
      setLoading(true);
      const initialQueries = ALL_INFINITE_SHELVES.slice(0, 4);
      const results = await Promise.allSettled([
        searchYouTubeMusic('top hits popular songs'),
        ...initialQueries.map(s => searchYouTubeMusic(s.query)),
      ]);
      if (!mounted) return;

      const picks = results[0].status === 'fulfilled' ? results[0].value : [];
      if (picks && picks.length > 0) setApiPicks(picks);

      const shelves: Shelf[] = [];
      initialQueries.forEach((s, i) => {
        const r = results[i + 1];
        if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
          shelves.push({ title: s.title, tracks: r.value });
        }
      });
      if (shelves.length > 0) setApiShelves(shelves);
      setLoading(false);
    };

    void loadInitial();
    return () => {
      mounted = false;
      window.clearTimeout(safety);
    };
  }, []);

  // Infinite Scroll Shelves Loader
  const loadNextShelves = useCallback(async () => {
    if (loadingMoreRef.current || loading) return;
    if (loadedQueryIndex >= ALL_INFINITE_SHELVES.length) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const nextBatch = ALL_INFINITE_SHELVES.slice(loadedQueryIndex, loadedQueryIndex + 2);
      const results = await Promise.allSettled(
        nextBatch.map(s => searchYouTubeMusic(s.query))
      );

      const newShelves: Shelf[] = [];
      nextBatch.forEach((s, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
          newShelves.push({ title: s.title, tracks: r.value });
        }
      });

      if (newShelves.length > 0) {
        setApiShelves(prev => {
          const existingTitles = new Set(prev.map(p => p.title));
          const fresh = newShelves.filter(ns => !existingTitles.has(ns.title));
          return [...prev, ...fresh];
        });
      }
      setLoadedQueryIndex(prev => prev + 2);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [loading, loadedQueryIndex]);

  // Scroll listener for infinite scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) {
      void loadNextShelves();
    }
  };

  const quickPicks = apiPicks.length > 0 ? apiPicks.slice(0, 8) : allKnown.slice(0, 8);

  const localShelves = useMemo<Shelf[]>(() => {
    const list: Shelf[] = [];
    if (favoriteTracks.length > 0) list.push({ title: 'Your favorites', tracks: favoriteTracks });
    const dls = allKnown.filter(t => downloads.includes(t.id));
    if (dls.length > 0) list.push({ title: 'Your offline mixes', tracks: dls });
    return list;
  }, [allKnown, favoriteTracks, downloads]);

  const shelves = [...apiShelves, ...localShelves];

  return (
    <div
      className="flex-1 overflow-y-auto pb-28 bg-transparent"
      onScroll={handleScroll}
    >
      {/* Profile Header */}
      <div className="flex items-center gap-3 px-5 safe-top pb-2">
        <button
          onClick={() => setActiveTab('settings')}
          className={`${avatarClass} rounded-full overflow-hidden bg-app-card border border-app-theme flex items-center justify-center shrink-0 shadow-sm`}
          title="Profile & settings"
        >
          {settings.profileAvatar ? (
            <img src={settings.profileAvatar} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <span className="text-app-primary font-bold">
              {(settings.profileName || 'M').charAt(0).toUpperCase()}
            </span>
          )}
        </button>
        <div className="min-w-0">
          <p className={headerTitleClass}>{settings.profileName}</p>
          <p className="text-xs text-app-secondary">Profile & settings</p>
        </div>
      </div>

      {/* Quick Picks */}
      <h1 className={quickPicksHeaderClass}>Quick Picks</h1>

      {loading && quickPicks.length === 0 ? (
        <div className="flex items-center justify-center py-16 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-app-primary" />
          <p className="text-sm text-app-secondary">Loading songs...</p>
        </div>
      ) : quickPicks.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-app-secondary">
            No songs yet — search for music or download songs to see them here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 stagger">
          {quickPicks.map((t, idx) => (
            <button
              key={`${t.id}-${idx}`}
              onClick={() => playQueue(quickPicks, idx)}
              className="flex items-center gap-3 text-left min-w-0 hover:opacity-80 active:scale-[0.98] transition-all"
            >
              <img
                src={t.coverUrl}
                alt={t.title}
                loading="lazy"
                className={`${quickPickImgClass} object-cover shrink-0 shadow-sm`}
              />
              <div className="min-w-0 flex-1">
                <p className={quickPickTitleClass}>{t.title}</p>
                <p className={quickPickArtistClass}>{t.artist}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Suggestions based on what's playing */}
      {suggestion && (
        <div className="mt-8 anim-rise">
          <h2 className={shelfSectionHeaderClass}>
            More like {suggestion.artist}
          </h2>
          <div className="flex gap-4 overflow-x-auto px-5 pb-2 no-scrollbar">
            {suggestion.tracks.slice(0, 12).map((t, idx) => (
              <button
                key={`${t.id}-${idx}`}
                onClick={() => playQueue(suggestion.tracks, idx)}
                className={`${shelfCardClass} hover:opacity-90 active:scale-[0.98] transition-all`}
              >
                <div className={shelfImgContainerClass}>
                  <img
                    src={t.coverUrl}
                    alt={t.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <PlayCircle className="absolute top-2 left-2 w-5 h-5 text-app-primary fill-black/40" />
                </div>
                <p className={shelfTitleClass}>{t.title}</p>
                <p className={shelfArtistClass}>{t.artist}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Shelves */}
      {shelves.map((shelf, sIdx) => (
        <div key={`${shelf.title}-${sIdx}`} className="mt-8 anim-rise">
          <h2 className={shelfSectionHeaderClass}>{shelf.title}</h2>
          <div className="flex gap-4 overflow-x-auto px-5 pb-2 no-scrollbar">
            {shelf.tracks.slice(0, 12).map((t, idx) => (
              <button
                key={`${t.id}-${idx}`}
                onClick={() => playQueue(shelf.tracks, idx)}
                className={`${shelfCardClass} hover:opacity-90 active:scale-[0.98] transition-all`}
              >
                <div className={shelfImgContainerClass}>
                  <img
                    src={t.coverUrl}
                    alt={t.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <PlayCircle className="absolute top-2 left-2 w-5 h-5 text-app-primary fill-black/40" />
                </div>
                <p className={shelfTitleClass}>{t.title}</p>
                <p className={shelfArtistClass}>{t.artist}</p>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Infinite Scroll Loading Sentinel & Spinner */}
      {(loadingMore || (loading && shelves.length === 0 && quickPicks.length > 0)) && (
        <div className="flex items-center justify-center py-10 gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-app-primary" />
          <p className="text-sm text-app-secondary">Discovering more music...</p>
        </div>
      )}
    </div>
  );
};
