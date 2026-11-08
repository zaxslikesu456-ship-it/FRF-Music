// DLNA / UPnP media renderer control: SOAP requests to the TV's AVTransport
// service (what to play, play/pause/seek, where it is) and RenderingControl
// (volume). A TV polled once a second is all the state there is.
import type { CastDevice } from './discovery';
import { lanFetch } from './native';
import type { CastMedia, CastSession, CastStatus } from './session';

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function hms(seconds: number, withMs = false): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const base = `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return withMs ? `${base}.000` : base;
}

function parseHms(v: string | undefined): number {
  if (!v || v === 'NOT_IMPLEMENTED') return 0;
  const parts = v.split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const DLNA_FLAGS = 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000';

function didl(media: CastMedia): string {
  const dur = media.duration ? ` duration="${hms(media.duration, true)}"` : '';
  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    '<item id="frf-0" parentID="-1" restricted="1">' +
    `<dc:title>${xmlEscape(media.title)}</dc:title>` +
    `<dc:creator>${xmlEscape(media.artist)}</dc:creator>` +
    `<upnp:artist>${xmlEscape(media.artist)}</upnp:artist>` +
    (media.album ? `<upnp:album>${xmlEscape(media.album)}</upnp:album>` : '') +
    (media.coverUrl ? `<upnp:albumArtURI>${xmlEscape(media.coverUrl)}</upnp:albumArtURI>` : '') +
    '<upnp:class>object.item.audioItem.musicTrack</upnp:class>' +
    `<res protocolInfo="http-get:*:${media.contentType}:${DLNA_FLAGS}"${dur}>${xmlEscape(media.url)}</res>` +
    '</item></DIDL-Lite>'
  );
}

export class DlnaSession implements CastSession {
  private sawPlaying = false;
  private last = { position: 0, duration: 0 };
  private loadedAt = 0; // 0: no song sent yet
  private stopped = false;
  private lastPlayingAt = 0;

  readonly device: CastDevice;

  constructor(device: CastDevice) {
    this.device = device;
    if (!device.avTransport) throw new Error('This TV cannot play music from other devices');
  }

  private async soap(
    svc: { url: string; type: string } | undefined,
    action: string,
    args: Record<string, string | number>
  ): Promise<Document> {
    if (!svc) throw new Error('Not supported by this TV');
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
      `<s:Body><u:${action} xmlns:u="${svc.type}">` +
      Object.entries(args)
        .map(([k, v]) => `<${k}>${xmlEscape(String(v))}</${k}>`)
        .join('') +
      `</u:${action}></s:Body></s:Envelope>`;
    const res = await lanFetch(svc.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: `"${svc.type}#${action}"`,
      },
      body,
    });
    const doc = new DOMParser().parseFromString(res.text || '<x/>', 'text/xml');
    if (res.status >= 400) {
      const desc = doc.getElementsByTagName('errorDescription')[0]?.textContent;
      const code = doc.getElementsByTagName('errorCode')[0]?.textContent;
      throw new Error(`${action}: ${desc || 'error'}${code ? ` (${code})` : ''}`);
    }
    return doc;
  }

  private avt(action: string, args: Record<string, string | number> = {}) {
    return this.soap(this.device.avTransport, action, { InstanceID: 0, ...args });
  }

  async load(media: CastMedia): Promise<void> {
    this.sawPlaying = false;
    this.loadedAt = Date.now();
    this.last = { position: media.startTime || 0, duration: media.duration || 0 };
    // Many TVs refuse a new song while one is playing.
    await this.avt('Stop').catch(() => {});
    await this.avt('SetAVTransportURI', { CurrentURI: media.url, CurrentURIMetaData: didl(media) });
    await this.avt('Play', { Speed: 1 });
    if (media.startTime && media.startTime > 2) {
      // Seeking right away often fails while the TV is still opening the song.
      const target = media.startTime;
      setTimeout(() => void this.seek(target).catch(() => {}), 2500);
    }
  }

  async play() {
    await this.avt('Play', { Speed: 1 });
  }

  async pause() {
    await this.avt('Pause');
  }

  async seek(seconds: number) {
    await this.avt('Seek', { Unit: 'REL_TIME', Target: hms(seconds) });
    this.last.position = seconds;
  }

  async setVolume(level: number) {
    await this.soap(this.device.renderingControl, 'SetVolume', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredVolume: Math.round(Math.max(0, Math.min(1, level)) * 100),
    });
  }

  async status(): Promise<CastStatus> {
    if (this.stopped) return { state: 'disconnected', ...this.last };
    let transport = '';
    try {
      const t = await this.avt('GetTransportInfo');
      transport = (t.getElementsByTagName('CurrentTransportState')[0]?.textContent || '').trim();
      const p = await this.avt('GetPositionInfo');
      const pos = parseHms(p.getElementsByTagName('RelTime')[0]?.textContent || '');
      const dur = parseHms(p.getElementsByTagName('TrackDuration')[0]?.textContent || '');
      if (pos > 0 || transport === 'PLAYING') this.last.position = pos;
      if (dur > 0) this.last.duration = dur;
    } catch (e) {
      return { state: 'error', ...this.last, error: String((e as Error)?.message || e) };
    }
    switch (transport) {
      case 'PLAYING':
        this.sawPlaying = true;
        this.lastPlayingAt = Date.now();
        return { state: 'playing', ...this.last };
      case 'PAUSED_PLAYBACK':
      case 'PAUSED_RECORDING':
        return { state: 'paused', ...this.last };
      case 'TRANSITIONING':
        return { state: 'buffering', ...this.last };
      case 'STOPPED':
      case 'NO_MEDIA_PRESENT': {
        if (!this.loadedAt) return { state: 'idle', ...this.last };
        if (!this.sawPlaying) {
          // Still opening the song; give up after a while.
          return Date.now() - this.loadedAt > 25000
            ? { state: 'error', ...this.last, error: 'The TV could not play this song' }
            : { state: 'buffering', ...this.last };
        }
        // Stopped after playing: the song ended, unless it was stopped early on the TV.
        // Where it would be now if it kept playing since the last report.
        const reached = this.last.position + (Date.now() - this.lastPlayingAt) / 1000;
        const nearEnd = !this.last.duration || reached >= this.last.duration - 8 || this.last.position === 0;
        return { state: nearEnd ? 'ended' : 'idle', ...this.last };
      }
      default:
        return { state: 'buffering', ...this.last };
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.avt('Stop').catch(() => {});
  }
}
