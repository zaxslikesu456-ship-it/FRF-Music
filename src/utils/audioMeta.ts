// Details from a song file you import: title, artist, album and cover art from
// an MP3's ID3 tag (most downloaded songs carry one), and the length. Other
// formats fall back to the file name ("Artist - Title.ext").

import { shrinkImage } from "./pickImage";

export interface AudioMeta {
  title: string;
  artist: string;
  album: string;
  /** Cover art embedded in the file, as a data URL. */
  picture?: string;
  duration: number;
}

const syncsafe = (b: Uint8Array, o: number) =>
  ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

function decodeText(bytes: Uint8Array, encoding: number): string {
  try {
    if (encoding === 1 || encoding === 2) {
      // UTF-16 (with BOM) / UTF-16BE
      let le = encoding === 1;
      let start = 0;
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        le = true;
        start = 2;
      } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        le = false;
        start = 2;
      }
      return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(bytes.subarray(start)).replace(/\0+$/, '');
    }
    return new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1').decode(bytes).replace(/\0+$/, '');
  } catch {
    return '';
  }
}

/** Index after the text terminator (one zero byte, or two for UTF-16). */
function skipTerminated(b: Uint8Array, from: number, encoding: number): number {
  const wide = encoding === 1 || encoding === 2;
  for (let i = from; i < b.length; i += wide ? 2 : 1) {
    if (b[i] === 0 && (!wide || b[i + 1] === 0)) return i + (wide ? 2 : 1);
  }
  return b.length;
}

async function readId3(file: File): Promise<Partial<AudioMeta>> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {}; // "ID3"
  const version = head[3];
  const tagSize = syncsafe(head, 6);
  const tag = new Uint8Array(await file.slice(10, 10 + tagSize).arrayBuffer());
  const out: Partial<AudioMeta> = {};
  let pos = 0;
  // Extended header (rare): skip it.
  if (head[5] & 0x40) pos += version === 4 ? syncsafe(tag, 0) : ((tag[0] << 24) | (tag[1] << 16) | (tag[2] << 8) | tag[3]) + 4;
  while (pos + 10 <= tag.length) {
    const id = String.fromCharCode(tag[pos], tag[pos + 1], tag[pos + 2], tag[pos + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding
    const size =
      version === 4
        ? syncsafe(tag, pos + 4)
        : (tag[pos + 4] << 24) | (tag[pos + 5] << 16) | (tag[pos + 6] << 8) | tag[pos + 7];
    const body = tag.subarray(pos + 10, pos + 10 + size);
    pos += 10 + size;
    if (size <= 0 || body.length === 0) continue;
    const enc = body[0];
    if (id === 'TIT2') out.title = decodeText(body.subarray(1), enc).trim();
    else if (id === 'TPE1') out.artist = decodeText(body.subarray(1), enc).split('\0')[0].trim();
    else if (id === 'TALB') out.album = decodeText(body.subarray(1), enc).trim();
    else if (id === 'APIC' && !out.picture) {
      // encoding, MIME type\0, picture type, description\0, image data
      let p = 1;
      const mimeEnd = body.indexOf(0, p);
      const mime = new TextDecoder('latin1').decode(body.subarray(p, mimeEnd)) || 'image/jpeg';
      p = mimeEnd + 1 + 1; // + picture type
      p = skipTerminated(body, p, enc);
      const img = body.subarray(p);
      if (img.length > 100) {
        const blob = new Blob([img], { type: mime.includes('/') ? mime : `image/${mime.toLowerCase()}` });
        out.picture = await new Promise<string>(resolve => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => resolve('');
          r.readAsDataURL(blob);
        });
      }
    }
  }
  return out;
}

function readDuration(file: File): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? Math.round(d) : 0);
    };
    const timer = window.setTimeout(() => done(0), 8000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      done(audio.duration);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      done(0);
    };
    audio.src = url;
  });
}

/** Turns "Artist - Title (2019).mp3" into an artist and a title. */
function fromFileName(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim();
  const parts = base.split(/\s+-\s+|\s+–\s+/);
  if (parts.length > 1) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: base };
}

export async function readAudioMeta(file: File): Promise<AudioMeta> {
  const named = fromFileName(file.name);
  let tag: Partial<AudioMeta> = {};
  try {
    tag = await readId3(file);
  } catch {
    // not an MP3 with a tag: the file name will do
  }
  const duration = await readDuration(file);
  return {
    title: tag.title || named.title || file.name,
    artist: tag.artist || named.artist || 'Unknown Artist',
    album: tag.album || '',
    picture: tag.picture ? await shrinkImage(tag.picture) : undefined,
    duration,
  };
}

/** A colourful default picture for a song with no cover art: its first letter on a
 *  gradient. Drawn as a JPEG (the Android notification cannot show SVG). */
export function generatedCover(title: string, artist: string): string {
  let h = 0;
  for (const ch of `${title}|${artist}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 50) % 360;
  const letter = (title.trim()[0] || "♪").toUpperCase();
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 400;
    const ctx = c.getContext("2d");
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, 400, 400);
      g.addColorStop(0, `hsl(${hue},70%,45%)`);
      g.addColorStop(1, `hsl(${hue2},75%,25%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 400, 400);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.arc(330, 330, 150, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "800 170px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, 200, 210);
      return c.toDataURL("image/jpeg", 0.85);
    }
  } catch {
    // fall through to SVG
  }
  const safe = letter.replace(/[<>&"]/g, "♪");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,45%)"/><stop offset="1" stop-color="hsl(${hue2},75%,25%)"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><text x="200" y="260" font-family="sans-serif" font-weight="800" font-size="170" fill="white" text-anchor="middle">${safe}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
