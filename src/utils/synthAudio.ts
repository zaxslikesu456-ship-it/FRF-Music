// In-browser Web Audio Procedural Music Synthesizer Engine

class SynthAudioEngine {
  private ctx: AudioContext | null = null;
  private isGenerating = false;
  private intervalId: number | null = null;
  private masterGain: GainNode | null = null;

  public init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.2;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public playPreset(preset: 'lofi' | 'ambient' | 'synthwave' | 'chill') {
    this.init();
    this.stop();

    if (!this.ctx || !this.masterGain) return;
    this.isGenerating = true;

    // Chords frequencies in Hz
    const chordsMap = {
      ambient: [[261.63, 329.63, 392.00, 523.25], [220.00, 261.63, 329.63, 440.00], [174.61, 220.00, 261.63, 349.23], [196.00, 246.94, 293.66, 392.00]],
      lofi: [[130.81, 196.00, 246.94, 329.63], [146.83, 220.00, 261.63, 349.23], [164.81, 246.94, 293.66, 392.00], [174.61, 261.63, 329.63, 440.00]],
      synthwave: [[110.00, 164.81, 220.00, 329.63], [130.81, 196.00, 261.63, 392.00], [146.83, 220.00, 293.66, 440.00], [98.00, 146.83, 196.00, 293.66]],
      chill: [[196.00, 246.94, 293.66, 392.00], [164.81, 220.00, 261.63, 329.63], [146.83, 196.00, 246.94, 349.23], [130.81, 164.81, 196.00, 261.63]],
    };

    const chords = chordsMap[preset] || chordsMap.ambient;
    let chordIdx = 0;

    const playChord = () => {
      if (!this.ctx || !this.isGenerating || !this.masterGain) return;

      const currentChord = chords[chordIdx % chords.length];
      chordIdx++;

      currentChord.forEach(freq => {
        if (!this.ctx || !this.masterGain) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = preset === 'synthwave' ? 'sawtooth' : preset === 'lofi' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(preset === 'lofi' ? 800 : 1800, this.ctx.currentTime);

        // Envelope attack & release
        gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.1, this.ctx.currentTime + 0.4);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 3.8);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + 4.0);
      });
    };

    playChord();
    this.intervalId = window.setInterval(playChord, 3500);
  }

  public stop() {
    this.isGenerating = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public setVolume(vol: number) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(vol * 0.3, this.ctx.currentTime);
    }
  }
}

export const synthEngine = new SynthAudioEngine();
