import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { t as tr } from '../i18n';
import { PlayCircle, Loader2, ListPlus, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { searchYouTubeMusic, fetchHomeQuickPicks, fetchSimilarSongs, fetchArtistTopSongs } from '../utils/ytMusicApi';
import { createHomeFeed, type HomeFeed, type HomeRow } from '../utils/homeFeed';
import type { Track } from '../types/music';
import {
  buildDailyMixes,
  buildRediscover,
  leadSeedsForToday,
  buildDiscoverMix,
  dayKey,
  type Mix,
} from '../utils/listening';

interface Shelf {
  title: string;
  tracks: Track[];
}

const HOME_CACHE_KEY = 'frf_home_cache_v1';

function readHomeCache(): { picks: Track[]; rows: HomeRow[] } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(HOME_CACHE_KEY) || 'null');
    return raw && raw.day === dayKey() ? raw : null;
  } catch {
    return null;
  }
}

export const HomeView: React.FC = () => {
  const {
    tracks,
    favoriteTracks,
    recentlyPlayed,
    playCounts,
    favorites,
    downloads,
    playQueue,
    settings,
    setActiveTab,
    currentTrack,
    playlists,
    importPlaylistToLibrary,
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

  // "More like ...": YouTube Music's radio for what's playing (or was last
  // played), which matches the style far better than searching the artist.
  const seedTrack = currentTrack?.youtubeId ? currentTrack : recentlyPlayed.find(t => t.youtubeId) || null;
  const seedVideoId = seedTrack?.youtubeId || '';
  const seedArtist = seedTrack?.artist || '';
  const [suggestion, setSuggestion] = useState<{ artist: string; tracks: Track[] } | null>(null);

  useEffect(() => {
    if (!seedVideoId) return;
    let mounted = true;
    void (async () => {
      // The artist's own popular songs taking turns with similar songs, so the
      // row is about that artist and not only songs that sound like them.
      const [top, radio] = await Promise.all([
        fetchArtistTopSongs(seedArtist).catch(() => [] as Track[]),
        fetchSimilarSongs(seedVideoId).catch(() => [] as Track[]),
      ]);
      const own = top.filter(t => t.youtubeId !== seedVideoId).slice(0, 10);
      const similar = radio.filter(t => t.youtubeId !== seedVideoId);
      let list: Track[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < Math.max(own.length, similar.length) && list.length < 30; i++) {
        for (const t of [own[i], similar[i]]) {
          if (t && !seen.has(t.id)) {
            seen.add(t.id);
            list.push(t);
          }
        }
      }
      if (list.length === 0) list = await searchYouTubeMusic(seedArtist).catch(() => [] as Track[]);
      if (mounted && list.length > 0) setSuggestion({ artist: seedArtist, tracks: list });
    })();
    return () => {
      mounted = false;
    };
  }, [seedVideoId, seedArtist]);

  const cachedHome = useMemo(readHomeCache, []);
  const [apiPicks, setApiPicks] = useState<Track[]>(() => cachedHome?.picks || []);
  const [rows, setRows] = useState<HomeRow[]>(() => cachedHome?.rows || []);
  const [loading, setLoading] = useState(() => !(cachedHome?.picks?.length));
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const feedRef = useRef<HomeFeed | null>(null);
  const feedDoneRef = useRef(false);
  const shownKeysRef = useRef<Set<string>>(new Set((cachedHome?.rows || []).map(r => r.key)));
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const atEndRef = useRef<() => boolean>(() => false);

  const allKnown = useMemo(() => {
    const map = new Map<string, Track>();
    recentlyPlayed.forEach(t => map.set(t.id, t));
    favoriteTracks.forEach(t => map.set(t.id, t));
    tracks.forEach(t => map.set(t.id, t));
    return Array.from(map.values());
  }, [tracks, favoriteTracks, recentlyPlayed]);

  // Made for you: daily mixes around your top artists (your songs + their most
  // popular songs + radio for your favourite song of theirs), a Discover Mix
  // of new artists from those radios, and Rediscover. The fetched songs are
  // kept for the day.
  const MIX_EXTRAS_KEY = 'frf_mix_extras_v2';
  const [mixExtras, setMixExtras] = useState<Record<string, Track[]>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(MIX_EXTRAS_KEY) || 'null');
      return raw && raw.day === dayKey() ? raw.extras : {};
    } catch {
      return {};
    }
  });
  const mixInput = useMemo(
    () => ({ known: allKnown, favoriteIds: favorites, playCounts }),
    [allKnown, favorites, playCounts]
  );
  const leadSeeds = leadSeedsForToday(mixInput);
  const leadKey = leadSeeds.map(l => `${l.name}~${l.seedVideoId}`).join('|');
  useEffect(() => {
    const leads = leadKey
      ? leadKey.split('|').map(s => {
          const [name, seedVideoId] = s.split('~');
          return { name, seedVideoId };
        })
      : [];
    const missing = leads.filter(l => !mixExtras[l.name]);
    if (missing.length === 0) return;
    let live = true;
    void Promise.all(
      missing.map(async l => {
        const [top, radio] = await Promise.all([
          fetchArtistTopSongs(l.name).catch(() => [] as Track[]),
          l.seedVideoId ? fetchSimilarSongs(l.seedVideoId).catch(() => [] as Track[]) : Promise.resolve([] as Track[]),
        ]);
        // Their hits and the radio, taking turns; the radio's first entry is the seed itself.
        const hits = top.slice(0, 12);
        const similar = radio.slice(1, 24);
        const mixed: Track[] = [];
        for (let i = 0; i < Math.max(hits.length, similar.length); i++) {
          if (hits[i]) mixed.push(hits[i]);
          if (similar[i]) mixed.push(similar[i]);
        }
        return { name: l.name, mixed, similar };
      })
    ).then(results => {
      if (!live) return;
      setMixExtras(prev => {
        const next = { ...prev };
        const discover = [...(prev.__discover__ || [])];
        for (const r of results) {
          if (r.mixed.length) next[r.name] = r.mixed;
          discover.push(...r.similar);
        }
        next.__discover__ = discover;
        try {
          localStorage.setItem(MIX_EXTRAS_KEY, JSON.stringify({ day: dayKey(), extras: next }));
        } catch {
          // ignore
        }
        return next;
      });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadKey]);
  const madeForYou = useMemo<Mix[]>(() => {
    const list = buildDailyMixes(mixInput, mixExtras);
    const discover = buildDiscoverMix(mixInput, mixExtras.__discover__ || []);
    const re = buildRediscover(mixInput);
    return [...list, ...(discover ? [discover] : []), ...(re ? [re] : [])];
  }, [mixInput, mixExtras]);

  // Quick Picks: YouTube Music's own "Quick picks" (a search only if that fails).
  useEffect(() => {
    let live = true;
    const safety = window.setTimeout(() => {
      if (live) setLoading(false);
    }, 15000);
    void (async () => {
      let picks = await fetchHomeQuickPicks();
      if (picks.length === 0) picks = await searchYouTubeMusic('top hits popular songs').catch(() => []);
      if (!live) return;
      if (picks.length > 0) setApiPicks(picks);
      setLoading(false);
    })();
    return () => {
      live = false;
      window.clearTimeout(safety);
    };
  }, []);

  // Rows come from the automatic feed (charts, then moods & genres), a couple
  // at a time.
  const loadRows = useCallback(async (count: number) => {
    if (loadingMoreRef.current || feedDoneRef.current) return;
    if (!feedRef.current) feedRef.current = createHomeFeed();
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      let added = 0;
      while (added < count) {
        const row = await feedRef.current.next();
        if (!row) {
          feedDoneRef.current = true;
          break;
        }
        if (shownKeysRef.current.has(row.key)) continue;
        shownKeysRef.current.add(row.key);
        setRows(prev => [...prev, row]);
        added++;
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
    // Still at the end (rows were short or the screen is tall): keep going.
    window.setTimeout(() => {
      if (!feedDoneRef.current && atEndRef.current()) void loadRows(2);
    }, 50);
  }, []);

  useEffect(() => {
    void loadRows(rows.length > 0 ? 1 : 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRows]);

  // Remember today's Quick Picks and first rows, so Home opens full straight away.
  useEffect(() => {
    if (apiPicks.length === 0) return;
    try {
      localStorage.setItem(
        HOME_CACHE_KEY,
        JSON.stringify({ day: dayKey(), picks: apiPicks, rows: rows.slice(0, 4) })
      );
    } catch {
      // storage full: just not cached
    }
  }, [apiPicks, rows]);

  // More rows only once you actually reach the end of the rows. (It used to
  // start 600px early, so "Discovering more music" showed before you got there.)
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const atEnd = () => {
    const box = scrollBoxRef.current;
    const end = sentinelRef.current;
    if (!box || !end) return false;
    return end.getBoundingClientRect().top <= box.getBoundingClientRect().bottom + 24;
  };
  atEndRef.current = atEnd;
  const onHomeScroll = () => {
    if (atEnd()) void loadRows(2);
  };

  // Quick Picks: every song loaded (not just 8), in pages of 8 you swipe through.
  const quickPicks = apiPicks.length > 0 ? apiPicks : allKnown.slice(0, 24);
  const quickPickPages = useMemo(() => {
    const pages: Track[][] = [];
    for (let i = 0; i < quickPicks.length; i += 8) pages.push(quickPicks.slice(i, i + 8));
    return pages;
  }, [quickPicks]);

  // Save a Made for you mix as one of your playlists (it changes every day).
  const [savedMixIds, setSavedMixIds] = useState<Set<string>>(new Set());
  const saveMixAsPlaylist = (mix: Mix) => {
    if (mix.tracks.length === 0) return;
    const taken = new Set(playlists.map(p => p.name));
    const date = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const name = taken.has(mix.title) ? `${mix.title} (${date})` : mix.title;
    importPlaylistToLibrary(name, mix.subtitle, mix.tracks);
    setSavedMixIds(prev => new Set(prev).add(mix.id));
  };

  const localShelves = useMemo<Shelf[]>(() => {
    const list: Shelf[] = [];
    if (favoriteTracks.length > 0) list.push({ title: 'Your favorites', tracks: favoriteTracks });
    const dls = allKnown.filter(t => downloads.includes(t.id));
    if (dls.length > 0) list.push({ title: 'Your offline mixes', tracks: dls });
    return list;
  }, [allKnown, favoriteTracks, downloads]);

  const visibleRows: HomeRow[] = [...localShelves.map(s => ({ ...s, key: `local-${s.title}` })), ...rows];

  return (
    <div ref={scrollBoxRef} onScroll={onHomeScroll} className="flex-1 overflow-y-auto pb-28 bg-transparent">
      {/* Profile Header */}
      <div className="flex items-center gap-3 px-5 safe-top pb-2">
        <button
          onClick={() => setActiveTab('settings')}
          className={`${avatarClass} rounded-full overflow-hidden bg-app-card border border-app-theme flex items-center justify-center shrink-0 shadow-sm`}
          title={tr("Profile & settings")}
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
          <p className="text-xs text-app-secondary">{tr("Profile & settings")}</p>
        </div>
      </div>

      {/* Quick Picks */}
      <h1 className={quickPicksHeaderClass}>{tr("Quick Picks")}</h1>

      {loading && quickPicks.length === 0 ? (
        <div className="flex items-center justify-center py-16 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-app-primary" />
          <p className="text-sm text-app-secondary">{tr("Loading songs...")}</p>
        </div>
      ) : quickPicks.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-app-secondary">
            {tr("No songs yet — search for music or download songs to see them here.")}
          </p>
        </div>
      ) : (
        <ScrollRow className="snap-x snap-mandatory scroll-px-5 pb-1">
          {quickPickPages.map((page, p) => (
            <div
              key={p}
              className={`grid grid-cols-2 gap-x-4 gap-y-4 shrink-0 snap-start stagger ${
                quickPickPages.length > 1 ? "w-[92%]" : "w-full"
              }`}
            >
              {page.map((t, i) => {
                const idx = p * 8 + i;
                return (
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
                );
              })}
            </div>
          ))}
        </ScrollRow>
      )}

      {/* Daily mixes and Rediscover */}
      {madeForYou.length > 0 && (
        <div className="mt-8 anim-rise">
          <h2 className={shelfSectionHeaderClass}>{tr("Made for you")}</h2>
          <ScrollRow>
            {madeForYou.map(mix => {
              const saved = savedMixIds.has(mix.id);
              return (
                <div key={mix.id} className={`${shelfCardClass} relative`}>
                  <button
                    onClick={() => playQueue(mix.tracks, 0)}
                    className="w-full text-left hover:opacity-90 active:scale-[0.98] transition-all"
                  >
                    <div className={shelfImgContainerClass}>
                      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
                        {[0, 1, 2, 3].map(i => (
                          <img
                            key={i}
                            src={mix.tracks[i % mix.tracks.length]?.coverUrl}
                            alt=""
                            loading="lazy"
                            className="w-full h-full object-cover"
                          />
                        ))}
                      </div>
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                        <p className="text-sm font-bold text-white">{mix.title}</p>
                      </div>
                    </div>
                    <p className={shelfArtistClass}>{mix.subtitle}</p>
                  </button>
                  <button
                    onClick={() => !saved && saveMixAsPlaylist(mix)}
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm text-white flex items-center justify-center active:scale-95 transition-transform"
                    title={saved ? tr("Saved to your playlists") : tr("Save as playlist")}
                    aria-label={saved ? tr("Saved to your playlists") : tr("Save as playlist")}
                  >
                    {saved ? <Check className="w-4 h-4" /> : <ListPlus className="w-4 h-4" />}
                  </button>
                </div>
              );
            })}
          </ScrollRow>
        </div>
      )}

      {/* Suggestions based on what's playing */}
      {suggestion && (
        <div className="mt-8 anim-rise">
          <h2 className={shelfSectionHeaderClass}>
            More like {suggestion.artist}
          </h2>
          <ScrollRow>
            {suggestion.tracks.map((t, idx) => (
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
          </ScrollRow>
        </div>
      )}

      {/* Rows: your favourites / offline songs, then the automatic feed */}
      {visibleRows.map((row, sIdx) => (
        <div key={`${row.key}-${sIdx}`} className="mt-8 anim-rise">
          <div className="px-5 pb-4">
            {row.subtitle && (
              <p className="text-xs font-semibold uppercase tracking-wide text-app-secondary">{tr(row.subtitle)}</p>
            )}
            <h2 className={shelfSectionHeaderClass.replace(/px-5 pb-\S+/, '')}>{row.title}</h2>
          </div>
          <ScrollRow>
            {row.tracks.map((t, idx) => (
              <button
                key={`${t.id}-${idx}`}
                onClick={() => playQueue(row.tracks, idx)}
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
          </ScrollRow>
        </div>
      ))}

      {/* Bottom marker: more rows load when this comes into view */}
      <div ref={sentinelRef} className="h-px" />
      {loadingMore && (
        <div className="flex items-center justify-center py-10 gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-app-primary" />
          <p className="text-sm text-app-secondary">{tr("Discovering more music...")}</p>
        </div>
      )}
    </div>
  );
};

// A sideways row of songs with arrows to scroll it (a mouse can't swipe) and
// a thin scrollbar. The arrows only show when there is more to that side.
const ScrollRow: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = 'pb-2' }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    Array.from(el.children).forEach(c => ro.observe(c));
    return () => ro.disconnect();
  }, [update, children]);
  const scrollBy = (dir: number) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };
  const arrow = 'absolute top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/70 backdrop-blur-sm text-white flex items-center justify-center shadow-lg hover:bg-black/85 active:scale-95 transition';
  return (
    <div className="relative">
      <div ref={ref} onScroll={update} className={`flex gap-4 overflow-x-auto px-5 home-row-scroll ${className}`}>
        {children}
      </div>
      {canLeft && (
        <button onClick={() => scrollBy(-1)} className={`${arrow} left-1`} aria-label={tr('Scroll left')} title={tr('Scroll left')}>
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      {canRight && (
        <button onClick={() => scrollBy(1)} className={`${arrow} right-1`} aria-label={tr('Scroll right')} title={tr('Scroll right')}>
          <ChevronRight className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};
