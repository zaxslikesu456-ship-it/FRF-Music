import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { MINI_CHANNEL, invokeTauri } from '../utils/miniPlayer';
import type { MiniState } from '../utils/miniPlayer';

// Tiny always-on-top window (index.html?mini=1). No app contexts: it only
// mirrors state sent by the main window and sends commands back.
export const PcMiniWindow: React.FC = () => {
  const [s, setS] = useState<MiniState | null>(null);
  const chan = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    document.documentElement.style.background = '#121212';
    document.body.style.background = '#121212';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    const c = new BroadcastChannel(MINI_CHANNEL);
    chan.current = c;
    c.onmessage = ev => {
      if (ev.data?.type === 'state') setS(ev.data.state);
    };
    c.postMessage({ type: 'hello' });
    const retry = window.setInterval(() => c.postMessage({ type: 'hello' }), 1500);
    return () => {
      window.clearInterval(retry);
      c.close();
    };
  }, []);

  const send = (cmd: string, value?: number) => chan.current?.postMessage({ type: 'cmd', cmd, value });
  const pct = s && s.duration > 0 ? Math.min(100, (s.currentTime / s.duration) * 100) : 0;
  const btn = 'flex items-center justify-center rounded-full text-white/90 hover:text-white hover:bg-white/10';

  return (
    <div
      style={{ width: '100vw', height: '100vh', background: '#121212', color: '#fff', fontFamily: 'system-ui, sans-serif', userSelect: 'none' }}
      className="flex flex-col"
    >
      <div data-tauri-drag-region className="flex items-center gap-3 px-3 pt-3 flex-1 min-h-0">
        {s?.cover ? (
          <img data-tauri-drag-region src={s.cover} alt="" className="w-14 h-14 rounded-md object-cover shrink-0 bg-white/10" />
        ) : (
          <div data-tauri-drag-region className="w-14 h-14 rounded-md shrink-0 bg-white/10" />
        )}
        <div data-tauri-drag-region className="min-w-0 flex-1">
          <p data-tauri-drag-region className="text-sm font-bold truncate">{s?.title || 'Nothing playing'}</p>
          <p data-tauri-drag-region className="text-xs text-white/60 truncate">{s?.artist || ''}</p>
        </div>
        <button className={`${btn} w-8 h-8 shrink-0`} title="Back to full window" onClick={() => invokeTauri('show_main_window')}>
          <Maximize2 size={16} />
        </button>
      </div>
      <div className="flex items-center gap-3 px-3 pb-2 pt-1">
        <div
          className="flex-1 h-1.5 rounded-full bg-white/15 cursor-pointer"
          onClick={e => {
            if (!s || s.duration <= 0) return;
            const r = e.currentTarget.getBoundingClientRect();
            send('seek', ((e.clientX - r.left) / r.width) * s.duration);
          }}
        >
          <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
        </div>
        <button className={`${btn} w-8 h-8`} title="Previous" onClick={() => send('prev')}>
          <SkipBack size={18} fill="currentColor" />
        </button>
        <button className={`${btn} w-9 h-9 bg-white/15`} title={s?.isPlaying ? 'Pause' : 'Play'} onClick={() => send('toggle')}>
          {s?.isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </button>
        <button className={`${btn} w-8 h-8`} title="Next" onClick={() => send('next')}>
          <SkipForward size={18} fill="currentColor" />
        </button>
      </div>
    </div>
  );
};
