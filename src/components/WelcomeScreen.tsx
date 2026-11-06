import React, { useState } from 'react';
import { Music2, Search, Download, Mic2, Check, ArrowRight } from 'lucide-react';
import { LANGUAGES, useI18n } from '../i18n';

const WELCOME_DONE_KEY = 'frf_welcome_done_v1';

/**
 * First launch (and after "Clear all data"). People who already used the app
 * before this screen existed are not shown it: they have settings saved.
 */
export function shouldShowWelcome(): boolean {
  try {
    if (localStorage.getItem(WELCOME_DONE_KEY) === '1') return false;
    if (localStorage.getItem('bw_music_settings_v11') || localStorage.getItem('bw_music_settings_v1')) {
      localStorage.setItem(WELCOME_DONE_KEY, '1');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const WelcomeScreen: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { t, lang, setLanguage } = useI18n();
  const [leaving, setLeaving] = useState(false);

  const finish = () => {
    try {
      localStorage.setItem(WELCOME_DONE_KEY, '1');
    } catch {
      // shown again next time; harmless
    }
    setLeaving(true);
    window.setTimeout(onDone, 260);
  };

  const features: { icon: React.ElementType; title: string; text: string }[] = [
    { icon: Search, title: t('Find any song'), text: t('Search songs, artists, albums and playlists.') },
    { icon: Mic2, title: t('Lyrics that follow along'), text: t('Sing along with synced lyrics.') },
    { icon: Download, title: t('Listen offline'), text: t('Download songs to play without internet.') },
  ];

  return (
    <div
      className={`fixed inset-0 z-[300] flex flex-col bg-app-primary transition-opacity duration-300 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      style={{
        background:
          'radial-gradient(120% 70% at 50% 0%, color-mix(in srgb, var(--accent-color, #8b5cf6) 28%, transparent), transparent 70%), var(--bg-primary)',
      }}
    >
      <div className="flex-1 overflow-y-auto safe-top">
        <div className="w-full max-w-lg mx-auto px-6 pt-10 pb-6">
          {/* Logo + greeting */}
          <div className="flex flex-col items-center text-center anim-fade">
            <div className="w-20 h-20 rounded-full bg-black border border-white/10 shadow-2xl flex items-center justify-center">
              <Music2 className="w-10 h-10 text-white" />
            </div>
            <h1 className="mt-6 text-3xl font-extrabold text-app-primary tracking-tight">
              {t('Welcome to Aura Music')}
            </h1>
            <p className="mt-2 text-base text-app-secondary">
              {t('Your music, lyrics and downloads in one place.')}
            </p>
          </div>

          {/* What you can do */}
          <div className="mt-8 space-y-3">
            {features.map(f => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="flex items-center gap-4 p-3.5 rounded-2xl bg-app-surface">
                  <span className="w-10 h-10 rounded-xl bg-app-card text-app-accent flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-app-primary">{f.title}</span>
                    <span className="block text-sm text-app-secondary">{f.text}</span>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Language */}
          <p className="mt-8 mb-3 text-sm font-semibold text-app-secondary uppercase tracking-wide">
            {t('Choose your language')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {LANGUAGES.map(l => {
              const selected = l.code === lang;
              return (
                <button
                  key={l.code}
                  onClick={() => setLanguage(l.code)}
                  aria-pressed={selected}
                  className={`flex items-center justify-between gap-2 px-3.5 py-3 rounded-xl border text-left transition-colors ${
                    selected ? 'border-transparent' : 'bg-app-surface border-app-theme'
                  }`}
                  style={selected ? { background: 'var(--text-primary)', color: 'var(--bg-primary)' } : undefined}
                >
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold truncate ${selected ? '' : 'text-app-primary'}`}>
                      {l.name}
                    </span>
                    {l.name !== l.english && (
                      <span className={`block text-xs truncate ${selected ? 'opacity-70' : 'text-app-secondary'}`}>
                        {l.english}
                      </span>
                    )}
                  </span>
                  {selected && <Check className="w-4 h-4 shrink-0" />}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-app-secondary">
            {t('You can change this any time in Settings.')}
          </p>
        </div>
      </div>

      {/* Start */}
      <div className="w-full max-w-lg mx-auto px-6 pt-3 safe-bottom pb-6">
        <button
          onClick={finish}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-full text-base font-bold shadow-lg active:scale-[0.99] transition-transform"
          style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)' }}
        >
          {t('Get started')} <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
