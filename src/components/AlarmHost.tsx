import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlarmClock, Moon } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import type { Track } from '../types/music';
import { buildDailyMixes, buildRediscover, dayKey, type Mix } from '../utils/listening';
import {
  ALARM_CHANGED_EVENT,
  FrfAlarm,
  IS_ANDROID_APP,
  type AlarmConfig,
  formatClock,
  loadAlarm,
  nextAlarmTime,
  saveAlarm,
  syncNativeAlarm,
} from '../utils/alarm';

const VOLUME_KEY = 'bw_music_volume_v1';
const MAX_LATE_MS = 10 * 60 * 1000; // a timer that wakes up later than this skips the alarm

/** Today's Daily Mixes + Rediscover, built the same way Home builds them. */
export function useAlarmMixes(): Mix[] {
  const { tracks, favoriteTracks, recentlyPlayed, favorites, playCounts } = useAudio();
  return useMemo(() => {
    const map = new Map<string, Track>();
    recentlyPlayed.forEach(t => map.set(t.id, t));
    favoriteTracks.forEach(t => map.set(t.id, t));
    tracks.forEach(t => map.set(t.id, t));
    const input = { known: Array.from(map.values()), favoriteIds: favorites, playCounts };
    let extras: Record<string, Track[]> = {};
    try {
      const raw = JSON.parse(localStorage.getItem('frf_mix_extras_v1') || 'null');
      if (raw && raw.day === dayKey()) extras = raw.extras || {};
    } catch {
      // ignore
    }
    const list = buildDailyMixes(input, extras);
    const re = buildRediscover(input);
    return re ? [...list, re] : list;
  }, [tracks, favoriteTracks, recentlyPlayed, favorites, playCounts]);
}

function shuffle<T>(list: T[]): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function readSavedVolume(fallback: number): number {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY) || '');
    if (Number.isFinite(v) && v > 0.05) return Math.min(1, v);
  } catch {
    // ignore
  }
  return fallback > 0.05 ? fallback : 0.6;
}

/**
 * Runs the music alarm: reacts to the native alarm on Android (app opened or
 * already running) and to a wall-clock timer on PC / web, then plays the chosen
 * music with a slow volume ramp and shows the Stop / Snooze card.
 */
export const AlarmHost: React.FC = () => {
  const audio = useAudio();
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const mixes = useAlarmMixes();
  const mixesRef = useRef(mixes);
  mixesRef.current = mixes;

  const [ringing, setRinging] = useState<{ label: string; at: number; snoozeMinutes: number } | null>(null);
  const ringingRef = useRef(false);
  const rampTimer = useRef<number | null>(null);
  const beepTimer = useRef<number | null>(null);
  const beepCtx = useRef<AudioContext | null>(null);
  const origVolume = useRef(0.6);
  const lastFire = useRef(0);
  const nextRef = useRef(0); // web timer: the moment we are waiting for
  const snoozeAtRef = useRef(0); // web timer: snoozed alarm

  const clearRamp = () => {
    if (rampTimer.current != null) window.clearInterval(rampTimer.current);
    rampTimer.current = null;
  };
  const stopBeep = () => {
    if (beepTimer.current != null) window.clearInterval(beepTimer.current);
    beepTimer.current = null;
    try {
      void beepCtx.current?.close();
    } catch {
      // ignore
    }
    beepCtx.current = null;
  };

  // Set the playback volume without touching the saved level.
  const applyVolume = (v: number, saved: number) => {
    audioRef.current.setVolume(Math.max(0, Math.min(1, v)));
    try {
      localStorage.setItem(VOLUME_KEY, String(saved));
    } catch {
      // ignore
    }
  };

  const pickTracks = (cfg: AlarmConfig): Track[] => {
    const a = audioRef.current;
    let list: Track[] = [];
    if (cfg.source.type === 'playlist') {
      const pl = a.playlists.find(p => p.id === cfg.source.id);
      if (pl) list = pl.trackIds.map(id => a.trackStore[id]).filter(Boolean) as Track[];
    } else if (cfg.source.type === 'mix') {
      const mix = mixesRef.current.find(m => m.id === cfg.source.id);
      if (mix) list = mix.tracks;
    } else {
      list = a.favoriteTracks;
    }
    if (list.length === 0) list = a.favoriteTracks;
    if (list.length === 0) list = a.recentlyPlayed;
    if (list.length === 0) list = a.tracks;
    // No network: only songs that are saved on the device can play.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const saved = new Set(a.downloadedTracks.map(t => t.id));
      const offline = list.filter(t => saved.has(t.id));
      list = offline.length > 0 ? offline : a.downloadedTracks;
    }
    return shuffle(list).slice(0, 60);
  };

  const startBeep = () => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      beepCtx.current = ctx;
      const beep = () => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      };
      beep();
      beepTimer.current = window.setInterval(beep, 1000);
    } catch {
      // ignore
    }
  };

  const fire = async () => {
    const now = Date.now();
    if (ringingRef.current || now - lastFire.current < 20000) return;
    lastFire.current = now;
    const cfg = loadAlarm();
    // Web/iOS keep the schedule in JS; a one-off alarm switches itself off.
    if (!IS_ANDROID_APP && cfg.days.length === 0 && cfg.enabled) saveAlarm({ ...cfg, enabled: false });
    ringingRef.current = true;
    const a = audioRef.current;
    const saved = readSavedVolume(a.volume);
    origVolume.current = saved;
    const label =
      cfg.source.type === 'liked'
        ? 'Liked songs'
        : cfg.source.title || (cfg.source.type === 'mix' ? 'Daily Mix' : 'Playlist');
    setRinging({ label, at: now, snoozeMinutes: cfg.snoozeMinutes });

    const list = pickTracks(cfg);
    const startVol = 0.03;
    applyVolume(startVol, saved);
    await new Promise(r => window.setTimeout(r, 250));
    if (!ringingRef.current) return;
    if (list.length > 0) audioRef.current.playQueue(list, 0);
    else startBeep();

    const rampMs = Math.max(5, cfg.rampSeconds) * 1000;
    const t0 = Date.now();
    clearRamp();
    rampTimer.current = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / rampMs);
      applyVolume(startVol + (saved - startVol) * p, saved);
      if (p >= 1) clearRamp();
    }, 500);
  };
  const fireRef = useRef(fire);
  fireRef.current = fire;

  const dismiss = (snooze: boolean) => {
    if (!ringingRef.current) return;
    ringingRef.current = false;
    clearRamp();
    stopBeep();
    const cfg = loadAlarm();
    try {
      audioRef.current.stopTrack();
    } catch {
      // ignore
    }
    applyVolume(origVolume.current, origVolume.current);
    setRinging(null);
    if (snooze) {
      if (FrfAlarm) void FrfAlarm.snooze({ minutes: cfg.snoozeMinutes }).catch(() => {});
      else snoozeAtRef.current = Date.now() + cfg.snoozeMinutes * 60000;
    } else if (FrfAlarm) {
      void FrfAlarm.stopRinging().catch(() => {});
    }
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  // Android: the alarm wakes the app; ask the native side if that is why we are open.
  useEffect(() => {
    const FA = FrfAlarm;
    if (!FA) return;
    let live = true;
    const check = () => {
      FA.getAlarmLaunch()
        .then(r => {
          if (live && r.launched) void fireRef.current();
        })
        .catch(() => {});
    };
    // Keep native and saved settings in step (a one-off alarm switches itself off natively).
    FA.getAlarmState()
      .then(st => {
        const cfg = loadAlarm();
        if (!live || !cfg.enabled) return;
        if (!st.enabled) saveAlarm({ ...cfg, enabled: false });
        else void syncNativeAlarm(cfg);
      })
      .catch(() => {});
    check();
    const subs = [
      FA.addListener('alarmFired', check),
      FA.addListener('alarmAction', (d: { action?: string }) => {
        if (d?.action === 'stop') dismissRef.current(false);
        else if (d?.action === 'snooze') dismissRef.current(true);
      }),
    ];
    return () => {
      live = false;
      subs.forEach(s => void s.then(h => h.remove()).catch(() => {}));
    };
  }, []);

  // PC / web / iOS: compare wall-clock time every 15 s (survives sleep and wake).
  useEffect(() => {
    if (IS_ANDROID_APP) return;
    const reset = () => {
      nextRef.current = 0;
    };
    window.addEventListener(ALARM_CHANGED_EVENT, reset);
    const check = () => {
      const now = Date.now();
      if (snoozeAtRef.current && now >= snoozeAtRef.current) {
        const late = now - snoozeAtRef.current;
        snoozeAtRef.current = 0;
        if (late < MAX_LATE_MS) void fireRef.current();
        return;
      }
      const cfg = loadAlarm();
      if (!cfg.enabled) {
        nextRef.current = 0;
        return;
      }
      if (!nextRef.current) {
        const n = nextAlarmTime(cfg, new Date(now));
        nextRef.current = n ? n.getTime() : 0;
        return;
      }
      if (now >= nextRef.current) {
        const late = now - nextRef.current;
        nextRef.current = 0;
        if (late < MAX_LATE_MS) void fireRef.current();
        else if (cfg.days.length === 0) saveAlarm({ ...cfg, enabled: false });
      }
    };
    check();
    const id = window.setInterval(check, 15000);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(ALARM_CHANGED_EVENT, reset);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(
    () => () => {
      clearRamp();
      stopBeep();
    },
    []
  );

  if (!ringing) return null;
  const when = new Date(ringing.at);
  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/90 backdrop-blur-md flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-app-solid border border-app-theme rounded-3xl p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-app-card border border-app-theme flex items-center justify-center text-app-primary">
          <AlarmClock className="w-8 h-8" />
        </div>
        <p className="text-sm text-app-secondary">Alarm</p>
        <p className="text-5xl font-bold text-app-primary mt-1">
          {formatClock(when.getHours(), when.getMinutes())}
        </p>
        <p className="text-sm text-app-secondary mt-3">Playing {ringing.label}</p>
        <button
          onClick={() => dismiss(false)}
          className="mt-8 w-full py-4 rounded-full bg-app-highlight text-app-inverse text-lg font-bold active:scale-98 transition-all"
        >
          Stop
        </button>
        <button
          onClick={() => dismiss(true)}
          className="mt-3 w-full py-3.5 rounded-full bg-app-card border border-app-theme text-app-primary font-semibold flex items-center justify-center gap-2 active:scale-98 transition-all"
        >
          <Moon className="w-4 h-4" /> Snooze {ringing.snoozeMinutes} min
        </button>
      </div>
    </div>,
    document.body
  );
};
