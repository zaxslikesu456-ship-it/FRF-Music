import type { AppTheme, SettingsState } from '../types/music';

interface ThemeVars {
  primary: string;
  surface: string;
  card: string;
  highlight: string;
  textPrimary: string;
  textSecondary: string;
  textInverse: string;
  border: string;
}

export const THEMES: Record<AppTheme, ThemeVars> = {
  'black-white': {
    primary: '#000000',
    surface: '#0a0a0a',
    card: '#121212',
    highlight: '#ffffff',
    textPrimary: '#ffffff',
    textSecondary: '#a3a3a3',
    textInverse: '#000000',
    border: '#262626',
  },
  'cyberpunk-neon': {
    primary: '#090414',
    surface: '#14092b',
    card: '#1f0e42',
    highlight: '#00f0ff',
    textPrimary: '#00f0ff',
    textSecondary: '#d8b4fe',
    textInverse: '#090414',
    border: '#7e22ce',
  },
  'midnight-blue': {
    primary: '#020b1f',
    surface: '#071738',
    card: '#0c2352',
    highlight: '#38bdf8',
    textPrimary: '#38bdf8',
    textSecondary: '#93c5fd',
    textInverse: '#020b1f',
    border: '#1e3a8a',
  },
  'sunset-crimson': {
    primary: '#18040a',
    surface: '#2b0813',
    card: '#3f0d1c',
    highlight: '#fb7185',
    textPrimary: '#fb7185',
    textSecondary: '#fca5a5',
    textInverse: '#18040a',
    border: '#881337',
  },
  'emerald-matrix': {
    primary: '#02170d',
    surface: '#062b18',
    card: '#0a3f24',
    highlight: '#34d399',
    textPrimary: '#34d399',
    textSecondary: '#6ee7b7',
    textInverse: '#02170d',
    border: '#065f46',
  },
  'violet-aura': {
    primary: '#130426',
    surface: '#20073d',
    card: '#310b5b',
    highlight: '#c084fc',
    textPrimary: '#c084fc',
    textSecondary: '#e9d5ff',
    textInverse: '#130426',
    border: '#6b21a8',
  },
  'solar-amber': {
    primary: '#1c0d03',
    surface: '#301705',
    card: '#452208',
    highlight: '#fbbf24',
    textPrimary: '#fbbf24',
    textSecondary: '#fde68a',
    textInverse: '#1c0d03',
    border: '#78350f',
  },
  'nordic-frost': {
    primary: '#041226',
    surface: '#092140',
    card: '#0e315c',
    highlight: '#38bdf8',
    textPrimary: '#e0f2fe',
    textSecondary: '#7dd3fc',
    textInverse: '#041226',
    border: '#0284c7',
  },
  'obsidian-gold': {
    primary: '#0b0a07',
    surface: '#17140e',
    card: '#242016',
    highlight: '#fbbf24',
    textPrimary: '#fef3c7',
    textSecondary: '#fde68a',
    textInverse: '#0b0a07',
    border: '#b45309',
  },
  'forest-emerald': {
    primary: '#021c10',
    surface: '#05331e',
    card: '#0a4f2e',
    highlight: '#10b981',
    textPrimary: '#a7f3d0',
    textSecondary: '#6ee7b7',
    textInverse: '#021c10',
    border: '#047857',
  },
  'amoled-pitch': {
    primary: '#000000',
    surface: '#050505',
    card: '#0d0d0d',
    highlight: '#ffffff',
    textPrimary: '#ffffff',
    textSecondary: '#888888',
    textInverse: '#000000',
    border: '#222222',
  },
  'cherry-blossom': {
    primary: '#1a0610',
    surface: '#2b091c',
    card: '#420f2b',
    highlight: '#f43f5e',
    textPrimary: '#fecdd3',
    textSecondary: '#fda4af',
    textInverse: '#1a0610',
    border: '#be123c',
  },
};

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function isLight(hex: string): boolean {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

// Applies the active theme (+ custom colors, transparency) as CSS variables
// on the document root so every surface follows it.
export function applyThemeSettings(settings: SettingsState): void {
  const base = THEMES[settings.theme] || THEMES['black-white'];
  const root = document.documentElement;

  const transparency = Math.max(0, Math.min(90, settings.overlayTransparency));
  const alpha = 1 - transparency / 100;

  const accent = settings.useCustomColors ? settings.customAccent : base.highlight;
  const primary = settings.useCustomColors ? settings.customBackground : base.primary;
  const surface = settings.useCustomColors ? settings.customBackground : base.surface;
  const card = settings.useCustomColors ? settings.customBackground : base.card;

  // When a background image is set, keep the base slightly see-through
  const primaryAlpha = settings.backgroundImage ? Math.min(alpha, 0.75) : 1;

  root.style.setProperty('--bg-primary', hexToRgba(primary, primaryAlpha));
  root.style.setProperty('--bg-surface', hexToRgba(surface, alpha));
  root.style.setProperty('--bg-card', hexToRgba(card, alpha));
  root.style.setProperty('--bg-highlight', accent);
  root.style.setProperty('--text-primary', base.textPrimary);
  root.style.setProperty('--text-secondary', base.textSecondary);
  root.style.setProperty(
    '--text-inverse',
    settings.useCustomColors ? (isLight(accent) ? '#000000' : '#ffffff') : base.textInverse
  );
  root.style.setProperty('--border-color', settings.useCustomColors ? hexToRgba(accent, 0.35) : base.border);
  root.style.setProperty('--accent-color', accent);
}
