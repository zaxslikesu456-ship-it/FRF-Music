// Picks colours from a song's cover art, for the Now Playing screen, the mini
// player and the PC player panel (and, if the user wants, as the accent).
// The cover is drawn small onto a canvas; the most common colourful pixels win.

export interface ArtColors {
  /** A strong colour from the cover, bright enough for buttons and text. */
  accent: string;
  /** A dark version of it, for backgrounds behind white text. */
  dark: string;
  /** The raw dominant colour (r, g, b). */
  rgb: [number, number, number];
}

const cache = new Map<string, ArtColors | null>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('cover failed to load'));
    window.setTimeout(() => reject(new Error('cover timed out')), 8000);
    img.src = src;
  });
}

export async function getArtColors(src: string | undefined): Promise<ArtColors | null> {
  if (!src) return null;
  if (cache.has(src)) return cache.get(src) || null;
  try {
    const img = await loadImage(src);
    const size = 40;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    // Bucket pixels by hue (24 buckets); colourful, mid-light pixels count most.
    const buckets = new Array(24).fill(0).map(() => ({ w: 0, r: 0, g: 0, b: 0 }));
    let grey = { w: 0, r: 0, g: 0, b: 0 };
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      const [h, s, l] = rgbToHsl(r, g, b);
      if (l < 0.08 || l > 0.95) continue;
      if (s < 0.18) {
        grey = { w: grey.w + 1, r: grey.r + r, g: grey.g + g, b: grey.b + b };
        continue;
      }
      const w = s * (1 - Math.abs(l - 0.5) * 1.2);
      const bk = buckets[Math.floor(h * 24) % 24];
      bk.w += w; bk.r += r * w; bk.g += g * w; bk.b += b * w;
    }
    const best = buckets.reduce((a, c) => (c.w > a.w ? c : a));
    let rgb: [number, number, number];
    if (best.w > 4) {
      rgb = [best.r / best.w, best.g / best.w, best.b / best.w].map(Math.round) as [number, number, number];
    } else if (grey.w > 0) {
      rgb = [grey.r / grey.w, grey.g / grey.w, grey.b / grey.w].map(Math.round) as [number, number, number];
    } else {
      throw new Error('no usable colours');
    }
    const [h, s] = rgbToHsl(...rgb);
    const colourful = best.w > 4;
    const result: ArtColors = {
      rgb,
      // Bright and saturated enough to read on the dark app background.
      accent: colourful ? hslToHex(h, Math.max(0.55, Math.min(0.9, s)), 0.6) : '#d4d4d4',
      dark: hslToHex(h, colourful ? Math.min(0.6, s) : 0.05, 0.16),
    };
    cache.set(src, result);
    return result;
  } catch {
    // A cover from a site that does not allow reading its pixels, or offline.
    cache.set(src, null);
    return null;
  }
}
