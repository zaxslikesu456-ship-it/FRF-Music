import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0';

type FetchLike = typeof fetch;

let tauriFetchPromise: Promise<FetchLike | null> | null = null;

function isTauri(): boolean {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
}

function getTauriFetch(): Promise<FetchLike | null> {
  if (!isTauri()) return Promise.resolve(null);
  if (!tauriFetchPromise) {
    tauriFetchPromise = import('@tauri-apps/plugin-http')
      .then(m => m.fetch as unknown as FetchLike)
      .catch(() => null);
  }
  return tauriFetchPromise;
}

function parseData(data: unknown): any {
  if (typeof data === 'string') return JSON.parse(data);
  return data;
}

// Guarantees a request always settles, even if the underlying fetch ignores
// the abort signal (prevents the app hanging on "loading" forever).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), ms);
    promise.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export function isTauriRuntime(): boolean {
  return isTauri();
}

export async function httpPostJson(
  url: string,
  body: unknown,
  timeout = 15000,
  extraHeaders?: Record<string, string>
): Promise<any> {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    Origin: 'https://music.youtube.com',
    Referer: 'https://music.youtube.com/',
    'X-Youtube-Client-Name': '6',
    'X-Youtube-Client-Version': '1.20240801.01.00',
    ...extraHeaders,
  };

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url,
      headers,
      data: body,
      connectTimeout: timeout,
      readTimeout: timeout,
    });
    if (res.status >= 200 && res.status < 300) return parseData(res.data);
    throw new Error(`HTTP ${res.status}`);
  }

  const tauriFetch = await getTauriFetch();
  const doFetch = tauriFetch || fetch;

  const ctrl = new AbortController();
  try {
    const res = await withTimeout(
      doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }),
      timeout
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    ctrl.abort();
  }
}

export async function httpGetJson(
  url: string,
  timeout = 15000,
  extraHeaders?: Record<string, string>
): Promise<any> {
  const headers = {
    'User-Agent': UA,
    Accept: 'application/json',
    Origin: 'https://music.youtube.com',
    Referer: 'https://music.youtube.com/',
    ...extraHeaders,
  };

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: timeout,
      readTimeout: timeout,
    });
    if (res.status >= 200 && res.status < 300) return parseData(res.data);
    throw new Error(`HTTP ${res.status}`);
  }

  const tauriFetch = await getTauriFetch();
  const doFetch = tauriFetch || fetch;

  const ctrl = new AbortController();
  try {
    const res = await withTimeout(
      doFetch(url, {
        headers,
        signal: ctrl.signal,
      }),
      timeout
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    ctrl.abort();
  }
}

export async function httpGetText(
  url: string,
  timeout = 15000,
  extraHeaders?: Record<string, string>
): Promise<string> {
  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...extraHeaders,
  };

  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: timeout,
      readTimeout: timeout,
    });
    if (res.status >= 200 && res.status < 300) return String(res.data);
    throw new Error(`HTTP ${res.status}`);
  }

  const tauriFetch = await getTauriFetch();
  const doFetch = tauriFetch || fetch;

  const ctrl = new AbortController();
  try {
    const res = await withTimeout(
      doFetch(url, {
        headers,
        signal: ctrl.signal,
      }),
      timeout
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    ctrl.abort();
  }
}
