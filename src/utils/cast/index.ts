// Playing songs on a TV: Google Cast devices and DLNA TVs on the same Wi-Fi.
// The phone/PC stays in charge of the queue; the TV only plays the current song,
// pulling it from a small server in the app (see native.ts).
import { ChromecastSession } from './chromecast';
import type { CastDevice } from './discovery';
import { DlnaSession } from './dlna';
import type { CastSession } from './session';

export { castSupported, mediaServe } from './native';
export { discoverDevices } from './discovery';
export type { CastDevice } from './discovery';
export type { CastMedia, CastSession, CastState, CastStatus } from './session';

export async function connectCastDevice(device: CastDevice): Promise<CastSession> {
  if (device.kind === 'chromecast') return ChromecastSession.connect(device);
  const s = new DlnaSession(device);
  // Make sure it answers before the song leaves this device.
  const st = await s.status();
  if (st.state === 'error') throw new Error(st.error || 'The TV did not answer');
  return s;
}

/** The type the TV is told for a stream or file. */
export function castContentType(urlOrPath: string): string {
  const u = urlOrPath.toLowerCase();
  const mime = /[?&]mime=([^&]+)/.exec(u)?.[1];
  if (mime) return decodeURIComponent(mime);
  if (/\.(webm|weba|opus)(\?|$)/.test(u)) return 'audio/webm';
  if (/\.mp3(\?|$)/.test(u)) return 'audio/mpeg';
  if (/\.(ogg|oga)(\?|$)/.test(u)) return 'audio/ogg';
  if (/\.flac(\?|$)/.test(u)) return 'audio/flac';
  if (/\.wav(\?|$)/.test(u)) return 'audio/wav';
  return 'audio/mp4';
}
