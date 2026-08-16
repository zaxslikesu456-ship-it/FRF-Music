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

// Web Audio API Equalizer Processor Node graph wrapper
export class WebAudioEqualizer {
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private bassBoostNode: BiquadFilterNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private connectedElement: HTMLAudioElement | null = null;

  public getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  public init(audioEl: HTMLAudioElement): AnalyserNode | null {
    if (this.connectedElement === audioEl && this.ctx) {
      return this.analyserNode;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;

      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }

      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }

      if (!this.sourceNode) {
        this.sourceNode = this.ctx.createMediaElementSource(audioEl);
        this.connectedElement = audioEl;
      }

      // Create 5-band peaking/shelf filters
      this.filters = EQ_FREQUENCIES.map((freq, idx) => {
        const filter = this.ctx!.createBiquadFilter();
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

      // Bass Boost filter (lowshelf 80Hz)
      this.bassBoostNode = this.ctx.createBiquadFilter();
      this.bassBoostNode.type = 'lowshelf';
      this.bassBoostNode.frequency.value = 80;
      this.bassBoostNode.gain.value = 0;

      // Analyser for visuals
      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 128;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // Connect graph in series: Source -> Filters -> BassBoost -> Analyser -> Destination
      let lastNode: AudioNode = this.sourceNode;
      for (const filter of this.filters) {
        lastNode.connect(filter);
        lastNode = filter;
      }

      lastNode.connect(this.bassBoostNode);
      this.bassBoostNode.connect(this.analyserNode);
      this.analyserNode.connect(this.ctx.destination);

      return this.analyserNode;
    } catch {
      return null;
    }
  }

  public update(settings: EqualizerSettings) {
    if (!this.ctx) return;

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    const isEnabled = settings.enabled;
    const now = this.ctx.currentTime;

    // Apply band gains
    this.filters.forEach((filter, idx) => {
      const targetGain = isEnabled ? (settings.bands[idx] ?? 0) : 0;
      try {
        filter.gain.setTargetAtTime(targetGain, now, 0.05);
      } catch {
        filter.gain.value = targetGain;
      }
    });

    // Apply Bass Boost (scale 0-10 -> up to +18dB deep bass)
    if (this.bassBoostNode) {
      const targetBass = isEnabled ? (settings.bassBoost || 0) * 1.8 : 0;
      try {
        this.bassBoostNode.gain.setTargetAtTime(targetBass, now, 0.03);
      } catch {
        this.bassBoostNode.gain.value = targetBass;
      }
    }
  }
}

export const globalEqualizer = new WebAudioEqualizer();
