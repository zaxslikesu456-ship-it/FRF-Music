import React, { useState } from 'react';
import {
  Palette,
  Music,
  Download,
  Upload,
  History,
  Settings2,
  Info,
  ChevronDown,
  Check,
  Trash2,
  Timer,
  LibraryBig,
  Sliders,
} from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import type {
  AppTheme,
  FontStyle,
  SortOrder,
  BackgroundAnimation,
  SettingsState,
  IconSize,
} from '../types/music';

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
            ? 'bg-app-highlight text-app-inverse border-white'
            : 'bg-app-surface text-app-secondary border-app-theme'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

type Section =
  | 'personalisation'
  | 'content'
  | 'playback'
  | 'download'
  | 'backup'
  | 'misc'
  | 'info';

export const SettingsView: React.FC = () => {
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
  } = useAudio();

  const [open, setOpen] = useState<Section | null>(null);

  const toggle = (s: Section) => setOpen(prev => (prev === s ? null : s));

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

  const sections: { id: Section; label: string; icon: React.ElementType }[] = [
    { id: 'personalisation', label: 'Personalisation', icon: Palette },
    { id: 'content', label: 'Content', icon: LibraryBig },
    { id: 'playback', label: 'Music & Playback', icon: Music },
    { id: 'download', label: 'Download', icon: Download },
    { id: 'backup', label: 'Backup & Restore', icon: History },
    { id: 'misc', label: 'Misc', icon: Settings2 },
    { id: 'info', label: 'App Info', icon: Info },
  ];

  const themes: { id: AppTheme; label: string; dot: string }[] = [
    { id: 'black-white', label: 'Classic Black', dot: 'bg-app-highlight' },
    { id: 'cyberpunk-neon', label: 'Cyberpunk Neon', dot: 'bg-cyan-400' },
    { id: 'midnight-blue', label: 'Midnight Blue', dot: 'bg-sky-400' },
    { id: 'sunset-crimson', label: 'Sunset Crimson', dot: 'bg-rose-500' },
    { id: 'emerald-matrix', label: 'Emerald Matrix', dot: 'bg-emerald-400' },
    { id: 'violet-aura', label: 'Violet Aura', dot: 'bg-purple-400' },
    { id: 'solar-amber', label: 'Solar Amber', dot: 'bg-amber-400' },
    { id: 'nordic-frost', label: 'Nordic Frost', dot: 'bg-sky-300' },
    { id: 'obsidian-gold', label: 'Obsidian Gold', dot: 'bg-amber-500' },
    { id: 'forest-emerald', label: 'Forest Emerald', dot: 'bg-emerald-500' },
    { id: 'amoled-pitch', label: 'Amoled Pitch Black', dot: 'bg-white' },
    { id: 'cherry-blossom', label: 'Cherry Blossom', dot: 'bg-rose-400' },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-28 bg-transparent">
      <h1 className="text-3xl font-bold text-app-primary px-5 safe-top pb-6">Settings</h1>

      <div className="px-5 space-y-4 stagger">
        {sections.map(s => {
          const Icon = s.icon;
          const isOpen = open === s.id;
          return (
            <div key={s.id} className="rounded-2xl bg-app-surface overflow-hidden">
              <button
                onClick={() => toggle(s.id)}
                className="w-full flex items-center gap-4 px-5 py-5 text-left"
              >
                <Icon className="w-6 h-6 text-app-secondary shrink-0" />
                <span className="flex-1 text-lg font-semibold text-app-primary">{s.label}</span>
                <ChevronDown
                  className={`w-5 h-5 text-app-secondary transition-transform ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-app-theme">
                  {/* PERSONALISATION */}
                  {s.id === 'personalisation' && (
                    <div className="pt-2">
                      <p className="text-sm text-app-secondary pt-3 pb-1">THEME</p>
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

                      <p className="text-sm text-app-secondary pt-5 pb-1">BACKGROUND ANIMATION</p>
                      <ChipGroup
                        options={[
                          { id: 'off', label: 'Off' },
                          { id: 'meteors', label: 'Meteor Shower' },
                          { id: 'particles', label: 'Cosmic Dust' },
                          { id: 'matrix', label: 'Matrix Rain' },
                          { id: 'rain', label: 'Rain Drops' },
                          { id: 'aurora', label: 'Aurora Waves' },
                        ]}
                        value={settings.backgroundAnimation || 'off'}
                        onSelect={a => updateSettings({ backgroundAnimation: a as BackgroundAnimation })}
                      />

                      <p className="text-sm text-app-secondary pt-5 pb-1">FONT STYLE</p>
                      <ChipGroup
                        options={[
                          { id: 'sans', label: 'Sans' },
                          { id: 'mono', label: 'Mono' },
                          { id: 'serif', label: 'Serif' },
                        ]}
                        value={settings.fontStyle}
                        onSelect={f => updateSettings({ fontStyle: f as FontStyle })}
                      />

                      <p className="text-sm text-app-secondary pt-5 pb-1">ICON & LIST SIZE</p>
                      <ChipGroup
                        options={[
                          { id: 'compact', label: 'Compact (Small Icons)' },
                          { id: 'standard', label: 'Standard' },
                          { id: 'large', label: 'Large' },
                        ]}
                        value={settings.iconSize || (settings.compactView ? 'compact' : 'standard')}
                        onSelect={sz => updateSettings({ iconSize: sz as IconSize, compactView: sz === 'compact' })}
                      />

                      <div className="pt-3">
                        <Row title="Compact track lists" subtitle="Higher density layout">
                          <Switch
                            on={settings.compactView || settings.iconSize === 'compact'}
                            onChange={() => {
                              const next = !(settings.compactView || settings.iconSize === 'compact');
                              updateSettings({ compactView: next, iconSize: next ? 'compact' : 'standard' });
                            }}
                          />
                        </Row>
                      </div>

                      <p className="text-sm text-app-secondary pt-5 pb-1">PROFILE</p>
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
                          placeholder="Your name"
                          className="flex-1 bg-app-card border border-app-theme rounded-xl py-2.5 px-3 text-base text-app-primary placeholder:text-app-secondary focus:outline-none"
                        />
                      </div>

                      <p className="text-sm text-app-secondary pt-5 pb-1">CUSTOM COLORS</p>
                      <Row title="Use custom colors" subtitle="Pick your own accent & background">
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
                            <span className="text-base text-app-primary">Accent</span>
                          </label>
                          <label className="flex items-center gap-3">
                            <input
                              type="color"
                              value={settings.customBackground}
                              onChange={e => updateSettings({ customBackground: e.target.value })}
                              className="w-10 h-10 rounded-lg bg-transparent border border-app-theme cursor-pointer"
                            />
                            <span className="text-base text-app-primary">Background</span>
                          </label>
                        </div>
                      )}

                      <p className="text-sm text-app-secondary pt-5 pb-1">BACKGROUND & TRANSPARENCY</p>
                      <Row
                        title="Background image / GIF"
                        subtitle={settings.backgroundImage ? 'Custom background active' : 'None set'}
                      >
                        <div className="flex items-center gap-2">
                          <label className="px-3 py-2 rounded-full bg-app-card border border-app-theme text-sm font-semibold text-app-primary cursor-pointer">
                            Upload
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
                              Remove
                            </button>
                          )}
                        </div>
                      </Row>
                      <Row title={`Overlay transparency • ${settings.overlayTransparency}%`} subtitle="Let your background show through">
                        <input
                          type="range"
                          min={0}
                          max={90}
                          step={5}
                          value={settings.overlayTransparency}
                          onChange={e => updateSettings({ overlayTransparency: parseInt(e.target.value, 10) })}
                          className="w-32 accent-white cursor-pointer"
                        />
                      </Row>
                    </div>
                  )}

                  {/* CONTENT */}
                  {s.id === 'content' && (
                    <div className="pt-2">
                      <p className="text-sm text-app-secondary pt-3 pb-1">DEFAULT LIBRARY SORTING</p>
                      <ChipGroup
                        options={[
                          { id: 'title', label: 'Title' },
                          { id: 'artist', label: 'Artist' },
                          { id: 'addedAt', label: 'Date Added' },
                        ]}
                        value={settings.sortBy}
                        onSelect={v => updateSettings({ sortBy: v as SortOrder })}
                      />
                      <p className="text-sm text-app-secondary pt-4 pb-1">LIBRARY ICON & LIST SIZE</p>
                      <ChipGroup
                        options={[
                          { id: 'compact', label: 'Small Icons (40px)' },
                          { id: 'standard', label: 'Standard Icons (56px)' },
                          { id: 'large', label: 'Large Icons (64px)' },
                        ]}
                        value={settings.iconSize || (settings.compactView ? 'compact' : 'standard')}
                        onSelect={sz => updateSettings({ iconSize: sz as IconSize, compactView: sz === 'compact' })}
                      />

                      <Row title="YouTube Music engine" subtitle="Search, streams & downloads">
                        <span className="text-xs font-semibold px-2.5 py-1 rounded bg-app-highlight text-app-inverse">
                          CONNECTED
                        </span>
                      </Row>
                      <Row title="Invidious mirrors" subtitle="Backup stream sources">
                        <span className="text-xs font-semibold px-2.5 py-1 rounded bg-app-highlight text-app-inverse">
                          CONNECTED
                        </span>
                      </Row>
                      {hiddenArtists.length > 0 && (
                        <Row title="Hidden artists" subtitle={`${hiddenArtists.length} removed from your Artists tab`}>
                          <button
                            onClick={restoreHiddenArtists}
                            className="px-3 py-2 rounded-full bg-app-card border border-app-theme text-sm font-semibold text-app-primary"
                          >
                            Restore
                          </button>
                        </Row>
                      )}
                    </div>
                  )}

                  {/* MUSIC & PLAYBACK */}
                  {s.id === 'playback' && (
                    <div className="pt-2">
                      <Row title="Auto-play next" subtitle="Continue to the next song">
                        <Switch
                          on={settings.autoPlayNext}
                          onChange={() => updateSettings({ autoPlayNext: !settings.autoPlayNext })}
                        />
                      </Row>
                      <Row title="Background playback" subtitle="Keep playing outside the app">
                        <Switch
                          on={settings.backgroundPlayback}
                          onChange={() =>
                            updateSettings({ backgroundPlayback: !settings.backgroundPlayback })
                          }
                        />
                      </Row>
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
                              <p className="text-base font-semibold text-app-primary">Equalizer & Sound FX</p>
                              <p className="text-xs text-app-secondary">
                                {settings.equalizer?.enabled ? `Enabled • ${settings.equalizer?.preset.toUpperCase()}` : 'Bypassed'}
                              </p>
                            </div>
                          </div>
                          <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-app-highlight text-app-inverse">
                            Tune
                          </span>
                        </button>
                      </div>
                      <p className="text-sm text-app-secondary pt-4 pb-1 flex items-center gap-2">
                        <Timer className="w-4 h-4" />
                        SLEEP TIMER
                      </p>
                      <ChipGroup
                        options={[
                          { id: '0', label: 'Off' },
                          { id: '15', label: '15 min' },
                          { id: '30', label: '30 min' },
                          { id: '60', label: '60 min' },
                        ]}
                        value={String(settings.sleepTimerMinutes)}
                        onSelect={m => updateSettings({ sleepTimerMinutes: parseInt(m, 10) as any })}
                      />
                      <p className="text-sm text-app-secondary pt-3 pb-1">PLAYBACK SPEED</p>
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
                      <p className="text-sm text-app-secondary pt-3 pb-1">AUDIO QUALITY</p>
                      <button
                        onClick={() => updateSettings({ downloadQuality: 'high' })}
                        className="w-full flex items-center justify-between py-3 border-b border-app-theme text-left"
                      >
                        <span>
                          <span className="block text-base text-app-primary">Original</span>
                          <span className="block text-sm text-app-secondary">Best available source</span>
                        </span>
                        {settings.downloadQuality === 'high' && <Check className="w-5 h-5 text-app-primary" />}
                      </button>
                      <button
                        onClick={() => updateSettings({ downloadQuality: 'low' })}
                        className="w-full flex items-center justify-between py-3 border-b border-app-theme text-left"
                      >
                        <span>
                          <span className="block text-base text-app-primary">Data saver</span>
                          <span className="block text-sm text-app-secondary">~50 kbps • ~1 MB/song</span>
                        </span>
                        {settings.downloadQuality === 'low' && <Check className="w-5 h-5 text-app-primary" />}
                      </button>
                      <Row title="Saved songs" subtitle={`${downloads.length} songs on this device`} />
                    </div>
                  )}

                  {/* BACKUP & RESTORE */}
                  {s.id === 'backup' && (
                    <div className="pt-3 space-y-3">
                      <Row
                        title="Permanent Library Protection"
                        subtitle={`${tracks.length} songs • ${downloads.length} downloads (Auto-saved to IndexedDB)`}
                      />
                      
                      <button
                        onClick={exportLibrary}
                        className="w-full flex items-center justify-between p-4 rounded-2xl bg-app-card border border-app-theme text-left hover:scale-[1.01] active:scale-98 transition-all"
                      >
                        <div>
                          <p className="text-base font-semibold text-app-primary">Export Library Backup</p>
                          <p className="text-xs text-app-secondary mt-0.5">Save all playlists, songs & settings to a JSON file</p>
                        </div>
                        <Download className="w-5 h-5 text-app-primary shrink-0 ml-2" />
                      </button>

                      <label className="w-full flex items-center justify-between p-4 rounded-2xl bg-app-card border border-app-theme text-left cursor-pointer hover:scale-[1.01] active:scale-98 transition-all">
                        <div>
                          <p className="text-base font-semibold text-app-primary">Import / Restore Backup</p>
                          <p className="text-xs text-app-secondary mt-0.5">Restore all your songs & playlists from a backup file</p>
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
                        Clear all data
                      </button>
                      <p className="text-xs text-app-secondary pt-2">
                        Your library is automatically preserved across app updates in permanent storage.
                      </p>
                    </div>
                  )}

                  {/* MISC */}
                  {s.id === 'misc' && (
                    <div className="pt-3">
                      {[
                        { key: 'SPACE', label: 'Play / Pause' },
                        { key: 'L', label: 'Like current track' },
                        { key: 'M', label: 'Mute / Unmute' },
                        { key: '← / →', label: 'Seek 5 seconds' },
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
                      <Row title="FRF Music" subtitle="Version 7.0 • YouTube streaming player" />
                      <p className="text-sm text-app-secondary pt-2">
                        Streams are resolved through YouTube Music and public Invidious instances.
                        Downloaded songs are stored on your device for offline playback, and music
                        keeps playing in the background.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
