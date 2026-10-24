// Smart downloads: ranking and fitting logic. Pure on purpose (no browser or
// app imports) so it can be tested from Node. The app side feeds it candidate
// songs and acts on the plan it returns.

export const EST_TRACK_BYTES = 3.5 * 1024 * 1024;
const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A song needs at least this many plays to count as "most played". */
export const MIN_PLAYS_FOR_TOP = 2;

export interface SmartCandidate {
  id: string;
  liked: boolean;
  plays: number;
  /** ms timestamp of the last play, 0 if unknown. */
  lastPlayed: number;
  /** True when a usable file is stored on the device. */
  offline: boolean;
  /** Stored size in bytes (only meaningful when offline). */
  sizeBytes?: number;
  /** Smart downloads added this file itself (so it may be evicted). */
  smartOwned: boolean;
  /** Never evict (currently playing, or kept by another auto-download rule). */
  protectedFromEviction?: boolean;
}

export interface SmartOptions {
  keepLiked: boolean;
  /** Keep this many most played songs; 0 = off. */
  topPlayed: number;
  limitBytes: number;
  now?: number;
}

export interface SmartPlan {
  /** Ids to keep offline, best first. */
  wanted: string[];
  /** Wanted ids that still need downloading, in priority order. */
  toDownload: string[];
  /** Smart-owned files to delete to get back under the limit, worst first. */
  toEvict: string[];
  /** Bytes the wanted set is expected to use (actual sizes + estimates). */
  plannedBytes: number;
}

/** Higher = more worth keeping. Liked counts most, then plays, then recency. */
export function scoreCandidate(c: SmartCandidate, now: number): number {
  let score = c.liked ? 1000 : 0;
  score += Math.min(c.plays, 100) * 5;
  if (c.lastPlayed > 0) {
    const ageDays = Math.max(0, (now - c.lastPlayed) / DAY_MS);
    score += Math.max(0, 60 - ageDays * 2); // fades to nothing after 30 days
  }
  return score;
}

function sizeOf(c: SmartCandidate): number {
  return c.offline && c.sizeBytes && c.sizeBytes > 0 ? c.sizeBytes : EST_TRACK_BYTES;
}

export function planSmartDownloads(candidates: SmartCandidate[], opts: SmartOptions): SmartPlan {
  const now = opts.now ?? Date.now();
  const limit = Math.max(0, opts.limitBytes);

  const scored = candidates
    .map(c => ({ c, score: scoreCandidate(c, now) }))
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));

  // Which songs qualify at all.
  const topIds = new Set<string>();
  if (opts.topPlayed > 0) {
    candidates
      .filter(c => c.plays >= MIN_PLAYS_FOR_TOP)
      .sort((a, b) => b.plays - a.plays || b.lastPlayed - a.lastPlayed || a.id.localeCompare(b.id))
      .slice(0, opts.topPlayed)
      .forEach(c => topIds.add(c.id));
  }
  const eligible = (c: SmartCandidate) => (opts.keepLiked && c.liked) || topIds.has(c.id);

  // Fill the budget best-first; a song that does not fit is skipped so smaller
  // ones further down can still use the space.
  const wanted: string[] = [];
  const wantedSet = new Set<string>();
  let planned = 0;
  for (const { c } of scored) {
    if (!eligible(c)) continue;
    // Files the user saved themselves are already on the device: free for the budget.
    const size = c.offline && !c.smartOwned ? 0 : sizeOf(c);
    if (planned + size > limit) continue;
    planned += size;
    wanted.push(c.id);
    wantedSet.add(c.id);
  }

  const byId = new Map(candidates.map(c => [c.id, c]));
  const toDownload = wanted.filter(id => !byId.get(id)!.offline);

  // Everything smart-owned and stored takes room even when no longer wanted.
  // Unwanted files are removed (worst first) only while over the limit.
  let used = 0;
  for (const c of candidates) {
    if (c.smartOwned && c.offline) used += sizeOf(c);
  }
  const pendingBytes = toDownload.reduce((n, id) => n + sizeOf(byId.get(id)!), 0);
  let projected = used + pendingBytes;
  const toEvict: string[] = [];
  if (projected > limit) {
    const evictable = scored
      .filter(({ c }) => c.smartOwned && c.offline && !wantedSet.has(c.id) && !c.protectedFromEviction)
      .reverse(); // lowest rank first
    for (const { c } of evictable) {
      if (projected <= limit) break;
      toEvict.push(c.id);
      projected -= sizeOf(c);
    }
  }

  return { wanted, toDownload, toEvict, plannedBytes: planned };
}

export function mbToBytes(mb: number): number {
  return mb * MB;
}
