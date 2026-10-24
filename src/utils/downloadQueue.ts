import type { Track } from '../types/music';
import {
  downloadTrackToFile,
  getOfflineRecord,
  getLastDownloadError,
  removeOfflineTrack,
  cancelDownload,
} from './downloadManager';

// A persistent download queue. Downloads used to run one after another inside a
// single function call: they were lost if the app closed, a failure was final,
// and songs were listed as "downloaded" before any file existed. Here every
// request is queued and saved, runs with limited concurrency, is retried with a
// growing delay, waits while offline, and resumes after a restart.

export type QueueState = 'waiting' | 'downloading' | 'retrying' | 'failed';

export interface QueuedDownload {
  track: Track;
  state: QueueState;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  source: 'manual' | 'auto';
}

const KEY = 'bw_music_dl_queue_v1';
export const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [8000, 30000, 90000];
// A download that has not finished by then is treated as failed (and retried),
// so one stuck transfer cannot hold a slot and stall the whole queue.
const DOWNLOAD_TIMEOUT_MS = 4 * 60 * 1000;
const CONCURRENCY = 2;
const RECHECK_MS = 30000;

function load(): QueuedDownload[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: QueuedDownload[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Anything that was mid-download when the app closed starts over.
    return parsed
      .filter(q => q && q.track && q.track.id)
      .map(q => (q.state === 'downloading' ? { ...q, state: 'waiting' as QueueState } : q));
  } catch {
    return [];
  }
}

let queue: QueuedDownload[] = load();
const listeners = new Set<() => void>();
let onDownloaded: ((track: Track) => void) | null = null;
let gate: ((item: QueuedDownload) => boolean) | null = null;
let paused = false;
// Why the queue paused itself (storage full), shown in Downloads. Empty when the
// user paused it or it is running.
let pauseReason = '';
let running = 0;
let timer: number | undefined;
const cancelled = new Set<string>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // storage full: the in-memory queue still works
  }
}

function emit() {
  listeners.forEach(fn => fn());
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getQueue(): QueuedDownload[] {
  return queue.map(q => ({ ...q }));
}

export function isQueuePaused(): boolean {
  return paused;
}

export function getQueuePauseReason(): string {
  return paused ? pauseReason : '';
}

// True when a real, usable file is already stored for this track.
export function isAlreadyOffline(trackId: string): boolean {
  const rec = getOfflineRecord(trackId);
  if (!rec) return false;
  return rec.path ? rec.size >= 20000 : rec.size > 0;
}

/** Called once on startup: sets what happens on success and resumes saved work. */
export function startDownloadQueue(handlers: {
  onDownloaded: (track: Track) => void;
  gate?: (item: QueuedDownload) => boolean;
}) {
  onDownloaded = handlers.onDownloaded;
  gate = handlers.gate ?? null;
  window.addEventListener('online', () => schedule(0));
  const conn = (navigator as any).connection;
  conn?.addEventListener?.('change', () => schedule(0));
  schedule(0);
}

/** Wakes the queue now (for example when the network changed). */
export function kickQueue() {
  schedule(0);
}

/** Lets auto-download hold its items back (for example while on mobile data). */
export function setQueueGate(next: ((item: QueuedDownload) => boolean) | null) {
  gate = next;
  schedule(0);
}

export function enqueueDownloads(tracks: Track[], source: 'manual' | 'auto' = 'manual'): number {
  let added = 0;
  for (const t of tracks) {
    if (!t || !t.id || t.isLocal || !t.youtubeId) continue;
    if (isAlreadyOffline(t.id)) {
      onDownloaded?.(t); // make sure it is registered as downloaded
      continue;
    }
    const existing = queue.find(q => q.track.id === t.id);
    if (existing) {
      // Asking again for a failed item retries it; a manual request also
      // overrides "auto" so the Wi-Fi gate no longer holds it back.
      if (existing.state === 'failed' && source === 'manual') {
        existing.state = 'waiting';
        existing.attempts = 0;
        existing.nextAttemptAt = 0;
      }
      if (source === 'manual') existing.source = 'manual';
      continue;
    }
    cancelled.delete(t.id);
    queue.push({ track: t, state: 'waiting', attempts: 0, nextAttemptAt: 0, source });
    added++;
  }
  persist();
  emit();
  schedule(0);
  return added;
}

export function retryDownload(trackId: string) {
  const item = queue.find(q => q.track.id === trackId);
  if (!item) return;
  item.state = 'waiting';
  item.attempts = 0;
  item.nextAttemptAt = 0;
  item.lastError = undefined;
  persist();
  emit();
  schedule(0);
}

export function retryAllFailed() {
  for (const item of queue) {
    if (item.state === 'failed') {
      item.state = 'waiting';
      item.attempts = 0;
      item.nextAttemptAt = 0;
      item.lastError = undefined;
    }
  }
  persist();
  emit();
  schedule(0);
}

export function removeFromQueue(trackId: string) {
  const item = queue.find(q => q.track.id === trackId);
  if (!item) return;
  if (item.state === 'downloading') {
    // It cannot be aborted mid-transfer; drop its result when it finishes.
    cancelled.add(trackId);
  }
  queue = queue.filter(q => q.track.id !== trackId);
  cancelDownload(trackId);
  persist();
  emit();
}

/** Drops everything that has not started yet; a transfer in progress finishes. */
export function clearQueue() {
  for (const q of queue) {
    if (q.state === 'downloading') cancelled.add(q.track.id);
  }
  queue = [];
  persist();
  emit();
}

export function clearFailed() {
  queue = queue.filter(q => q.state !== 'failed');
  persist();
  emit();
}

export function pauseQueue() {
  paused = true;
  pauseReason = '';
  emit();
}

export function resumeQueue() {
  paused = false;
  pauseReason = '';
  emit();
  schedule(0);
}

function schedule(delayMs: number) {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(pump, Math.max(0, delayMs));
}

function pump() {
  timer = undefined;
  if (paused) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    // No network: wait without burning retry attempts.
    schedule(RECHECK_MS);
    return;
  }

  const now = Date.now();
  while (running < CONCURRENCY) {
    const next = queue.find(
      q =>
        (q.state === 'waiting' || q.state === 'retrying') &&
        q.nextAttemptAt <= now &&
        (!gate || gate(q))
    );
    if (!next) break;
    void run(next);
  }

  // Come back for the next retry, or to re-check held-back items.
  const waiting = queue.filter(q => q.state === 'waiting' || q.state === 'retrying');
  if (waiting.length > 0 && running < CONCURRENCY) {
    const future = waiting.filter(q => q.nextAttemptAt > now).map(q => q.nextAttemptAt - now);
    schedule(future.length > 0 ? Math.min(...future) : RECHECK_MS);
  }
}

async function run(item: QueuedDownload) {
  running++;
  item.state = 'downloading';
  persist();
  emit();

  let ok = false;
  try {
    ok = await Promise.race([
      downloadTrackToFile(item.track),
      new Promise<boolean>(resolve => window.setTimeout(() => resolve(false), DOWNLOAD_TIMEOUT_MS)),
    ]);
  } catch {
    ok = false;
  }
  running--;
  const id = item.track.id;

  if (cancelled.delete(id)) {
    // Removed while it was downloading: discard whatever was fetched.
    if (ok) await removeOfflineTrack(id);
    cancelDownload(id);
    pumpSoon();
    return;
  }

  if (ok) {
    queue = queue.filter(q => q.track.id !== id);
    onDownloaded?.(item.track);
  } else if (/ENOSPC|No space left|not enough space|storage full/i.test(getLastDownloadError())) {
    // The device is full: retrying cannot help and only burns every song's
    // attempts. Put the song back in line and pause until the user frees space
    // and presses Resume.
    item.state = 'waiting';
    item.nextAttemptAt = 0;
    item.lastError = 'Not enough storage space';
    paused = true;
    pauseReason = 'Paused: your device is out of storage. Free up some space, then press Resume.';
    cancelDownload(id);
  } else {
    item.attempts += 1;
    item.lastError = getLastDownloadError();
    // The failed card is replaced by the queue's own status line.
    cancelDownload(id);
    if (item.attempts >= MAX_ATTEMPTS) {
      item.state = 'failed';
    } else {
      item.state = 'retrying';
      item.nextAttemptAt = Date.now() + BACKOFF_MS[Math.min(item.attempts - 1, BACKOFF_MS.length - 1)];
    }
  }
  persist();
  emit();
  pumpSoon();
}

function pumpSoon() {
  schedule(0);
}
