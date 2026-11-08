// The "About" text on an artist's page. YouTube Music's own description is
// used when it is real text; many artists only put a website link there, so
// otherwise the opening of their Wikipedia article is shown (in the app's
// language when that Wikipedia has it, else English). One request per artist,
// remembered for a week.
import { httpGetJson } from './http';
import { getLanguage } from '../i18n';

export interface ArtistBio {
  text: string;
  source: 'youtube' | 'wikipedia';
  /** Link to the full article (Wikipedia only). */
  url?: string;
}

const CACHE_KEY = 'frf_artist_bio_v1';
const WEEK_MS = 7 * 24 * 3600 * 1000;
const MUSIC =
  /singer|rapper|band|musician|songwriter|\bdj\b|producer|musical|group|composer|cantante|cantor|rappeur|chanteu|sänger|musik|músic|music|zanger|şarkıcı|певец|певица|рэпер|группа|गायक|गायिका|penyanyi|歌手|ラッパー|バンド|가수|래퍼|밴드|音乐|乐队|说唱/i;

type Cache = Record<string, { at: number; bio: ArtistBio | null }>;

function readCache(): Cache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCache(c: Cache) {
  try {
    // Keep it small: the 60 most recent artists.
    const entries = Object.entries(c).sort((a, b) => b[1].at - a[1].at).slice(0, 60);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // not cached; fine
  }
}

/** A description that is more than a link or a line of contact details. */
function isRealText(s: string): boolean {
  const withoutLinks = s.replace(/https?:\/\/\S+|www\.\S+/gi, '').trim();
  return withoutLinks.length >= 80;
}

async function fromWikipedia(lang: string, name: string): Promise<ArtistBio | null> {
  // Ask for a few likely titles in one request and keep the music one.
  const titles = [name, `${name} (musician)`, `${name} (rapper)`, `${name} (singer)`, `${name} (band)`].join('|');
  const data = await httpGetJson(
    `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|description&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(titles)}&format=json&formatversion=2&origin=*`,
    6000
  );
  const pages: any[] = data?.query?.pages || [];
  const music = pages
    .filter(
      p =>
        !p.missing &&
        typeof p.extract === 'string' &&
        p.extract.length > 60 &&
        !/may refer to|puede referirse|peut désigner|steht für/i.test(p.extract) &&
        MUSIC.test(`${p.description || ''} ${p.extract.slice(0, 300)}`)
    )
    // "Drake (musician)" beats a plain "Drake" page about something else.
    .sort((a, b) => (b.title.includes('(') ? 1 : 0) - (a.title.includes('(') ? 1 : 0));
  const p = music[0];
  if (!p) return null;
  return {
    text: p.extract.trim(),
    source: 'wikipedia',
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
  };
}

export async function getArtistBio(name: string, youtubeDescription = ''): Promise<ArtistBio | null> {
  if (youtubeDescription && isRealText(youtubeDescription)) {
    return { text: youtubeDescription.trim(), source: 'youtube' };
  }
  const lang = getLanguage();
  const key = `${lang}:${name.toLowerCase()}`;
  const cache = readCache();
  const hit = cache[key];
  if (hit && Date.now() - hit.at < WEEK_MS) return hit.bio;

  let bio: ArtistBio | null = null;
  try {
    bio = await fromWikipedia(lang, name);
    if (!bio && lang !== 'en') bio = await fromWikipedia('en', name);
  } catch {
    return null; // network trouble: don't remember a miss
  }
  cache[key] = { at: Date.now(), bio };
  writeCache(cache);
  return bio;
}
