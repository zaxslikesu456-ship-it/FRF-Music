// A running record of how each audio source behaved, for the Playback health screen.
// YouTube changes things often; when playback or a download breaks, this shows which
// source stopped working and with what error, instead of guessing.

export interface HealthEvent {
  source: string;
  ok: boolean;
  ms: number;
  error?: string;
  at: number;
}

export interface SourceSummary {
  source: string;
  ok: number;
  fail: number;
  avgMs: number;
  lastAt: number;
  lastOk: boolean;
  lastError?: string;
}

const KEY = 'frf_stream_health_v1';
const MAX_EVENTS = 300;

function load(): HealthEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

let events: HealthEvent[] = load();
const listeners = new Set<() => void>();
let saveTimer: number | undefined;

function save() {
  if (saveTimer !== undefined) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    try {
      localStorage.setItem(KEY, JSON.stringify(events));
    } catch {
      // storage full: the in-memory record still works
    }
  }, 1500);
}

/** Short, readable text for an error; never the raw URL (it carries tokens). */
function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return raw
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\s+/g, ' ')
    .replace(/^Error: /, '')
    .slice(0, 140);
}

// YouTube's rate limit. When a connection sends YouTube too many requests, every
// client gets "This content isn't available, try again later" for up to an hour.
// The app made it worse: one song could send ~35 lookups (two dozen clients, retries,
// then the same again for each other version of the song it searched for), so a
// short limit turned into a long one and nothing played. After the first "try again
// later", YouTube is left alone for a while (5, then 15, then 30 minutes; the mirrors
// still get asked); a lookup that works again ends it. Kept across restarts, since
// the limit outlasts them.
const COOLDOWN_KEY = 'frf_yt_cooldown_v1';
const COOLDOWN_MINUTES = [5, 15, 30];
const RATE_LIMITED = /try again later/i;
let cooldown: { until: number; step: number } = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(COOLDOWN_KEY) || 'null');
    if (saved && typeof saved.until === 'number' && typeof saved.step === 'number') return saved;
  } catch {
    // ignore
  }
  return { until: 0, step: 0 };
})();

function saveCooldown() {
  try {
    localStorage.setItem(COOLDOWN_KEY, JSON.stringify(cooldown));
  } catch {
    // ignore
  }
}

/** True while YouTube is being left alone after it rate-limited this connection. */
export function youtubeCoolingDown(): boolean {
  return Date.now() < cooldown.until;
}

/** The error used while cooling down. */
export function youtubeCooldownError(): Error {
  const minutes = Math.max(1, Math.ceil((cooldown.until - Date.now()) / 60000));
  return new Error(`YouTube is limiting this connection (too many requests); asking again in ${minutes} min`);
}

// YouTube's own clients (not the mirrors, the token minter or the player).
const YOUTUBE_SOURCE = /^YouTube (TV|web) client$|^[A-Z][A-Z0-9_]*(\+po)?$/;

function watchRateLimit(source: string, ok: boolean, error: string | undefined) {
  if (!YOUTUBE_SOURCE.test(source)) return;
  if (ok) {
    if (cooldown.step !== 0 || cooldown.until !== 0) {
      cooldown = { until: 0, step: 0 };
      saveCooldown();
    }
    return;
  }
  if (!error || !RATE_LIMITED.test(error) || youtubeCoolingDown()) return;
  const minutes = COOLDOWN_MINUTES[Math.min(cooldown.step, COOLDOWN_MINUTES.length - 1)];
  cooldown = { until: Date.now() + minutes * 60000, step: cooldown.step + 1 };
  saveCooldown();
  events.push({
    source: 'YouTube rate limit',
    ok: false,
    ms: 0,
    error: `YouTube asked to try again later; not asking it for ${minutes} min`,
    at: Date.now(),
  });
}

export function recordSource(source: string, ok: boolean, ms: number, error?: unknown) {
  events.push({
    source,
    ok,
    ms: Math.max(0, Math.round(ms)),
    error: ok ? undefined : cleanError(error),
    at: Date.now(),
  });
  watchRateLimit(source, ok, events[events.length - 1].error);
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  save();
  listeners.forEach(fn => fn());
}

/** Runs a task and records how it went. The task's own result or error passes through. */
export async function timed<T>(source: string, task: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const value = await task();
    recordSource(source, true, Date.now() - start);
    return value;
  } catch (e) {
    recordSource(source, false, Date.now() - start, e);
    throw e;
  }
}

export function subscribeHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getEvents(): HealthEvent[] {
  return events.slice();
}

export function clearHealth() {
  events = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  listeners.forEach(fn => fn());
}

/** One row per source, newest activity first. Recent history only (the last 80 tries each). */
export function summarize(): SourceSummary[] {
  const bySource = new Map<string, HealthEvent[]>();
  for (const e of events) {
    const list = bySource.get(e.source) || [];
    list.push(e);
    bySource.set(e.source, list);
  }
  const rows: SourceSummary[] = [];
  for (const [source, all] of bySource) {
    const list = all.slice(-80);
    const okEvents = list.filter(e => e.ok);
    const last = list[list.length - 1];
    const lastFail = [...list].reverse().find(e => !e.ok);
    rows.push({
      source,
      ok: okEvents.length,
      fail: list.length - okEvents.length,
      avgMs: okEvents.length ? Math.round(okEvents.reduce((a, e) => a + e.ms, 0) / okEvents.length) : 0,
      lastAt: last.at,
      lastOk: last.ok,
      lastError: lastFail?.error,
    });
  }
  return rows.sort((a, b) => b.lastAt - a.lastAt);
}

/** 'healthy' when the latest tries mostly worked, 'degraded' when mixed, 'down' when they fail. */
export function statusOf(row: SourceSummary): 'healthy' | 'degraded' | 'down' {
  const total = row.ok + row.fail;
  if (total === 0) return 'healthy';
  const rate = row.ok / total;
  if (row.lastOk && rate >= 0.6) return 'healthy';
  if (row.lastOk || rate >= 0.3) return 'degraded';
  return 'down';
}

export function formatAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
