export const MINI_CHANNEL = 'frf-mini-player';

export interface MiniState {
  title: string;
  artist: string;
  cover: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

type TauriInvoke = (cmd: string, args?: unknown) => Promise<unknown>;

export const invokeTauri = (cmd: string): void => {
  const inv = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } })
    .__TAURI_INTERNALS__?.invoke;
  void inv?.(cmd);
};
