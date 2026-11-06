// App language. Strings are looked up by their English text, so a component
// only has to wrap a literal in t('...'); anything without a translation (or
// any language without that string yet) simply shows the English.
import { useSyncExternalStore } from 'react';
import { TRANSLATIONS } from './translations';

export interface Language {
  code: string;
  /** Name in the language itself, shown in the picker. */
  name: string;
  /** Name in English, shown under it. */
  english: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'it', name: 'Italiano', english: 'Italian' },
  { code: 'nl', name: 'Nederlands', english: 'Dutch' },
  { code: 'tr', name: 'Türkçe', english: 'Turkish' },
  { code: 'ru', name: 'Русский', english: 'Russian' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'ja', name: '日本語', english: 'Japanese' },
  { code: 'ko', name: '한국어', english: 'Korean' },
  { code: 'zh', name: '中文（简体）', english: 'Chinese (Simplified)' },
];

const STORAGE_KEY = 'frf_language_v1';

/** The phone's / browser's language if the app has it, else English. */
export function detectDeviceLanguage(): string {
  const wanted = (navigator.languages?.length ? navigator.languages : [navigator.language]) || [];
  for (const tag of wanted) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (LANGUAGES.some(l => l.code === base)) return base;
  }
  return 'en';
}

function readStored(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && LANGUAGES.some(l => l.code === v)) return v;
  } catch {
    // storage unavailable
  }
  return detectDeviceLanguage();
}

let current = readStored();
const listeners = new Set<() => void>();
document.documentElement.lang = current;

export function getLanguage(): string {
  return current;
}

export function setLanguage(code: string): void {
  if (!LANGUAGES.some(l => l.code === code) || code === current) return;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // the choice still applies for this session
  }
  document.documentElement.lang = code;
  listeners.forEach(fn => fn());
}

/**
 * Translate an English UI string. `{name}` placeholders are filled from vars,
 * in the translation as well as in the English fallback.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const translated = (current !== 'en' && TRANSLATIONS[current]?.[text]) || text;
  if (!vars) return translated;
  return translated.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? String(vars[k]) : m));
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Re-renders the component when the language changes. */
export function useI18n() {
  const lang = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { t, lang, setLanguage };
}
