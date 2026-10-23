import { Innertube, Platform } from 'youtubei.js/web';
import type { Types } from 'youtubei.js/web';
import { timed } from './streamHealth';

// googlevideo serves only the first ~1 MiB of IOS / ANDROID / ANDROID_VR /
// WEB_REMIX streams unless the URL carries a GVS poToken that it accepts, so
// those clients can't download or play a full track. TV_SIMPLY needs no
// poToken at all, and MWEB is kept as a poToken'd fallback. Both return
// signature-ciphered, n-throttled URLs, which takes the live player script to
// solve. youtubei.js keeps that extraction current; it hands us the extracted
// script and we run it here.
//
// That script comes from YouTube, so it runs in a throwaway Web Worker: no
// DOM, no localStorage, no Capacitor bridge — only the strings in and out.
const WORKER_SRC = `onmessage = e => {
  try { postMessage({ ok: true, value: new Function(e.data)() }); }
  catch (err) { postMessage({ ok: false, error: String(err && err.message || err) }); }
};`;

Platform.shim.eval = (data, env) => {
  const args = [env.n, env.sp, env.sig].map(v => JSON.stringify(v ?? ''));
  const code = `${data.output}\nreturn process(${args.join(', ')});`;
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  const worker = new Worker(url);
  return new Promise((resolve, reject) => {
    const done = () => { worker.terminate(); URL.revokeObjectURL(url); clearTimeout(timer); };
    const timer = setTimeout(() => { done(); reject(new Error('Player script timed out')); }, 5000);
    worker.onmessage = e => {
      done();
      if (e.data?.ok) resolve(e.data.value);
      else reject(new Error(e.data?.error || 'Player script failed'));
    };
    worker.onerror = e => { done(); reject(new Error(e.message || 'Player script failed')); };
    worker.postMessage(code);
  });
};

export interface WebPoTokens {
  // URL-encoded, exactly as YouTube returned it: the session token is minted
  // over this string.
  visitorData: string;
  // Bound to the video ID: goes in the player request.
  contentPot: string;
  // Bound to visitorData: Player appends it to deciphered URLs as `pot`.
  sessionPot: string;
}

const sessions = new Map<string, Promise<Innertube>>();

function getInnertube(po?: WebPoTokens): Promise<Innertube> {
  // A session token is only valid with the visitor ID it was minted for, so
  // each token pair gets its own session; keep just the latest one around.
  const key = po ? `${po.visitorData}|${po.sessionPot}` : 'anon';
  const existing = sessions.get(key);
  if (existing) return existing;
  if (po) {
    for (const k of sessions.keys()) if (k !== 'anon') sessions.delete(k);
  }
  const yt = Innertube.create({
    ...(po ? { visitor_data: po.visitorData, po_token: po.sessionPot } : {}),
    retrieve_player: true,
    generate_session_locally: true,
  });
  sessions.set(key, yt);
  yt.catch(() => sessions.delete(key));
  return yt;
}

async function resolveWithClient(
  youtubeId: string,
  client: Types.InnerTubeClient,
  preferredItags: number[],
  po?: WebPoTokens
): Promise<string> {
  const yt = await getInnertube(po);
  const info = await yt.getBasicInfo(youtubeId, { client, ...(po ? { po_token: po.contentPot } : {}) });
  const status = info.playability_status?.status;
  if (status && status !== 'OK') throw new Error(`${client} ${status}`);
  const audio = (info.streaming_data?.adaptive_formats || []).filter(f => f.has_audio && !f.has_video);
  if (audio.length === 0) throw new Error(`${client}: no audio formats`);
  const format =
    preferredItags.map(itag => audio.find(f => f.itag === itag)).find(Boolean) ||
    audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  const url = await format.decipher(yt.session.player);
  if (!url) throw new Error(`${client}: decipher failed`);
  return url;
}

// Resolve a full-length googlevideo audio URL: TV_SIMPLY first, then MWEB.
// TV_SIMPLY's stream needs no poToken, but its player request answers
// UNPLAYABLE for most tracks without an established visitor session, so both
// run on the session minted in the native youtube.com WebView when available.
export async function resolveFullAudioUrl(
  youtubeId: string,
  preferredItags: number[],
  mintPoTokens: () => Promise<WebPoTokens>
): Promise<string> {
  let po: WebPoTokens | undefined;
  try {
    po = await timed('Token minter', mintPoTokens);
  } catch (e) {
    console.warn(`[ytjs] mint: ${String((e as Error)?.message || e).slice(0, 120)}`);
  }
  try {
    return await timed('YouTube TV client', () =>
      resolveWithClient(youtubeId, 'TV_SIMPLY', preferredItags, po)
    );
  } catch (e) {
    console.warn(`[ytjs] TV_SIMPLY: ${String((e as Error)?.message || e).slice(0, 120)}`);
  }
  if (!po) throw new Error('No poToken for MWEB');
  return timed('YouTube web client', () => resolveWithClient(youtubeId, 'MWEB', preferredItags, po));
}
