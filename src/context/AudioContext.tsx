import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import type { Track, Playlist, RepeatMode, SettingsState, NavTab } from '../types/music';
import { INITIAL_TRACKS } from '../utils/sampleData';
import { applyThemeSettings } from '../utils/theme';
import { searchYouTubeMusic, findBestAlternateVideoId, fetchDirectAudioStreamUrl } from '../utils/ytMusicApi';
import {
  verifyOfflineRecord,
  deleteOfflineFile,
  getOfflinePlaybackUrl,
  getOfflinePlaybackUrlAsync,
  getOfflineRecord,
  setCachedStreamUrl,
  dropCachedStreamUrl,
  cacheCoverArt,
  restoreDownloadsFromMusic,
  syncMusicCopies,
  resolveAudioStreamUrl,
  getLastStreamResolveNotes,
} from '../utils/downloadManager';
import { recordSource } from '../utils/streamHealth';
import {
  startDownloadQueue,
  enqueueDownloads,
  kickQueue,
  isAlreadyOffline,
} from '../utils/downloadQueue';
import { autoDownloadAllowed, startNetworkMonitor } from '../utils/autoDownload';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { createYtBridgePlayer, shouldUseYtBridge } from '../utils/ytBridge';
import {
  idbSaveItem,
  idbGetItem,
  loadFromAnyKey,
  exportLibraryBackup,
  parseLibraryBackup,
} from '../utils/persistentLibrary';
import {
  globalEqualizer,
  DEFAULT_EQUALIZER_SETTINGS,
} from '../utils/equalizer';

interface BackgroundAudioPlugin {
  start(options: {
    title: string;
    artist: string;
    isPlaying: boolean;
    coverUrl?: string;
    duration?: number;
    position?: number;
  }): Promise<void>;
  update(options: {
    title: string;
    artist: string;
    isPlaying: boolean;
    coverUrl?: string;
    streamUrl?: string;
    filePath?: string;
    duration?: number;
    position?: number;
  }): Promise<void>;
  playUrl(options: {
    url?: string;
    filePath?: string;
    title: string;
    artist: string;
    coverUrl?: string;
    startTime?: number;
    duration?: number;
  }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(options: { position: number }): Promise<void>;
  stop(): Promise<void>;
  setVolume(options: { volume: number }): Promise<void>;
  setSpeed(options: { speed: number }): Promise<void>;
  setEqualizer(options: {
    enabled: boolean;
    bands: number[];
    bassBoost: number;
    surround: number;
  }): Promise<void>;
  // Queue the song to play after the current one; the native player rolls into it
  // by itself (gapless, and without waiting on this web layer).
  setNext(options: {
    trackId: string;
    url?: string;
    filePath?: string;
    title: string;
    artist: string;
    coverUrl?: string;
    duration?: number;
  }): Promise<void>;
  clearNext(): Promise<void>;
  setVisualizerEnabled(options: { enabled: boolean }): Promise<void>;
  setWebAudible(options: { audible: boolean }): Promise<void>;
  handoverNow(options: {
    title: string;
    artist: string;
    coverUrl?: string;
    streamUrl?: string;
    filePath?: string;
    position?: number;
    duration?: number;
  }): Promise<void>;
}

const BackgroundAudio = Capacitor.isNativePlatform()
  ? registerPlugin<BackgroundAudioPlugin>('BackgroundAudio')
  : null;

// Android runs the YouTube IFrame player inside the WebView, and that player
// drops its audio as soon as the page reports hidden (Activity stopped).
// Native ExoPlayer is the only engine that survives outside the app, so the
// Android path hands playback over to it as soon as a direct stream exists.
const IS_ANDROID = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const YOUTUBE_APP_ORIGIN =
  typeof window !== 'undefined' && window.location.origin.startsWith('http')
    ? window.location.origin
    : 'https://music.youtube.com';
const YOUTUBE_ALTERNATE_ERROR_CODES = new Set([2, 100, 101, 150]);
const MAX_ALTERNATE_UPLOADS = 15;
const YOUTUBE_PLAYBACK_OVERRIDES_KEY = 'frf_youtube_playback_overrides_v1';

function loadYouTubePlaybackOverrides(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(YOUTUBE_PLAYBACK_OVERRIDES_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

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
  isEqualizerOpen: boolean;
  setIsEqualizerOpen: (open: boolean) => void;
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
  playCounts: Record<string, number>;
  mostPlayed: { track: Track; count: number }[];
  sleepSecondsRemaining: number | null;
  settings: SettingsState;
  analyserNode: SpectrumSource | null;
  isResolvingStream: boolean;
  isLoadingApiTracks: boolean;
  downloadStatus: string | null;
  
  // Actions
  playTrack: (track: Track) => void;
  playQueue: (list: Track[], startIndex?: number) => void;
  addToQueue: (track: Track, position?: 'next' | 'last') => void;
  reorderQueue: (from: number, to: number) => void;
  removeFromQueue: (index: number) => void;
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
  toggleFavorite: (trackId: string, track?: Track) => void;
  downloadTrack: (track: Track) => void;
  downloadPlaylist: (playlistTitle: string, tracks: Track[]) => void;
  // Bring back downloads from the Music/FRF Music folder (after a reinstall).
  restoreMusicFolderDownloads: (
    onProgress?: (done: number, total: number) => void
  ) => Promise<{ restored: number; skipped: number; permissionDenied: boolean; unsupported: boolean }>;
  // Copy every current download into the Music folder (when the setting is turned on).
  syncMusicFolderCopies: () => Promise<number>;
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
  youtubeMiniPlayer: false,
  keepMusicCopy: true,
  autoDownloadLikes: false,
  autoDownloadPlaylists: [],
  autoDownloadWifiOnly: true,
  autoDownloadLimitMb: 2048,
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
  equalizer: DEFAULT_EQUALIZER_SETTINGS,
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

/**
 * The subset of AnalyserNode the visualizer actually uses. Exposing this rather
 * than a concrete AnalyserNode lets ExoPlayer's native FFT stand in during
 * native playback, where the Web Audio graph receives no signal.
 */
export interface SpectrumSource {
  frequencyBinCount: number;
  getByteFrequencyData(array: Uint8Array<ArrayBuffer>): void;
  getByteTimeDomainData(array: Uint8Array<ArrayBuffer>): void;
}

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

  // A playlist download marks every song as downloaded before any file exists,
  // so interrupted or failed downloads (and files wiped by a reinstall or
  // Android clearing storage) stay listed as downloaded with nothing behind
  // them. Check once per launch and drop the entries that have no real file.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    void (async () => {
      const candidates = new Map<string, Track>();
      downloadedTracks.forEach(t => candidates.set(t.id, t));
      tracks.filter(t => downloads.includes(t.id)).forEach(t => candidates.set(t.id, t));
      const ghosts = new Set<string>();
      for (const id of downloads) {
        const t = candidates.get(id);
        // Local files and non-YouTube tracks have no offline record to check.
        if (t && (t.isLocal || !t.youtubeId)) continue;
        // Read-only on purpose: verifyOfflineRecord deletes files when its
        // check fails, which is too risky to run blindly at startup.
        const rec = getOfflineRecord(id);
        if (!rec || (rec.path && rec.size < 20000)) ghosts.add(id);
      }
      if (cancelled || ghosts.size === 0) return;
      setDownloads(prev => {
        const updated = prev.filter(id => !ghosts.has(id));
        localStorage.setItem('bw_music_downloads_v11', JSON.stringify(updated));
        return updated;
      });
      setDownloadedTracks(prev => {
        const updated = prev.filter(t => !ghosts.has(t.id));
        localStorage.setItem('bw_music_downloaded_objects_v11', JSON.stringify(updated));
        return updated;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Download queue: resumes saved work, and registers each finished download.
  const registerDownloadedTrackRef = useRef<(t: Track) => void>(() => {});
  useEffect(() => {
    startDownloadQueue({
      onDownloaded: t => registerDownloadedTrackRef.current(t),
      // Auto-download items wait while on mobile data (if Wi-Fi only) or over the limit.
      gate: item => item.source !== 'auto' || autoDownloadAllowed(settingsRef.current),
    });
    startNetworkMonitor(() => kickQueue());
  }, []);

  // Make sure every current download also has its copy in the Music folder.
  useEffect(() => {
    if (!IS_ANDROID) return;
    const timer = window.setTimeout(() => {
      void syncMusicCopies(downloadedTracks);
    }, 5000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Songs downloaded before covers were cached still need their picture saved
  // for the notification; top them up once per launch while online.
  useEffect(() => {
    if (!IS_ANDROID || !navigator.onLine) return;
    const urls = downloadedTracks
      .filter(t => getOfflineRecord(t.id) && t.coverUrl)
      .map(t => t.coverUrl);
    void (async () => {
      for (const url of urls) await cacheCoverArt(url);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(() => {
    const saved = localStorage.getItem('bw_music_recently_played_v2');
    return saved ? JSON.parse(saved) : [];
  });

  // Lifetime play counts per track id, powering the "Most played" stats card.
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('bw_music_play_counts_v1');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Seconds left on the sleep timer, for the Now Playing countdown chip.
  const [sleepSecondsRemaining, setSleepSecondsRemaining] = useState<number | null>(null);

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

  // Auto-sync playlists and trackStore to localStorage whenever modified
  useEffect(() => {
    try {
      localStorage.setItem('bw_music_playlists_v11', JSON.stringify(playlists));
    } catch {
      // storage full
    }
  }, [playlists]);

  useEffect(() => {
    try {
      localStorage.setItem('bw_music_track_store_v1', JSON.stringify(trackStore));
    } catch {
      // storage full
    }
  }, [trackStore]);

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
  const [isEqualizerOpen, setIsEqualizerOpen] = useState(false);
  const [artistProfileName, setArtistProfileName] = useState<string | null>(null);
  // In-app popup messages are switched off; the field stays so the frames that
  // read it keep compiling, and showStatus just logs.
  const downloadStatus: string | null = null;

  const openArtistProfile = (name: string) => {
    if (name) setArtistProfileName(name);
  };
  const closeArtistProfile = () => setArtistProfileName(null);
  const showStatus = (msg: string, _ms?: number) => {
    console.info('[status]', msg);
  };

  // Audio & YT Player refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const isYtReadyRef = useRef(false);
  const ytBridgeFailedRef = useRef(false);

  // Always-fresh action handlers for listeners registered only once (YT iframe, audio element, mediaSession)
  const latestActionsRef = useRef<{
    handleEnded: () => void;
    togglePlay: () => void;
    nextTrack: () => void;
    previousTrack: () => void;
    seekTo: (time: number) => void;
    applyPosition: (time: number) => void;
    resumeFromRemote: () => void;
    pauseFromRemote: () => void;
    adoptAdvancedTrack: (trackId: string) => void;
  }>({
    handleEnded: () => {},
    togglePlay: () => {},
    nextTrack: () => {},
    previousTrack: () => {},
    seekTo: () => {},
    applyPosition: () => {},
    resumeFromRemote: () => {},
    pauseFromRemote: () => {},
    adoptAdvancedTrack: () => {},
  });

  // Id of the song currently queued behind the playing one inside the native player.
  const queuedNextIdRef = useRef<string | null>(null);

  // Track currently playing through the <audio> element (offline file or resolved stream)
  const audioModeTrackIdRef = useRef<string | null>(null);
  // True while ExoPlayer (Android PlaybackService) owns the audio. Controls and
  // progress must be routed to it instead of the WebView engines.
  const nativeOwnerRef = useRef(false);

  // Pending "did ExoPlayer actually start?" confirmation. BackgroundAudio.playUrl
  // resolves the moment the intent is delivered — before ExoPlayer has fetched
  // a single byte — so treating it as success was the regression that silenced
  // playback: the WebView player had already been stopped by the time ExoPlayer
  // failed on the device.
  // hardFail distinguishes "ExoPlayer explicitly errored" (dead URL — purge it)
  // from "still buffering when the timeout hit" (may yet start — leave it alone,
  // late progress ticks adopt it).
  const nativeConfirmRef = useRef<{
    resolve: (res: { ok: boolean; hardFail: boolean; msg?: string }) => void;
  } | null>(null);
  const confirmTimeoutRef = useRef<number | null>(null);

  const settleNativeConfirm = (ok: boolean, hardFail = false, msg?: string) => {
    const token = nativeConfirmRef.current;
    if (!token) return;
    nativeConfirmRef.current = null;
    if (confirmTimeoutRef.current != null) {
      window.clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
    if (ok) recordSource('Native player', true, 0);
    token.resolve({ ok, hardFail, msg });
  };

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Latest FFT frame pushed by Android's Visualizer during native playback.
  const nativeSpectrumRef = useRef<Uint8Array>(new Uint8Array(64));

  // One stable source that reads whichever engine is live right now. Keeping a
  // single identity means the visualizer's effect never has to re-run when
  // playback changes hands.
  const spectrumSourceRef = useRef<SpectrumSource | null>(null);
  if (!spectrumSourceRef.current) {
    const webAnalyser = () => globalEqualizer.getAnalyser();
    spectrumSourceRef.current = {
      frequencyBinCount: 64,
      getByteFrequencyData(array: Uint8Array<ArrayBuffer>) {
        if (nativeOwnerRef.current) {
          const src = nativeSpectrumRef.current;
          const n = Math.min(array.length, src.length);
          for (let i = 0; i < n; i++) array[i] = src[i];
          return;
        }
        const a = webAnalyser();
        if (a) a.getByteFrequencyData(array);
        else array.fill(0);
      },
      getByteTimeDomainData(array: Uint8Array<ArrayBuffer>) {
        // Native capture carries no waveform, so hold the line at centre.
        if (nativeOwnerRef.current) {
          array.fill(128);
          return;
        }
        const a = webAnalyser();
        if (a) a.getByteTimeDomainData(array);
        else array.fill(128);
      },
    };
  }

  // Android's effect chain lives in a Java singleton that resets when the
  // process dies, so the equalizer has to be re-pushed every time playback
  // moves to native — not just when the user changes a slider.
  const pushEqualizerToNative = (eq: SettingsState['equalizer']) => {
    if (!eq || !BackgroundAudio?.setEqualizer) return;
    BackgroundAudio.setEqualizer({
      enabled: eq.enabled,
      bands: eq.bands,
      bassBoost: eq.bassBoost,
      surround: eq.surround,
    }).catch(() => {});
  };
  const streamUrlCacheRef = useRef(new Map<string, string>());
  const currentTrackRef = useRef<Track | null>(null);
  const isPlayingRef = useRef(false);
  const hasPlayedRef = useRef(false);
  const lastSeekAtRef = useRef(0);
  const positionRef = useRef(LAST_SESSION.position || 0);
  const pendingSeekRef = useRef<number>(LAST_SESSION.position || 0);
  const playGenRef = useRef(0);
  const activeYoutubeIdRef = useRef<string | null>(null);
  const youtubePlaybackOverridesRef = useRef<Record<string, string>>(loadYouTubePlaybackOverrides());
  const failedYoutubeIdsRef = useRef(new Set<string>());
  const isYoutubeRecoveryRunningRef = useRef(false);
  const streamRetryCountRef = useRef(new Map<string, number>());
  // Pausing and stopping the Activity both ask the service to take over within
  // the same second, and each path resolves a stream when none is cached.
  // Without this guard two parallel resolves race and the losing handover
  // clobbers the winner's ExoPlayer start.
  const handoverResolveInFlightRef = useRef(false);
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

    // Native iOS Lock Screen & Background Audio engine
    if (BackgroundAudio?.update) {
      BackgroundAudio.update({
        title: currentTrack.title,
        artist: currentTrack.artist || 'FRF Music',
        isPlaying,
        coverUrl: currentTrack.coverUrl,
        duration: duration || currentTrack.duration || 0,
        position: positionRef.current || 0,
      }).catch(() => {});
    }
  }, [currentTrack, isPlaying, duration]);

  // Native Lock Screen / AirPods remote command listeners + AVPlayer playback events
  useEffect(() => {
    if (!BackgroundAudio) return;

    const listeners = [
      (BackgroundAudio as any).addListener('remotePlay', () => {
        latestActionsRef.current?.resumeFromRemote?.();
      }),
      (BackgroundAudio as any).addListener('remotePause', () => {
        latestActionsRef.current?.pauseFromRemote?.();
      }),
      (BackgroundAudio as any).addListener('remoteTogglePlay', () => {
        latestActionsRef.current?.togglePlay?.();
      }),
      // The service is about to lose the WebView's audio (app backgrounded) but
      // has no playable source cached. Resolve a fresh direct stream and hand
      // it over before Android suspends the page.
      (BackgroundAudio as any).addListener('requestStream', () => {
        const track = currentTrackRef.current;
        if (!track) return;
        const videoId = activeYoutubeIdRef.current || track.youtubeId;
        if (!videoId) return;
        if (nativeOwnerRef.current) return;
        if (handoverResolveInFlightRef.current) return;
        handoverResolveInFlightRef.current = true;
        void resolveAudioStreamUrl(videoId, true)
          .then(url => {
            if (!url) return;
            if (currentTrackRef.current?.id !== track.id) return;
            if (nativeOwnerRef.current) return;
            streamUrlCacheRef.current.set(videoId, url);
            setCachedStreamUrl(videoId, url);
            void handOffToNativeRef.current(track, url);
          })
          .catch(() => {})
          .finally(() => {
            handoverResolveInFlightRef.current = false;
          });
      }),
      (BackgroundAudio as any).addListener('remoteNext', () => {
        latestActionsRef.current?.nextTrack?.();
      }),
      (BackgroundAudio as any).addListener('remotePrev', () => {
        latestActionsRef.current?.previousTrack?.();
      }),
      (BackgroundAudio as any).addListener('remoteSeek', (data: { position?: number }) => {
        if (data && typeof data.position === 'number') {
          // Apply locally only. Routing this back through seekTo() would ask the
          // service to seek again, which emits remoteSeek again — an endless
          // ping-pong between Java and JS.
          latestActionsRef.current?.applyPosition?.(data.position);
        }
      }),
      (BackgroundAudio as any).addListener('visualizerFrame', (data: { bins?: string }) => {
        if (typeof data?.bins !== 'string') return;
        const parts = data.bins.split(',');
        const buf = nativeSpectrumRef.current;
        const n = Math.min(parts.length, buf.length);
        for (let i = 0; i < n; i++) {
          const v = Number(parts[i]);
          buf[i] = Number.isFinite(v) ? v : 0;
        }
      }),
      (BackgroundAudio as any).addListener('playbackProgress', (data: { currentTime?: number; duration?: number }) => {
        if (!nativeOwnerRef.current) {
          // ExoPlayer is audibly playing but the WebView engine was never told
          // to stand down — a handover that timed out on a slow network, or a
          // takeOver the service ran on its own. Adopt the native engine now:
          // proof of sound is the only safe moment to silence the WebView.
          nativeOwnerRef.current = true;
          try {
            ytPlayerRef.current?.stopVideo?.();
          } catch {
            // ignore
          }
          if (audioRef.current) {
            try {
              audioRef.current.pause();
              audioRef.current.removeAttribute('src');
            } catch {
              // ignore
            }
          }
          hasPlayedRef.current = true;
          setIsPlaying(true);
        }
        // First progress tick is the handoff proof — only now is it safe to
        // silence the WebView engine.
        settleNativeConfirm(true);
        if (typeof data.currentTime === 'number') {
          positionRef.current = data.currentTime;
          setCurrentTime(data.currentTime);
        }
        if (typeof data.duration === 'number' && data.duration > 0) {
          setDuration(data.duration);
        }
      }),
      (BackgroundAudio as any).addListener('playbackEnded', () => {
        latestActionsRef.current?.handleEnded?.();
      }),
      // The native player rolled into the song queued behind the previous one.
      (BackgroundAudio as any).addListener('trackAdvanced', (data: { trackId?: string }) => {
        if (data?.trackId) latestActionsRef.current?.adoptAdvancedTrack?.(data.trackId);
      }),
      // Native AVPlayer could not play the resolved stream (403, unsupported
      // codec, dropped connection): force a fresh stream resolution, bounded
      // by the per-track retry counter so we never loop forever.
      (BackgroundAudio as any).addListener('playbackError', (payload: { message?: string }) => {
        const nativeMsg = typeof payload?.message === 'string' ? payload.message : '';
        if (nativeMsg) {
          // Persist so the real ExoPlayer error survives the toast and can be
          // reported — "it doesn't work" is unfixable, "HTTP 403" is not.
          try {
            localStorage.setItem(
              'frf_native_last_error',
              JSON.stringify({ t: Date.now(), msg: nativeMsg })
            );
          } catch {
            // ignore
          }
          console.warn('[FRF] native playback error:', nativeMsg);
          recordSource('Native player', false, 0, nativeMsg);
        }
        if (nativeConfirmRef.current) {
          // Handoff attempt failed — caller falls back to WebView playback.
          settleNativeConfirm(false, true, nativeMsg || undefined);
          return;
        }
        // Backgrounded: ExoPlayer is the ONLY engine that can make sound, so
        // there is nothing to fall back to. The URL it just choked on is dead
        // (expired signature, or a proxy that answered with an anti-bot page),
        // so purge it and hand over a freshly resolved one. Without this the
        // handover failure was a silent dead end — the branch below only ever
        // recovered <audio>-element playback, never the iframe engine.
        if (IS_ANDROID && document.hidden) {
          const hiddenTrack = currentTrackRef.current;
          const hiddenVid = hiddenTrack
            ? activeYoutubeIdRef.current || hiddenTrack.youtubeId
            : null;
          if (!hiddenTrack || !hiddenVid) return;
          const tries = streamRetryCountRef.current.get(hiddenTrack.id) || 0;
          if (tries >= 2) return;
          streamRetryCountRef.current.set(hiddenTrack.id, tries + 1);
          streamUrlCacheRef.current.delete(hiddenVid);
          dropCachedStreamUrl(hiddenVid);
          if (handoverResolveInFlightRef.current) return;
          handoverResolveInFlightRef.current = true;
          void resolveAudioStreamUrl(hiddenVid, true)
            .then(url => {
              if (!url) return;
              if (currentTrackRef.current?.id !== hiddenTrack.id) return;
              streamUrlCacheRef.current.set(hiddenVid, url);
              setCachedStreamUrl(hiddenVid, url);
              return handOffToNativeRef.current(hiddenTrack, url).then(() => {});
            })
            .catch(() => {})
            .finally(() => {
              handoverResolveInFlightRef.current = false;
            });
          return;
        }
        const track = currentTrackRef.current;
        if (!track?.isYouTube || !track.youtubeId) return;
        if (audioModeTrackIdRef.current !== track.id) return;
        if (getOfflinePlaybackUrl(track.id)) return;
        const retryCount = streamRetryCountRef.current.get(track.id) || 0;
        if (retryCount >= 2) {
          audioModeTrackIdRef.current = null;
          setIsPlaying(false);
          // Last resort on iPhone: the HTTPS bridge player (plays restricted
          // songs, may include YouTube ads).
          if (shouldUseYtBridge()) {
            showStatus('Stream stopped working — switching to YouTube player', 6000);
            void startIframe(track, positionRef.current || 0);
            return;
          }
          showStatus('This song could not start. Please try another upload.', 5000);
          return;
        }
        streamRetryCountRef.current.set(track.id, retryCount + 1);
        const streamYoutubeId = activeYoutubeIdRef.current || track.youtubeId;
        audioModeTrackIdRef.current = null;
        streamUrlCacheRef.current.delete(streamYoutubeId);
        dropCachedStreamUrl(streamYoutubeId);
        fallbackToStreamRef.current(
          streamYoutubeId === track.youtubeId
            ? track
            : { ...track, youtubeId: streamYoutubeId },
          true
        );
      }),
    ];

    return () => {
      listeners.forEach(p => p?.then?.((l: any) => l?.remove?.()).catch?.(() => {}));
    };
  }, []);

  // Hooks the Android PlaybackService invokes through bridge.eval(). Without
  // these the service's handover is a silent no-op: it starts ExoPlayer while
  // the WebView keeps playing, and position updates from the lock screen go
  // nowhere.
  useEffect(() => {
    const w = window as unknown as {
      __frfNativePause?: () => void;
      __frfBgSeek?: (position: number) => void;
    };

    // ExoPlayer has the audio now. Silence both WebView engines without
    // touching isPlaying: playback did not stop, it changed owner.
    w.__frfNativePause = () => {
      nativeOwnerRef.current = true;
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {
        // player not ready yet
      }
      if (audioRef.current && !audioRef.current.paused) {
        try {
          audioRef.current.pause();
        } catch {
          // ignore
        }
      }
    };

    w.__frfBgSeek = (position: number) => {
      latestActionsRef.current?.applyPosition?.(position);
    };

    return () => {
      delete w.__frfNativePause;
      delete w.__frfBgSeek;
    };
  }, []);

  // Tell the native service whether the WebView engine is the one making
  // sound. takeOver() uses this to decide whether backgrounding the app
  // should move playback onto ExoPlayer — the service's own `playing` flag
  // goes stale-false after any failed native start, which used to make
  // takeOver bail out exactly when it mattered.
  const webAudibleRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!IS_ANDROID || !BackgroundAudio?.setWebAudible) return;
    const audible = isPlaying && !!currentTrack && !nativeOwnerRef.current;
    if (webAudibleRef.current === audible) return;
    webAudibleRef.current = audible;
    BackgroundAudio.setWebAudible({ audible }).catch(() => {});
  });

  // The moment the page starts hiding, hand the freshest URL and position to
  // the service and let it start ExoPlayer itself. Waiting for the service to
  // ask (requestStream) is too late: the WebView's fetch/timer machinery is
  // already being suspended by then, so the answer may never arrive.
  useEffect(() => {
    if (!IS_ANDROID || !BackgroundAudio?.handoverNow) return;
    const onHidden = () => {
      if (!document.hidden) return;
      const track = currentTrackRef.current;
      if (!track) return;
      if (!isPlayingRef.current) return;
      if (nativeOwnerRef.current) return;
      const vid = activeYoutubeIdRef.current || track.youtubeId;
      const offline = getOfflineRecord(track.id)?.path || getOfflinePlaybackUrl(track.id) || '';
      const cached = vid ? streamUrlCacheRef.current.get(vid) || '' : track.url;
      const send = (src: string) => {
        BackgroundAudio.handoverNow!({
          title: track.title,
          artist: track.artist,
          coverUrl: track.coverUrl || '',
          streamUrl: src.startsWith('http') ? src : '',
          filePath: src && !src.startsWith('http') ? src : '',
          position: getCurrentPosition(),
          duration: track.duration || 0,
        }).catch(() => {});
      };
      send(offline || cached);
      // No playable URL cached? Resolve fresh while the page still has a
      // pulse (MainActivity keeps WebView timers alive in the background)
      // and deliver it the moment it lands.
      if (vid && !offline && !cached) {
        if (handoverResolveInFlightRef.current) return;
        handoverResolveInFlightRef.current = true;
        void resolveAudioStreamUrl(vid, true)
          .then(url => {
            if (!url) return;
            if (currentTrackRef.current?.id !== track.id) return;
            if (nativeOwnerRef.current) return;
            streamUrlCacheRef.current.set(vid, url);
            setCachedStreamUrl(vid, url);
            send(url);
          })
          .catch(() => {})
          .finally(() => {
            handoverResolveInFlightRef.current = false;
          });
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, []);

  // Initialize HTML5 Audio element and connect Web Audio API Equalizer graph
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      if (audioModeTrackIdRef.current) {
        positionRef.current = audio.currentTime;
        setCurrentTime(audio.currentTime);
      }
    };

    const onDurationChange = () => {
      if (audioModeTrackIdRef.current && audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const onEnded = () => {
      if (audioModeTrackIdRef.current) {
        latestActionsRef.current?.handleEnded?.();
      }
    };

    // The equalizer's audio context starts suspended until the page has had a
    // gesture, and a suspended context makes the element silent. Wake it on the
    // first tap/key and whenever playback starts.
    const wakeEqualizer = () => globalEqualizer.resume();
    audio.addEventListener('play', wakeEqualizer);
    for (const evt of ['pointerdown', 'keydown', 'touchstart']) {
      document.addEventListener(evt, wakeEqualizer, { passive: true });
    }

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);

    // Connect Web Audio API Equalizer node graph to the audio pipeline
    try {
      globalEqualizer.init(audio);
      if (settings.equalizer) {
        globalEqualizer.update(settings.equalizer);
      }
    } catch {
      // ignore
    }

    return () => {
      audio.removeEventListener('play', wakeEqualizer);
      for (const evt of ['pointerdown', 'keydown', 'touchstart']) {
        document.removeEventListener(evt, wakeEqualizer);
      }
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.pause();
      audio.removeAttribute('src');
    };
  }, []);

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

  // Native FFT capture runs a continuous callback, so it is only enabled while
  // a visualizer mode is actually selected.
  useEffect(() => {
    if (!BackgroundAudio?.setVisualizerEnabled) return;
    BackgroundAudio.setVisualizerEnabled({
      enabled: settings.visualizerMode !== 'off',
    }).catch(() => {});
  }, [settings.visualizerMode]);

  // Synchronize Real-time Equalizer & Sound FX settings
  useEffect(() => {
    if (!settings.equalizer) return;
    globalEqualizer.update(settings.equalizer);

    // The Web Audio graph only shapes the <audio> element. Once ExoPlayer owns
    // playback it has to be driven through Android's own effect chain, or the
    // equalizer silently does nothing.
    pushEqualizerToNativeRef.current(settings.equalizer);
  }, [settings.equalizer]);

  const ytReadyWaitersRef = useRef<Array<() => void>>([]);

  const ensureYtPlayerElement = () => {
    let el = document.getElementById('yt-hidden-player');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yt-hidden-player';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    // The Now Playing screen aligns this surface over its visible video slot.
    // Keep the parked size at YouTube's documented 200px minimum.
    el.style.cssText =
      'position:fixed;left:-10000px;top:0;width:200px;height:200px;opacity:0;pointer-events:none;z-index:-1;border:0;';
    return el;
  };

  // Event handlers shared by the inline IFrame player and the hosted HTTPS
  // bridge player used on iOS (see createYtPlayer below).
  const ytSharedEvents = {
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
        const playingTrack = currentTrackRef.current;
        const activeId = activeYoutubeIdRef.current;
        if (playingTrack?.isYouTube && activeId && activeId !== playingTrack.youtubeId) {
          youtubePlaybackOverridesRef.current[playingTrack.id] = activeId;
          try {
            localStorage.setItem(
              YOUTUBE_PLAYBACK_OVERRIDES_KEY,
              JSON.stringify(youtubePlaybackOverridesRef.current)
            );
          } catch {
            // Storage can be unavailable in private browsing.
          }
        }
        if (ytPlayerRef.current?.setVolume) {
          try {
            ytPlayerRef.current.setVolume(volumeRef.current * 100);
          } catch {
            // ignore
          }
        }
      }
      // ExoPlayer taking audio focus makes the embedded player report a pause.
      // Ignore that while the native engine owns playback, or the UI flips to
      // "paused" even though audio is running.
      if (event.data === 2 && !document.hidden && !nativeOwnerRef.current) setIsPlaying(false);
      if (event.data === 0) {
        setIsPlaying(false);
        latestActionsRef.current.handleEnded();
      }
    },
        onError: async (event: any) => {
          const errorCode = Number(event?.data);
          console.warn('YouTube Player Error:', errorCode);
          const t = currentTrackRef.current;
          if (!t?.youtubeId) return;

          const generation = playGenRef.current;
          const failedId = activeYoutubeIdRef.current || t.youtubeId;
          failedYoutubeIdsRef.current.add(failedId);
          setIsPlaying(false);
          if (youtubePlaybackOverridesRef.current[t.id] === failedId) {
            delete youtubePlaybackOverridesRef.current[t.id];
            try {
              localStorage.setItem(
                YOUTUBE_PLAYBACK_OVERRIDES_KEY,
                JSON.stringify(youtubePlaybackOverridesRef.current)
              );
            } catch {
              // Storage can be unavailable in private browsing.
            }
          }

          // Error 153 is an app-identification problem, not a restricted song.
          // Retrying other uploads would fail for the same reason.
          if (errorCode === 153) {
            showStatus('YouTube could not identify this app. Please install the newest iPhone build.', 6000);
            return;
          }

          // Removed/private/non-embeddable uploads can often be replaced by a
          // matching official audio upload or played via direct stream extraction.
          if (YOUTUBE_ALTERNATE_ERROR_CODES.has(errorCode)) {
            if (
              isYoutubeRecoveryRunningRef.current ||
              failedYoutubeIdsRef.current.size > MAX_ALTERNATE_UPLOADS
            ) {
              showStatus('No exact embeddable upload was found. Tap ⋯ then Open in YouTube.', 7000);
              return;
            }

            isYoutubeRecoveryRunningRef.current = true;
            try {
              // Step 1: Try direct audio stream extraction (like Harmony Music)
              // This bypasses embed restrictions by extracting raw audio via InnerTube ANDROID_VR client
              try {
                const directUrl = await resolveAudioStreamUrl(failedId, true);
                if (
                  directUrl &&
                  playGenRef.current === generation &&
                  currentTrackRef.current?.id === t.id
                ) {
                  await playAudioUrl(t, directUrl, 0);
                  return;
                }
              } catch {
                // Direct extraction failed, try alternate video IDs
              }

              // Step 2: Find an alternate embeddable upload (Topic / Official Audio)
              const altId = await findBestAlternateVideoId(
                t.title,
                t.artist,
                t.duration,
                failedYoutubeIdsRef.current
              );
              if (
                altId &&
                playGenRef.current === generation &&
                currentTrackRef.current?.id === t.id
              ) {
                activeYoutubeIdRef.current = altId;
                youtubePlaybackOverridesRef.current[t.id] = altId;
                try {
                  localStorage.setItem(
                    YOUTUBE_PLAYBACK_OVERRIDES_KEY,
                    JSON.stringify(youtubePlaybackOverridesRef.current)
                  );
                } catch {
                  // ignore
                }
                // Prefer the ad-free stream for the alternate upload; only use
                // the ad-serving player when no stream can be resolved.
                try {
                  const altStream = await resolveAudioStreamUrl(altId, true);
                  if (
                    altStream &&
                    playGenRef.current === generation &&
                    currentTrackRef.current?.id === t.id
                  ) {
                    await playAudioUrl(t, altStream, 0);
                    return;
                  }
                } catch {
                  // fall through to the player
                }
                if (
                  playGenRef.current === generation &&
                  currentTrackRef.current?.id === t.id &&
                  ytPlayerRef.current?.loadVideoById
                ) {
                  ytPlayerRef.current.loadVideoById({ videoId: altId, startSeconds: 0 });
                  ytPlayerRef.current.playVideo?.();
                  return;
                }
              }

              // Step 3: Last resort - try Invidious direct stream
              const invidiousStream = await fetchDirectAudioStreamUrl(failedId || t.youtubeId || '');
              if (
                invidiousStream &&
                playGenRef.current === generation &&
                currentTrackRef.current?.id === t.id
              ) {
                await playAudioUrl(t, invidiousStream, 0);
                return;
              }
            } catch {
              // ignore
            } finally {
              if (playGenRef.current === generation) {
                isYoutubeRecoveryRunningRef.current = false;
              }
            }

            if (playGenRef.current === generation && currentTrackRef.current?.id === t.id) {
              showStatus('This track is restricted by YouTube. Please try another song.', 6000);
            }
            return;
          }

          // Error 5 is an HTML5 playback failure rather than an age gate. Keep
          // the existing audio-only recovery for that specific failure.
          if (errorCode === 5) {
            const recoveryTrack =
              failedId === t.youtubeId ? t : { ...t, youtubeId: failedId };
            const recovered = await fallbackToStreamRef.current(recoveryTrack, true);
            if (!recovered && playGenRef.current === generation) {
              showStatus('This song could not start. Please try it again.', 5000);
            }
            return;
          }

          showStatus('This song is not available for in-app playback.', 5000);
        },
  };

  const createInlineYtPlayer = () => {
    if (ytPlayerRef.current || !window.YT?.Player) return;
    ensureYtPlayerElement();
    ytPlayerRef.current = new window.YT.Player('yt-hidden-player', {
      height: '200',
      width: '200',
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: 1,
        controls: 1,
        disablekb: 1,
        fs: 0,
        rel: 0,
        enablejsapi: 1,
        playsinline: 1,
        // Capacitor pages use a custom URL scheme, which does not provide an
        // HTTPS Referer. YouTube accepts the installed bundle ID as the API
        // client identity through these player parameters.
        origin: YOUTUBE_APP_ORIGIN,
        widget_referrer: YOUTUBE_APP_ORIGIN,
      },
      events: ytSharedEvents,
    });
  };

  // On iOS the app runs on a capacitor:// origin, which sends YouTube no HTTPS
  // Referer, so embed-restricted songs fail with error 150. The bridge hosts
  // the real IFrame player on an HTTPS origin (GitHub Pages) and relays
  // commands via postMessage, so restricted playback behaves like Android/PC.
  // Falls back to the inline player if the bridge page is unreachable.
  const createYtPlayer = () => {
    if (ytPlayerRef.current) return;
    ensureYtPlayerElement();
    if (shouldUseYtBridge() && !ytBridgeFailedRef.current) {
      const bridge = createYtBridgePlayer('yt-hidden-player', ytSharedEvents, () => {
        ytBridgeFailedRef.current = true;
        ytPlayerRef.current = null;
        createInlineYtPlayer();
      });
      if (bridge) {
        ytPlayerRef.current = bridge;
        return;
      }
    }
    createInlineYtPlayer();
  };

  const loadYtApi = (): Promise<void> => {
    if (isYtReadyRef.current && ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      ytReadyWaitersRef.current.push(resolve);
      // The iOS bridge player does not need the IFrame API script — start it now.
      if (shouldUseYtBridge() && !ytPlayerRef.current) createYtPlayer();
      window.onYouTubeIframeAPIReady = () => createYtPlayer();
      if (window.YT?.Player) {
        createYtPlayer();
      } else if (!document.querySelector('script[data-yt-iframe]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.dataset.ytIframe = '1';
        tag.referrerPolicy = 'strict-origin-when-cross-origin';
        document.head.appendChild(tag);
      }
    });
  };

  // Android still uses the iframe as a backup; desktop skips it on startup
  // because the hidden player element is not in DesktopFrame and the iframe
  // Load YouTube IFrame API on startup
  useEffect(() => {
    void loadYtApi();
  }, []);

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
    // ExoPlayer claimed the track while the IFrame API was still loading.
    // Starting the embedded player now would put two sources on one output.
    if (nativeOwnerRef.current && currentTrackRef.current?.id === track.id) return;
    const yt = ytPlayerRef.current;
    if (yt && typeof yt.loadVideoById === 'function') {
      try {
        yt.stopVideo();
      } catch {
        // ignore
      }
      if (playGenRef.current !== currentGen) return;
      activeYoutubeIdRef.current = track.youtubeId || null;
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
      try {
        yt.playVideo();
      } catch {
        // ignore
      }
      setIsPlaying(true);
    }
  };

  // Sync Timer interval for progress & duration
  useEffect(() => {
    const interval = setInterval(() => {
      // ExoPlayer pushes progress through playbackProgress events; polling the
      // WebView engines here would fight it with stale iframe positions.
      if (nativeOwnerRef.current) return;
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
        const retryCount = streamRetryCountRef.current.get(track.id) || 0;
        if (retryCount >= 1) {
          audioModeTrackIdRef.current = null;
          setIsPlaying(false);
          // Last resort on iPhone: the HTTPS bridge player.
          if (shouldUseYtBridge()) {
            showStatus('Stream failed — switching to YouTube player', 6000);
            void startIframe(track, positionRef.current || 0);
            return;
          }
          showStatus('This song could not start. Please try another upload.', 5000);
          return;
        }
        streamRetryCountRef.current.set(track.id, retryCount + 1);
        const streamYoutubeId = activeYoutubeIdRef.current || track.youtubeId;
        audioModeTrackIdRef.current = null;
        streamUrlCacheRef.current.delete(streamYoutubeId);
        dropCachedStreamUrl(streamYoutubeId);
        fallbackToStreamRef.current(
          streamYoutubeId === track.youtubeId
            ? track
            : { ...track, youtubeId: streamYoutubeId },
          true
        );
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

  // Sleep timer: fades the volume out over the last 30s, then pauses playback.
  useEffect(() => {
    if (!settings.sleepTimerMinutes) {
      setSleepSecondsRemaining(null);
      return;
    }
    const totalMs = settings.sleepTimerMinutes * 60000;
    const fadeMs = 30000;
    const baseVolume = volumeRef.current;

    // Countdown for the Now Playing chip.
    const startAt = Date.now();
    setSleepSecondsRemaining(Math.round(totalMs / 1000));
    const tick = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((totalMs - (Date.now() - startAt)) / 1000));
      setSleepSecondsRemaining(left);
    }, 1000);

    // Adjust the live engines directly. Going through setVolume() would persist
    // every faded step to localStorage and fight the volume slider.
    const setEngineVolume = (v: number) => {
      const level = Math.max(0, Math.min(1, v));
      try {
        if (audioRef.current) audioRef.current.volume = level;
      } catch {
        // ignore
      }
      try {
        ytPlayerRef.current?.setVolume?.(level * 100);
      } catch {
        // ignore
      }
      BackgroundAudio?.setVolume?.({ volume: level }).catch(() => {});
    };

    let fadeInterval: number | null = null;
    const fadeTimer = window.setTimeout(() => {
      const steps = 20;
      const stepMs = fadeMs / steps;
      let i = 0;
      fadeInterval = window.setInterval(() => {
        i += 1;
        setEngineVolume(baseVolume * Math.max(0, 1 - i / steps));
        if (i >= steps && fadeInterval != null) {
          window.clearInterval(fadeInterval);
          fadeInterval = null;
        }
      }, stepMs);
    }, Math.max(0, totalMs - fadeMs));

    const endTimer = window.setTimeout(() => {
      try {
        ytPlayerRef.current?.pauseVideo?.();
      } catch {
        // ignore
      }
      audioRef.current?.pause();
      setIsPlaying(false);
      setEngineVolume(baseVolume);
      showStatus('Sleep timer ended — playback paused', 4000);
    }, totalMs);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(endTimer);
      window.clearInterval(tick);
      if (fadeInterval != null) window.clearInterval(fadeInterval);
      setEngineVolume(baseVolume);
      setSleepSecondsRemaining(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.sleepTimerMinutes]);

  // Apply playback speed to both engines
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = settings.playbackSpeed;
    try {
      ytPlayerRef.current?.setPlaybackRate?.(settings.playbackSpeed);
    } catch {
      // ignore
    }
    BackgroundAudio?.setSpeed?.({ speed: settings.playbackSpeed }).catch(() => {});
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
          ? streamUrlCacheRef.current.get(activeYoutubeIdRef.current || currentTrack.youtubeId)
          : !rec && !currentTrack.isYouTube ? currentTrack.url : undefined;
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
      let url = force
        ? await resolveAudioStreamUrl(vid, true)
        : streamUrlCacheRef.current.get(vid) || (await resolveAudioStreamUrl(vid));
      if (!url) return false;

      streamUrlCacheRef.current.set(vid, url);
      setCachedStreamUrl(vid, url);

      if (playGenRef.current !== gen) return false;
      const current = currentTrackRef.current;
      if (!current || current.id !== track.id || !audioRef.current) return false;

      // Recovering inside the WebView would only work until the Activity
      // stops. Keep recovery on ExoPlayer so a mid-track stream failure does
      // not silently cost background playback.
      if (IS_ANDROID && BackgroundAudio?.playUrl) {
        let res = await handOffToNativeRef.current(track, url);
        if (!res.handedOver && res.hardFail && !force) {
          // The cached URL may be exactly what just died on ExoPlayer — drop
          // it and try once more with a guaranteed-fresh resolve. A timeout
          // is NOT retried: ExoPlayer may still be buffering the first URL,
          // and replacing it would just restart the wait.
          streamUrlCacheRef.current.delete(vid);
          dropCachedStreamUrl(vid);
          const fresh = await resolveAudioStreamUrl(vid, true).catch(() => null);
          if (fresh && playGenRef.current === gen && currentTrackRef.current?.id === track.id) {
            url = fresh;
            streamUrlCacheRef.current.set(vid, url);
            setCachedStreamUrl(vid, url);
            res = await handOffToNativeRef.current(track, url);
          }
        }
        if (res.handedOver) return true;
        if (playGenRef.current !== gen) return false;
      }

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

  // Position of whichever engine is currently making sound.
  const getCurrentPosition = () => {
    if (nativeOwnerRef.current) return positionRef.current;
    const yt = ytPlayerRef.current;
    if (yt?.getCurrentTime) {
      try {
        const t = yt.getCurrentTime();
        if (typeof t === 'number' && t > 0) return t;
      } catch {
        // fall through to the audio element
      }
    }
    if (audioRef.current && audioRef.current.currentTime > 0) {
      return audioRef.current.currentTime;
    }
    return positionRef.current;
  };

  // Ask ExoPlayer to play, but only treat it as real once the first
  // playbackProgress tick proves audio is actually flowing. playUrl resolves
  // the moment the intent lands in the service — long before ExoPlayer has
  // fetched a single byte — so believing it is what silenced playback: the
  // WebView engine had already been stopped by the time the native side
  // failed on the device.
  const playNativeConfirmed = (track: Track, url: string, startTime: number) => {
    type Result = { ok: boolean; hardFail: boolean; msg?: string };
    if (!BackgroundAudio?.playUrl) {
      return Promise.resolve<Result>({ ok: false, hardFail: true });
    }
    const currentGen = playGenRef.current;
    // Cancel any stale pending handoff from a previous track.
    settleNativeConfirm(false);
    const confirmed = new Promise<Result>((resolve) => {
      let settled = false;
      nativeConfirmRef.current = {
        resolve: (res) => {
          if (settled) return;
          settled = true;
          resolve(res);
        },
      };
      // 15s: slow mobile networks can buffer longer than a desktop timeout,
      // and a timeout must NOT kill the native attempt — ExoPlayer may still
      // start, and the progress listener will adopt it.
      confirmTimeoutRef.current = window.setTimeout(() => {
        settleNativeConfirm(false, false);
      }, 15000);
      // Starting a song replaces the player's playlist, so a queued song is gone.
      queuedNextIdRef.current = null;
      BackgroundAudio.playUrl({
        url: url.startsWith('http') ? url : undefined,
        filePath: !url.startsWith('http') ? url : undefined,
        title: track.title,
        artist: track.artist,
        coverUrl: track.coverUrl,
        startTime,
        duration: track.duration,
      }).catch(() => {
        settleNativeConfirm(false, true);
      });
    });
    return confirmed.then((res) => {
      if (!res.ok) return res;
      if (playGenRef.current !== currentGen || currentTrackRef.current?.id !== track.id) {
        // A newer track superseded this one while we waited for proof.
        BackgroundAudio.stop?.().catch(() => {});
        return { ok: false, hardFail: false };
      }
      return res;
    });
  };

  // Move playback from the WebView onto ExoPlayer at the current position.
  // This is what keeps music alive once the Activity stops.
  const handOffToNative = async (
    track: Track,
    url: string
  ): Promise<{ handedOver: boolean; hardFail: boolean; msg?: string }> => {
    if (!BackgroundAudio?.playUrl) return { handedOver: false, hardFail: true };
    const startAt = Math.max(0, getCurrentPosition());
    const res = await playNativeConfirmed(track, url, startAt);
    if (!res.ok) {
      // Never stop the native side here: on a hard failure ExoPlayer already
      // errored out on its own, and on a timeout it may still be buffering —
      // killing it would destroy a handover that was about to succeed.
      return { handedOver: false, hardFail: res.hardFail, msg: res.msg };
    }

    nativeOwnerRef.current = true;
    audioModeTrackIdRef.current = track.id;
    positionRef.current = startAt;
    pendingSeekRef.current = 0;
    lastSeekAtRef.current = Date.now();
    // Re-assert the effect chain: the service may have just been created, or
    // the process may have recycled since the last time it was set.
    pushEqualizerToNativeRef.current(settingsRef.current?.equalizer);

    try {
      ytPlayerRef.current?.stopVideo?.();
    } catch {
      // ignore
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
      } catch {
        // ignore
      }
    }
    hasPlayedRef.current = true;
    setIsPlaying(true);
    return { handedOver: true, hardFail: false };
  };

  const handOffToNativeRef = useRef(handOffToNative);
  useEffect(() => {
    handOffToNativeRef.current = handOffToNative;
  });

  const pushEqualizerToNativeRef = useRef(pushEqualizerToNative);
  useEffect(() => {
    pushEqualizerToNativeRef.current = pushEqualizerToNative;
  });

  // Lock screen / notification pressed play or pause. These carry intent, so
  // they must not be routed through the generic toggle: a stale isPlaying flag
  // would otherwise invert the command the user just gave.
  const applyPosition = (time: number) => {
    lastSeekAtRef.current = Date.now();
    pendingSeekRef.current = 0;
    positionRef.current = time;
    setCurrentTime(time);
  };

  const resumeFromRemote = () => {
    if (!currentTrackRef.current) return;
    if (nativeOwnerRef.current && BackgroundAudio?.resume) {
      void BackgroundAudio.resume().catch(() => {});
      setIsPlaying(true);
      return;
    }
    if (!isPlayingRef.current) {
      latestActionsRef.current.togglePlay();
    } else {
      setIsPlaying(true);
    }
  };

  const pauseFromRemote = () => {
    if (!currentTrackRef.current) return;
    if (nativeOwnerRef.current && BackgroundAudio?.pause) {
      void BackgroundAudio.pause().catch(() => {});
      setIsPlaying(false);
      return;
    }
    if (isPlayingRef.current) {
      latestActionsRef.current.togglePlay();
    } else {
      setIsPlaying(false);
    }
  };

  const playAudioUrl = (track: Track, url: string, startTime = 0) => {
    const currentGen = playGenRef.current;

    // Stop YouTube iframe to ensure no dual playback
    const stopIframe = () => {
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

    // Android keeps the iframe alive until ExoPlayer has proven it is making
    // sound — killing it first is what caused the dead-air regression.
    if (!IS_ANDROID) stopIframe();

    audioModeTrackIdRef.current = track.id;

    // Native playback for local downloaded files and direct audio URLs
    if (Capacitor.isNativePlatform() && BackgroundAudio?.playUrl) {
      const rec = getOfflineRecord(track.id);
      const nativeSource = IS_ANDROID
        ? rec?.path || rec?.webUrl || url
        : rec?.webUrl || rec?.path || url;

      if (IS_ANDROID) {
        return playNativeConfirmed(track, nativeSource, startTime).then((res) => {
          if (playGenRef.current !== currentGen) return;
          if (!res.ok) {
            nativeOwnerRef.current = false;
            // No BackgroundAudio.stop(): a timeout means ExoPlayer may still
            // be buffering, and a hard failure already killed it. If it ever
            // starts, the progress listener adopts it and silences this
            // element again.
            return playHtml5Audio(track, url, startTime, currentGen);
          }
          stopIframe();
          nativeOwnerRef.current = true;
          hasPlayedRef.current = true;
          setIsPlaying(true);
          pushEqualizerToNativeRef.current(settingsRef.current?.equalizer);
        });
      }

      return BackgroundAudio.playUrl({
        url: rec?.webUrl || (url.startsWith('http') ? url : undefined),
        filePath: rec?.path || (!url.startsWith('http') ? url : undefined),
        title: track.title,
        artist: track.artist,
        coverUrl: track.coverUrl,
        startTime,
        duration: track.duration,
      })
        .then(() => {
          if (playGenRef.current !== currentGen) {
            BackgroundAudio.stop?.().catch(() => {});
            return;
          }
          // ExoPlayer is producing the audio from here on, including for
          // offline files. Controls and progress have to follow it.
          nativeOwnerRef.current = true;
          hasPlayedRef.current = true;
          setIsPlaying(true);
        })
        .catch(() => {
          nativeOwnerRef.current = false;
          return playHtml5Audio(track, url, startTime, currentGen);
        });
    }

    return playHtml5Audio(track, url, startTime, currentGen);
  };

  // iOS: try the ad-free direct audio stream first (native AVPlayer, lock
  // screen controls, no YouTube ads) and only use the iframe bridge when no
  // playable stream can be resolved — the bridge plays restricted songs but
  // serves YouTube ads.
  const startStreamThenIframe = async (track: Track, startTime: number, currentGen: number) => {
    setIsResolvingStream(true);
    try {
      const url = await resolveAudioStreamUrl(track.youtubeId || '');
      if (playGenRef.current !== currentGen || currentTrackRef.current?.id !== track.id) return;
      await playAudioUrl(track, url, startTime);
    } catch (e) {
      if (playGenRef.current !== currentGen || currentTrackRef.current?.id !== track.id) return;
      const debug = getLastStreamResolveNotes();
      console.warn('Direct stream unavailable:', debug || e);
      showStatus(
        debug
          ? `Direct audio blocked (${debug.slice(0, 140)}) — using YouTube player`
          : 'Direct audio unavailable — using YouTube player',
        10000
      );
      void startIframe(track, startTime);
    } finally {
      if (playGenRef.current === currentGen) setIsResolvingStream(false);
    }
  };

  const playHtml5Audio = (_track: Track, url: string, startTime: number, currentGen: number) => {
    if (!audioRef.current) return Promise.reject(new Error('no audio'));
    nativeOwnerRef.current = false;
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
    queuedNextIdRef.current = null;
    activeYoutubeIdRef.current = null;
    isYoutubeRecoveryRunningRef.current = false;
    nativeOwnerRef.current = false;
    // Native engine too — otherwise the old ExoPlayer track keeps playing
    // underneath the new track's WebView start (dual audio).
    if (BackgroundAudio?.stop) {
      BackgroundAudio.stop().catch(() => {});
    }
    settleNativeConfirm(false);
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

  // History and play counts for a song that is starting.
  const recordPlay = (track: Track) => {
    setRecentlyPlayed(prev => {
      const updated = [track, ...prev.filter(t => t.id !== track.id)].slice(0, 50);
      localStorage.setItem('bw_music_recently_played_v2', JSON.stringify(updated));
      return updated;
    });
    setPlayCounts(prev => {
      const next = { ...prev, [track.id]: (prev[track.id] || 0) + 1 };
      try {
        localStorage.setItem('bw_music_play_counts_v1', JSON.stringify(next));
      } catch {
        // storage full
      }
      return next;
    });
  };

  // The native player rolled into the song queued behind the previous one without
  // us starting it. The audio is already playing, so only the app's own state
  // (current song, history, counters) has to catch up. No player call here.
  const adoptAdvancedTrack = (trackId: string) => {
    const known = [currentTrack, ...queue, ...tracks, ...downloadedTracks];
    const track = trackStore[trackId] || known.find(t => t?.id === trackId);
    if (!track) return;
    queuedNextIdRef.current = null;
    playGenRef.current += 1; // anything still starting the previous song is stale now
    failedYoutubeIdsRef.current.clear();
    streamRetryCountRef.current.delete(track.id);
    const savedYoutubeId = track.isYouTube
      ? youtubePlaybackOverridesRef.current[track.id]
      : undefined;
    activeYoutubeIdRef.current = savedYoutubeId || track.youtubeId || null;
    registerTrack(track);
    recordPlay(track);
    setCurrentTrack(track);
    audioModeTrackIdRef.current = track.id;
    nativeOwnerRef.current = true;
    hasPlayedRef.current = true;
    pendingSeekRef.current = 0;
    positionRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(true);
  };

  const startTrack = (track: Track, startTime = 0) => {
    stopAllPlayback();
    const currentGen = playGenRef.current;
    failedYoutubeIdsRef.current.clear();
    streamRetryCountRef.current.delete(track.id);
    const savedYoutubeId = track.isYouTube
      ? youtubePlaybackOverridesRef.current[track.id]
      : undefined;
    activeYoutubeIdRef.current = savedYoutubeId || track.youtubeId || null;
    registerTrack(track);
    recordPlay(track);

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

    // 2. YouTube tracks: Immediate player start via YouTube player with automatic alternate recovery
    if (track.isYouTube && track.youtubeId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
      }

      // On iPhone always try the ad-free direct stream first — for the original
      // upload or a previously-found alternate — and only fall back to the
      // ad-serving bridge player when no stream can be resolved.
      if (shouldUseYtBridge()) {
        const target = savedYoutubeId ? { ...track, youtubeId: savedYoutubeId } : track;
        void startStreamThenIframe(target, startTime, currentGen);
        return;
      }

      const targetId = savedYoutubeId || track.youtubeId;

      // Android: resolve the direct stream first and play it on ExoPlayer from
      // the start. Starting the YouTube iframe to cover the resolve and then
      // handing over to ExoPlayer meant every song played, cut out while the
      // native player buffered, and restarted. The iframe is only the fallback
      // for a stream that cannot be resolved in time.
      if (IS_ANDROID && BackgroundAudio?.playUrl && targetId) {
        const nativeTrack = savedYoutubeId ? { ...track, youtubeId: savedYoutubeId } : track;
        // Only the play generation: stopAllPlayback() bumps it synchronously for
        // every new start. currentTrackRef lags a render behind, so with a
        // cached stream (which resolves instantly) comparing it here wrongly
        // treated the new track as superseded and dropped it.
        const stale = () => playGenRef.current !== currentGen;
        setIsResolvingStream(true);
        const resolved = Promise.race([
          streamUrlCacheRef.current.get(targetId)
            ? Promise.resolve(streamUrlCacheRef.current.get(targetId)!)
            : resolveAudioStreamUrl(targetId),
          new Promise<string>((_, reject) =>
            window.setTimeout(() => reject(new Error('stream resolve timeout')), 12000)
          ),
        ]);
        void resolved
          .then(async url => {
            if (stale()) return;
            streamUrlCacheRef.current.set(targetId, url);
            setCachedStreamUrl(targetId, url);
            await playAudioUrl(nativeTrack, url, startTime);
          })
          .catch(() => {
            if (stale()) return;
            console.warn('Direct stream unavailable, using the YouTube player');
            void startIframe(nativeTrack, startTime);
          })
          .finally(() => {
            if (playGenRef.current === currentGen) setIsResolvingStream(false);
          });
        return;
      }

      void startIframe(
        savedYoutubeId ? { ...track, youtubeId: savedYoutubeId } : track,
        startTime
      );
      if (IS_ANDROID && track.youtubeId) {
        // Resolve the direct stream in parallel and move to ExoPlayer as soon
        // as it lands. The WebView player only exists to cover the gap — it
        // cannot survive the Activity being stopped.
        void resolveAudioStreamUrl(targetId)
          .then(async url => {
            if (!url || playGenRef.current !== currentGen) return;
            if (currentTrackRef.current?.id !== track.id) return;
            streamUrlCacheRef.current.set(targetId, url);
            setCachedStreamUrl(targetId, url);

            const res = await handOffToNativeRef.current(track, url);
            if (!res.handedOver && res.hardFail) {
              if (playGenRef.current !== currentGen) return;
              if (currentTrackRef.current?.id !== track.id) return;
              // The URL ExoPlayer refused is poison — never prime the service
              // with it. The iframe keeps playing in the foreground; if the
              // app is backgrounded, handoverNow / requestStream resolve a
              // fresh URL and retry. Show the real native error so it can be
              // reported instead of guessed at.
              streamUrlCacheRef.current.delete(targetId);
              dropCachedStreamUrl(targetId);
              showStatus(
                res.msg
                  ? `Background audio failed: ${res.msg.slice(0, 120)}`
                  : 'Background playback unavailable for this song — keep the app open',
                8000
              );
            }
            // A soft timeout is silent on purpose: ExoPlayer may still be
            // buffering, and the progress listener adopts it when it starts.
          })
          .catch(() => {});
      }
      return;
    }

    // 3. Direct audio URL track
    if (ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
      try { ytPlayerRef.current.pauseVideo(); } catch {}
    }

    // Use the same native path as downloaded tracks. Starting <audio> here
    // bypassed the foreground service for every ordinary audio URL.
    void playAudioUrl(track, track.url, startTime).catch(() => {
      if (playGenRef.current === currentGen) setIsPlaying(false);
    });
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

  // Remove a single entry from the play queue by index.
  const removeFromQueue = (index: number) => {
    setQueue(prev => {
      if (index < 0 || index >= prev.length) return prev;
      const next = [...prev];
      next.splice(index, 1);
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

    // ExoPlayer owns the audio: talk to the service, not the WebView engines.
    if (nativeOwnerRef.current && BackgroundAudio) {
      if (isPlaying) {
        void BackgroundAudio.pause().catch(() => {});
        setIsPlaying(false);
      } else {
        void BackgroundAudio.resume().catch(() => {});
        setIsPlaying(true);
      }
      return;
    }

    const audioMode = isAudioMode(currentTrack);

    if (currentTrack.isYouTube && !audioMode && ytPlayerRef.current) {
      if (isPlaying) {
        try {
          ytPlayerRef.current.pauseVideo?.();
        } catch {
          // ignore
        }
        setIsPlaying(false);
      } else {
        try {
          ytPlayerRef.current.playVideo?.();
        } catch {
          // ignore
        }
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

  // Queue a track without replacing the current play queue. 'next' plays it
  // immediately after the current song; 'last' appends it to the end. When
  // nothing is playing yet, the track simply starts.
  const addToQueue = (track: Track, position: 'next' | 'last' = 'last') => {
    registerTrack(track);
    if (!currentTrackRef.current) {
      playTrack(track);
      return;
    }
    setQueue(prev => {
      const list = [...prev];
      if (position === 'next') {
        const curIdx = list.findIndex(t => t.id === currentTrackRef.current?.id);
        list.splice(curIdx >= 0 ? curIdx + 1 : 0, 0, track);
      } else {
        list.push(track);
      }
      return list;
    });
    showStatus(
      position === 'next'
        ? `Playing "${track.title}" next`
        : `Added "${track.title}" to the queue`,
      2500
    );
  };

  const nextShuffleRef = useRef<{ forId: string; track: Track } | null>(null);

  const pickShuffleNext = (list: Track[], currentId?: string): Track => {
    const others = list.filter(t => t.id !== currentId);
    const pool = others.length > 0 ? others : list;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const nextTrack = () => {
    const list = queue.length > 0 ? queue : tracks;
    if (list.length === 0) return;

    if (isShuffle) {
      // Use the song already chosen (and prefetched) for this track, if any.
      const planned = nextShuffleRef.current;
      const pick =
        planned && planned.forId === currentTrack?.id && list.some(t => t.id === planned.track.id)
          ? planned.track
          : pickShuffleNext(list, currentTrack?.id);
      nextShuffleRef.current = null;
      playTrack(pick);
      return;
    }

    const currentIndex = list.findIndex(t => t.id === currentTrack?.id);
    if (currentIndex === -1) {
      playTrack(list[0]);
      return;
    }
    // When playlist runs out of songs, wrap back to the first song (index 0) and continue playing seamlessly
    const nextIndex = (currentIndex + 1) % list.length;
    playTrack(list[nextIndex]);
  };

  const previousTrack = () => {
    const list = queue.length > 0 ? queue : tracks;
    if (list.length === 0) return;
    const currentIndex = list.findIndex(t => t.id === currentTrack?.id);
    if (currentIndex <= 0) {
      if (currentTime > 3) {
        seekTo(0);
      } else {
        const prevIndex = (currentIndex - 1 + list.length) % list.length;
        playTrack(list[prevIndex]);
      }
      return;
    }
    playTrack(list[currentIndex - 1]);
  };

  // Called when a track finishes: honors Repeat 1, otherwise advances through the queue
  const handleEnded = () => {
    if (repeatMode === 'one' && currentTrack) {
      if (nativeOwnerRef.current && BackgroundAudio) {
        void BackgroundAudio.seek({ position: 0 }).catch(() => {});
        void BackgroundAudio.resume().catch(() => {});
        setCurrentTime(0);
        positionRef.current = 0;
        setIsPlaying(true);
        return;
      }
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
      applyPosition,
      resumeFromRemote,
      pauseFromRemote,
      adoptAdvancedTrack,
    };
  });

  // Android: get the next song ready while the current one plays: look up its
  // stream, then queue it inside the native player. The player rolls into it by
  // itself when the song ends (gapless), and keeps going even if the web layer
  // is asleep in the background. Shuffle picks its next song up front so that
  // one can be prepared too.
  useEffect(() => {
    if (!IS_ANDROID || !isPlaying || !currentTrack) return;
    const list = queue.length > 0 ? queue : tracks;
    const idx = list.findIndex(t => t.id === currentTrack.id);
    if (idx === -1) return;

    let next: Track | undefined;
    if (isShuffle) {
      let planned = nextShuffleRef.current;
      if (!planned || planned.forId !== currentTrack.id || !list.some(t => t.id === planned!.track.id)) {
        planned = { forId: currentTrack.id, track: pickShuffleNext(list, currentTrack.id) };
        nextShuffleRef.current = planned;
      }
      next = planned.track;
    } else {
      next = list[(idx + 1) % list.length];
    }

    // Auto-play off or repeat-one: the app decides what happens at the end.
    const wantNative = settings.autoPlayNext && repeatMode !== 'one';
    const target = next && next.id !== currentTrack.id ? next : undefined;

    // A song queued earlier may no longer be the right one (queue edited, shuffle
    // toggled): take it out so it cannot play by mistake.
    if (queuedNextIdRef.current && (!wantNative || queuedNextIdRef.current !== target?.id)) {
      queuedNextIdRef.current = null;
      void BackgroundAudio?.clearNext?.().catch(() => {});
    }
    if (!target) return;

    const record = getOfflineRecord(target.id);
    const vid = target.isYouTube
      ? youtubePlaybackOverridesRef.current[target.id] || target.youtubeId
      : undefined;
    if (!record && !vid) return;

    let cancelled = false;
    let retry: number | undefined;

    const queueNatively = async (url?: string) => {
      if (!wantNative || cancelled || !BackgroundAudio?.setNext) return;
      if (queuedNextIdRef.current === target.id) return;
      // The player ignores a queued song until it owns playback.
      for (let i = 0; i < 8 && !nativeOwnerRef.current; i++) {
        await new Promise(r => window.setTimeout(r, 750));
        if (cancelled) return;
      }
      if (cancelled || !nativeOwnerRef.current) return;
      try {
        await BackgroundAudio.setNext({
          trackId: target.id,
          url: record ? undefined : url,
          filePath: record?.path || undefined,
          title: target.title,
          artist: target.artist,
          coverUrl: target.coverUrl,
          duration: target.duration,
        });
        queuedNextIdRef.current = target.id;
      } catch {
        // the app still advances on its own when the song ends
      }
    };

    const attempt = (triesLeft: number) => {
      if (record) {
        void queueNatively();
        return;
      }
      resolveAudioStreamUrl(vid!)
        .then(url => queueNatively(url))
        .catch(() => {
          // One more try a little later (flaky network, minter warming up).
          if (!cancelled && triesLeft > 0) retry = window.setTimeout(() => attempt(triesLeft - 1), 8000);
        });
    };
    const timer = window.setTimeout(() => attempt(2), 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, [currentTrack, isPlaying, isShuffle, queue, tracks, settings.autoPlayNext, repeatMode]);

  const seekTo = (time: number) => {
    lastSeekAtRef.current = Date.now();
    pendingSeekRef.current = time;
    positionRef.current = time;

    if (nativeOwnerRef.current && BackgroundAudio?.seek) {
      setCurrentTime(time);
      void BackgroundAudio.seek({ position: time }).catch(() => {});
      return;
    }

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
    // ExoPlayer keeps its own output level; the Web Audio graph never sees it.
    BackgroundAudio?.setVolume?.({ volume: clamped }).catch(() => {});
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

  const toggleFavorite = (trackId: string, knownTrack?: Track) => {
    const isFav = favorites.includes(trackId);
    setFavorites(prev =>
      prev.includes(trackId) ? prev.filter(id => id !== trackId) : [...prev, trackId]
    );

    if (!isFav) {
      // The caller's own copy wins: a song liked straight from a search result is
      // not in any of the app's lists yet, and without its details it would be
      // saved as a bare id (missing from Liked Music and from auto-download).
      const source = [currentTrack, ...queue, ...tracks, ...downloadedTracks];
      const trackObj = knownTrack || trackStore[trackId] || source.find(t => t?.id === trackId);
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

  registerDownloadedTrackRef.current = registerDownloadedTrack;

  // Auto-download: queue liked songs and the chosen playlists. Enqueueing skips
  // anything already saved or already queued, so running this often is safe.
  useEffect(() => {
    const want = new Map<string, Track>();
    if (settings.autoDownloadLikes) favoriteTracks.forEach(t => want.set(t.id, t));
    for (const pid of settings.autoDownloadPlaylists || []) {
      const pl = playlists.find(p => p.id === pid);
      if (!pl) continue;
      for (const id of pl.trackIds) {
        const t = tracks.find(x => x.id === id);
        if (t) want.set(t.id, t);
      }
    }
    const fresh = [...want.values()].filter(t => t.youtubeId && !t.isLocal && !isAlreadyOffline(t.id));
    if (fresh.length > 0) enqueueDownloads(fresh, 'auto');
  }, [settings.autoDownloadLikes, settings.autoDownloadPlaylists, favoriteTracks, playlists, tracks]);

  // Changing the Wi-Fi rule or the size limit may release held-back downloads now.
  useEffect(() => {
    kickQueue();
  }, [settings.autoDownloadWifiOnly, settings.autoDownloadLimitMb]);

  const downloadTrack = async (track: Track) => {
    // Local files already live on the device — just register them.
    if (track.isLocal || !track.youtubeId) {
      registerDownloadedTrack(track);
      return;
    }

    if (await verifyOfflineRecord(track.id)) {
      registerDownloadedTrack(track);
      showStatus(`"${track.title}" is already saved for offline playback`);
      return;
    }

    // The queue downloads it (with retries) and registers it once the file exists.
    enqueueDownloads([track], 'manual');
  };

  const downloadPlaylist = async (playlistTitle: string, tracksToDownload: Track[]) => {
    if (!tracksToDownload || tracksToDownload.length === 0) return;

    // Songs are only marked as downloaded once their file really exists (the
    // queue registers each one on success), not up front.

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

    // 5. Queue the audio files: retried on failure, resumed after a restart.
    enqueueDownloads(
      tracksToDownload.filter(t => t.youtubeId && !t.isLocal),
      'manual'
    );
    showStatus(`Queued ${tracksToDownload.length} songs from "${playlistTitle}" for download`);
  };

  const restoreMusicFolderDownloads = async (onProgress?: (done: number, total: number) => void) => {
    const res = await restoreDownloadsFromMusic(onProgress);
    res.tracks.forEach(t => registerDownloadedTrack(t));
    return {
      restored: res.tracks.length,
      skipped: res.skipped,
      permissionDenied: res.permissionDenied,
      unsupported: res.unsupported,
    };
  };

  const syncMusicFolderCopies = () => syncMusicCopies(downloadedTracks);

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

    if (found) {
      registerTrack(found);
      addTrackToLibrary(found);
    }

    setPlaylists(prev => {
      const next = prev.map(p => {
        if (p.id === playlistId && !p.trackIds.includes(trackId)) {
          return { ...p, trackIds: [...p.trackIds, trackId] };
        }
        return p;
      });
      try {
        localStorage.setItem('bw_music_playlists_v11', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const removeTrackFromPlaylist = (playlistId: string, trackId: string) => {
    if (playlistId === 'favorites') {
      setFavorites(prev => prev.filter(id => id !== trackId));
      return;
    }
    setPlaylists(prev => {
      const next = prev.map(p => {
        if (p.id === playlistId) {
          return { ...p, trackIds: p.trackIds.filter(id => id !== trackId) };
        }
        return p;
      });
      try {
        localStorage.setItem('bw_music_playlists_v11', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const reorderPlaylistTracks = (playlistId: string, fromIndex: number, toIndex: number) => {
    setPlaylists(prev => {
      const next = prev.map(p => {
        if (p.id === playlistId) {
          const newTrackIds = [...p.trackIds];
          if (fromIndex >= 0 && fromIndex < newTrackIds.length && toIndex >= 0 && toIndex < newTrackIds.length) {
            const [moved] = newTrackIds.splice(fromIndex, 1);
            newTrackIds.splice(toIndex, 0, moved);
          }
          return { ...p, trackIds: newTrackIds };
        }
        return p;
      });
      try {
        localStorage.setItem('bw_music_playlists_v11', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
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

  // Top tracks by lifetime plays, resolved to their track objects. Backs the
  // "Most played" card on Home.
  const mostPlayed = useMemo(() => {
    return Object.entries(playCounts)
      .map(([id, count]) => {
        const track =
          trackStore[id] ||
          tracks.find(t => t.id === id) ||
          recentlyPlayed.find(t => t.id === id);
        return track ? { track, count } : null;
      })
      .filter((x): x is { track: Track; count: number } => x !== null)
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [playCounts, trackStore, tracks, recentlyPlayed]);

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
        playCounts,
        mostPlayed,
        sleepSecondsRemaining,
        settings,
        analyserNode: spectrumSourceRef.current,
        isResolvingStream,
        isLoadingApiTracks: false,
        downloadStatus,
        sleepTimerMinutes,
        isEqualizerOpen,
        setIsEqualizerOpen,

        playTrack,
        playQueue,
        addToQueue,
        reorderQueue,
        removeFromQueue,
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
        restoreMusicFolderDownloads,
        syncMusicFolderCopies,
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
