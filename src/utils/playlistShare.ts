import type { Track } from '../types/music';

// Playlist sharing. A playlist becomes a short text code that can be pasted in any
// chat and imported on another phone or PC. Import also accepts plain lists
// ("Title - Artist" lines) and CSV files exported from other music services.
// Pure functions only (no React, no storage), so they can be tested on their own.

const PREFIX = 'FRFPL1:';
const MAX_SONGS = 1000;

export interface SharedSong {
  id?: string; // YouTube video id, when known (imports without searching)
  t: string; // title
  a: string; // artist
  d?: number; // duration in seconds
}

export interface SharedPlaylist {
  name: string;
  songs: SharedSong[];
}

// ----------------------------------------------------------------- encoding

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipeThrough(
  data: Uint8Array,
  transform: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(transform as any);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const hasCompression = () =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Playlist -> "FRFPL1:..." text. Compressed when the platform supports it. */
export async function encodeShareCode(pl: SharedPlaylist): Promise<string> {
  const songs = pl.songs.slice(0, MAX_SONGS).map(s => {
    const o: SharedSong = { t: s.t, a: s.a };
    if (s.id) o.id = s.id;
    if (s.d) o.d = Math.round(s.d);
    return o;
  });
  const json = new TextEncoder().encode(JSON.stringify({ n: pl.name, s: songs }));
  if (hasCompression()) {
    const packed = await pipeThrough(json, new CompressionStream('deflate-raw'));
    return PREFIX + 'z' + toBase64Url(packed);
  }
  return PREFIX + 'p' + toBase64Url(json);
}

/** Text -> playlist, or null when it is not a valid share code. */
export async function decodeShareCode(text: string): Promise<SharedPlaylist | null> {
  const start = text.indexOf(PREFIX);
  if (start < 0) return null;
  const body = text.slice(start + PREFIX.length).trim().split(/\s+/)[0];
  if (body.length < 2) return null;
  try {
    const mode = body[0];
    const bytes = fromBase64Url(body.slice(1));
    let json: Uint8Array;
    if (mode === 'z') {
      if (!hasCompression()) return null;
      json = await pipeThrough(bytes, new DecompressionStream('deflate-raw'));
    } else if (mode === 'p') {
      json = bytes;
    } else {
      return null;
    }
    const data = JSON.parse(new TextDecoder().decode(json));
    if (!data || typeof data.n !== 'string' || !Array.isArray(data.s)) return null;
    const songs: SharedSong[] = [];
    for (const s of data.s.slice(0, MAX_SONGS)) {
      if (!s || typeof s.t !== 'string' || !s.t.trim()) continue;
      songs.push({
        t: s.t,
        a: typeof s.a === 'string' ? s.a : '',
        id: typeof s.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(s.id) ? s.id : undefined,
        d: typeof s.d === 'number' ? s.d : undefined,
      });
    }
    return songs.length > 0 ? { name: data.n.trim() || 'Shared playlist', songs } : null;
  } catch {
    return null;
  }
}

/** The text that is shared: a friendly line plus the code. */
export function shareMessage(name: string, count: number, code: string): string {
  return `FRF Music playlist "${name}" (${count} songs). Paste this in FRF Music > Library > Import playlist:\n\n${code}`;
}

// ------------------------------------------------------------------ parsing

/** One CSV record per row; handles quotes, escaped quotes and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  row.push(cell);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

const TITLE_HEADERS = ['track name', 'track', 'title', 'song', 'song name', 'name'];
const ARTIST_HEADERS = ['artist name(s)', 'artist names', 'artist name', 'artist', 'artists', 'author'];

/** CSV with a header row (Spotify/Exportify style, or plain "title,artist"). */
export function songsFromCsv(text: string): SharedSong[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const find = (names: string[]) => names.map(n => header.indexOf(n)).find(i => i >= 0) ?? -1;
  const ti = find(TITLE_HEADERS);
  if (ti < 0) return [];
  const ai = find(ARTIST_HEADERS);
  const idx = header.findIndex(h => h === 'video id' || h === 'youtube id' || h === 'youtubeid');
  const songs: SharedSong[] = [];
  for (const r of rows.slice(1)) {
    const title = (r[ti] || '').trim();
    if (!title) continue;
    const artist = ai >= 0 ? (r[ai] || '').split(/[;,]/)[0].trim() : '';
    const id = idx >= 0 ? (r[idx] || '').trim() : '';
    songs.push({ t: title, a: artist, id: /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined });
  }
  return songs;
}

/** One song per line: "Title - Artist", "Artist - Title" is not guessed (kept as typed). */
export function songsFromLines(text: string): SharedSong[] {
  const songs: SharedSong[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(\d+[.)]|[-*•])\s+/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.search(/\s[-–—]\s/);
    if (split > 0) {
      songs.push({ t: line.slice(0, split).trim(), a: line.slice(split + 3).trim() });
    } else {
      songs.push({ t: line, a: '' });
    }
  }
  return songs.slice(0, MAX_SONGS);
}

/** Works out what the user gave us: a share code, a CSV, or a plain list. */
export async function parseImportText(
  text: string,
  fallbackName = 'Imported playlist'
): Promise<{ playlist: SharedPlaylist | null; kind: 'code' | 'csv' | 'list' | 'none' }> {
  const trimmed = text.trim();
  if (!trimmed) return { playlist: null, kind: 'none' };

  if (trimmed.includes(PREFIX)) {
    const pl = await decodeShareCode(trimmed);
    return pl ? { playlist: pl, kind: 'code' } : { playlist: null, kind: 'none' };
  }

  const firstLine = trimmed.split(/\r?\n/)[0].toLowerCase();
  if (firstLine.includes(',') && TITLE_HEADERS.some(h => firstLine.split(',').map(x => x.trim().replace(/"/g, '')).includes(h))) {
    const songs = songsFromCsv(trimmed);
    if (songs.length > 0) return { playlist: { name: fallbackName, songs }, kind: 'csv' };
  }

  const songs = songsFromLines(trimmed);
  return songs.length > 0
    ? { playlist: { name: fallbackName, songs }, kind: 'list' }
    : { playlist: null, kind: 'none' };
}

// ----------------------------------------------------------- track building

export function songFromTrack(t: Track): SharedSong {
  return {
    id: t.youtubeId,
    t: t.title,
    a: t.artist,
    d: t.duration || undefined,
  };
}

/** A track for a shared song that already carries its YouTube id (no search needed). */
export function trackFromSong(s: SharedSong): Track | null {
  if (!s.id) return null;
  return {
    id: `yt-${s.id}`,
    title: s.t,
    artist: s.a || 'Unknown artist',
    album: 'Shared playlist',
    duration: s.d || 0,
    url: '',
    coverUrl: `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`,
    isYouTube: true,
    youtubeId: s.id,
    addedAt: Date.now(),
  };
}
