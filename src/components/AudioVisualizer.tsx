import React, { useEffect, useRef } from 'react';
import { useAudio } from '../context/AudioContext';

// Reacts to the sound that is actually playing (after the equalizer): the Web
// Audio analyser on PC/web, the native player's spectrum on Android.
//   bars - soft glowing bars in the accent colour
//   wave - a smooth flowing line
//   ring - bars radiating around the cover (variant "ring" draws only this one)
export const AudioVisualizer: React.FC<{
  variant?: 'strip' | 'ring';
  height?: number;
  className?: string;
}> = ({ variant = 'strip', height = 56, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { analyserNode, isPlaying, settings } = useAudio();
  const mode = settings.visualizerMode;
  const active = variant === 'ring' ? mode === 'ring' : mode === 'bars' || mode === 'wave';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    const bins = analyserNode ? analyserNode.frequencyBinCount : 64;
    const data = new Uint8Array(bins);
    const smooth = new Float32Array(bins);
    let accent = '#ffffff';
    let frame = 0;
    let animId = 0;

    const render = () => {
      if (frame++ % 30 === 0) {
        accent = getComputedStyle(document.documentElement).getPropertyValue('--bg-highlight').trim() || '#ffffff';
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (analyserNode && isPlaying) {
        if (mode === 'wave') analyserNode.getByteTimeDomainData(data);
        else analyserNode.getByteFrequencyData(data);
      } else {
        data.fill(mode === 'wave' ? 128 : 0);
      }
      // Ease towards the new values so the motion is fluid, not jittery.
      for (let i = 0; i < bins; i++) smooth[i] += (data[i] - smooth[i]) * 0.35;

      ctx.shadowColor = accent;
      ctx.fillStyle = accent;
      ctx.strokeStyle = accent;

      if (variant === 'ring') {
        const cx = w / 2;
        const cy = h / 2;
        const base = Math.min(w, h) * 0.38; // just outside the cover's edge
        const count = 72;
        ctx.shadowBlur = 12 * dpr;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(2, (2 * Math.PI * base) / count / 2.2);
        for (let i = 0; i < count; i++) {
          // Mirror the low half of the spectrum around the circle.
          const idx = Math.floor(((i < count / 2 ? i : count - i) / (count / 2)) * bins * 0.7);
          const v = smooth[idx] / 255;
          const len = 3 * dpr + v * base * 0.3;
          const a = (i / count) * Math.PI * 2 - Math.PI / 2;
          ctx.globalAlpha = 0.35 + v * 0.65;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * base, cy + Math.sin(a) * base);
          ctx.lineTo(cx + Math.cos(a) * (base + len), cy + Math.sin(a) * (base + len));
          ctx.stroke();
        }
      } else if (mode === 'wave') {
        ctx.shadowBlur = 10 * dpr;
        ctx.lineWidth = 2.5 * dpr;
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        const step = w / (bins - 1);
        for (let i = 0; i < bins; i++) {
          const y = h / 2 + ((smooth[i] - 128) / 128) * (h / 2) * 0.9;
          const x = i * step;
          if (i === 0) ctx.moveTo(x, y);
          else {
            const px = (i - 1) * step;
            const py = h / 2 + ((smooth[i - 1] - 128) / 128) * (h / 2) * 0.9;
            ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
          }
        }
        ctx.stroke();
      } else {
        // Glowing bars, mirrored from the centre, low notes in the middle.
        const count = 32;
        const gap = 3 * dpr;
        const bw = (w - gap * (count - 1)) / count;
        ctx.shadowBlur = 14 * dpr;
        for (let i = 0; i < count; i++) {
          const fromCentre = Math.abs(i - (count - 1) / 2) / (count / 2);
          const v = smooth[Math.floor(fromCentre * bins * 0.75)] / 255;
          const bh = Math.max(3 * dpr, v * h);
          ctx.globalAlpha = 0.35 + v * 0.65;
          const x = i * (bw + gap);
          const r = Math.min(bw / 2, 4 * dpr);
          const y = (h - bh) / 2;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, bw, bh, r);
          else ctx.rect(x, y, bw, bh);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      animId = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(animId);
      ro?.disconnect();
    };
  }, [analyserNode, isPlaying, mode, variant, active]);

  if (!active) return null;

  return (
    <div
      className={`pointer-events-none ${variant === 'ring' ? 'absolute' : 'w-full'} ${className}`}
      style={variant === 'ring' ? { inset: '-16%' } : undefined}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={variant === 'ring' ? undefined : { height }}
      />
    </div>
  );
};

export const VISUALIZER_OPTIONS: { id: 'off' | 'bars' | 'wave' | 'ring'; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'ring', label: 'Ring around the cover' },
  { id: 'bars', label: 'Glowing bars' },
  { id: 'wave', label: 'Smooth wave' },
];
