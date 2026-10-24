import { Capacitor, registerPlugin } from '@capacitor/core';

// Alarm settings live in localStorage. On Android the time/days are mirrored
// to the native side (AlarmManager) so the alarm fires with the app closed.

export type AlarmSourceType = 'liked' | 'playlist' | 'mix';

export interface AlarmConfig {
  enabled: boolean;
  hour: number; // 0-23
  minute: number; // 0-59
  days: number[]; // 0 = Sunday ... 6 = Saturday. Empty = once (next occurrence).
  source: { type: AlarmSourceType; id?: string; title?: string };
  rampSeconds: number;
  snoozeMinutes: number;
}

export const ALARM_CONFIG_KEY = 'frf_alarm_v1';
export const ALARM_CHANGED_EVENT = 'frf-alarm-changed';

export const DEFAULT_ALARM: AlarmConfig = {
  enabled: false,
  hour: 7,
  minute: 0,
  days: [],
  source: { type: 'liked' },
  rampSeconds: 60,
  snoozeMinutes: 10,
};

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function loadAlarm(): AlarmConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(ALARM_CONFIG_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      return {
        ...DEFAULT_ALARM,
        ...raw,
        source: { ...DEFAULT_ALARM.source, ...(raw.source || {}) },
        days: Array.isArray(raw.days) ? raw.days.filter((d: number) => d >= 0 && d <= 6) : [],
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_ALARM };
}

export function saveAlarm(cfg: AlarmConfig) {
  try {
    localStorage.setItem(ALARM_CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
  void syncNativeAlarm(cfg);
  window.dispatchEvent(new Event(ALARM_CHANGED_EVENT));
}

/** The next time this alarm rings after `from`, or null when it is off. */
export function nextAlarmTime(cfg: AlarmConfig, from: Date = new Date()): Date | null {
  if (!cfg.enabled) return null;
  for (let add = 0; add <= 7; add++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + add, cfg.hour, cfg.minute, 0, 0);
    if (d.getTime() <= from.getTime()) continue;
    if (cfg.days.length === 0 || cfg.days.includes(d.getDay())) return d;
  }
  return null;
}

export function formatClock(hour: number, minute: number): string {
  const d = new Date(2000, 0, 1, hour, minute);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function describeDays(days: number[]): string {
  if (days.length === 0) return 'Once';
  if (days.length === 7) return 'Every day';
  const set = new Set(days);
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'Weekdays';
  return [...days].sort().map(d => DAY_NAMES[d]).join(', ');
}

export function describeNext(cfg: AlarmConfig, from: Date = new Date()): string | null {
  const next = nextAlarmTime(cfg, from);
  if (!next) return null;
  const sameDay = next.toDateString() === from.toDateString();
  const day = sameDay ? 'Today' : DAY_NAMES[next.getDay()];
  return `${day} ${formatClock(next.getHours(), next.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Native (Android) side
// ---------------------------------------------------------------------------

export interface AlarmNativeState {
  canScheduleExact: boolean;
  nextAt: number; // epoch ms, 0 when nothing is scheduled
}

interface FrfAlarmPlugin {
  setAlarm(o: { enabled: boolean; hour: number; minute: number; days: number[]; snoozeMinutes: number }): Promise<AlarmNativeState>;
  cancelAlarm(): Promise<void>;
  getAlarmState(): Promise<AlarmNativeState & { enabled: boolean }>;
  getAlarmLaunch(): Promise<{ launched: boolean }>;
  snooze(o: { minutes: number }): Promise<void>;
  stopRinging(): Promise<void>;
  openExactAlarmSettings(): Promise<void>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  addListener(event: string, cb: (data: any) => void): Promise<{ remove: () => void }>;
}

export const IS_ANDROID_APP =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const FrfAlarm: FrfAlarmPlugin | null = IS_ANDROID_APP
  ? registerPlugin<FrfAlarmPlugin>('FrfAlarm')
  : null;

export async function syncNativeAlarm(cfg: AlarmConfig): Promise<AlarmNativeState | null> {
  if (!FrfAlarm) return null;
  try {
    if (!cfg.enabled) {
      await FrfAlarm.cancelAlarm();
      return { canScheduleExact: true, nextAt: 0 };
    }
    return await FrfAlarm.setAlarm({
      enabled: true,
      hour: cfg.hour,
      minute: cfg.minute,
      days: cfg.days,
      snoozeMinutes: cfg.snoozeMinutes,
    });
  } catch {
    return null;
  }
}
