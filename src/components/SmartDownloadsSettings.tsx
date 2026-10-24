import React, { useEffect, useState } from 'react';
import { useAudio } from '../context/AudioContext';
import { formatMb } from '../utils/autoDownload';
import { getSmartSummary, subscribeSmartOwned } from '../utils/smartDownloadsStore';
import { subscribeQueue } from '../utils/downloadQueue';

// Settings block for smart downloads (lives under Downloads > Auto-download).

const LIMITS_MB = [500, 1024, 2048, 5120];
const TOP_OPTIONS = [0, 25, 50, 100, 200];

const Chips: React.FC<{
  options: { value: number; label: string }[];
  value: number;
  onSelect: (v: number) => void;
}> = ({ options, value, onSelect }) => (
  <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
    {options.map(o => (
      <button
        key={o.value}
        onClick={() => onSelect(o.value)}
        className={`px-3.5 py-1.5 rounded-full text-sm font-semibold shrink-0 border ${
          value === o.value
            ? 'bg-app-highlight text-app-inverse border-transparent'
            : 'bg-app-card text-app-secondary border-app-theme'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const SmartDownloadsSettings: React.FC = () => {
  const { settings, updateSettings } = useAudio();
  const [summary, setSummary] = useState(getSmartSummary);

  // Refresh when files arrive or get removed.
  useEffect(() => {
    const refresh = () => setSummary(getSmartSummary());
    const offOwned = subscribeSmartOwned(refresh);
    const offQueue = subscribeQueue(refresh);
    const timer = window.setInterval(refresh, 5000);
    return () => {
      offOwned();
      offQueue();
      window.clearInterval(timer);
    };
  }, []);

  const on = settings.smartDownloads;
  const limitLabel = formatMb(settings.smartLimitMb * 1024 * 1024);

  return (
    <>
      <p className="text-sm text-app-secondary pt-4 pb-1">SMART DOWNLOADS</p>
      <div className="flex items-center justify-between gap-4 py-3.5">
        <div className="min-w-0">
          <p className="text-base text-app-primary">Smart downloads</p>
          <p className="text-sm text-app-secondary mt-0.5">
            Keep your liked and most played songs offline automatically
          </p>
        </div>
        <button
          onClick={() => updateSettings({ smartDownloads: !on })}
          className={`w-12 h-7 rounded-full p-1 shrink-0 transition-colors ${on ? 'bg-app-highlight' : 'bg-app-card'}`}
        >
          <span
            className={`block w-5 h-5 rounded-full transition-transform ${
              on ? 'translate-x-5 bg-app-primary' : 'translate-x-0 bg-app-highlight'
            }`}
          />
        </button>
      </div>
      {on && (
        <>
          <div className="flex items-center justify-between gap-4 py-3.5">
            <div className="min-w-0">
              <p className="text-base text-app-primary">Liked songs</p>
              <p className="text-sm text-app-secondary mt-0.5">Always first in line</p>
            </div>
            <button
              onClick={() => updateSettings({ smartKeepLiked: !settings.smartKeepLiked })}
              className={`w-12 h-7 rounded-full p-1 shrink-0 transition-colors ${
                settings.smartKeepLiked ? 'bg-app-highlight' : 'bg-app-card'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full transition-transform ${
                  settings.smartKeepLiked ? 'translate-x-5 bg-app-primary' : 'translate-x-0 bg-app-highlight'
                }`}
              />
            </button>
          </div>
          <div className="py-3">
            <p className="text-base text-app-primary">Most played</p>
            <p className="text-sm text-app-secondary">
              {settings.smartTopPlayed > 0
                ? `Your top ${settings.smartTopPlayed} songs (played 2+ times)`
                : 'Off'}
            </p>
            <Chips
              options={TOP_OPTIONS.map(n => ({ value: n, label: n === 0 ? 'Off' : `Top ${n}` }))}
              value={settings.smartTopPlayed}
              onSelect={v => updateSettings({ smartTopPlayed: v })}
            />
          </div>
          <div className="py-3">
            <p className="text-base text-app-primary">Storage limit</p>
            <p className="text-sm text-app-secondary">
              Using {formatMb(summary.bytes)} of {limitLabel}
            </p>
            <Chips
              options={LIMITS_MB.map(mb => ({ value: mb, label: mb < 1024 ? `${mb} MB` : `${mb / 1024} GB` }))}
              value={settings.smartLimitMb}
              onSelect={v => updateSettings({ smartLimitMb: v })}
            />
            <p className="mt-3 text-sm text-app-secondary">
              {summary.count} {summary.count === 1 ? 'song' : 'songs'} kept offline. Songs you download yourself
              are never removed. Follows the Wi-Fi only rule above.
            </p>
          </div>
        </>
      )}
    </>
  );
};
