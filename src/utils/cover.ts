// Higher-resolution cover art.
//
// YouTube Music hands out small pictures: square album art at 60-226 px
// (lh3.googleusercontent.com "=w120-h120") and video thumbnails at 320x180
// ("mqdefault"), which is only 180 px once cropped to a square cover, blurry on
// a phone screen. These helpers ask for the large versions instead.

const ART_SIZE = 544;
const YT_THUMB = /^https?:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{6,})\/(?:default|mqdefault|hqdefault|sddefault|hq720|maxresdefault)\.(?:jpg|webp)(?:\?.*)?$/;

export function hiResCover(url: string | undefined | null): string {
  if (!url) return url || '';
  // Square album / artist art: ask for a bigger size.
  if (/(googleusercontent\.com|ggpht\.com)\//.test(url)) {
    if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, `=w${ART_SIZE}-h${ART_SIZE}`);
    if (/=s\d+/.test(url)) return url.replace(/=s\d+/, `=s${ART_SIZE}`);
    return url;
  }
  // Video thumbnail: the 1280x720 one. Not every video has it; the image error
  // handler (imageFallback.ts) drops back to the small one when it is missing.
  const m = url.match(YT_THUMB);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/maxresdefault.jpg`;
  return url;
}

// Album art sizes YouTube serves; the smallest that covers the space is used.
const ART_STEPS = [120, 226, 360, 544, 1200];

/**
 * The cover version for a picture shown `px` device pixels wide. The large
 * versions cost a lot of memory once decoded (a 1280x720 thumbnail is 3.5 MB),
 * so small spots (list rows, cards) get small pictures and only big views get
 * the large ones. Stored covers stay large; this picks per picture on screen.
 */
export function sizedCover(url: string, px: number): string {
  if (/(googleusercontent\.com|ggpht\.com)\//.test(url)) {
    const step = ART_STEPS.find(s => s >= px) ?? ART_STEPS[ART_STEPS.length - 1];
    if (/=w\d+-h\d+/.test(url)) return url.replace(/=w\d+-h\d+/, `=w${step}-h${step}`);
    if (/=s\d+/.test(url)) return url.replace(/=s\d+/, `=s${step}`);
    return url;
  }
  const m = url.match(YT_THUMB);
  if (!m) return url;
  // The 320x180 thumbnail fills a square up to about 200 px; above that, the large one.
  return `https://i.ytimg.com/vi/${m[1]}/${px <= 200 ? 'mqdefault' : 'maxresdefault'}.jpg`;
}

/** The small video thumbnail that every video has (320x180, no black bars). */
export function fallbackThumb(url: string): string | null {
  const m = url.match(YT_THUMB);
  if (!m || !/maxresdefault/.test(url)) return null;
  return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
}

/**
 * Cover for the lock screen / notification / widget. The native players cannot
 * fall back when the large video thumbnail is missing, so they get the one that
 * always exists. Album art keeps its large size.
 */
export function nativeCover(url: string | undefined | null): string {
  if (!url) return '';
  return fallbackThumb(url) || url;
}

const UPGRADE_FLAG = 'frf_covers_hires_v1';

/**
 * Once: the songs, playlists and history already saved on this device still
 * point at the small pictures. Rewrite those addresses to the large ones.
 */
export function upgradeStoredCovers(): void {
  try {
    if (localStorage.getItem(UPGRADE_FLAG)) return;
    const thumb = /https?:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{6,})\/(?:default|mqdefault|hqdefault|sddefault|hq720)\.(?:jpg|webp)(?:\?[^"\s]*)?/g;
    const art = /((?:googleusercontent|ggpht)\.com\/[^"\s=]+)=w(\d+)-h(\d+)/g;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !(key.startsWith('bw_music_') || key.startsWith('frf_'))) continue;
      const value = localStorage.getItem(key);
      if (!value || (!value.includes('ytimg.com') && !value.includes('googleusercontent') && !value.includes('ggpht'))) continue;
      const next = value
        .replace(thumb, (_m, id) => `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`)
        .replace(art, (m, base, w) => (Number(w) < ART_SIZE ? `${base}=w${ART_SIZE}-h${ART_SIZE}` : m));
      if (next !== value) localStorage.setItem(key, next);
    }
    localStorage.setItem(UPGRADE_FLAG, '1');
  } catch {
    // storage full or blocked: keep the small pictures
  }
}
