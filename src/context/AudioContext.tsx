import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { Track, Playlist, RepeatMode, SettingsState, NavTab } from '../types/music';
import { INITIAL_TRACKS } from '../utils/sampleData';
import { applyThemeSettings } from '../utils/theme';
import { searchYouTubeMusic } from '../utils/ytMusicApi';
import {
  downloadTrackToFile,
  deleteOfflineFile,
  getOfflinePlaybackUrl,
  getOfflinePlaybackUrlAsync,
  getOfflineRecord,
  getCachedStreamUrl,
  setCachedStreamUrl,
  dropCachedStreamUrl,
  isTrackOffline,
  resolveAudioStreamUrl,
} from '../utils/downloadManager';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  idbSaveItem,
  idbGetItem,
  loadFromAnyKey,
  exportLibraryBackup,
  parseLibraryBackup,
} from '../utils/persistentLibrary';

interface BackgroundAudioPlugin {
  start(options: { title: string; artist: string; isPlaying: boolean }): Promise<void>;
  update(options: {
    title: string;
    artist: string;
    isPlaying: boolean;
    coverUrl?: string;
    streamUrl?: string;
    filePath?: string;
    position?: number;
  }): Promise<void>;
  stop(): Promise<void>;
}

const BackgroundAudio = Capacitor.isNativePlatform()
  ? registerPlugin<BackgroundAudioPlugin>('BackgroundAudio')
  : null;

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

interface AudioContextType {
  tracks: Track[];
  queue: Track[];
  playlists: Playlist[];
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  searchQuery: string;
  activeTab: NavTab;
  isPlayerOpen: boolean;
  artistProfileName: string | null;
  openArtistProfile: (name: string) => void;
  closeArtistProfile: () => void;
  favorites: string[];
  favoriteTracks: Track[];
  hiddenArtists: string[];
  hideArtist: (name: string) => void;
  restoreHiddenArtists: () => void;
  downloads: string[];
  downloadedTracks: Track[];
  recentlyPlayed: Track[];
  settings: SettingsState;
  analyserNode: AnalyserNode | null;
  isResolvingStream: boolean;
  isLoadingApiTracks: boolean;
  downloadStatus: string | null;
  
  // Actions
  playTrack: (track: Track) => void;
  playQueue: (list: Track[], startIndex?: number) => void;
  reorderQueue: (from: number, to: number) => void;
  togglePlay: () => void;
  nextTrack: () => void;
  previousTrack: () => void;
  seekTo: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleRepeatMode: () => void;
  setRepeatModeDirect: (mode: RepeatMode) => void;
  toggleShuffle: () => void;
  setSearchQuery: (query: string) => void;
  setActiveTab: (tab: NavTab) => void;
  setIsPlayerOpen: (open: boolean) => void;
  toggleFavorite: (trackId: string) => void;
  downloadTrack: (track: Track) => void;
  downloadPlaylist: (playlistTitle: string, tracks: Track[]) => void;
  importPlaylistToLibrary: (title: string, description: string, playlistTracks: Track[]) => void;
  removeDownload: (trackId: string) => void;
  addLocalTracks: (files: FileList | File[]) => void;
  addTrackToLibrary: (track: Track) => void;
  removeTrackFromLibrary: (trackId: string) => void;
  searchYTMusic: (query: string) => Promise<Track[]>;
  createPlaylist: (name: string, description?: string) => string;
  deletePlaylist: (playlistId: string) => void;
  renamePlaylist: (playlistId: string, name: string, description?: string) => void;
  playPlaylist: (playlistId: string) => void;
  addTrackToPlaylist: (playlistId: string, track: string | Track) => void;
  trackStore: Record<string, Track>;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  reorderPlaylistTracks: (playlistId: string, fromIndex: number, toIndex: number) => void;
  updateSettings: (newSettings: Partial<SettingsState>) => void;
  stopTrack: () => void;
  clearAllData: () => void;
  startRadio: (track: Track) => Promise<void>;
  sleepTimerMinutes: number | null;
  setSleepTimer: (minutes: number | null) => void;
  exportLibrary: () => void;
  importLibrary: (file: File) => Promise<boolean>;
}

const DEFAULT_SETTINGS: SettingsState = {
  theme: 'black-white',
  fontStyle: 'sans',
  visualizerMode: 'bars',
  backgroundAnimation: 'off',
  playbackSpeed: 1.0,
  compactView: false,
  iconSize: 'standard',
  autoPlayNext: true,
  sortBy: 'title',
  downloadQuality: 'high',
  sleepTimerMinutes: 0,
  backgroundPlayback: true,
  showPlayCounts: true,
  profileName: 'Music Lover',
  profileAvatar: null,
  useCustomColors: false,
  customAccent: '#8b5cf6',
  customBackground: '#0a0a0a',
  backgroundImage: null,
  overlayTransparency: 0,
  providers: [
    { id: 'ytmusic', name: 'YouTube Music API Engine', enabled: true },
    { id: 'piped', name: 'Piped Privacy Proxy API', enabled: true },
    { id: 'freesound', name: 'FreeSound Audio API', enabled: false },
    { id: 'custom', name: 'Custom Stream API Endpoint', enabled: false },
  ],
};

function loadLastSession(): { track: Track | null; queue: Track[]; position: number } {
  try {
    const saved = localStorage.getItem('bw_music_last_session_v1');
    if (saved) {
      const s = JSON.parse(saved);
      return {
        track: s.track || null,
        queue: Array.isArray(s.queue) ? s.queue : [],
        position: typeof s.position === 'number' && !isNaN(s.position) ? s.position : 0,
      };
    }
  } catch {
    // ignore
  }
  return { track: null, queue: [], position: 0 };
}

const LAST_SESSION = loadLastSession();

const AudioContext = createContext<AudioContextType | null>(null);

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tracks, setTracks] = useState<Track[]>(() => {
    const list = loadFromAnyKey(
      ['bw_music_tracks_v11', 'bw_music_tracks_v10', 'bw_music_tracks_v9', 'bw_music_tracks_v1', 'bw_music_tracks'],
      INITIAL_TRACKS
    );
    const seen = new Set<string>();
    return list.filter((t: Track) => {
      if (!t || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  });

  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    loadFromAnyKey(
      ['bw_music_playlists_v11', 'bw_music_playlists_v10', 'bw_music_playlists_v9', 'bw_music_playlists_v1', 'bw_music_playlists'],
      []
    )
  );

  const [favorites, setFavorites] = useState<string[]>(() =>
    loadFromAnyKey(
      ['bw_music_favorites_v11', 'bw_music_favorites_v10', 'bw_music_favorites_v9', 'bw_music_favorites_v1', 'bw_music_favorites'],
      []
    )
  );

  const [downloads, setDownloads] = useState<string[]>(() =>
    loadFromAnyKey(
      ['bw_music_downloads_v11', 'bw_music_downloads_v10', 'bw_music_downloads_v9', 'bw_music_downloads_v1', 'bw_music_downloads'],
      []
    )
  );

  const [downloadedTracks, setDownloadedTracks] = useState<Track[]>(() => {
    const saved = localStorage.getItem('bw_music_downloaded_objects_v11');
    return saved ? JSON.parse(saved) : [];
  });

  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(() => {
    const saved = localStorage.getItem('bw_music_recently_played_v2');
    return saved ? JSON.parse(saved) : [];
  });

  // Registry of every track object the app has seen, so playlists can show
  // songs that were never added to the library itself.
  const [trackStore, setTrackStore] = useState<Record<string, Track>>(() => {
    try {
      const saved = localStorage.getItem('bw_music_track_store_v1');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const registerTrack = (track: Track) => {
    if (!track?.id) return;
    setTrackStore(prev => {
      if (prev[track.id]) return prev;
      const next = { ...prev, [track.id]: track };
      try {
        localStorage.setItem('bw_music_track_store_v1', JSON.stringify(next));
      } catch {
        // storage full
      }
      return next;
    });
  };

  const [favoriteTracks, setFavoriteTracks] = useState<Track[]>(() => {
    const saved = localStorage.getItem('bw_music_favorite_objects_v1');
    return saved ? JSON.parse(saved) : [];
  });

  const [hiddenArtists, setHiddenArtists] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('bw_music_hidden_artists_v1');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const hideArtist = (name: string) => {
    setHiddenArtists(prev => {
      const next = prev.includes(name) ? prev : [...prev, name];
      try {
        localStorage.setItem('bw_music_hidden_artists_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const restoreHiddenArtists = () => {
    setHiddenArtists([]);
    try {
      localStorage.setItem('bw_music_hidden_artists_v1', '[]');
    } catch {
      // ignore
    }
  };

  const [settings, setSettings] = useState<SettingsState>(() => {
    const saved = loadFromAnyKey<Partial<SettingsState> | null>(
      ['bw_music_settings_v11', 'bw_music_settings_v10', 'bw_music_settings_v9', 'bw_music_settings_v1', 'bw_music_settings'],
      null
    );
    return saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS;
  });

  const [currentTrack, setCurrentTrack] = useState<Track | null>(LAST_SESSION.track);
  const [queue, setQueue] = useState<Track[]>(LAST_SESSION.queue);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(LAST_SESSION.position || 0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('bw_music_volume_v1');
      if (saved !== null) {
        const v = parseFloat(saved);
        if (!isNaN(v) && v >= 0 && v <= 1) return v;
      }
    } catch {
      // ignore
    }
    return 0.8;
  });

  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
    if (ytPlayerRef.current && ytPlayerRef.current.setVolume) {
      try {
        ytPlayerRef.current.setVolume(volume * 100);
      } catch {
        // ignore
      }
    }
  }, [volume]);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [isShuffle, setIsShuffle] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [artistProfileName, setArtistProfileName] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  const openArtistProfile = (name: string) => {
    if (name) setArtistProfileName(name);
  };
  const closeArtistProfile = () => setArtistProfileName(null);
  const statusTimerRef = useRef<number | null>(null);

  const showStatus = (msg: string, ms = 3000) => {
    setDownloadStatus(msg);
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => setDownloadStatus(null), ms);
  };

  // Audio & YT Player refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const isYtReadyRef = useRef(false);

  // Always-fresh action handlers for listeners registered only once (YT iframe, audio element, mediaSession)
  const latestActionsRef = useRef<{
    handleEnded: () => void;
    togglePlay: () => void;
    nextTrack: () => void;
    previousTrack: () => void;
    seekTo: (time: number) => void;
  }>({
    handleEnded: () => {},
    togglePlay: () => {},
    nextTrack: () => {},
    previousTrack: () => {},
    seekTo: () => {},
  });

  // Track currently playing through the <audio> element (offline file or resolved stream)
  const audioModeTrackIdRef = useRef<string | null>(null);
  const streamUrlCacheRef = useRef(new Map<string, string>());
  const currentTrackRef = useRef<Track | null>(null);
  const isPlayingRef = useRef(false);
  const hasPlayedRef = useRef(false);
  const lastSeekAtRef = useRef(0);
  const positionRef = useRef(LAST_SESSION.position || 0);
  const pendingSeekRef = useRef<number>(LAST_SESSION.position || 0);
  const playGenRef = useRef(0);
  const [isResolvingStream, setIsResolvingStream] = useState(false);
  // Restored sessions need a real load on the first play press
  const needsLoadRef = useRef(Boolean(LAST_SESSION.track));

  // Remember the session (track, queue, exact position in seconds)
  useEffect(() => {
    if (!currentTrack) return;
    const saveSession = () => {
      try {
        localStorage.setItem(
          'bw_music_last_session_v1',
          JSON.stringify({
            track: currentTrack,
            queue,
            position: positionRef.current,
          })
        );
      } catch {
        // ignore
      }
    };

    saveSession();
    window.addEventListener('beforeunload', saveSession);
    window.addEventListener('pagehide', saveSession);
    return () => {
      window.removeEventListener('beforeunload', saveSession);
      window.removeEventListener('pagehide', saveSession);
    };
  }, [currentTrack, queue, currentTime]);

  // Standard Web MediaSession API for Background Audio on Android Chromium/Capacitor
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist || 'Aura Music',
        album: currentTrack.album || 'Aura Music',
        artwork: currentTrack.coverUrl
          ? [
              { src: currentTrack.coverUrl, sizes: '192x192', type: 'image/jpeg' },
              { src: currentTrack.coverUrl, sizes: '512x512', type: 'image/jpeg' },
            ]
          : [],
      });

      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

      navigator.mediaSession.setActionHandler('play', () => {
        setIsPlaying(true);
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        setIsPlaying(false);
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (queue.length > 0) {
          const idx = queue.findIndex(t => t.id === currentTrack.id);
          const prevIdx = idx > 0 ? idx - 1 : queue.length - 1;
          playQueue(queue, prevIdx);
        }
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (queue.length > 0) {
          const idx = queue.findIndex(t => t.id === currentTrack.id);
          const nextIdx = idx >= 0 && idx < queue.length - 1 ? idx + 1 : 0;
          playQueue(queue, nextIdx);
        }
      });
    } catch {
      // ignore
    }
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Web Audio API Background Audio Keep-Alive engine for PC / Desktop WebView2
  useEffect(() => {
    if (!isPlaying) return;

    let audioCtx: AudioContext | null = null;
    let sourceNode: AudioBufferSourceNode | null = null;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
        const buffer = audioCtx.createBuffer(2, 44100, 44100);
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = buffer;
        sourceNode.loop = true;
        
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.001;
        sourceNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        sourceNode.start(0);

        if (audioCtx.state === 'suspended') {
          void audioCtx.resume();
        }
      }
    } catch {
      // ignore
    }

    return () => {
      try {
        if (sourceNode) {
          sourceNode.stop();
          sourceNode.disconnect();
        }
        if (audioCtx) {
          void audioCtx.close();
        }
      } catch {
        // ignore
      }
    };
  }, [isPlaying]);

  const isAudioMode = (track: Track | null) =>
    Boolean(
      track &&
        (getOfflinePlaybackUrl(track.id) ||
          audioModeTrackIdRef.current === track.id)
    );

  // Library only contains songs the user downloaded or added locally.
  // Discovery happens on Home and in Library > Discover instead.

  // Permanent IndexedDB automatic restore (survives app updates, scheme changes & cache purges)
  useEffect(() => {
    void Promise.all([
      idbGetItem<Track[]>('permanent_tracks'),
      idbGetItem<Playlist[]>('permanent_playlists'),
      idbGetItem<string[]>('permanent_favorites'),
      idbGetItem<string[]>('permanent_downloads'),
      idbGetItem<SettingsState>('permanent_settings'),
    ]).then(([idbTracks, idbPlaylists, idbFavorites, idbDownloads, idbSettings]) => {
      if (idbTracks && idbTracks.length > 0) {
        setTracks(prev => {
          if (prev.length <= INITIAL_TRACKS.length) return idbTracks;
          const merged = [...prev];
          for (const t of idbTracks) {
            if (!merged.some(m => m.id === t.id)) merged.push(t);
          }
          return merged;
        });
      }
      if (idbPlaylists && idbPlaylists.length > 0) {
        setPlaylists(prev => (prev.length === 0 ? idbPlaylists : prev));
      }
      if (idbFavorites && idbFavorites.length > 0) {
        setFavorites(prev => (prev.length === 0 ? idbFavorites : prev));
      }
      if (idbDownloads && idbDownloads.length > 0) {
        setDownloads(prev => (prev.length === 0 ? idbDownloads : prev));
      }
      if (idbSettings) {
        setSettings(prev => ({ ...DEFAULT_SETTINGS, ...idbSettings, ...prev }));
      }
    });
  }, []);

  // Dual-Persistence (synchronous localStorage + permanent IndexedDB)
  useEffect(() => {
    try {
      localStorage.setItem('bw_music_tracks_v11', JSON.stringify(tracks));
      localStorage.setItem('bw_music_playlists_v11', JSON.stringify(playlists));
      localStorage.setItem('bw_music_favorites_v11', JSON.stringify(favorites));
      localStorage.setItem('bw_music_downloads_v11', JSON.stringify(downloads));
      localStorage.setItem('bw_music_settings_v11', JSON.stringify(settings));
    } catch {
      // storage full
    }
    // Permanent IndexedDB backup
    void idbSaveItem('permanent_tracks', tracks);
    void idbSaveItem('permanent_playlists', playlists);
    void idbSaveItem('permanent_favorites', favorites);
    void idbSaveItem('permanent_downloads', downloads);
    void idbSaveItem('permanent_settings', settings);
  }, [tracks, playlists, favorites, downloads, settings]);

  // Apply theme / custom colors / transparency as CSS variables
  useEffect(() => {
    applyThemeSettings(settings);
  }, [settings]);

  const ytReadyWaitersRef = useRef<Array<() => void>>([]);

  const ensureYtPlayerElement = () => {
    let el = document.getElementById('yt-hidden-player');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yt-hidden-player';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    // Must be on-screen with non-zero dimensions and opacity > 0 for iOS WebKit to allow media playback
    el.style.cssText =
      'position:fixed;bottom:0;right:0;width:240px;height:160px;opacity:0.005;pointer-events:none;z-index:-10;';
    return el;
  };

  const createYtPlayer = () => {
    if (ytPlayerRef.current || !window.YT?.Player) return;
    ensureYtPlayerElement();
    ytPlayerRef.current = new window.YT.Player('yt-hidden-player', {
      height: '160',
      width: '240',
      host: 'https://www.youtube.com',
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        rel: 0,
        enablejsapi: 1,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          isYtReadyRef.current = true;
          if (ytPlayerRef.current?.setVolume) {
            try {
              ytPlayerRef.current.setVolume(volumeRef.current * 100);
            } catch {
              // ignore
            }
          }
          ytReadyWaitersRef.current.splice(0).forEach(fn => fn());
        },
        onStateChange: (event: any) => {
          if (event.data === 1) {
            hasPlayedRef.current = true;
            setIsPlaying(true);
            if (ytPlayerRef.current?.setVolume) {
              try {
                ytPlayerRef.current.setVolume(volumeRef.current * 100);
              } catch {
                // ignore
              }
            }
          }
          if (event.data === 2) setIsPlaying(false);
          if (event.data === 0) {
            setIsPlaying(false);
            latestActionsRef.current.handleEnded();
          }
        },
        onError: () => {
          const t = currentTrackRef.current;
          if (t?.isYouTube && t.youtubeId) {
            fallbackToStreamRef.current(t);
          }
        },
      },
    });
  };

  const loadYtApi = (): Promise<void> => {
    if (isYtReadyRef.current && ytPlayerRef.current) return Promise.resolve();
    return new Promise(resolve => {
      ytReadyWaitersRef.current.push(resolve);
      window.onYouTubeIframeAPIReady = () => createYtPlayer();
      if (window.YT?.Player) {
        createYtPlayer();
        return;
      }
      if (!document.querySelector('script[data-yt-iframe]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.dataset.ytIframe = '1';
        document.head.appendChild(tag);
      }
    });
  };

  // Android still uses the iframe as a backup; desktop skips it on startup
  // because the hidden player element is not in DesktopFrame and the iframe
  // is what made Play take several seconds.
  useEffect(() => {
    void loadYtApi();
  }, []);

  // Sync Timer interval for progress & duration
  useEffect(() => {
    const interval = setInterval(() => {
      // Don't fight the user while they're seeking
      if (Date.now() - lastSeekAtRef.current < 1200) return;
      const audioMode = isAudioMode(currentTrack);
      const targetPending = pendingSeekRef.current;

      if (currentTrack?.isYouTube && !audioMode && ytPlayerRef.current && ytPlayerRef.current.getCurrentTime) {
        try {
          const curr = ytPlayerRef.current.getCurrentTime() || 0;
          const dur = ytPlayerRef.current.getDuration() || 0;
          if (targetPending > 0.5 && curr < targetPending - 1) {
            return;
          }
          if (targetPending > 0 && curr >= 0.2) {
            pendingSeekRef.current = 0;
          }
          positionRef.current = curr;
          setCurrentTime(curr);
          if (dur > 0) setDuration(dur);
        } catch (e) {
          // ignore
        }
      } else if (audioRef.current && (!currentTrack?.isYouTube || audioMode)) {
        const curr = audioRef.current.currentTime || 0;
        const dur = audioRef.current.duration || 0;
        if (targetPending > 0.5 && curr < targetPending - 1) {
          return;
        }
        if (targetPending > 0 && curr >= 0.2) {
          pendingSeekRef.current = 0;
        }
        positionRef.current = curr;
        setCurrentTime(curr);
        setDuration(dur);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [currentTrack]);

  // HTML5 Audio setup for local tracks and direct YouTube streams
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = volume;
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      const targetPending = pendingSeekRef.current;
      const curr = audio.currentTime || 0;
      if (targetPending > 0.5 && curr < targetPending - 1) {
        return;
      }
      if (targetPending > 0 && curr >= 0.2) {
        pendingSeekRef.current = 0;
      }
      positionRef.current = curr;
      setCurrentTime(curr);
    };
    const handleLoadedMetadata = () => setDuration(audio.duration || 0);
    const handleAudioEnded = () => latestActionsRef.current.handleEnded();
    const handleAudioError = () => {
      const track = currentTrackRef.current;
      if (
        track?.isYouTube &&
        track.youtubeId &&
        audioModeTrackIdRef.current === track.id &&
        !getOfflinePlaybackUrl(track.id)
      ) {
        audioModeTrackIdRef.current = null;
        streamUrlCacheRef.current.delete(track.youtubeId);
        dropCachedStreamUrl(track.youtubeId);
        fallbackToStreamRef.current(track, true);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleAudioEnded);
    audio.addEventListener('error', handleAudioError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleAudioEnded);
      audio.removeEventListener('error', handleAudioError);
      audio.pause();
    };
  }, []);

  // Sleep timer: pauses playback after the chosen duration
  useEffect(() => {
    if (!settings.sleepTimerMinutes) return;
    const timer = window.setTimeout(() => {
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {
        // ignore
      }
      audioRef.current?.pause();
      setIsPlaying(false);
      showStatus('Sleep timer ended — playback paused', 4000);
    }, settings.sleepTimerMinutes * 60000);
    return () => window.clearTimeout(timer);
  }, [settings.sleepTimerMinutes]);

  // Apply playback speed to both engines
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = settings.playbackSpeed;
    try {
      ytPlayerRef.current?.setPlaybackRate?.(settings.playbackSpeed);
    } catch {
      // ignore
    }
  }, [settings.playbackSpeed, currentTrack]);

  // Native notification buttons (prev/play-pause/next) invoke this from the foreground service
  useEffect(() => {
    (window as unknown as { __frfBgAction?: (action: string) => void }).__frfBgAction = (action: string) => {
      if (action === 'toggle') togglePlay();
      else if (action === 'next') nextTrack();
      else if (action === 'prev') previousTrack();
    };
  });

  // Keep the Android foreground service + notification in sync with playback
  useEffect(() => {
    if (!BackgroundAudio || !currentTrack) return;

    const send = () => {
      const rec = getOfflineRecord(currentTrack.id);
      const stream =
        !rec && currentTrack.youtubeId
          ? streamUrlCacheRef.current.get(currentTrack.youtubeId)
          : undefined;
      const payload = {
        title: currentTrack.title,
        artist: currentTrack.artist,
        isPlaying,
        coverUrl: currentTrack.coverUrl || '',
        streamUrl: stream || '',
        filePath: rec ? rec.path : '',
        position: positionRef.current,
      };
      if (BackgroundAudio.start) {
        BackgroundAudio.start(payload).catch(() => {});
      }
      BackgroundAudio.update(payload).catch(() => {});
    };

    send();
    if (!isPlaying) return;
    const interval = window.setInterval(send, 3000);
    return () => window.clearInterval(interval);
  }, [currentTrack, isPlaying]);

  // Lock screen, desktop OS media controls, background audio & Bluetooth headphone controls
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (currentTrack) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentTrack.title,
          artist: currentTrack.artist,
          album: currentTrack.album || 'FRF Music',
          artwork: currentTrack.coverUrl
            ? [
                { src: currentTrack.coverUrl, sizes: '96x96', type: 'image/jpeg' },
                { src: currentTrack.coverUrl, sizes: '128x128', type: 'image/jpeg' },
                { src: currentTrack.coverUrl, sizes: '192x192', type: 'image/jpeg' },
                { src: currentTrack.coverUrl, sizes: '512x512', type: 'image/jpeg' },
              ]
            : [],
        });
      } catch {
        // ignore
      }
    }
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
      // ignore
    }
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const safeSet = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // action not supported by browser
      }
    };

    safeSet('play', () => latestActionsRef.current.togglePlay());
    safeSet('pause', () => latestActionsRef.current.togglePlay());
    safeSet('previoustrack', () => latestActionsRef.current.previousTrack());
    safeSet('nexttrack', () => latestActionsRef.current.nextTrack());
    safeSet('seekto', details => {
      if (details.seekTime !== undefined && details.seekTime !== null) {
        latestActionsRef.current.seekTo(details.seekTime);
      }
    });
  }, []);

  // Play a YouTube track through the <audio> element using a direct stream URL.
  // Returns true if audio actually started.
  const fallbackToStream = async (track: Track, force = false): Promise<boolean> => {
    if (!track.youtubeId) return false;
    if (!force && audioModeTrackIdRef.current === track.id) return true;
    const vid = track.youtubeId;
    const gen = playGenRef.current;

    setIsResolvingStream(true);
    try {
      const url = force
        ? await resolveAudioStreamUrl(vid, true)
        : streamUrlCacheRef.current.get(vid) || (await resolveAudioStreamUrl(vid));
      if (!url) return false;

      streamUrlCacheRef.current.set(vid, url);
      setCachedStreamUrl(vid, url);

      if (playGenRef.current !== gen) return false;
      const current = currentTrackRef.current;
      if (!current || current.id !== track.id || !audioRef.current) return false;

      let pos = 0;
      const yt = ytPlayerRef.current;
      if (yt?.getCurrentTime) {
        try {
          pos = yt.getCurrentTime() || 0;
        } catch {
          // ignore
        }
      }

      const audio = audioRef.current;
      audioModeTrackIdRef.current = track.id;
      audio.src = url;
      const start = () =>
        audio
          .play()
          .then(() => {
            if (playGenRef.current !== gen) return;
            try {
              yt?.pauseVideo?.();
            } catch {
              // ignore
            }
            hasPlayedRef.current = true;
            setIsPlaying(true);
          });

      if (pos > 1) {
        const seekThenPlay = () => {
          audio.removeEventListener('loadedmetadata', seekThenPlay);
          try {
            audio.currentTime = pos;
          } catch {
            // ignore
          }
          return start();
        };
        audio.addEventListener('loadedmetadata', seekThenPlay);
        audio.load();
        try {
          await start();
        } catch {
          audioModeTrackIdRef.current = null;
          return false;
        }
      } else {
        try {
          await start();
        } catch {
          audioModeTrackIdRef.current = null;
          streamUrlCacheRef.current.delete(vid);
          dropCachedStreamUrl(vid);
          if (force) return false;
          return fallbackToStream(track, true);
        }
      }
      return playGenRef.current === gen && audioModeTrackIdRef.current === track.id;
    } catch {
      return false;
    } finally {
      if (playGenRef.current === gen) setIsResolvingStream(false);
    }
  };

  const fallbackToStreamRef = useRef(fallbackToStream);
  useEffect(() => {
    fallbackToStreamRef.current = fallbackToStream;
  });

  const startIframe = async (track: Track, startTime = 0) => {
    const currentGen = playGenRef.current;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
    }
    try {
      await loadYtApi();
    } catch {
      return;
    }
    if (playGenRef.current !== currentGen) return;
    const yt = ytPlayerRef.current;
    if (yt?.loadVideoById) {
      try {
        yt.stopVideo();
      } catch {
        // ignore
      }
      if (playGenRef.current !== currentGen) return;
      yt.loadVideoById({
        videoId: track.youtubeId,
        startSeconds: startTime > 0 ? startTime : 0,
      });
      try {
        yt.unMute?.();
        yt.setVolume?.(volumeRef.current * 100);
      } catch {
        // ignore
      }
      yt.playVideo();
      setIsPlaying(true);
    }
  };

  // Resolve streams for upcoming queue entries in parallel so skipping is instant
  const prefetchNextStream = (track: Track) => {
    const list = queue.length > 0 ? queue : tracks;
    const idx = list.findIndex(t => t.id === track.id);
    if (idx === -1) return;
    const targetIndices = [
      (idx + 1) % list.length,
      (idx + 2) % list.length,
      (idx + 3) % list.length,
    ];
    for (const i of targetIndices) {
      const target = list[i];
      if (!target?.youtubeId) continue;
      if (streamUrlCacheRef.current.has(target.youtubeId)) continue;
      if (getCachedStreamUrl(target.youtubeId)) continue;
      resolveAudioStreamUrl(target.youtubeId)
        .then(url => {
          if (url) streamUrlCacheRef.current.set(target.youtubeId!, url);
        })
        .catch(() => {});
    }
  };

  const playAudioUrl = (track: Track, url: string, startTime = 0) => {
    if (!audioRef.current) return Promise.reject(new Error('no audio'));
    const currentGen = playGenRef.current;

    // Stop YouTube iframe to ensure no dual playback
    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.stopVideo();
      } catch {
        try {
          ytPlayerRef.current.pauseVideo();
        } catch {
          // ignore
        }
      }
    }

    audioModeTrackIdRef.current = track.id;
    const audio = audioRef.current;
    audio.src = url;
    audio.volume = volumeRef.current;
    if (startTime > 0) {
      const setPos = () => {
        audio.removeEventListener('loadedmetadata', setPos);
        try {
          audio.currentTime = startTime;
        } catch {
          // ignore
        }
      };
      audio.addEventListener('loadedmetadata', setPos);
    }
    return audio.play().then(() => {
      if (playGenRef.current !== currentGen) {
        audio.pause();
        return;
      }
      hasPlayedRef.current = true;
      setIsPlaying(true);
    });
  };

  const stopAllPlayback = () => {
    playGenRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      try {
        audioRef.current.load();
      } catch {
        // ignore
      }
    }
    if (ytPlayerRef.current) {
      try {
        ytPlayerRef.current.stopVideo();
      } catch {
        try {
          ytPlayerRef.current.pauseVideo();
        } catch {
          // ignore
        }
      }
    }
  };

  const stopTrack = () => {
    stopAllPlayback();
    setIsPlaying(false);
    setCurrentTrack(null);
    setIsPlayerOpen(false);
    audioModeTrackIdRef.current = null;
    try {
      localStorage.removeItem('bw_music_last_session_v1');
    } catch {
      // ignore
    }
    if (BackgroundAudio?.stop) {
      BackgroundAudio.stop().catch(() => {});
    }
  };

  const startTrack = (track: Track, startTime = 0) => {
    stopAllPlayback();
    const currentGen = playGenRef.current;
    registerTrack(track);
    setRecentlyPlayed(prev => {
      const updated = [track, ...prev.filter(t => t.id !== track.id)].slice(0, 50);
      localStorage.setItem('bw_music_recently_played_v2', JSON.stringify(updated));
      return updated;
    });

    setCurrentTrack(track);
    audioModeTrackIdRef.current = null;
    hasPlayedRef.current = false;
    pendingSeekRef.current = startTime;
    positionRef.current = startTime;
    setCurrentTime(startTime);

    // 1. Offline-downloaded tracks play from local storage / IndexedDB
    const offlineUrl = getOfflinePlaybackUrl(track.id);
    if (offlineUrl && audioRef.current) {
      if (ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
        try { ytPlayerRef.current.pauseVideo(); } catch {}
      }
      playAudioUrl(track, offlineUrl, startTime).catch(() => setIsPlaying(false));
      return;
    }

    void getOfflinePlaybackUrlAsync(track.id).then(asyncUrl => {
      if (playGenRef.current !== currentGen) return;
      if (asyncUrl && audioRef.current) {
        if (ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
          try { ytPlayerRef.current.pauseVideo(); } catch {}
        }
        playAudioUrl(track, asyncUrl, startTime).catch(() => setIsPlaying(false));
      }
    });

    // 2. YouTube tracks: Immediate player start + background stream cache
    if (track.isYouTube && track.youtubeId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
      }

      const cachedStream =
        streamUrlCacheRef.current.get(track.youtubeId) ||
        getCachedStreamUrl(track.youtubeId);

      if (cachedStream && audioRef.current) {
        playAudioUrl(track, cachedStream, startTime).catch(() => {
          dropCachedStreamUrl(track.youtubeId!);
          streamUrlCacheRef.current.delete(track.youtubeId!);
          void startIframe(track, startTime);
        });
      } else {
        // Start YouTube player IMMEDIATELY upon user click
        void startIframe(track, startTime);
        // Pre-fetch direct audio stream in background for next play (don't interrupt current iframe)
        void resolveAudioStreamUrl(track.youtubeId, false)
          .then(url => {
            if (url) {
              streamUrlCacheRef.current.set(track.youtubeId!, url);
            }
          })
          .catch(() => {});
      }

      prefetchNextStream(track);
      return;
    }

    // 3. Direct audio URL track
    if (ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
      try { ytPlayerRef.current.pauseVideo(); } catch {}
    }

    if (audioRef.current) {
      audioRef.current.src = track.url;
      audioRef.current.volume = volumeRef.current;
      if (startTime > 0) {
        audioRef.current.currentTime = startTime;
      }
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const playTrack = (track: Track) => {
    if (currentTrack?.id === track.id && !needsLoadRef.current) {
      togglePlay();
      return;
    }
    needsLoadRef.current = false;
    startTrack(track);
  };

  const reorderQueue = (from: number, to: number) => {
    setQueue(prev => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const togglePlay = () => {
    if (!currentTrack) return;

    // Restored session: load the track on first play press
    if (needsLoadRef.current) {
      needsLoadRef.current = false;
      startTrack(currentTrack, positionRef.current || LAST_SESSION.position || 0);
      return;
    }

    const audioMode = isAudioMode(currentTrack);

    if (currentTrack.isYouTube && !audioMode && ytPlayerRef.current) {
      if (isPlaying) {
        ytPlayerRef.current.pauseVideo();
        setIsPlaying(false);
      } else {
        ytPlayerRef.current.playVideo();
        setIsPlaying(true);
      }
      return;
    }

    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const playQueue = (list: Track[], startIndex = 0) => {
    if (!list || list.length === 0) return;
    setQueue(list);
    const safeIndex = Math.max(0, Math.min(startIndex, list.length - 1));
    playTrack(list[safeIndex]);
  };

  const nextTrack = () => {
    const list = queue.length > 0 ? queue : tracks;
    if (list.length === 0) return;

    if (isShuffle) {
      const others = list.filter(t => t.id !== currentTrack?.id);
      const pool = others.length > 0 ? others : list;
      const randomIndex = Math.floor(Math.random() * pool.length);
      playTrack(pool[randomIndex]);
      return;
    }

    const currentIndex = list.findIndex(t => t.id === currentTrack?.id);
    if (currentIndex === -1) {
      playTrack(list[0]);
      return;
    }
    if (currentIndex >= list.length - 1 && repeatMode !== 'all') {
      setIsPlaying(false);
      return;
    }
    const nextIndex = (currentIndex + 1) % list.length;
    playTrack(list[nextIndex]);
  };

  const previousTrack = () => {
    const list = queue.length > 0 ? queue : tracks;
    if (list.length === 0) return;
    const currentIndex = list.findIndex(t => t.id === currentTrack?.id);
    if (currentIndex <= 0) {
      seekTo(0);
      return;
    }
    playTrack(list[currentIndex - 1]);
  };

  // Called when a track finishes: honors Repeat 1, otherwise advances through the queue
  const handleEnded = () => {
    if (repeatMode === 'one' && currentTrack) {
      const audioMode = isAudioMode(currentTrack);
      if (currentTrack.isYouTube && !audioMode && ytPlayerRef.current?.seekTo) {
        ytPlayerRef.current.seekTo(0, true);
        ytPlayerRef.current.playVideo();
      } else if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
      return;
    }
    if (!settings.autoPlayNext) {
      setIsPlaying(false);
      return;
    }
    nextTrack();
  };

  useEffect(() => {
    latestActionsRef.current = {
      handleEnded,
      togglePlay,
      nextTrack,
      previousTrack,
      seekTo,
    };
  });

  const seekTo = (time: number) => {
    lastSeekAtRef.current = Date.now();
    pendingSeekRef.current = time;
    positionRef.current = time;
    const audioMode = isAudioMode(currentTrack);
    if (currentTrack?.isYouTube && !audioMode && ytPlayerRef.current && ytPlayerRef.current.seekTo) {
      ytPlayerRef.current.seekTo(time, true);
      setCurrentTime(time);
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const setVolume = (vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    try {
      localStorage.setItem('bw_music_volume_v1', clamped.toString());
    } catch {
      // ignore
    }
    if (audioRef.current) audioRef.current.volume = clamped;
    if (ytPlayerRef.current && ytPlayerRef.current.setVolume) {
      ytPlayerRef.current.setVolume(clamped * 100);
    }
  };

  const toggleRepeatMode = () => {
    setRepeatMode(prev => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  };

  const setRepeatModeDirect = (mode: RepeatMode) => setRepeatMode(mode);
  const toggleShuffle = () => setIsShuffle(prev => !prev);

  const toggleFavorite = (trackId: string) => {
    const isFav = favorites.includes(trackId);
    setFavorites(prev =>
      prev.includes(trackId) ? prev.filter(id => id !== trackId) : [...prev, trackId]
    );

    if (!isFav) {
      const source = [currentTrack, ...queue, ...tracks, ...downloadedTracks];
      const trackObj = source.find(t => t?.id === trackId);
      if (trackObj) {
        setFavoriteTracks(prev => {
          if (prev.some(t => t.id === trackId)) return prev;
          const updated = [trackObj, ...prev];
          localStorage.setItem('bw_music_favorite_objects_v1', JSON.stringify(updated));
          return updated;
        });
      }
    } else {
      setFavoriteTracks(prev => {
        const updated = prev.filter(t => t.id !== trackId);
        localStorage.setItem('bw_music_favorite_objects_v1', JSON.stringify(updated));
        return updated;
      });
    }
  };

  const registerDownloadedTrack = (track: Track) => {
    setDownloadedTracks(prev => {
      const filtered = prev.filter(t => t.id !== track.id);
      const updated = [track, ...filtered];
      localStorage.setItem('bw_music_downloaded_objects_v11', JSON.stringify(updated));
      return updated;
    });

    setDownloads(prev => {
      if (prev.includes(track.id)) return prev;
      const updated = [...prev, track.id];
      localStorage.setItem('bw_music_downloads_v11', JSON.stringify(updated));
      return updated;
    });

    addTrackToLibrary(track);
  };

  const downloadTrack = async (track: Track) => {
    // Local files already live on the device — just register them.
    if (track.isLocal || !track.youtubeId) {
      registerDownloadedTrack(track);
      return;
    }

    if (isTrackOffline(track.id)) {
      registerDownloadedTrack(track);
      showStatus(`"${track.title}" is already saved for offline playback`);
      return;
    }

    try {
      await downloadTrackToFile(track);
      registerDownloadedTrack(track);
      showStatus(`Downloaded "${track.title}" — plays offline now`);
    } catch (e) {
      if ((e as Error).message === 'cancelled') {
        showStatus(`Skipped "${track.title}"`);
      } else {
        showStatus(`Download failed for "${track.title}" — retrying next time`, 4000);
      }
    }
  };

  const downloadPlaylist = async (playlistTitle: string, tracksToDownload: Track[]) => {
    if (!tracksToDownload || tracksToDownload.length === 0) return;

    // 1. Save all tracks to downloadedTracks in localStorage
    setDownloadedTracks(prev => {
      const ids = new Set(prev.map(t => t.id));
      const newUnique = tracksToDownload.filter(t => !ids.has(t.id));
      const updated = [...newUnique, ...prev];
      localStorage.setItem('bw_music_downloaded_objects_v11', JSON.stringify(updated));
      return updated;
    });

    // 2. Save all track IDs to downloads
    setDownloads(prev => {
      const ids = new Set(prev);
      tracksToDownload.forEach(t => ids.add(t.id));
      const updated = Array.from(ids);
      localStorage.setItem('bw_music_downloads_v11', JSON.stringify(updated));
      return updated;
    });

    // 3. Add all tracks to Library
    tracksToDownload.forEach(t => addTrackToLibrary(t));

    // 4. Create new Playlist in Playlists tab and attach track IDs
    const newPlId = `playlist-${Date.now()}`;
    const newPlaylist: Playlist = {
      id: newPlId,
      name: playlistTitle,
      description: `Downloaded Community Playlist (${tracksToDownload.length} tracks)`,
      trackIds: tracksToDownload.map(t => t.id),
      createdAt: Date.now(),
    };

    setPlaylists(prev => [...prev, newPlaylist]);

    // 5. Actually download the audio files one by one
    const toFetch = tracksToDownload.filter(
      t => t.youtubeId && !t.isLocal && !isTrackOffline(t.id)
    );

    if (toFetch.length === 0) {
      showStatus(`Playlist "${playlistTitle}" is already available offline`);
      return;
    }

    let done = 0;
    let failed = 0;
    let skipped = 0;
    for (const t of toFetch) {
      setDownloadStatus(
        `Downloading ${done + failed + skipped + 1}/${toFetch.length}: ${t.title}`
      );
      try {
        await downloadTrackToFile(t);
        done++;
      } catch (e) {
        if ((e as Error).message === 'cancelled') skipped++;
        else failed++;
      }
    }

    showStatus(
      `"${playlistTitle}" saved: ${done} offline${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}`,
      5000
    );
  };

  const importPlaylistToLibrary = (title: string, description: string, playlistTracks: Track[]) => {
    if (!playlistTracks || playlistTracks.length === 0) return;

    // 1. Register tracks into track store and library
    playlistTracks.forEach(t => {
      registerTrack(t);
      addTrackToLibrary(t);
    });

    // 2. Create new Playlist in user playlists state
    const newPlId = `playlist-${Date.now()}`;
    const newPlaylist: Playlist = {
      id: newPlId,
      name: title,
      description: description || `Search Playlist (${playlistTracks.length} tracks)`,
      trackIds: playlistTracks.map(t => t.id),
      createdAt: Date.now(),
    };

    setPlaylists(prev => {
      const updated = [newPlaylist, ...prev];
      localStorage.setItem('bw_music_playlists_v11', JSON.stringify(updated));
      return updated;
    });

    showStatus(`Added "${title}" (${playlistTracks.length} tracks) to your Playlists!`);
  };

  const removeTrackFromLibrary = (trackId: string) => {
    deleteOfflineFile(trackId).catch(() => {});

    // If the removed song is the current one, stop playback completely
    if (currentTrackRef.current?.id === trackId) {
      needsLoadRef.current = false;
      audioModeTrackIdRef.current = null;
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {
        // ignore
      }
      if (audioRef.current) audioRef.current.pause();
      setIsPlaying(false);
      setCurrentTrack(null);
      BackgroundAudio?.update({ title: '', artist: '', isPlaying: false }).catch(() => {});
    }

    setTracks(prev => prev.filter(t => t.id !== trackId));
    setQueue(prev => prev.filter(t => t.id !== trackId));
    setDownloads(prev => {
      const updated = prev.filter(id => id !== trackId);
      localStorage.setItem('bw_music_downloads_v11', JSON.stringify(updated));
      return updated;
    });
    setDownloadedTracks(prev => {
      const updated = prev.filter(t => t.id !== trackId);
      localStorage.setItem('bw_music_downloaded_objects_v11', JSON.stringify(updated));
      return updated;
    });
  };

  const removeDownload = (trackId: string) => {
    removeTrackFromLibrary(trackId);
  };

  const addTrackToLibrary = (track: Track) => {
    setTracks(prev => {
      if (prev.some(t => t.id === track.id)) return prev;
      return [track, ...prev];
    });
  };

  const searchYTMusic = async (query: string): Promise<Track[]> => {
    return await searchYouTubeMusic(query);
  };

  const addLocalTracks = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const newTracks: Track[] = fileArray
      .filter(file => file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.wav') || file.name.endsWith('.ogg') || file.name.endsWith('.flac'))
      .map((file, idx) => {
        const url = URL.createObjectURL(file);
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        const parts = nameWithoutExt.split('-').map(p => p.trim());
        const artist = parts.length > 1 ? parts[0] : 'Local Audio';
        const title = parts.length > 1 ? parts.slice(1).join(' - ') : nameWithoutExt;

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
          <rect width="400" height="400" fill="#050505"/>
          <circle cx="200" cy="200" r="150" stroke="#ffffff" stroke-width="4" fill="none" stroke-dasharray="12 6"/>
          <text x="200" y="210" font-family="sans-serif" font-weight="900" font-size="28" fill="#ffffff" text-anchor="middle">AUDIO FILE</text>
        </svg>`;

        return {
          id: `local-${Date.now()}-${idx}`,
          title: title || file.name,
          artist: artist,
          album: 'Local Storage',
          duration: 0,
          url: url,
          coverUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
          isLocal: true,
          genre: 'Local',
          addedAt: Date.now(),
        };
      });

    if (newTracks.length > 0) {
      setTracks(prev => [...newTracks, ...prev]);
      if (!currentTrack) {
        playTrack(newTracks[0]);
      }
    }
  };

  const createPlaylist = (name: string, description?: string) => {
    const newPlaylist: Playlist = {
      id: `playlist-${Date.now()}`,
      name,
      description,
      trackIds: [],
      createdAt: Date.now(),
    };
    setPlaylists(prev => [...prev, newPlaylist]);
    return newPlaylist.id;
  };

  const deletePlaylist = (playlistId: string) => {
    setPlaylists(prev => prev.filter(p => p.id !== playlistId));
  };

  const renamePlaylist = (playlistId: string, newName: string, description?: string) => {
    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        return {
          ...p,
          name: newName,
          description: description !== undefined ? description : p.description
        };
      }
      return p;
    }));
  };

  const playPlaylist = (playlistId: string) => {
    let playlistTracks: Track[] = [];
    if (playlistId === 'favorites') {
      playlistTracks = tracks.filter(t => favorites.includes(t.id));
    } else {
      const pl = playlists.find(p => p.id === playlistId);
      if (pl) {
        playlistTracks = pl.trackIds
          .map(id => trackStore[id] || tracks.find(t => t.id === id) || downloadedTracks.find(t => t.id === id) || favoriteTracks.find(t => t.id === id))
          .filter((t): t is Track => t !== undefined);
      }
    }

    playQueue(playlistTracks, 0);
  };

  const addTrackToPlaylist = (playlistId: string, trackOrId: string | Track) => {
    const trackObj = typeof trackOrId === 'object' ? trackOrId : undefined;
    const trackId = typeof trackOrId === 'object' ? trackOrId.id : trackOrId;

    const found =
      trackObj ||
      trackStore[trackId] ||
      tracks.find(t => t.id === trackId) ||
      queue.find(t => t.id === trackId) ||
      downloadedTracks.find(t => t.id === trackId) ||
      favoriteTracks.find(t => t.id === trackId) ||
      recentlyPlayed.find(t => t.id === trackId) ||
      (currentTrack?.id === trackId ? currentTrack : undefined);

    if (found) registerTrack(found);

    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId && !p.trackIds.includes(trackId)) {
        return { ...p, trackIds: [...p.trackIds, trackId] };
      }
      return p;
    }));
  };

  const removeTrackFromPlaylist = (playlistId: string, trackId: string) => {
    if (playlistId === 'favorites') {
      setFavorites(prev => prev.filter(id => id !== trackId));
      return;
    }
    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        return { ...p, trackIds: p.trackIds.filter(id => id !== trackId) };
      }
      return p;
    }));
  };

  const reorderPlaylistTracks = (playlistId: string, fromIndex: number, toIndex: number) => {
    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        const newTrackIds = [...p.trackIds];
        if (fromIndex >= 0 && fromIndex < newTrackIds.length && toIndex >= 0 && toIndex < newTrackIds.length) {
          const [moved] = newTrackIds.splice(fromIndex, 1);
          newTrackIds.splice(toIndex, 0, moved);
        }
        return { ...p, trackIds: newTrackIds };
      }
      return p;
    }));
  };

  const updateSettings = (newSettings: Partial<SettingsState>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const [sleepTimerMinutes, setSleepTimerMinutesState] = useState<number | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSleepTimer = (minutes: number | null) => {
    if (sleepTimerRef.current) {
      clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    setSleepTimerMinutesState(minutes);
    if (minutes && minutes > 0) {
      sleepTimerRef.current = setTimeout(() => {
        stopTrack();
        setSleepTimerMinutesState(null);
      }, minutes * 60 * 1000);
    }
  };

  const startRadio = async (track: Track) => {
    try {
      const radioQuery = `${track.artist} radio`;
      const results = await searchYouTubeMusic(radioQuery);
      if (results.length > 0) {
        const radioQueue = [track, ...results.filter(t => t.id !== track.id)];
        playQueue(radioQueue, 0);
      } else {
        playTrack(track);
      }
    } catch {
      playTrack(track);
    }
  };

  const exportLibrary = () => {
    exportLibraryBackup({ tracks, playlists, favorites, downloads, settings });
  };

  const importLibrary = async (file: File): Promise<boolean> => {
    const data = await parseLibraryBackup(file);
    if (!data) return false;
    if (data.tracks && data.tracks.length > 0) setTracks(data.tracks);
    if (data.playlists) setPlaylists(data.playlists);
    if (data.favorites) setFavorites(data.favorites);
    if (data.downloads) setDownloads(data.downloads);
    if (data.settings) setSettings(prev => ({ ...prev, ...data.settings }));
    return true;
  };

  const clearAllData = () => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    BackgroundAudio?.stop().catch(() => {});
    localStorage.clear();
    setTracks([]);
    setQueue([]);
    setPlaylists([]);
    setFavorites([]);
    setFavoriteTracks([]);
    setRecentlyPlayed([]);
    setDownloads([]);
    setCurrentTrack(null);
    setIsPlaying(false);
  };

  return (
    <AudioContext.Provider
      value={{
        tracks,
        queue,
        playlists,
        currentTrack,
        isPlaying,
        currentTime,
        duration,
        volume,
        repeatMode,
        isShuffle,
        searchQuery,
        activeTab,
        isPlayerOpen,
        artistProfileName,
        openArtistProfile,
        closeArtistProfile,
        favorites,
        favoriteTracks,
        hiddenArtists,
        hideArtist,
        restoreHiddenArtists,
        downloads,
        downloadedTracks,
        recentlyPlayed,
        settings,
        analyserNode: null,
        isResolvingStream,
        isLoadingApiTracks: false,
        downloadStatus,
        sleepTimerMinutes,

        playTrack,
        playQueue,
        reorderQueue,
        togglePlay,
        nextTrack,
        previousTrack,
        seekTo,
        setVolume,
        toggleRepeatMode,
        setRepeatModeDirect,
        toggleShuffle,
        setSearchQuery,
        setActiveTab,
        setIsPlayerOpen,
        toggleFavorite,
        downloadTrack,
        downloadPlaylist,
        importPlaylistToLibrary,
        removeDownload,
        addLocalTracks,
        addTrackToLibrary,
        removeTrackFromLibrary,
        searchYTMusic,
        createPlaylist,
        deletePlaylist,
        renamePlaylist,
        playPlaylist,
        addTrackToPlaylist,
        trackStore,
        removeTrackFromPlaylist,
        reorderPlaylistTracks,
        updateSettings,
        stopTrack,
        clearAllData,
        startRadio,
        setSleepTimer,
        exportLibrary,
        importLibrary,
      }}
    >
      {children}
    </AudioContext.Provider>
  );
};

export const useAudio = () => {
  const context = useContext(AudioContext);
  if (!context) throw new Error('useAudio must be used within an AudioProvider');
  return context;
};
