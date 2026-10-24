import { createPortal } from 'react-dom';
import React, { useEffect, useState } from 'react';
import { X, AlarmClock } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { useAlarmMixes } from './AlarmHost';
import {
  type AlarmConfig,
  DAY_NAMES,
  FrfAlarm,
  describeDays,
  describeNext,
  loadAlarm,
  saveAlarm,
} from '../utils/alarm';

const pad = (n: number) => String(n).padStart(2, '0');

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
      active
        ? 'bg-app-highlight text-app-inverse border-transparent'
        : 'bg-app-surface text-app-secondary border-app-theme'
    }`}
  >
    {children}
  </button>
);

export const AlarmModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { playlists } = useAudio();
  const mixes = useAlarmMixes();
  const [cfg, setCfg] = useState<AlarmConfig>(() => loadAlarm());
  const [exactOk, setExactOk] = useState(true);

  useEffect(() => {
    if (isOpen) setCfg(loadAlarm());
  }, [isOpen]);

  if (!isOpen) return null;

  // Every change is saved straight away and (on Android) handed to the system alarm.
  const update = (patch: Partial<AlarmConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    saveAlarm(next);
    if (FrfAlarm && next.enabled) {
      void FrfAlarm.getAlarmState()
        .then(s => setExactOk(s.canScheduleExact))
        .catch(() => {});
    }
  };

  const toggleEnabled = async () => {
    if (!cfg.enabled && FrfAlarm) {
      // Android 13+ needs permission for the alarm notification.
      await FrfAlarm.requestNotificationPermission().catch(() => {});
    }
    update({ enabled: !cfg.enabled });
  };

  const toggleDay = (d: number) => {
    const has = cfg.days.includes(d);
    update({ days: has ? cfg.days.filter(x => x !== d) : [...cfg.days, d].sort() });
  };

  const daysKey = [...cfg.days].sort().join(',');
  const preset = cfg.days.length === 0 ? 'once' : daysKey === '0,1,2,3,4,5,6' ? 'every' : daysKey === '1,2,3,4,5' ? 'weekdays' : 'custom';
  const next = describeNext(cfg);
  const sourceValue =
    cfg.source.type === 'liked' ? 'liked' : `${cfg.source.type}:${cfg.source.id || ''}`;

  const onSource = (v: string) => {
    if (v === 'liked') return update({ source: { type: 'liked' } });
    const [type, ...rest] = v.split(':');
    const id = rest.join(':');
    if (type === 'playlist') {
      const pl = playlists.find(p => p.id === id);
      update({ source: { type: 'playlist', id, title: pl?.name } });
    } else {
      const m = mixes.find(x => x.id === id);
      update({ source: { type: 'mix', id, title: m?.title } });
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center">
      <div className="w-full max-w-lg bg-app-solid border border-app-theme rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-app-theme">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-app-card border border-app-theme text-app-primary">
              <AlarmClock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-app-primary">Alarm</h2>
              <p className="text-xs text-app-secondary">
                {cfg.enabled && next ? `Next alarm: ${next}` : 'Wake up to your music'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-app-secondary rounded-full" title="Close">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold text-app-primary">Alarm on</p>
            <button
              onClick={toggleEnabled}
              className={`w-12 h-7 rounded-full p-1 shrink-0 transition-colors ${
                cfg.enabled ? 'bg-app-highlight' : 'bg-app-card'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full transition-transform ${
                  cfg.enabled ? 'translate-x-5 bg-app-primary' : 'translate-x-0 bg-app-highlight'
                }`}
              />
            </button>
          </div>

          <div className="flex justify-center">
            <input
              type="time"
              value={`${pad(cfg.hour)}:${pad(cfg.minute)}`}
              onChange={e => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (Number.isFinite(h) && Number.isFinite(m)) update({ hour: h, minute: m });
              }}
              className="text-5xl font-bold text-app-primary bg-app-card border border-app-theme rounded-2xl px-5 py-3 text-center"
            />
          </div>

          <div>
            <p className="text-sm font-semibold text-app-secondary mb-2">Repeat: {describeDays(cfg.days)}</p>
            <div className="flex flex-wrap gap-2">
              <Chip active={preset === 'once'} onClick={() => update({ days: [] })}>Once</Chip>
              <Chip active={preset === 'every'} onClick={() => update({ days: [0, 1, 2, 3, 4, 5, 6] })}>Every day</Chip>
              <Chip active={preset === 'weekdays'} onClick={() => update({ days: [1, 2, 3, 4, 5] })}>Weekdays</Chip>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {DAY_NAMES.map((n, d) => (
                <Chip key={n} active={cfg.days.includes(d)} onClick={() => toggleDay(d)}>
                  {n}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-app-secondary mb-2">Music</p>
            <select
              value={sourceValue}
              onChange={e => onSource(e.target.value)}
              className="w-full p-3 rounded-2xl bg-app-card border border-app-theme text-app-primary"
            >
              <option value="liked">Liked songs</option>
              {mixes.length > 0 && (
                <optgroup label="Made for you">
                  {mixes.map(m => (
                    <option key={m.id} value={`mix:${m.id}`}>
                      {m.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {playlists.length > 0 && (
                <optgroup label="Your playlists">
                  {playlists.map(p => (
                    <option key={p.id} value={`playlist:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="text-xs text-app-secondary mt-2">
              Daily Mixes change every day. With no internet, only downloaded songs from this
              choice play.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-app-secondary mb-2">Volume rises over</p>
            <div className="flex flex-wrap gap-2">
              {[15, 30, 60, 120, 300].map(s => (
                <Chip key={s} active={cfg.rampSeconds === s} onClick={() => update({ rampSeconds: s })}>
                  {s < 60 ? `${s} sec` : `${s / 60} min`}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-app-secondary mb-2">Snooze for</p>
            <div className="flex flex-wrap gap-2">
              {[5, 10, 15].map(m => (
                <Chip key={m} active={cfg.snoozeMinutes === m} onClick={() => update({ snoozeMinutes: m })}>
                  {m} min
                </Chip>
              ))}
            </div>
          </div>

          {FrfAlarm && !exactOk && cfg.enabled && (
            <div className="p-3 rounded-2xl bg-app-card border border-app-theme text-sm text-app-secondary">
              Android is not letting FRF Music set exact alarms, so it may ring a few minutes late.{' '}
              <button
                className="text-app-primary font-semibold underline"
                onClick={() => void FrfAlarm?.openExactAlarmSettings()}
              >
                Allow alarms
              </button>
            </div>
          )}
          <p className="text-xs text-app-secondary leading-relaxed">
            {FrfAlarm
              ? 'Rings even when the app is closed. Keep notifications on for FRF Music so the alarm can open the app.'
              : 'On this device the alarm only rings while FRF Music is running.'}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};
