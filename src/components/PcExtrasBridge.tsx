import { useEffect, useRef } from 'react';
import { useAudio } from '../context/AudioContext';
import { MINI_CHANNEL } from '../utils/miniPlayer';
import type { MiniState } from '../utils/miniPlayer';

// Desktop (Tauri) only. Lives in the main window, which owns playback:
//  - exposes window.__frfMedia() for the global media keys registered in Rust
//    (debounced so a key seen by both Windows paths only acts once)
//  - streams now-playing state to the mini player window and runs its commands
export const PcExtrasBridge: React.FC = () => {
  const audio = useAudio();
  const ref = useRef(audio);
  ref.current = audio;
  const chanRef = useRef<BroadcastChannel | null>(null);
  const lastCmd = useRef<{ cmd: string; at: number }>({ cmd: '', at: 0 });

  useEffect(() => {
    const run = (cmd: string, value?: number) => {
      const now = Date.now();
      if (cmd !== 'seek') {
        if (lastCmd.current.cmd === cmd && now - lastCmd.current.at < 300) return;
        lastCmd.current = { cmd, at: now };
      }
      const a = ref.current;
      if (cmd === 'toggle') a.togglePlay();
      else if (cmd === 'next') a.nextTrack();
      else if (cmd === 'prev') a.previousTrack();
      else if (cmd === 'seek' && typeof value === 'number') a.seekTo(value);
    };
    (window as unknown as { __frfMedia?: (c: string) => void }).__frfMedia = c => run(c);

    const chan = new BroadcastChannel(MINI_CHANNEL);
    chanRef.current = chan;
    chan.onmessage = ev => {
      const d = ev.data;
      if (d?.type === 'cmd') run(d.cmd, d.value);
      else if (d?.type === 'hello') push();
    };
    return () => {
      chan.close();
      chanRef.current = null;
      delete (window as unknown as { __frfMedia?: unknown }).__frfMedia;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const push = () => {
    const a = ref.current;
    const t = a.currentTrack;
    const state: MiniState = {
      title: t?.title ?? '',
      artist: t?.artist ?? '',
      cover: t?.coverUrl ?? '',
      isPlaying: a.isPlaying,
      currentTime: a.currentTime,
      duration: a.duration,
    };
    chanRef.current?.postMessage({ type: 'state', state });
  };

  useEffect(push, [audio.currentTrack, audio.isPlaying, audio.currentTime, audio.duration]);

  return null;
};
