// The network pieces a web page cannot do itself (multicast discovery, the TLS
// connection to a Cast device, a media server the TV can reach). They live in
// the Android app (CastPlugin.java) and the Windows app (src-tauri/src/cast.rs);
// this file gives both the same shape.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getPlatformFetch, isTauriRuntime } from '../http';

export interface CastMessage {
  namespace: string;
  source: string;
  destination: string;
  data: string;
}

interface AndroidCast {
  lanInfo(): Promise<{ address?: string | null }>;
  udpQuery(o: { host: string; port: number; data: string; waitMs: number; listenMulticast?: boolean }): Promise<{
    replies: { address: string; data: string }[];
  }>;
  castOpen(o: { host: string; port: number }): Promise<{ id: number }>;
  castSend(o: { id: number } & CastMessage): Promise<void>;
  castRecv(o: { id: number }): Promise<{ messages: CastMessage[]; closed: boolean }>;
  castClose(o: { id: number }): Promise<void>;
  mediaServe(o: { url?: string; path?: string; contentType: string }): Promise<{ url: string }>;
}

const IS_ANDROID = Capacitor.getPlatform() === 'android';
const androidCast = IS_ANDROID ? registerPlugin<AndroidCast>('FrfCast') : null;

function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  };
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return Promise.reject(new Error('Casting is not available here'));
  return invoke(cmd, args) as Promise<T>;
}

/** Casting works in the Android and Windows apps (not the browser or iPhone build). */
export function castSupported(): boolean {
  return IS_ANDROID || isTauriRuntime();
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function lanAddress(): Promise<string | null> {
  if (androidCast) return (await androidCast.lanInfo()).address || null;
  return (await tauriInvoke<{ address?: string | null }>('cast_lan_info')).address || null;
}

/** Sends one UDP query to a multicast group and returns the answers. */
export async function udpQuery(
  host: string,
  port: number,
  data: Uint8Array,
  waitMs: number,
  listenMulticast = false
): Promise<{ address: string; data: Uint8Array }[]> {
  if (androidCast) {
    const r = await androidCast.udpQuery({ host, port, data: toBase64(data), waitMs, listenMulticast });
    return (r.replies || []).map(x => ({ address: x.address, data: fromBase64(x.data) }));
  }
  const r = await tauriInvoke<{ replies: { address: string; data: number[] }[] }>('cast_udp_query', {
    host,
    port,
    data: Array.from(data),
    waitMs,
    listenMulticast,
  });
  return (r.replies || []).map(x => ({ address: x.address, data: new Uint8Array(x.data) }));
}

export async function castOpen(host: string, port: number): Promise<number> {
  if (androidCast) return (await androidCast.castOpen({ host, port })).id;
  return (await tauriInvoke<{ id: number }>('cast_open', { host, port })).id;
}

export async function castSend(id: number, m: CastMessage): Promise<void> {
  if (androidCast) return androidCast.castSend({ id, ...m });
  await tauriInvoke('cast_send', { id, ...m });
}

export async function castRecv(id: number): Promise<{ messages: CastMessage[]; closed: boolean }> {
  if (androidCast) return androidCast.castRecv({ id });
  return tauriInvoke('cast_recv', { id });
}

export async function castClose(id: number): Promise<void> {
  if (androidCast) return androidCast.castClose({ id }).catch(() => {});
  await tauriInvoke('cast_close', { id }).catch(() => {});
}

/** Makes a stream URL, a local file or a cover reachable for the TV; returns its address. */
export async function mediaServe(o: { url?: string; path?: string; contentType: string }): Promise<string> {
  if (androidCast) return (await androidCast.mediaServe(o)).url;
  return (await tauriInvoke<{ url: string }>('cast_media_serve', o)).url;
}

/** HTTP to a device on the local network (DLNA descriptions and commands). */
export async function lanFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  timeoutMs = 6000
): Promise<{ status: number; text: string }> {
  const f = (await getPlatformFetch()) || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await Promise.race([
      f(url, { ...init, signal: ctl.signal }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('The TV did not answer')), timeoutMs + 500)),
    ]);
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}
