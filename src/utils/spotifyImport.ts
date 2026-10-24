// Imports a Spotify playlist, album or song from its share link.
//
// Spotify's public embed page (open.spotify.com/embed/...) carries the track
// list as JSON (title, artists, length), so no Spotify account or API key is
// needed. It lists at most 100 songs of a playlist; for longer playlists, and
// for Liked Songs (which have no share link), a CSV export from Exportify
// (exportify.net) works with the same Import screen.
import { httpGetText } from './http';
import type { SharedPlaylist, SharedSong } from './playlistShare';

export type SpotifyKind = 'playlist' | 'album' | 'track';

export const SPOTIFY_EMBED_LIMIT = 100;

const LINK_RE = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track)\/([A-Za-z0-9]{22})/i;
const URI_RE = /spotify:(playlist|album|track):([A-Za-z0-9]{22})/i;
const SHORT_RE = /https?:\/\/(?:spotify\.link|spoti\.fi)\/[A-Za-z0-9]+/i;

/** True when the text is (or contains) a Spotify link. */
export function looksLikeSpotify(text: string): boolean {
  return LINK_RE.test(text) || URI_RE.test(text) || SHORT_RE.test(text);
}

function parseLink(text: string): { kind: SpotifyKind; id: string } | null {
  const m = text.match(LINK_RE) || text.match(URI_RE);
  return m ? { kind: m[1].toLowerCase() as SpotifyKind, id: m[2] } : null;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface SpotifyImport {
  playlist: SharedPlaylist;
  kind: SpotifyKind;
  /** The playlist may be longer than what Spotify shared (it shares 100). */
  maybeTruncated: boolean;
}

export async function fetchSpotifyImport(text: string): Promise<SpotifyImport> {
  let link = parseLink(text);
  // Short links (spotify.link/...) open a page that contains the real link.
  if (!link) {
    const short = text.match(SHORT_RE)?.[0];
    if (short) {
      const page = await httpGetText(short, 15000, { 'User-Agent': UA });
      link = parseLink(page);
    }
  }
  if (!link) throw new Error('That is not a Spotify playlist, album or song link.');

  const html = await httpGetText(`https://open.spotify.com/embed/${link.kind}/${link.id}`, 15000, {
    'User-Agent': UA,
  });
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new Error('Spotify did not return the song list. Check that the playlist is public.');
  const entity = JSON.parse(json)?.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('Spotify did not return the song list. Check that the playlist is public.');

  const list: Array<{ title?: string; subtitle?: string; duration?: number }> =
    link.kind === 'track'
      ? [{ title: entity.name || entity.title, subtitle: entity.subtitle || artistsOf(entity), duration: entity.duration }]
      : Array.isArray(entity.trackList)
        ? entity.trackList
        : [];
  const songs: SharedSong[] = list
    .filter(t => t && t.title)
    .map(t => ({
      t: String(t.title).trim(),
      // "Artist1, Artist2" (Spotify uses non-breaking spaces after the commas).
      a: String(t.subtitle || '').replace(/\u00a0/g, ' ').trim(),
      d: t.duration ? Math.round(t.duration / 1000) : undefined,
    }));
  if (songs.length === 0) throw new Error('This Spotify link has no songs that could be read.');

  return {
    playlist: { name: String(entity.name || entity.title || 'Spotify playlist'), songs },
    kind: link.kind,
    maybeTruncated: link.kind === 'playlist' && songs.length >= SPOTIFY_EMBED_LIMIT,
  };
}

function artistsOf(entity: { artists?: Array<{ name?: string }> }): string {
  return (entity.artists || []).map(a => a?.name).filter(Boolean).join(', ');
}
