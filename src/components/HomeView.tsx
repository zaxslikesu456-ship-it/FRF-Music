import React, { useEffect, useMemo, useState } from 'react';
import { PlayCircle, Loader2 } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { searchYouTubeMusic, getCachedSearch } from '../utils/ytMusicApi';
import type { Track } from '../types/music';


interface Shelf {
  title: string;
  tracks: Track[];
}

const SHELF_QUERIES: { title: string; query: string }[] = [
  { title: 'That summer feeling', query: 'summer vibes hits' },
  { title: 'Throwbacks', query: '80s 90s throwback hits' },
  { title: 'Chill mix', query: 'chill lofi beats' },
  { title: 'Hip-hop heat', query: 'trending hip hop rap' },
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

  const allKnown = useMemo(() => {
    const map = new Map<string, Track>();
    recentlyPlayed.forEach(t => map.set(t.id, t));
    favoriteTracks.forEach(t => map.set(t.id, t));
    tracks.forEach(t => map.set(t.id, t));
    return Array.from(map.values());
  }, [tracks, favoriteTracks, recentlyPlayed]);

  useEffect(() => {
    let mounted = true;

    // Show cached content instantly so the app never sits on a spinner
    const cachedPicks = getCachedSearch('top hits popular songs');
    if (cachedPicks && cachedPicks.length > 0) {
      setApiPicks(cachedPicks);
      setLoading(false);
    }
    const cachedShelves: Shelf[] = [];
    SHELF_QUERIES.forEach(s => {
      const c = getCachedSearch(s.query);
      if (c && c.length > 0) cachedShelves.push({ title: s.title, tracks: c });
    });
    if (cachedShelves.length > 0) setApiShelves(cachedShelves);

    // Never stay stuck on "loading"
    const safety = window.setTimeout(() => {
      if (mounted) setLoading(false);
    }, 20000);

    const load = async () => {
      setLoading(true);
      const results = await Promise.allSettled([
        searchYouTubeMusic('top hits popular songs'),
        ...SHELF_QUERIES.map(s => searchYouTubeMusic(s.query)),
      ]);
      if (!mounted) return;

      const picks = results[0].status === 'fulfilled' ? results[0].value : [];
      if (picks && picks.length > 0) setApiPicks(picks);

      const shelves: Shelf[] = [];
      SHELF_QUERIES.forEach((s, i) => {
        const r = results[i + 1];
        if (r.status === 'fulfilled' && r.value && r.value.length > 0) {
          shelves.push({ title: s.title, tracks: r.value });
        }
      });
      if (shelves.length > 0) setApiShelves(shelves);
      setLoading(false);
    };

    load();
    return () => {
      mounted = false;
      window.clearTimeout(safety);
    };
  }, []);

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
    <div className="flex-1 overflow-y-auto pb-28 bg-transparent">
      {/* Profile Header */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-2">
        <button
          onClick={() => setActiveTab('settings')}
          className="w-11 h-11 rounded-full overflow-hidden bg-app-card border border-app-theme flex items-center justify-center shrink-0"
          title="Profile & settings"
        >
          {settings.profileAvatar ? (
            <img src={settings.profileAvatar} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <span className="text-app-primary text-lg font-bold">
              {(settings.profileName || 'M').charAt(0).toUpperCase()}
            </span>
          )}
        </button>
        <div className="min-w-0">
          <p className="text-base font-bold text-app-primary truncate">{settings.profileName}</p>
          <p className="text-xs text-app-secondary">Profile & settings</p>
        </div>
      </div>

      {/* Quick Picks */}
      <h1 className="text-3xl font-bold text-app-primary px-5 pt-4 pb-4">Quick Picks</h1>

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
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-5 stagger">
          {quickPicks.map((t, idx) => (
            <button
              key={`${t.id}-${idx}`}
              onClick={() => playQueue(quickPicks, idx)}
              className="flex items-center gap-3 text-left min-w-0"
            >
              <img
                src={t.coverUrl}
                alt={t.title}
                loading="lazy"
                className="w-16 h-16 rounded-xl object-cover shrink-0"
              />
              <div className="min-w-0">
                <p className="text-base font-semibold text-app-primary truncate">{t.title}</p>
                <p className="text-sm text-app-secondary truncate">{t.artist}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Suggestions based on what's playing */}
      {suggestion && (
        <div className="mt-8 anim-rise">
          <h2 className="text-2xl font-bold text-app-primary px-5 pb-4">
            More like {suggestion.artist}
          </h2>
          <div className="flex gap-4 overflow-x-auto px-5 pb-2 no-scrollbar">
            {suggestion.tracks.slice(0, 12).map((t, idx) => (
              <button
                key={`${t.id}-${idx}`}
                onClick={() => playQueue(suggestion.tracks, idx)}
                className="w-40 shrink-0 text-left"
              >
                <div className="relative w-40 h-44 rounded-xl overflow-hidden bg-app-surface">
                  <img
                    src={t.coverUrl}
                    alt={t.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <PlayCircle className="absolute top-2 left-2 w-5 h-5 text-app-primary fill-black/40" />
                </div>
                <p className="text-base font-semibold text-app-primary mt-2 truncate">{t.title}</p>
                <p className="text-sm text-app-secondary truncate">{t.artist}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Shelves */}
      {shelves.map(shelf => (
        <div key={shelf.title} className="mt-8 anim-rise">
          <h2 className="text-2xl font-bold text-app-primary px-5 pb-4">{shelf.title}</h2>
          <div className="flex gap-4 overflow-x-auto px-5 pb-2 no-scrollbar">
            {shelf.tracks.slice(0, 12).map((t, idx) => (
              <button
                key={`${t.id}-${idx}`}
                onClick={() => playQueue(shelf.tracks, idx)}
                className="w-40 shrink-0 text-left"
              >
                <div className="relative w-40 h-44 rounded-xl overflow-hidden bg-app-surface">
                  <img
                    src={t.coverUrl}
                    alt={t.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  <PlayCircle className="absolute top-2 left-2 w-5 h-5 text-app-primary fill-black/40" />
                </div>
                <p className="text-base font-semibold text-app-primary mt-2 truncate">{t.title}</p>
                <p className="text-sm text-app-secondary truncate">{t.artist}</p>
              </button>
            ))}
          </div>
        </div>
      ))}

      {loading && shelves.length === 0 && quickPicks.length > 0 && (
        <div className="flex items-center justify-center py-10 gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-app-primary" />
          <p className="text-sm text-app-secondary">Loading more...</p>
        </div>
      )}
    </div>
  );
};
