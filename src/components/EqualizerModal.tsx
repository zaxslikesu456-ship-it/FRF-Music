import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Sliders,
  Sparkles,
  RotateCcw,
  Zap,
  Headphones,
  Speaker,
  Volume2,
  Plus,
  Check,
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
  const { settings, updateSettings, outputDevice } = useAudio();
  const remember = settings.eqRememberPerDevice !== false;

  const eq = settings.equalizer || DEFAULT_EQUALIZER_SETTINGS;

  const setEq = (partial: Partial<EqualizerSettings>) => {
    const updated: EqualizerSettings = {
      ...eq,
      ...partial,
    };
    // With "remember per headphone" on, the change is also kept for this output.
    updateSettings({
      equalizer: updated,
      ...(remember && outputDevice
        ? { eqPerDevice: { ...(settings.eqPerDevice || {}), [outputDevice.key]: updated } }
        : {}),
    });
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

  // Presets you save yourself.
  const customPresets = settings.eqCustomPresets || [];
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState('');
  const sameAs = (p: { bands: number[]; bassBoost: number; surround: number }) =>
    p.bassBoost === eq.bassBoost &&
    p.surround === eq.surround &&
    p.bands.length === eq.bands.length &&
    p.bands.every((b, i) => b === eq.bands[i]);
  const saveCustomPreset = () => {
    const name = presetName.trim().slice(0, 24);
    if (!name) return;
    const entry = {
      id: 'c' + Date.now().toString(36),
      name,
      bands: [...eq.bands],
      bassBoost: eq.bassBoost,
      surround: eq.surround,
    };
    updateSettings({ eqCustomPresets: [...customPresets, entry].slice(-12) });
    setPresetName('');
    setNaming(false);
  };
  const applyCustomPreset = (p: { bands: number[]; bassBoost: number; surround: number }) =>
    setEq({ preset: 'custom', bands: [...p.bands], bassBoost: p.bassBoost, surround: p.surround });
  const deleteCustomPreset = (id: string) =>
    updateSettings({ eqCustomPresets: customPresets.filter(p => p.id !== id) });

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

  // Rendered on the page itself (not inside the animated screen container,
  // which clipped it and swallowed scrolling).
  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg sm:max-w-xl bg-app-surface border border-app-theme rounded-t-3xl sm:rounded-3xl h-[92vh] sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl anim-sheet-up"
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
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y px-6 py-5 space-y-6">
          {/* Output device and per-headphone presets */}
          {outputDevice && (
            <div className="p-3 rounded-2xl bg-app-card border border-app-theme flex items-center gap-3">
              <div className="p-2 rounded-xl bg-app-surface border border-app-theme text-app-primary">
                {outputDevice.kind === 'speaker' ? <Speaker className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-app-primary truncate">{outputDevice.name}</p>
                <p className="text-xs text-app-secondary">
                  {remember
                    ? settings.eqPerDevice?.[outputDevice.key]
                      ? 'Using the preset saved for this output'
                      : 'Your changes will be saved for this output'
                    : 'One preset for every output'}
                </p>
              </div>
              <button
                onClick={() => updateSettings({ eqRememberPerDevice: !remember })}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  remember
                    ? 'bg-app-highlight text-app-inverse'
                    : 'bg-app-surface text-app-secondary border border-app-theme'
                }`}
              >
                {remember ? 'REMEMBER' : 'OFF'}
              </button>
            </div>
          )}

          {/* Volume normalization */}
          <div className="p-3 rounded-2xl bg-app-card border border-app-theme flex items-center gap-3">
            <div className="p-2 rounded-xl bg-app-surface border border-app-theme text-app-primary">
              <Volume2 className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-app-primary">Volume normalization</p>
              <p className="text-xs text-app-secondary">Turns loud songs down so they play at a similar level</p>
            </div>
            <button
              onClick={() => updateSettings({ normalizeVolume: settings.normalizeVolume === false })}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                settings.normalizeVolume !== false
                  ? 'bg-app-highlight text-app-inverse'
                  : 'bg-app-surface text-app-secondary border border-app-theme'
              }`}
            >
              {settings.normalizeVolume !== false ? 'ON' : 'OFF'}
            </button>
          </div>

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
                    <stop offset="0%" stopColor="var(--accent-color, #a855f7)" />
                    <stop offset="50%" stopColor="var(--accent-color, #ec4899)" />
                    <stop offset="100%" stopColor="var(--accent-color, #3b82f6)" />
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
            <div className="flex flex-wrap gap-2 py-1">
              {(Object.keys(EQ_PRESETS) as EqualizerPreset[]).filter(k => k !== 'custom').map(pKey => {
                const isSelected = eq.preset === pKey;
                return (
                  <button
                    key={pKey}
                    onClick={() => handlePresetSelect(pKey)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all ${
                      isSelected
                        ? 'bg-app-highlight text-app-inverse border border-transparent'
                        : 'bg-app-card text-app-secondary border border-app-theme hover:text-app-primary'
                    }`}
                  >
                    {EQ_PRESETS[pKey].name}
                  </button>
                );
              })}
              {customPresets.map(p => (
                <span
                  key={p.id}
                  className={`inline-flex items-center rounded-full text-xs font-semibold border ${
                    sameAs(p)
                      ? 'bg-app-highlight text-app-inverse border-transparent'
                      : 'bg-app-card text-app-secondary border-app-theme'
                  }`}
                >
                  <button onClick={() => applyCustomPreset(p)} className="pl-3.5 pr-2 py-1.5">
                    {p.name}
                  </button>
                  <button
                    onClick={() => deleteCustomPreset(p.id)}
                    className="pr-2.5 py-1.5 opacity-60 hover:opacity-100"
                    title="Delete this preset"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            {naming ? (
              <div className="flex gap-2 mt-3">
                <input
                  autoFocus
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveCustomPreset();
                    if (e.key === 'Escape') setNaming(false);
                  }}
                  maxLength={24}
                  placeholder="Name your preset"
                  className="flex-1 min-w-0 bg-app-card border border-app-theme rounded-full px-4 py-2 text-sm text-app-primary placeholder:text-app-secondary outline-none"
                />
                <button
                  onClick={saveCustomPreset}
                  disabled={!presetName.trim()}
                  className="px-4 rounded-full bg-app-highlight text-app-inverse text-sm font-semibold disabled:opacity-40 flex items-center gap-1"
                >
                  <Check className="w-4 h-4" /> Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setNaming(true)}
                className="mt-3 text-xs font-semibold text-app-primary flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-app-card border border-app-theme"
              >
                <Plus className="w-3.5 h-3.5" /> Save these settings as a preset
              </button>
            )}
          </div>

          {/* Band sliders: one row each, so the page scrolls normally (vertical
              sliders took over every touch and wheel scroll). Tap a dB value to
              put that band back to 0. */}
          <div>
            <p className="text-xs font-semibold text-app-secondary tracking-wider mb-3">5-BAND GRAPHIC EQ</p>
            <div className="rounded-2xl bg-app-card border border-app-theme divide-y divide-white/5">
              {eq.bands.map((gain, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-20 shrink-0">
                    <p className="text-sm font-bold text-app-primary">{EQ_BAND_LABELS[i]}</p>
                    <p className="text-[10px] text-app-secondary truncate">{EQ_BAND_NAMES[i]}</p>
                  </div>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={gain}
                    disabled={!eq.enabled}
                    onChange={e => handleBandChange(i, parseInt(e.target.value, 10))}
                    className="flex-1 min-w-0 accent-app-highlight h-2 bg-app-surface rounded-lg cursor-pointer disabled:opacity-40"
                    aria-label={`${EQ_BAND_LABELS[i]} gain`}
                  />
                  <button
                    onClick={() => handleBandChange(i, 0)}
                    disabled={!eq.enabled}
                    title="Set to 0 dB"
                    className="w-14 shrink-0 text-right text-xs font-bold text-app-primary disabled:opacity-40"
                  >
                    {gain > 0 ? `+${gain}` : gain}
                    <span className="text-[9px] text-app-secondary font-normal ml-0.5">dB</span>
                  </button>
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
    </div>,
    document.body
  );
};
