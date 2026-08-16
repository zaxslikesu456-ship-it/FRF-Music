export type RepeatMode = 'off' | 'all' | 'one';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // in seconds
  url: string; // audio source URL, blob, or resolved stream
  coverUrl?: string;
  isLocal?: boolean;
  isYouTube?: boolean;
  youtubeId?: string;
  genre?: string;
  addedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackIds: string[];
  createdAt: number;
}

export interface CommunityPlaylist {
  id: string;
  browseId: string;
  title: string;
  author: string;
  songCount: string;
  coverUrl: string;
}

export type VisualizerMode = 'bars' | 'wave' | 'off';
export type BackgroundAnimation = 'off' | 'meteors' | 'particles' | 'matrix' | 'rain' | 'aurora';

export type AppTheme =
  | 'black-white'
  | 'cyberpunk-neon'
  | 'midnight-blue'
  | 'sunset-crimson'
  | 'emerald-matrix'
  | 'violet-aura'
  | 'solar-amber'
  | 'nordic-frost'
  | 'obsidian-gold'
  | 'forest-emerald'
  | 'amoled-pitch'
  | 'cherry-blossom';

export type FontStyle = 'sans' | 'mono' | 'serif';
export type SortOrder = 'title' | 'artist' | 'addedAt';
export type SettingsTab = 'appearance' | 'playback' | 'downloads' | 'library' | 'about';
export type NavTab = 'home' | 'search' | 'library' | 'settings';

export interface ApiProviderConfig {
  id: 'ytmusic' | 'piped' | 'freesound' | 'custom';
  name: string;
  enabled: boolean;
  apiKey?: string;
  customEndpoint?: string;
}

export interface SettingsState {
  theme: AppTheme;
  fontStyle: FontStyle;
  visualizerMode: VisualizerMode;
  backgroundAnimation: BackgroundAnimation;
  playbackSpeed: number;
  compactView: boolean;
  autoPlayNext: boolean;
  sortBy: SortOrder;
  downloadQuality: 'high' | 'low';
  sleepTimerMinutes: 0 | 15 | 30 | 60;
  backgroundPlayback: boolean;
  showPlayCounts: boolean;
  profileName: string;
  profileAvatar: string | null;
  useCustomColors: boolean;
  customAccent: string;
  customBackground: string;
  backgroundImage: string | null;
  overlayTransparency: number;
  providers: ApiProviderConfig[];
}
