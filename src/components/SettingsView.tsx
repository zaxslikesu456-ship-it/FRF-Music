import React, { useEffect, useState } from 'react';
import { t as tr, LANGUAGES, getLanguage, setLanguage } from '../i18n';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { onBackButton } from '../utils/backButton';
import { formatMb } from '../utils/autoDownload';
import { PlaybackHealthModal } from './PlaybackHealthModal';
import { SmartDownloadsSettings } from './SmartDownloadsSettings';
import { ListeningStatsModal } from './ListeningStatsModal';
import { LicensesModal } from './LicensesModal';
import { VISUALIZER_OPTIONS } from './AudioVisualizer';
import { DeviceSyncModal } from './DeviceSyncModal';
import { AlarmModal } from './AlarmModal';
import { loadAlarm, describeNext } from '../utils/alarm';
import { getOfflineUsageBytes } from '../utils/downloadManager';
import {
  BarChart3,
  AlarmClock,
  Palette,
  Music,
  Download,
  Upload,
  History,
  Settings2,
  Info,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Trash2,
  Timer,
  LibraryBig,
  Sliders,
  Activity,
  Smartphone,
  Languages,
} from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import {
  getSavedYouTubeDataApiKey,
  hasBuiltInYouTubeDataApiKey,
  setSavedYouTubeDataApiKey,
} from '../utils/ytMusicApi';
import type {
  AppTheme,
  FontStyle,
  SortOrder,
  BackgroundAnimation,
  SettingsState,
  IconSize,
} from '../types/music';

// The iPhone player has no crossfade yet.
const IS_IOS_APP = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

const Switch: React.FC<{ on: boolean; onChange: () => void }> = ({ on, onChange }) => (
  <button
    onClick={onChange}
    className={`w-12 h-7 rounded-full p-1 shrink-0 transition-colors ${
      on ? 'bg-app-highlight' : 'bg-app-card'
    }`}
  >
    <span
      className={`block w-5 h-5 rounded-full transition-transform ${
        on ? 'translate-x-5 bg-app-primary' : 'translate-x-0 bg-app-highlight'
      }`}
    />
  </button>
);

const Row: React.FC<{ title: string; subtitle?: string; children?: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => (
  <div className="flex items-center justify-between gap-4 py-3.5">
    <div className="min-w-0">
      <p className="text-base text-app-primary">{title}</p>
      {subtitle && <p className="text-sm text-app-secondary mt-0.5">{subtitle}</p>}
    </div>
    {children}
  </div>
);

const ChipGroup: React.FC<{
  options: { id: string; label: string }[];
  value: string;
  onSelect: (id: string) => void;
}> = ({ options, value, onSelect }) => (
  <div className="flex flex-wrap gap-2 py-2">
    {options.map(o => (
      <button
        key={o.id}
        onClick={() => onSelect(o.id)}
        className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
          value === o.id
            ? 'bg-app-highlight text-app-inverse border-transparent'
            : 'bg-app-surface text-app-secondary border-app-theme'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

type Section =
  | 'language'
  | 'personalisation'
  | 'content'
  | 'playback'
  | 'download'
  | 'backup'
  | 'misc'
  | 'info';

export const SettingsView: React.FC = () => {
  const [youtubeDataApiKey, setYoutubeDataApiKey] = useState(() => getSavedYouTubeDataApiKey());
  const {
    settings,
    updateSettings,
    clearAllData,
    tracks,
    downloads,
    hiddenArtists,
    restoreHiddenArtists,
    exportLibrary,
    importLibrary,
    setIsEqualizerOpen,
    restoreMusicFolderDownloads,
    syncMusicFolderCopies,
    playlists,
  } = useAudio();

  const isAndroidApp = Capacitor.getPlatform() === 'android';
  const [showHealth, setShowHealth] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showLicenses, setShowLicenses] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [showAlarm, setShowAlarm] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState('');
  const [restoring, setRestoring] = useState(false);

  const restoreFromMusicFolder = async () => {
    setRestoring(true);
    setRestoreStatus('Looking in the Music folder...');
    try {
      const res = await restoreMusicFolderDownloads((done, total) =>
        setRestoreStatus(`Restoring ${done} of ${total}...`)
      );
      if (res.unsupported) {
        setRestoreStatus('This needs Android 10 or newer.');
      } else if (res.permissionDenied) {
        setRestoreStatus('Allow access to music and audio so FRF can read the folder, then try again.');
      } else if (res.restored === 0) {
        setRestoreStatus(
          res.skipped > 0
            ? 'Everything in the Music folder is already in your downloads.'
            : 'No saved songs found in Music/FRF Music.'
        );
      } else {
        setRestoreStatus(`Restored ${res.restored} song${res.restored === 1 ? '' : 's'}.`);
      }
    } catch {
      setRestoreStatus('Could not restore. Try again.');
    } finally {
      setRestoring(false);
    }
  };

  // Phones: a menu of sections; tapping one opens it as its own page (with a
  // back button). PC: the menu stays on the left and the section shows beside it.
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [picked, setPicked] = useState<Section | null>(null);
  const tab: Section | null = picked;
  const setTab = (s: Section | null) => setPicked(s);
  // Back button (phones) and Esc (PC): close the open section.
  useEffect(() => {
    if (!picked) return;
    const offBack = onBackButton(() => setPicked(null));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPicked(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offBack();
      window.removeEventListener('keydown', onKey);
    };
  }, [picked]);

  const readFile = (
    e: React.ChangeEvent<HTMLInputElement>,
    key: 'profileAvatar' | 'backgroundImage'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateSettings({ [key]: String(reader.result) } as Partial<SettingsState>);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const currentLanguage = LANGUAGES.find(l => l.code === getLanguage()) || LANGUAGES[0];
  const sections: { id: Section; label: string; icon: React.ElementType; hint: string }[] = [
    { id: 'language', label: tr('Language'), icon: Languages, hint: currentLanguage.name },
    { id: 'personalisation', label: tr("Personalisation"), icon: Palette, hint: tr("Theme, colours, album art, background") },
    { id: 'content', label: tr("Content"), icon: LibraryBig, hint: tr("Sorting and what you see") },
    { id: 'playback', label: tr("Music & Playback"), icon: Music, hint: tr("Crossfade, equalizer, alarm, sync, stats") },
    { id: 'download', label: tr("Download"), icon: Download, hint: tr("Quality, auto and smart downloads") },
    { id: 'backup', label: tr("Backup & Restore"), icon: History, hint: tr("Keep your library safe") },
    { id: 'misc', label: tr("Misc"), icon: Settings2, hint: tr("Keyboard shortcuts") },
    { id: 'info', label: tr("App Info"), icon: Info, hint: tr("Version and build") },
  ];
  const current = sections.find(x => x.id === tab);

  // On PC a section opens in a window over the page; on phones it is the page.
  const sectionFrame = (content: React.ReactNode) => {
    if (!wide || !current) return content;
    const Icon = current.icon;
    return createPortal(
      <div
        className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 anim-fade"
        onMouseDown={e => {
          if (e.target === e.currentTarget) setTab(null);
        }}
      >
        <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl bg-app-solid border border-app-theme shadow-2xl overflow-hidden settings-window-in">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-app-theme shrink-0">
            <span className="w-10 h-10 rounded-xl bg-app-card text-app-accent flex items-center justify-center">
              <Icon className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-app-primary truncate">{current.label}</h2>
              <p className="text-xs text-app-secondary truncate">{current.hint}</p>
            </div>
            <button
              onClick={() => setTab(null)}
              className="p-2 rounded-full text-app-secondary hover:text-app-primary hover:bg-app-card"
              title={tr("Close")}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">{content}</div>
        </div>
      </div>,
      document.body
    );
  };

  const themes: { id: AppTheme; label: string; dot: string }[] = [
    { id: 'black-white', label: tr("Classic Black"), dot: 'bg-app-highlight' },
    { id: 'cyberpunk-neon', label: tr("Cyberpunk Neon"), dot: 'bg-cyan-400' },
    { id: 'midnight-blue', label: tr("Midnight Blue"), dot: 'bg-sky-400' },
    { id: 'sunset-crimson', label: tr("Sunset Crimson"), dot: 'bg-rose-500' },
    { id: 'emerald-matrix', label: tr("Emerald Matrix"), dot: 'bg-emerald-400' },
    { id: 'violet-aura', label: tr("Violet Aura"), dot: 'bg-purple-400' },
    { id: 'solar-amber', label: tr("Solar Amber"), dot: 'bg-amber-400' },
    { id: 'nordic-frost', label: tr("Nordic Frost"), dot: 'bg-sky-300' },
    { id: 'obsidian-gold', label: tr("Obsidian Gold"), dot: 'bg-amber-500' },
    { id: 'forest-emerald', label: tr("Forest Emerald"), dot: 'bg-emerald-500' },
    { id: 'amoled-pitch', label: tr("Amoled Pitch Black"), dot: 'bg-white' },
    { id: 'cherry-blossom', label: tr("Cherry Blossom"), dot: 'bg-rose-400' },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-28 bg-transparent">
      <PlaybackHealthModal isOpen={showHealth} onClose={() => setShowHealth(false)} />
      <ListeningStatsModal isOpen={showStats} onClose={() => setShowStats(false)} />
      <LicensesModal isOpen={showLicenses} onClose={() => setShowLicenses(false)} />
      <DeviceSyncModal isOpen={showSync} onClose={() => setShowSync(false)} />
      <AlarmModal isOpen={showAlarm} onClose={() => setShowAlarm(false)} />
      {/* Title: "Settings" on the menu (and on PC), the section's name with a back
          button on a phone section page */}
      {!wide && current ? (
        <div className="sticky top-0 z-20 flex items-center gap-2 px-3 safe-top pb-3 bg-app-primary/95 backdrop-blur-md">
          <button
            onClick={() => setTab(null)}
            className="p-2 rounded-full text-app-primary hover:bg-app-card active:scale-95 transition-transform"
            title={tr("Back")}
          >
            <ChevronLeft className="w-7 h-7" />
          </button>
          <h1 className="text-2xl font-bold text-app-primary truncate">{current.label}</h1>
        </div>
      ) : (
        <h1 className="text-3xl font-bold text-app-primary px-5 safe-top pb-4">{tr("Settings")}</h1>
      )}

      <div className="md:px-5">
        {/* The menu: a list on phones, a grid of cards on PC. A section opens as
            its own page on phones and in a window on PC. */}
        {(wide || !current) && (
          <nav className="px-5 md:px-0 md:max-w-5xl">
            {(
              <button
                onClick={() => setTab('personalisation')}
                className="w-full flex items-center gap-4 p-4 mb-4 rounded-2xl bg-app-surface text-left active:scale-[0.99] transition-transform"
              >
                <div className="w-14 h-14 rounded-full overflow-hidden bg-app-card flex items-center justify-center shrink-0">
                  {settings.profileAvatar ? (
                    <img src={settings.profileAvatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl font-bold text-app-primary">
                      {(settings.profileName || 'M').charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold text-app-primary truncate">{settings.profileName}</p>
                  <p className="text-sm text-app-secondary">{tr("Profile, theme and colours")}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-app-secondary shrink-0" />
              </button>
            )}
            {/* (The theme's background classes win over size variants, so the PC
                layout is chosen here rather than with md: classes.) */}
            <div className={wide ? 'grid grid-cols-2 gap-3' : 'rounded-2xl bg-app-surface overflow-hidden'}>
              {sections.map((s, i) => {
                const Icon = s.icon;
                const active = wide && tab === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setTab(s.id)}
                    className={`w-full flex items-center gap-4 px-4 text-left transition-colors ${
                      wide
                        ? 'py-5 rounded-2xl bg-app-surface hover:bg-app-card'
                        : `py-3.5 ${active ? 'bg-app-card' : 'hover:bg-app-card/60 active:bg-app-card'} ${i > 0 ? 'border-t border-app-theme' : ''}`
                    }`}
                  >
                    <span
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        active ? 'bg-app-highlight text-app-inverse' : 'bg-app-card text-app-accent'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold text-app-primary truncate">{s.label}</span>
                      <span className="block text-xs text-app-secondary truncate">{s.hint}</span>
                    </span>
                    <ChevronRight className="w-5 h-5 text-app-secondary shrink-0" />
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        {current && sectionFrame(
        <div className={wide ? '' : 'flex-1 min-w-0 px-5 pt-1'}>
        {sections.filter(s => s.id === tab).map(s => {
          return (
            <div key={s.id} className={wide ? '' : 'rounded-2xl bg-app-surface overflow-hidden settings-page-in'}>
              {(
                <div className="px-5 pb-5">
                  {/* LANGUAGE */}
                  {s.id === 'language' && (
                    <div className="pt-2">
                      <p className="text-sm text-app-secondary pt-3 pb-1">{tr('APP LANGUAGE')}</p>
                      {LANGUAGES.map(l => (
                        <button
                          key={l.code}
                          onClick={() => setLanguage(l.code)}
                          className="w-full flex items-center justify-between py-3 border-b border-app-theme text-left"
                        >
                          <span className="min-w-0">
                            <span className="block text-base text-app-primary">{l.name}</span>
                            {l.name !== l.english && (
                              <span className="block text-xs text-app-secondary">{l.english}</span>
                            )}
                          </span>
                          {l.code === currentLanguage.code && <Check className="w-5 h-5 text-app-accent shrink-0" />}
                        </button>
                      ))}
                      <p className="text-xs text-app-secondary pt-3">
                        {tr('Song titles, artists and lyrics stay in their own language.')}
                      </p>
                    </div>
                  )}

                  {/* PERSONALISATION */}
                  {s.id === 'personalisation' && (
                    <div className="pt-2">
                      <p className="text-sm text-app-secondary pt-3 pb-1">{tr("THEME")}</p>
                      {themes.map(t => (
                        <button
                          key={t.id}
                          onClick={() => updateSettings({ theme: t.id })}
                          className="w-full flex items-center justify-between py-3 border-b border-app-theme text-left"
                        >
                          <span className="flex items-center gap-3">
                            <span className={`w-4 h-4 rounded-full ${t.dot}`} />
                            <span className="text-base text-app-primary">{t.label}</span>
                          </span>
                          {settings.theme === t.id && <Check className="w-5 h-5 text-app-primary" />}
                        </button>
                      ))}

                      <p className="text-sm text-app-secondary pt-5 pb-1">{tr("BACKGROUND ANIMATION")}</p>
                      <ChipGroup
                        options={[
                          { id: 'off', label: tr("Off") },
                          { id: 'meteors', label: tr("Meteor Shower") },
                          { id: 'particles', label: tr("Cosmic Dust") },
                          { id: 'matrix', label: tr("Matrix Rain") },
                          { id: 'rain', label: tr("Rain Drops") },
                          { id: 'aurora', label: tr("Aurora Waves") },
                        ]}
                        value={settings.backgroundAnimation || 'off'}
                        onSelect={a => updateSettings({ backgroundAnimation: a as BackgroundAnimation })}
                      />

                      <p className="text-sm text-app-secondary pt-5 pb-1">{tr("FONT STYLE")}</p>
                      <ChipGroup
                        options={[
                          { id: 'sans', label: tr("Sans") },
                          { id: 'mono', label: tr("Mono") },
                          { id: 'serif', label: tr("Serif") },
                        ]}
                        value={settings.fontStyle}
                        onSelect={f => updateSettings({ fontStyle: f as FontStyle })}
                      />

                      <p className="text-sm text-app-secondary pt-5 pb-1">{tr("ICON & LIST SIZE")}</p>
                      <ChipGroup
                        options={[
                          { id: 'compact', label: tr("Compact (Small Icons)") },
                          { id: 'standard', label: tr("Standard") },
                          { id: 'large', label: tr("Large") },
                        ]}
                        value={settings.iconSize || (settings.compactView ? 'compact' : 'standard')}
                        onSelect={sz => updateSettings({ iconSize: sz as IconSize, compactView: sz === 'compact' })}
                      />

                      <div className="pt-3">
                        <Row title={tr("Compact track lists")} subtitle={tr("Higher density layout")}>
                          <Switch
                            on={settings.compactView || settings.iconSize === 'compact'}
                            onChange={() => {
                              const next = !(settings.compactView || settings.iconSize === 'compact');
                              updateSettings({ compactView: next, iconSize: next ? 'compact' : 'standard' });
                            }}
                          />
                        </Row>
                      </div>

                      <p className="text-sm text-app-secondary pt-5 pb-1">{tr("PROFILE")}</p>
                      <div className="flex items-center gap-4 py-2">
                        <label className="relative w-16 h-16 rounded-full overflow-hidden bg-app-card border border-app-theme flex items-center justify-center cursor-pointer shrink-0">
                          {settings.profileAvatar ? (
                            <img src={settings.profileAvatar} alt="Avatar" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-app-primary text-xl font-bold">
                              {(settings.profileName || 'M').charAt(0).toUpperCase()}
                            </span>
                          )}
                          <input
                            type="file"
                            accept="image/*,image/gif"
                            className="hidden"
                            onChange={e => readFile(e, 'profileAvatar')}
                          />
                        </label>
                        <input
                          type="text"
                          value={settings.profileName}
                          onChange={e => updateSettings({ profileName: e.target.value })}
                          placeholder={tr("Your name")}
                          className="flex-1 bg-app-card border border-app-theme rounded-xl py-2.5 px-3 text-base text-app-primary placeholder:text-app-secondary focus:outline-none"
                        />
                      </div>

                      <p className="text-sm text-app-secondary pt-5 pb-1">{tr("ALBUM ART")}</p>
                      <Row
                        title={tr("Colors from album art")}
                        subtitle={tr("Now Playing, the mini player and the PC player take the cover's colors")}
                      >
                        <Switch
                          on={settings.albumArtColors !== false}
                          onChange={() => updateSettings({ albumArtColors: settings.albumArtColors === false })}
                        />
                      </Row>
                      <Row
                        title={tr("Album art as accent")}
                        subtitle={tr("Buttons and highlights follow the song that is playing")}
                      >
                        <Switch
                          on={settings.albumArtAccent === true}
                          onChange={() => updateSettings({ albumArtAccent: !settings.albumArtAccent })}
                        />
                      </Row>
                      <Row title={tr("Visualizer style")} subtitle={tr("Shown on Now Playing while music plays")}>
                        <select
                          value={settings.visualizerMode}
                          onChange={e => updateSettings({ visualizerMode: e.target.value as SettingsState['visualizerMode'] })}
                          className="bg-app-card border border-app-theme rounded-lg px-2 py-1.5 text-sm text-app-primary"
                        >
                          {VISUALIZER_OPTIONS.map(o => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </Row>

                      <p className="text-sm text-app-secondary pt-5 pb-1">{tr("CUSTOM COLORS")}</p>
                      <Row title={tr("Use custom colors")} subtitle={tr("Pick your own accent & background")}>
                        <Switch
                          on={settings.useCustomColors}
                          onChange={() => updateSettings({ useCustomColors: !settings.useCustomColors })}
                        />
                      </Row>
                      {settings.useCustomColors && (
                        <div className="flex items-center gap-6 py-2">
                          <label className="flex items-center gap-3">
                            <input
                              type="color"
                              value={settings.customAccent}
                              onChange={e => updateSettings({ customAccent: e.target.value })}
                              className="w-10 h-10 rounded-lg bg-transparent border border-app-theme cursor-pointer"
                            />
                            <span className="text-base text-app-primary">{tr("Accent")}</span>
                          </label>
                          <label className="flex items-center gap-3">
                            <input
                              type="color"
                              value={settings.customBackground}
                              onChange={e => updateSettings({ customBackground: e.target.value })}
                              className="w-10 h-10 rounded-lg bg-transparent border border-app-theme cursor-pointer"
                            />
                            <span className="text-base text-app-primary">{tr("Background")}</span>
                          </label>
                        </div>
                      )}

                      <p className="text-sm text-app-secondary pt-5 pb-1">{tr("BACKGROUND & TRANSPARENCY")}</p>
                      <Row
                        title={tr("Background image / GIF")}
                        subtitle={settings.backgroundImage ? 'Custom background active' : 'None set'}
                      >
                        <div className="flex items-center gap-2">
                          <label className="px-3 py-2 rounded-full bg-app-card border border-app-theme text-sm font-semibold text-app-primary cursor-pointer">
                            {tr("Upload")}
                            <input
                              type="file"
                              accept="image/*,image/gif"
                              className="hidden"
                              onChange={e => readFile(e, 'backgroundImage')}
                            />
                          </label>
                          {settings.backgroundImage && (
                            <button
                              onClick={() => updateSettings({ backgroundImage: null })}
                              className="px-3 py-2 rounded-full bg-app-card border border-app-theme text-sm font-semibold text-red-400"
                            >
                              {tr("Remove")}
                            </button>
                          )}
                        </div>
                      </Row>
                      <Row title={`Overlay transparency • ${settings.overlayTransparency}%`} subtitle={tr("Let your background show through")}>
                        <input
                          type="range"
                          min={0}
                          max={90}
                          step={5}
                          value={settings.overlayTransparency}
                          onChange={e => updateSettings({ overlayTransparency: parseInt(e.target.value, 10) })}
                          className="w-32 accent-[var(--bg-highlight)] cursor-pointer"
                        />
                      </Row>
                    </div>
                  )}

                  {/* CONTENT */}
                  {s.id === 'content' && (
                    <div className="pt-2">
                      <p className="text-sm text-app-secondary pt-3 pb-1">{tr("DEFAULT LIBRARY SORTING")}</p>
                      <ChipGroup
                        options={[
                          { id: 'title', label: tr("Title") },
                          { id: 'artist', label: tr("Artist") },
                          { id: 'addedAt', label: tr("Date Added") },
                        ]}
                        value={settings.sortBy}
                        onSelect={v => updateSettings({ sortBy: v as SortOrder })}
                      />
                      <p className="text-sm text-app-secondary pt-4 pb-1">{tr("LIBRARY ICON & LIST SIZE")}</p>
                      <ChipGroup
                        options={[
                          { id: 'compact', label: tr("Small Icons (40px)") },
                          { id: 'standard', label: tr("Standard Icons (56px)") },
                          { id: 'large', label: tr("Large Icons (64px)") },
                        ]}
                        value={settings.iconSize || (settings.compactView ? 'compact' : 'standard')}
                        onSelect={sz => updateSettings({ iconSize: sz as IconSize, compactView: sz === 'compact' })}
                      />

                      <Row title={tr("YouTube Music engine")} subtitle={tr("Search, streams & downloads")}>
                        <span className="text-xs font-semibold px-2.5 py-1 rounded bg-app-highlight text-app-inverse">
                          {tr("CONNECTED")}
                        </span>
                      </Row>
                      <div className="py-3.5 border-t border-app-theme">
                        <label htmlFor="youtube-data-api-key" className="block text-base text-app-primary">
                          {tr("YouTube Data API key")}
                        </label>
                        <p className="text-sm text-app-secondary mt-0.5 mb-2">
                          {tr("Optional: verifies alternate uploads are embeddable. Stored only on this device.")}
                        </p>
                        <input
                          id="youtube-data-api-key"
                          type="password"
                          value={youtubeDataApiKey}
                          onChange={event => {
                            const value = event.target.value;
                            setYoutubeDataApiKey(value);
                            setSavedYouTubeDataApiKey(value);
                          }}
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          placeholder={hasBuiltInYouTubeDataApiKey() ? 'GitHub build key is configured' : 'Paste an API key (optional)'}
                          className="w-full bg-app-card border border-app-theme rounded-xl py-2.5 px-3 text-base text-app-primary placeholder:text-app-secondary focus:outline-none"
                        />
                        <p className="text-xs text-app-secondary mt-2">
                          {tr("Restrict the key to YouTube Data API v3. This never bypasses age restrictions.")}
                        </p>
                      </div>
                      <Row title={tr("Invidious mirrors")} subtitle={tr("Backup stream sources")}>
                        <span className="text-xs font-semibold px-2.5 py-1 rounded bg-app-highlight text-app-inverse">
                          {tr("CONNECTED")}
                        </span>
                      </Row>
                      {hiddenArtists.length > 0 && (
                        <Row title={tr("Hidden artists")} subtitle={`${hiddenArtists.length} removed from your Artists tab`}>
                          <button
                            onClick={restoreHiddenArtists}
                            className="px-3 py-2 rounded-full bg-app-card border border-app-theme text-sm font-semibold text-app-primary"
                          >
                            {tr("Restore")}
                          </button>
                        </Row>
                      )}
                    </div>
                  )}

                  {/* MUSIC & PLAYBACK */}
                  {s.id === 'playback' && (
                    <div className="pt-2">
                      <Row title={tr("Auto-play next")} subtitle={tr("Continue to the next song")}>
                        <Switch
                          on={settings.autoPlayNext}
                          onChange={() => updateSettings({ autoPlayNext: !settings.autoPlayNext })}
                        />
                      </Row>
                      <Row
                        title={`Crossfade • ${settings.crossfadeSeconds ? `${settings.crossfadeSeconds} s` : 'Off'}`}
                        subtitle={
                          IS_IOS_APP
                            ? 'Not available on iPhone yet'
                            : 'Fade each song into the next'
                        }
                      >
                        <input
                          type="range"
                          min={0}
                          max={12}
                          step={1}
                          value={settings.crossfadeSeconds || 0}
                          disabled={IS_IOS_APP}
                          onChange={e => updateSettings({ crossfadeSeconds: parseInt(e.target.value, 10) })}
                          className="w-32 accent-[var(--bg-highlight)] cursor-pointer disabled:opacity-40"
                        />
                      </Row>
                      <Row
                        title={tr("YouTube mini video")}
                        subtitle={tr("Optional: keep YouTube playing while browsing inside FRF")}
                      >
                        <Switch
                          on={settings.youtubeMiniPlayer}
                          onChange={() =>
                            updateSettings({ youtubeMiniPlayer: !settings.youtubeMiniPlayer })
                          }
                        />
                      </Row>
                      <div className="py-2">
                        <button
                          onClick={() => setShowAlarm(true)}
                          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-app-card border border-app-theme text-left active:scale-98 transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-app-surface border border-app-theme text-app-primary">
                              <AlarmClock className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-base font-semibold text-app-primary">{tr("Alarm")}</p>
                              <p className="text-xs text-app-secondary">
                                {(() => {
                                  const cfg = loadAlarm();
                                  const next = cfg.enabled ? describeNext(cfg) : null;
                                  return next ? `Next alarm: ${next}` : 'Wake up to your music';
                                })()}
                              </p>
                            </div>
                          </div>
                        </button>
                      </div>
                      <div className="py-2">
                        <button
                          onClick={() => setShowStats(true)}
                          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-app-card border border-app-theme text-left active:scale-98 transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-app-surface border border-app-theme text-app-primary">
                              <BarChart3 className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-base font-semibold text-app-primary">{tr("Listening stats")}</p>
                              <p className="text-xs text-app-secondary">{tr("Minutes, top artists and streaks")}</p>
                            </div>
                          </div>
                        </button>
                      </div>
                      <div className="py-2">
                        <button
                          onClick={() => setShowSync(true)}
                          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-app-card border border-app-theme text-left active:scale-98 transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-app-surface border border-app-theme text-app-primary">
                              <Smartphone className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-base font-semibold text-app-primary">{tr("Sync with another device")}</p>
                              <p className="text-xs text-app-secondary">{tr("Move playlists, likes and history by QR or file")}</p>
                            </div>
                          </div>
                        </button>
                      </div>

                      <div className="py-2">
                        <button
                          onClick={() => setShowHealth(true)}
                          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-app-card border border-app-theme text-left active:scale-98 transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-app-surface border border-app-theme text-app-primary">
                              <Activity className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-base font-semibold text-app-primary">{tr("Playback health")}</p>
                              <p className="text-xs text-app-secondary">{tr("See which sources are working")}</p>
                            </div>
                          </div>
                        </button>
                      </div>
                      <div className="py-2">
                        <button
                          onClick={() => setIsEqualizerOpen(true)}
                          className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-app-card border border-app-theme text-left hover:scale-[1.01] active:scale-98 transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-app-surface border border-app-theme text-app-primary">
                              <Sliders className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-base font-semibold text-app-primary">{tr("Equalizer & Sound FX")}</p>
                              <p className="text-xs text-app-secondary">
                                {settings.equalizer?.enabled ? `Enabled • ${settings.equalizer?.preset.toUpperCase()}` : 'Bypassed'}
                              </p>
                            </div>
                          </div>
                          <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-app-highlight text-app-inverse">
                            {tr("Tune")}
                          </span>
                        </button>
                      </div>
                      <p className="text-sm text-app-secondary pt-4 pb-1 flex items-center gap-2">
                        <Timer className="w-4 h-4" />
                        {tr("SLEEP TIMER")}
                      </p>
                      <ChipGroup
                        options={[
                          { id: '0', label: tr("Off") },
                          { id: '15', label: tr("15 min") },
                          { id: '30', label: tr("30 min") },
                          { id: '60', label: tr("60 min") },
                          { id: '-1', label: tr("End of song") },
                        ]}
                        value={String(settings.sleepTimerMinutes)}
                        onSelect={m => updateSettings({ sleepTimerMinutes: parseInt(m, 10) })}
                      />
                      <p className="text-sm text-app-secondary pt-3 pb-1">{tr("PLAYBACK SPEED")}</p>
                      <ChipGroup
                        options={[
                          { id: '0.75', label: '0.75×' },
                          { id: '1', label: '1.0×' },
                          { id: '1.25', label: '1.25×' },
                          { id: '1.5', label: '1.5×' },
                          { id: '2', label: '2.0×' },
                        ]}
                        value={String(settings.playbackSpeed)}
                        onSelect={sp => updateSettings({ playbackSpeed: parseFloat(sp) })}
                      />
                    </div>
                  )}

                  {/* DOWNLOAD */}
                  {s.id === 'download' && (
                    <div className="pt-2">
                      <p className="text-sm text-app-secondary pt-3 pb-1">{tr("AUDIO QUALITY")}</p>
                      <button
                        onClick={() => updateSettings({ downloadQuality: 'high' })}
                        className="w-full flex items-center justify-between py-3 border-b border-app-theme text-left"
                      >
                        <span>
                          <span className="block text-base text-app-primary">{tr("Original")}</span>
                          <span className="block text-sm text-app-secondary">{tr("Best available source")}</span>
                        </span>
                        {settings.downloadQuality === 'high' && <Check className="w-5 h-5 text-app-primary" />}
                      </button>
                      <button
                        onClick={() => updateSettings({ downloadQuality: 'low' })}
                        className="w-full flex items-center justify-between py-3 border-b border-app-theme text-left"
                      >
                        <span>
                          <span className="block text-base text-app-primary">{tr("Data saver")}</span>
                          <span className="block text-sm text-app-secondary">~50 kbps • ~1 MB/song</span>
                        </span>
                        {settings.downloadQuality === 'low' && <Check className="w-5 h-5 text-app-primary" />}
                      </button>
                      <Row title={tr("Saved songs")} subtitle={`${downloads.length} songs on this device`} />
                      {isAndroidApp && (
                        <>
                          <Row
                            title={tr("Keep a copy in the Music folder")}
                            subtitle={tr("Downloads survive an uninstall (Android 10 or newer)")}
                          >
                            <Switch
                              on={settings.keepMusicCopy}
                              onChange={() => {
                                const next = !settings.keepMusicCopy;
                                updateSettings({ keepMusicCopy: next });
                                // Switching on copies the songs you already have.
                                if (next) window.setTimeout(() => void syncMusicFolderCopies(), 300);
                              }}
                            />
                          </Row>
                          <div className="pb-3">
                            <button
                              onClick={() => void restoreFromMusicFolder()}
                              disabled={restoring}
                              className="w-full text-left px-4 py-3 rounded-2xl bg-app-card border border-app-theme text-sm font-semibold text-app-primary disabled:opacity-60"
                            >
                              {tr("Restore downloads from Music folder")}
                            </button>
                            <p className="mt-2 px-1 text-xs text-app-secondary leading-relaxed">
                              {restoreStatus ||
                                'After reinstalling, tap this to bring back songs saved in Music/FRF Music.'}
                            </p>
                          </div>
                        </>
                      )}

                      <p className="text-sm text-app-secondary pt-4 pb-1">{tr("AUTO-DOWNLOAD")}</p>
                      <Row title={tr("Liked songs")} subtitle={tr("Download songs when you like them")}>
                        <Switch
                          on={settings.autoDownloadLikes}
                          onChange={() => updateSettings({ autoDownloadLikes: !settings.autoDownloadLikes })}
                        />
                      </Row>
                      <Row title={tr("Wi-Fi only")} subtitle={tr("Don't use mobile data for auto-downloads")}>
                        <Switch
                          on={settings.autoDownloadWifiOnly}
                          onChange={() =>
                            updateSettings({ autoDownloadWifiOnly: !settings.autoDownloadWifiOnly })
                          }
                        />
                      </Row>
                      <div className="py-3">
                        <p className="text-base text-app-primary">{tr("Storage limit")}</p>
                        <p className="text-sm text-app-secondary">
                          Using {formatMb(getOfflineUsageBytes())}; auto-downloads pause at the limit
                        </p>
                        <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
                          {[1024, 2048, 5120, 10240, 0].map(mb => (
                            <button
                              key={mb}
                              onClick={() => updateSettings({ autoDownloadLimitMb: mb })}
                              className={`px-3.5 py-1.5 rounded-full text-sm font-semibold shrink-0 border ${
                                settings.autoDownloadLimitMb === mb
                                  ? 'bg-app-highlight text-app-inverse border-transparent'
                                  : 'bg-app-card text-app-secondary border-app-theme'
                              }`}
                            >
                              {mb === 0 ? 'No limit' : `${mb / 1024} GB`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <SmartDownloadsSettings />
                      {playlists.length > 0 && (
                        <>
                          <p className="text-sm text-app-secondary pt-2 pb-1">{tr("PLAYLISTS TO KEEP DOWNLOADED")}</p>
                          {playlists.map(pl => {
                            const chosen = (settings.autoDownloadPlaylists || []).includes(pl.id);
                            return (
                              <Row key={pl.id} title={pl.name} subtitle={`${pl.trackIds.length} songs`}>
                                <Switch
                                  on={chosen}
                                  onChange={() => {
                                    const ids = settings.autoDownloadPlaylists || [];
                                    updateSettings({
                                      autoDownloadPlaylists: chosen
                                        ? ids.filter(x => x !== pl.id)
                                        : [...ids, pl.id],
                                    });
                                  }}
                                />
                              </Row>
                            );
                          })}
                        </>
                      )}
                    </div>
                  )}

                  {/* BACKUP & RESTORE */}
                  {s.id === 'backup' && (
                    <div className="pt-3 space-y-3">
                      <Row
                        title={tr("Permanent Library Protection")}
                        subtitle={`${tracks.length} songs • ${downloads.length} downloads (Auto-saved to IndexedDB)`}
                      />
                      
                      <button
                        onClick={exportLibrary}
                        className="w-full flex items-center justify-between p-4 rounded-2xl bg-app-card border border-app-theme text-left hover:scale-[1.01] active:scale-98 transition-all"
                      >
                        <div>
                          <p className="text-base font-semibold text-app-primary">{tr("Export Library Backup")}</p>
                          <p className="text-xs text-app-secondary mt-0.5">{tr("Save all playlists, songs & settings to a JSON file")}</p>
                        </div>
                        <Download className="w-5 h-5 text-app-primary shrink-0 ml-2" />
                      </button>

                      <label className="w-full flex items-center justify-between p-4 rounded-2xl bg-app-card border border-app-theme text-left cursor-pointer hover:scale-[1.01] active:scale-98 transition-all">
                        <div>
                          <p className="text-base font-semibold text-app-primary">{tr("Import / Restore Backup")}</p>
                          <p className="text-xs text-app-secondary mt-0.5">{tr("Restore all your songs & playlists from a backup file")}</p>
                        </div>
                        <Upload className="w-5 h-5 text-app-primary shrink-0 ml-2" />
                        <input
                          type="file"
                          accept=".json,application/json"
                          className="hidden"
                          onChange={async e => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const ok = await importLibrary(file);
                              if (ok) alert('Library successfully restored from backup!');
                              else alert('Failed to import backup file. Please check file format.');
                            }
                          }}
                        />
                      </label>

                      <button
                        onClick={() => {
                          if (confirm('Clear all music, playlists, favorites and downloads?')) {
                            clearAllData();
                          }
                        }}
                        className="w-full py-3.5 rounded-2xl bg-app-card text-red-400 text-sm font-semibold flex items-center justify-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />
                        {tr("Clear all data")}
                      </button>
                      <p className="text-xs text-app-secondary pt-2">
                        {tr("Your library is automatically preserved across app updates in permanent storage.")}
                      </p>
                    </div>
                  )}

                  {/* MISC */}
                  {s.id === 'misc' && (
                    <div className="pt-3">
                      {[
                        { key: 'SPACE', label: tr("Play / Pause") },
                        { key: 'L', label: tr("Like current track") },
                        { key: 'M', label: tr("Mute / Unmute") },
                        { key: '← / →', label: tr("Seek 5 seconds") },
                      ].map(sc => (
                        <div
                          key={sc.key}
                          className="flex items-center justify-between py-3 border-b border-app-theme"
                        >
                          <span className="text-base text-app-primary">{sc.label}</span>
                          <kbd className="px-2.5 py-1 bg-app-card rounded-lg text-xs font-semibold text-app-secondary">
                            {sc.key}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* APP INFO */}
                  {s.id === 'info' && (
                    <div className="pt-3">
                      <Row title={tr("FRF Music")} subtitle={`Version 7.0 • Build ${__APP_BUILD__}`} />
                      <p className="text-sm text-app-secondary pt-2">
                        Streams are resolved through YouTube Music and public Invidious instances.
                        Downloaded songs are stored on your device for offline playback, and music
                        keeps playing in the background.
                      </p>
                      <p className="text-sm text-app-secondary pt-3">
                        Copyright © 2026 zaxs. FRF Music is free software under the GNU GPL v3.{' '}
                        <a
                          href="https://github.com/zaxslikesu456-ship-it/FRF-Music"
                          target="_blank"
                          rel="noreferrer"
                          className="underline text-app-primary"
                        >
                          Source code
                        </a>
                      </p>
                      <div className="py-3">
                        <button
                          onClick={() => setShowLicenses(true)}
                          className="w-full p-3.5 rounded-2xl bg-app-card border border-app-theme text-left active:scale-98 transition-all"
                        >
                          <p className="text-base font-semibold text-app-primary">Open-source licenses</p>
                          <p className="text-xs text-app-secondary">Credits for the code and libraries in this app</p>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        </div>
        )}
      </div>
    </div>
  );
};
