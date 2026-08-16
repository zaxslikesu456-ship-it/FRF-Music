import React, { useMemo } from 'react';
import {
  X,
  Sliders,
  Sparkles,
  RotateCcw,
  Zap,
} from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import {
  EQ_BAND_LABELS,
  EQ_BAND_NAMES,
  EQ_PRESETS,
  DEFAULT_EQUALIZER_SETTINGS,
} from '../utils/equalizer';
import type { EqualizerPreset, EqualizerSettings } from '../types/music';

interface EqualizerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EqualizerModal: React.FC<EqualizerModalProps> = ({ isOpen, onClose }) => {
  const { settings, updateSettings } = useAudio();

  const eq = settings.equalizer || DEFAULT_EQUALIZER_SETTINGS;

  const setEq = (partial: Partial<EqualizerSettings>) => {
    const updated: EqualizerSettings = {
      ...eq,
      ...partial,
    };
    updateSettings({ equalizer: updated });
  };

  const handlePresetSelect = (presetKey: EqualizerPreset) => {
    const p = EQ_PRESETS[presetKey];
    if (!p) return;
    setEq({
      preset: presetKey,
      bands: [...p.bands],
      bassBoost: p.bassBoost,
      surround: p.surround,
    });
  };

  const handleBandChange = (index: number, value: number) => {
    const nextBands = [...eq.bands];
    nextBands[index] = value;
    setEq({
      preset: 'custom',
      bands: nextBands,
    });
  };

  const handleReset = () => {
    handlePresetSelect('flat');
  };

  // Generate SVG curve points for visual contour
  const curvePath = useMemo(() => {
    const width = 300;
    const height = 70;
    const padding = 20;
    const availableWidth = width - padding * 2;
    const step = availableWidth / 4;
    const midY = height / 2;

    const points = eq.bands.map((gain, i) => {
      const x = padding + i * step;
      // gain is -12 to +12, map to height
      const y = midY - (gain / 12) * (height / 2 - 8);
      return { x, y };
    });

    if (points.length === 0) return '';

    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cx = (p0.x + p1.x) / 2;
      d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
  }, [eq.bands]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-app-surface border border-app-theme rounded-t-3xl sm:rounded-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-app-theme">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-app-primary">Equalizer & FX</h2>
              <p className="text-xs text-app-secondary">Real-time studio audio processor</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Master Toggle */}
            <button
              onClick={() => setEq({ enabled: !eq.enabled })}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                eq.enabled
                  ? 'bg-app-highlight text-app-inverse shadow-sm'
                  : 'bg-app-card text-app-secondary border border-app-theme'
              }`}
            >
              {eq.enabled ? 'ENABLED' : 'BYPASS'}
            </button>

            <button
              onClick={onClose}
              className="p-2 text-app-secondary hover:text-app-primary rounded-full hover:bg-app-card transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Curve Visualization */}
          <div className="relative p-4 rounded-2xl bg-app-card border border-app-theme overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-app-secondary">FREQUENCY RESPONSE</span>
              <span className="text-xs font-bold text-app-primary uppercase">
                {EQ_PRESETS[eq.preset]?.name || 'Custom'}
              </span>
            </div>

            <div className="h-20 flex items-center justify-center relative">
              {/* Zero line */}
              <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 border-b border-dashed border-app-theme" />

              <svg viewBox="0 0 300 70" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="eqGlow" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--accent, #a855f7)" />
                    <stop offset="50%" stopColor="var(--accent, #ec4899)" />
                    <stop offset="100%" stopColor="var(--accent, #3b82f6)" />
                  </linearGradient>
                </defs>
                <path
                  d={curvePath}
                  fill="none"
                  stroke="url(#eqGlow)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>

          {/* Presets Chips */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-app-secondary tracking-wider">PRESETS</p>
              <button
                onClick={handleReset}
                className="text-xs text-app-secondary hover:text-app-primary flex items-center gap-1 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
              {(Object.keys(EQ_PRESETS) as EqualizerPreset[]).map(pKey => {
                const isSelected = eq.preset === pKey;
                return (
                  <button
                    key={pKey}
                    onClick={() => handlePresetSelect(pKey)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all ${
                      isSelected
                        ? 'bg-app-highlight text-app-inverse border border-white'
                        : 'bg-app-card text-app-secondary border border-app-theme hover:text-app-primary'
                    }`}
                  >
                    {EQ_PRESETS[pKey].name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 5 Vertical Sliders */}
          <div>
            <p className="text-xs font-semibold text-app-secondary tracking-wider mb-4">5-BAND GRAPHIC EQ</p>
            <div className="grid grid-cols-5 gap-2 px-2 py-4 rounded-2xl bg-app-card border border-app-theme">
              {eq.bands.map((gain, i) => (
                <div key={i} className="flex flex-col items-center gap-3">
                  {/* dB indicator */}
                  <span className="text-[11px] font-bold text-app-primary">
                    {gain > 0 ? `+${gain}` : gain}
                    <span className="text-[9px] text-app-secondary font-normal ml-0.5">dB</span>
                  </span>

                  {/* Vertical Range Slider */}
                  <div className="relative h-36 flex items-center justify-center">
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={gain}
                      disabled={!eq.enabled}
                      onChange={e => handleBandChange(i, parseInt(e.target.value, 10))}
                      className="accent-app-highlight h-32 w-2 appearance-none bg-app-surface rounded-full cursor-pointer disabled:opacity-40"
                      style={{
                        WebkitAppearance: 'slider-vertical',
                      }}
                    />
                  </div>

                  {/* Label */}
                  <div className="text-center">
                    <p className="text-xs font-bold text-app-primary">{EQ_BAND_LABELS[i]}</p>
                    <p className="text-[9px] text-app-secondary truncate">{EQ_BAND_NAMES[i]}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sound Enhancers (Bass Boost & Spatial Surround) */}
          <div className="space-y-4 pt-1">
            <p className="text-xs font-semibold text-app-secondary tracking-wider">SOUND ENHANCERS</p>

            {/* Bass Boost */}
            <div className="p-4 rounded-2xl bg-app-card border border-app-theme space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-app-primary" />
                  <span className="text-sm font-semibold text-app-primary">Bass Boost</span>
                </div>
                <span className="text-xs font-bold text-app-primary">{eq.bassBoost * 10}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={eq.bassBoost}
                disabled={!eq.enabled}
                onChange={e => setEq({ bassBoost: parseInt(e.target.value, 10), preset: 'custom' })}
                className="w-full accent-app-highlight h-2 bg-app-surface rounded-lg cursor-pointer disabled:opacity-40"
              />
            </div>

            {/* Spatial Surround / 3D Audio */}
            <div className="p-4 rounded-2xl bg-app-card border border-app-theme space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-app-primary" />
                  <span className="text-sm font-semibold text-app-primary">3D Spatial Surround</span>
                </div>
                <span className="text-xs font-bold text-app-primary">{eq.surround * 10}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={eq.surround}
                disabled={!eq.enabled}
                onChange={e => setEq({ surround: parseInt(e.target.value, 10), preset: 'custom' })}
                className="w-full accent-app-highlight h-2 bg-app-surface rounded-lg cursor-pointer disabled:opacity-40"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-app-theme flex justify-end">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-app-highlight text-app-inverse font-bold text-sm hover:opacity-90 active:scale-98 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
