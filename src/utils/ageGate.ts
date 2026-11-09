// Age-restricted YouTube videos ("Sign in to confirm your age"). No client the
// app can use without a Google account is allowed to play them, so the
// resolver swaps such a video for the same song's YouTube Music audio track.
// This file remembers which videos are gated and which track replaced each.

const SUBS_KEY = 'frf_age_substitutes_v1';

const gated = new Set<string>();
let subs: Record<string, string> | null = null;

/** Video details YouTube still sends for a gated video: used to find the song. */
const details = new Map<string, { title: string; artist: string }>();

function loadSubs(): Record<string, string> {
  if (subs) return subs;
  try {
    subs = JSON.parse(localStorage.getItem(SUBS_KEY) || '{}') || {};
  } catch {
    subs = {};
  }
  return subs!;
}

/** True for YouTube's age-gate answers (and not its "confirm you're not a bot" one). */
export function isAgeGateReason(status?: string, reason?: string): boolean {
  if (status === 'AGE_CHECK_REQUIRED' || status === 'AGE_VERIFICATION_REQUIRED' || status === 'CONTENT_CHECK_REQUIRED') {
    return true;
  }
  return /confirm your age|inappropriate for some users|age[- ]restricted/i.test(reason || '');
}

export function noteAgeGated(videoId: string, title?: string, artist?: string): void {
  if (!videoId) return;
  gated.add(videoId);
  if (title && !details.has(videoId)) details.set(videoId, { title, artist: artist || '' });
}

export function isAgeGated(videoId: string): boolean {
  return gated.has(videoId) || !!loadSubs()[videoId];
}

export function gatedVideoDetails(videoId: string): { title: string; artist: string } | undefined {
  return details.get(videoId);
}

export function getAgeSubstitute(videoId: string): string | undefined {
  return loadSubs()[videoId];
}

export function setAgeSubstitute(videoId: string, songId: string | null): void {
  const all = loadSubs();
  if (songId) all[videoId] = songId;
  else delete all[videoId];
  try {
    localStorage.setItem(SUBS_KEY, JSON.stringify(all));
  } catch {
    // storage full: it is found again next time
  }
}

/** The app's own title and artist for a video (cleaner than YouTube's video title). */
const hints = new Map<string, { title: string; artist: string }>();
export function hintTrack(videoId: string | undefined, title: string, artist: string): void {
  if (!videoId || !title) return;
  hints.set(videoId, { title, artist });
  if (hints.size > 500) hints.delete(hints.keys().next().value as string);
}
export function songDetailsFor(videoId: string): { title: string; artist: string } | undefined {
  return hints.get(videoId) || details.get(videoId);
}
