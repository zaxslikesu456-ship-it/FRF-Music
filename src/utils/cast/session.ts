import type { CastDevice } from './discovery';

export interface CastMedia {
  /** Address on this phone/PC the TV pulls the song from. */
  url: string;
  contentType: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
  startTime?: number;
}

export type CastState = 'loading' | 'playing' | 'paused' | 'buffering' | 'idle' | 'ended' | 'error' | 'disconnected';

export interface CastStatus {
  state: CastState;
  position: number;
  duration: number;
  error?: string;
}

export interface CastSession {
  readonly device: CastDevice;
  load(media: CastMedia): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  /** 0..1 */
  setVolume(level: number): Promise<void>;
  status(): Promise<CastStatus>;
  /** Stops the song on the TV and closes the connection. */
  stop(): Promise<void>;
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
