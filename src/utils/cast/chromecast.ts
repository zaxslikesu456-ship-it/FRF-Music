// Google Cast sender: opens the TV's built-in "Default Media Receiver" and
// tells it which address to play. Messages are JSON on named channels
// ("namespaces"); see https://developers.google.com/cast/docs/media/messages.
import type { CastDevice } from './discovery';
import { castClose, castOpen, castRecv, castSend, type CastMessage } from './native';
import { sleep, type CastMedia, type CastSession, type CastStatus } from './session';

const NS_CONNECTION = 'urn:x-cast:com.google.cast.tp.connection';
const NS_RECEIVER = 'urn:x-cast:com.google.cast.receiver';
const NS_MEDIA = 'urn:x-cast:com.google.cast.media';
const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';
const SENDER = 'sender-frf';

type Json = Record<string, any>;

export class ChromecastSession implements CastSession {
  private sock = 0;
  private transportId = '';
  private sessionId = '';
  private mediaSessionId: number | null = null;
  private requestId = 1;
  private waiters = new Map<number, (m: Json) => void>();
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private lastStatusAsk = 0;
  private closed = false;
  private loaded = false;
  private last: { state: CastStatus['state']; position: number; duration: number; at: number; error?: string } = {
    state: 'idle',
    position: 0,
    duration: 0,
    at: Date.now(),
  };

  readonly device: CastDevice;

  private constructor(device: CastDevice) {
    this.device = device;
  }

  static async connect(device: CastDevice): Promise<ChromecastSession> {
    const s = new ChromecastSession(device);
    s.sock = await castOpen(device.host, device.port);
    s.pumpTimer = setInterval(() => void s.pump(), 250);
    try {
      await s.send(NS_CONNECTION, 'receiver-0', { type: 'CONNECT' });
      const reply = await s.request(NS_RECEIVER, 'receiver-0', { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER }, 20000);
      const app = (reply.status?.applications || []).find((a: Json) => a.appId === DEFAULT_MEDIA_RECEIVER);
      if (!app?.transportId) throw new Error(reply.reason || 'The TV did not open the player');
      s.transportId = app.transportId;
      s.sessionId = app.sessionId;
      await s.send(NS_CONNECTION, s.transportId, { type: 'CONNECT' });
      return s;
    } catch (e) {
      await s.close();
      throw e;
    }
  }

  private async send(namespace: string, destination: string, payload: Json): Promise<void> {
    const m: CastMessage = { namespace, source: SENDER, destination, data: JSON.stringify(payload) };
    await castSend(this.sock, m);
  }

  /** Sends a message with a requestId and waits for the TV's answer to it. */
  private request(namespace: string, destination: string, payload: Json, timeoutMs = 15000): Promise<Json> {
    const id = this.requestId++;
    return new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error('The TV did not answer'));
      }, timeoutMs);
      this.waiters.set(id, m => {
        clearTimeout(timer);
        resolve(m);
      });
      this.send(namespace, destination, { ...payload, requestId: id }).catch(e => {
        clearTimeout(timer);
        this.waiters.delete(id);
        reject(e);
      });
    });
  }

  private async pump(): Promise<void> {
    if (this.closed) return;
    let r: { messages: CastMessage[]; closed: boolean };
    try {
      r = await castRecv(this.sock);
    } catch {
      return;
    }
    for (const m of r.messages) {
      let data: Json;
      try {
        data = JSON.parse(m.data);
      } catch {
        continue;
      }
      this.onMessage(m, data);
    }
    if (r.closed && !this.closed) {
      this.last = { ...this.last, state: 'disconnected', at: Date.now() };
      void this.close();
      return;
    }
    // Ask for the position about once a second while a song is loaded.
    if (this.loaded && this.mediaSessionId != null && Date.now() - this.lastStatusAsk > 1000) {
      this.lastStatusAsk = Date.now();
      this.send(NS_MEDIA, this.transportId, { type: 'GET_STATUS', mediaSessionId: this.mediaSessionId, requestId: 0 }).catch(
        () => {}
      );
    }
  }

  private onMessage(m: CastMessage, data: Json) {
    const waiter = typeof data.requestId === 'number' && data.requestId > 0 ? this.waiters.get(data.requestId) : undefined;
    if (m.namespace === NS_CONNECTION && data.type === 'CLOSE' && m.source === this.transportId) {
      // The player on the TV was closed (another phone took over, or the TV's remote).
      this.last = { ...this.last, state: 'disconnected', at: Date.now() };
      void this.close();
      return;
    }
    if (m.namespace === NS_RECEIVER && data.type === 'RECEIVER_STATUS') {
      const apps: Json[] = data.status?.applications || [];
      if (this.sessionId && !apps.some(a => a.sessionId === this.sessionId) && !waiter) {
        this.last = { ...this.last, state: 'disconnected', at: Date.now() };
        void this.close();
        return;
      }
    }
    if (m.namespace === NS_MEDIA && data.type === 'MEDIA_STATUS') {
      const st: Json | undefined = (data.status || [])[0];
      if (st) {
        if (typeof st.mediaSessionId === 'number') this.mediaSessionId = st.mediaSessionId;
        const duration = Number(st.media?.duration) || this.last.duration;
        const position = Number(st.currentTime) || 0;
        let state: CastStatus['state'] = this.last.state;
        let error: string | undefined;
        switch (st.playerState) {
          case 'PLAYING':
            state = 'playing';
            break;
          case 'PAUSED':
            state = 'paused';
            break;
          case 'BUFFERING':
          case 'LOADING':
            state = 'buffering';
            break;
          case 'IDLE':
            if (st.idleReason === 'FINISHED') state = 'ended';
            else if (st.idleReason === 'ERROR') {
              state = 'error';
              error = 'The TV could not play this song';
            } else state = 'idle';
            break;
        }
        this.last = { state, position, duration, at: Date.now(), error };
      } else if (this.loaded && this.last.state !== 'loading') {
        // No media any more: the song finished (or was stopped on the TV).
        const nearEnd = this.last.duration > 0 && this.last.position >= this.last.duration - 5;
        this.last = { ...this.last, state: nearEnd || this.last.state === 'playing' ? 'ended' : 'idle', at: Date.now() };
      }
    }
    if (waiter) {
      this.waiters.delete(data.requestId);
      waiter(data);
    }
  }

  async load(media: CastMedia): Promise<void> {
    if (this.closed) throw new Error('Not connected to the TV');
    this.loaded = false;
    this.mediaSessionId = null;
    this.last = { state: 'loading', position: media.startTime || 0, duration: media.duration || 0, at: Date.now() };
    const reply = await this.request(
      NS_MEDIA,
      this.transportId,
      {
        type: 'LOAD',
        autoplay: true,
        currentTime: media.startTime || 0,
        media: {
          contentId: media.url,
          contentUrl: media.url,
          contentType: media.contentType,
          streamType: 'BUFFERED',
          ...(media.duration ? { duration: media.duration } : {}),
          metadata: {
            metadataType: 3, // music track
            title: media.title,
            artist: media.artist,
            ...(media.album ? { albumName: media.album } : {}),
            ...(media.coverUrl ? { images: [{ url: media.coverUrl }] } : {}),
          },
        },
      },
      30000
    );
    if (reply.type === 'LOAD_FAILED' || reply.type === 'LOAD_CANCELLED' || reply.type === 'INVALID_REQUEST') {
      this.last = { ...this.last, state: 'error', error: 'The TV could not play this song', at: Date.now() };
      throw new Error('The TV could not play this song');
    }
    this.loaded = true;
    if (this.last.state === 'loading') this.last = { ...this.last, state: 'buffering', at: Date.now() };
  }

  private async mediaCommand(type: string, extra: Json = {}): Promise<void> {
    if (this.mediaSessionId == null) return;
    await this.send(NS_MEDIA, this.transportId, {
      type,
      mediaSessionId: this.mediaSessionId,
      requestId: this.requestId++,
      ...extra,
    });
  }

  async play() {
    await this.mediaCommand('PLAY');
    this.last = { ...this.last, state: 'playing', at: Date.now() };
  }

  async pause() {
    const now = await this.status();
    await this.mediaCommand('PAUSE');
    this.last = { ...this.last, state: 'paused', position: now.position, at: Date.now() };
  }

  async seek(seconds: number) {
    await this.mediaCommand('SEEK', { currentTime: Math.max(0, seconds) });
    this.last = { ...this.last, position: Math.max(0, seconds), at: Date.now() };
  }

  async setVolume(level: number) {
    await this.send(NS_RECEIVER, 'receiver-0', {
      type: 'SET_VOLUME',
      volume: { level: Math.max(0, Math.min(1, level)) },
      requestId: this.requestId++,
    });
  }

  async status(): Promise<CastStatus> {
    const l = this.last;
    const position =
      l.state === 'playing' ? Math.min(l.duration || Infinity, l.position + (Date.now() - l.at) / 1000) : l.position;
    return { state: l.state, position, duration: l.duration, error: l.error };
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    try {
      if (this.sessionId) {
        await this.send(NS_RECEIVER, 'receiver-0', { type: 'STOP', sessionId: this.sessionId, requestId: this.requestId++ });
      }
      await sleep(150);
    } catch {
      // already gone
    }
    await this.close();
  }

  private async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
    for (const w of this.waiters.values()) w({ type: 'CLOSED' });
    this.waiters.clear();
    await castClose(this.sock);
  }
}
