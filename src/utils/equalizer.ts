import type { EqualizerPreset, EqualizerSettings } from '../types/music';

export const EQ_FREQUENCIES = [60, 230, 910, 3600, 14000];

export const EQ_BAND_LABELS = ['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz'];

export const EQ_BAND_NAMES = ['Sub-Bass', 'Bass', 'Midrange', 'Upper Mid', 'Treble'];

export interface PresetInfo {
  name: string;
  bands: number[];
  bassBoost: number;
  surround: number;
}

export const EQ_PRESETS: Record<EqualizerPreset, PresetInfo> = {
  flat: {
    name: 'Flat',
    bands: [0, 0, 0, 0, 0],
    bassBoost: 0,
    surround: 0,
  },
  'bass-boost': {
    name: 'Bass Boost',
    bands: [8, 6, 2, 0, 0],
    bassBoost: 7,
    surround: 0,
  },
  rock: {
    name: 'Rock',
    bands: [5, 3, -1, 3, 5],
    bassBoost: 3,
    surround: 2,
  },
  pop: {
    name: 'Pop',
    bands: [-1, 2, 5, 2, -2],
    bassBoost: 2,
    surround: 1,
  },
  'hip-hop': {
    name: 'Hip-Hop',
    bands: [7, 5, 0, 2, 4],
    bassBoost: 6,
    surround: 2,
  },
  electronic: {
    name: 'Electronic',
    bands: [6, 4, -1, 3, 6],
    bassBoost: 5,
    surround: 3,
  },
  jazz: {
    name: 'Jazz',
    bands: [3, 2, 1, 2, 3],
    bassBoost: 1,
    surround: 2,
  },
  classical: {
    name: 'Classical',
    bands: [4, 2, -1, 2, 4],
    bassBoost: 0,
    surround: 4,
  },
  vocal: {
    name: 'Vocal Booster',
    bands: [-3, -1, 5, 6, 2],
    bassBoost: 0,
    surround: 1,
  },
  acoustic: {
    name: 'Acoustic',
    bands: [4, 2, 2, 3, 4],
    bassBoost: 1,
    surround: 2,
  },
  custom: {
    name: 'Custom',
    bands: [0, 0, 0, 0, 0],
    bassBoost: 0,
    surround: 0,
  },
};

export const DEFAULT_EQUALIZER_SETTINGS: EqualizerSettings = {
  enabled: true,
  preset: 'flat',
  bands: [0, 0, 0, 0, 0],
  bassBoost: 0,
  surround: 0,
};

// The equalizer for the browser and desktop app, built on the Web Audio API.
// It matches the native one in android/.../ParametricEq.java (same bands, filter
// types, Q, bass shelf, stereo widening, headroom and soft limiter), so the phone
// and the PC sound the same.
const BASS_SHELF_HZ = 80;
const BASS_DB_PER_STEP = 1.8; // bass boost 0..10 -> 0..18 dB
const WIDEN_PER_STEP = 0.18; // surround 0..10 -> side gain 1.0 .. 2.8
const MAX_BAND_DB = 15;
const LIMIT_KNEE = 0.8;

// Leaves audio below the knee untouched and eases anything above it toward 1.0.
function buildSoftLimiterCurve(): Float32Array {
  const size = 2048;
  const curve = new Float32Array(size);
  const room = 1 - LIMIT_KNEE;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= LIMIT_KNEE ? a : LIMIT_KNEE + room * Math.tanh((a - LIMIT_KNEE) / room);
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

export class WebAudioEqualizer {
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private nodes: AudioNode[] = [];
  private preGain: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private bassBoostNode: BiquadFilterNode | null = null;
  private widen: { ll: GainNode; lr: GainNode; rl: GainNode; rr: GainNode } | null = null;
  private analyserNode: AnalyserNode | null = null;
  private connectedElement: HTMLAudioElement | null = null;
  private lastSettings: EqualizerSettings | null = null;

  public getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  // A suspended context outputs silence for every element routed through it, so
  // it has to be resumed once the page has had a user gesture.
  public resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  public init(audioEl: HTMLAudioElement): AnalyserNode | null {
    if (this.connectedElement === audioEl && this.ctx) {
      this.resume();
      return this.analyserNode;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!this.ctx) this.ctx = new AudioCtx();
      const ctx = this.ctx!;
      this.resume();

      // An element can only be wrapped once, but a new element (hot reload,
      // remount) needs its own source feeding a fresh graph.
      this.teardown();
      this.sourceNode = ctx.createMediaElementSource(audioEl);
      this.connectedElement = audioEl;

      this.preGain = ctx.createGain();

      // 5 bands: low shelf, three peaking, high shelf (same as the native EQ).
      this.filters = EQ_FREQUENCIES.map((freq, idx) => {
        const filter = ctx.createBiquadFilter();
        if (idx === 0) {
          filter.type = 'lowshelf';
        } else if (idx === EQ_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.4;
        }
        filter.frequency.value = freq;
        filter.gain.value = 0;
        return filter;
      });

      this.bassBoostNode = ctx.createBiquadFilter();
      this.bassBoostNode.type = 'lowshelf';
      this.bassBoostNode.frequency.value = BASS_SHELF_HZ;
      this.bassBoostNode.gain.value = 0;

      // Stereo widening: mid/side, expressed as four gains into a merger.
      //   L' = a*L + b*R,  R' = a*R + b*L   with a = (1+k)/2, b = (1-k)/2
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);
      const ll = ctx.createGain();
      const lr = ctx.createGain();
      const rl = ctx.createGain();
      const rr = ctx.createGain();
      splitter.connect(ll, 0);
      splitter.connect(lr, 0);
      splitter.connect(rl, 1);
      splitter.connect(rr, 1);
      ll.connect(merger, 0, 0);
      rl.connect(merger, 0, 0);
      lr.connect(merger, 0, 1);
      rr.connect(merger, 0, 1);
      this.widen = { ll, lr, rl, rr };

      const limiter = ctx.createWaveShaper();
      limiter.curve = buildSoftLimiterCurve() as Float32Array<ArrayBuffer>;

      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 128;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // Source -> preamp -> bands -> bass -> widen -> limiter -> analyser -> out
      let last: AudioNode = this.sourceNode;
      const chain: AudioNode[] = [this.preGain, ...this.filters, this.bassBoostNode];
      for (const node of chain) {
        last.connect(node);
        last = node;
      }
      last.connect(splitter);
      merger.connect(limiter);
      limiter.connect(this.analyserNode);
      this.analyserNode.connect(ctx.destination);

      this.nodes = [this.sourceNode, ...chain, splitter, merger, ll, lr, rl, rr, limiter, this.analyserNode];

      this.setWiden(ctx, 1);
      if (this.lastSettings) this.update(this.lastSettings);
      return this.analyserNode;
    } catch {
      return null;
    }
  }

  /**
   * Routes a second audio element (the crossfade's fading-out song) through the
   * same equalizer. Returns a function that disconnects it again.
   */
  public attachExtra(audioEl: HTMLAudioElement): () => void {
    if (!this.ctx || !this.preGain) return () => {};
    try {
      const src = this.ctx.createMediaElementSource(audioEl);
      src.connect(this.preGain);
      return () => {
        try {
          src.disconnect();
        } catch {
          // already gone
        }
      };
    } catch {
      return () => {};
    }
  }

  private teardown() {
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.nodes = [];
    this.sourceNode = null;
    this.connectedElement = null;
  }

  private setWiden(ctx: AudioContext, k: number) {
    if (!this.widen) return;
    const a = (1 + k) / 2;
    const b = (1 - k) / 2;
    const now = ctx.currentTime;
    for (const [node, v] of [
      [this.widen.ll, a],
      [this.widen.rr, a],
      [this.widen.lr, b],
      [this.widen.rl, b],
    ] as Array<[GainNode, number]>) {
      node.gain.setTargetAtTime(v, now, 0.03);
    }
  }

  public update(settings: EqualizerSettings) {
    this.lastSettings = settings;
    if (!this.ctx || !this.preGain) return;
    this.resume();

    const ctx = this.ctx;
    const enabled = settings.enabled;
    const now = ctx.currentTime;

    const bands = EQ_FREQUENCIES.map((_, i) => {
      const g = enabled ? settings.bands[i] ?? 0 : 0;
      return Math.max(-MAX_BAND_DB, Math.min(MAX_BAND_DB, g));
    });
    const bassDb = enabled ? Math.max(0, Math.min(10, settings.bassBoost || 0)) * BASS_DB_PER_STEP : 0;

    this.filters.forEach((filter, idx) => {
      filter.gain.setTargetAtTime(bands[idx], now, 0.05);
    });
    this.bassBoostNode?.gain.setTargetAtTime(bassDb, now, 0.03);

    // Boosting raises peaks: give back half of the largest boost (max 9 dB).
    const maxBoost = Math.max(0, ...bands, bassDb);
    const pre = Math.pow(10, -Math.min(9, maxBoost * 0.5) / 20);
    this.preGain.gain.setTargetAtTime(pre, now, 0.05);

    const surround = enabled ? Math.max(0, Math.min(10, settings.surround || 0)) : 0;
    this.setWiden(ctx, 1 + surround * WIDEN_PER_STEP);
  }
}

export const globalEqualizer = new WebAudioEqualizer();
