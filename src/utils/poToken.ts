import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getPlatformFetch } from './http';

// CORS-free HTTP: Capacitor's native client in the phone apps, the desktop app's
// own client on PC. Same shape as CapacitorHttp so the flow below reads the same.
interface HttpOpts {
  url: string;
  headers?: Record<string, string>;
  data?: unknown;
  connectTimeout?: number;
  readTimeout?: number;
}
const Http = {
  async request(method: 'GET' | 'POST', o: HttpOpts): Promise<{ status: number; data: unknown }> {
    if (Capacitor.isNativePlatform()) {
      return method === 'GET' ? CapacitorHttp.get(o) : CapacitorHttp.post(o);
    }
    const f = (await getPlatformFetch()) || fetch;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), (o.readTimeout || 6000) + (o.connectTimeout || 0));
    try {
      const res = await f(o.url, {
        method,
        headers: o.headers,
        body:
          method === 'POST'
            ? typeof o.data === 'string'
              ? o.data
              : JSON.stringify(o.data)
            : undefined,
        signal: ctrl.signal,
      });
      return { status: res.status, data: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  },
  get: (o: HttpOpts) => Http.request('GET', o),
  post: (o: HttpOpts) => Http.request('POST', o),
};

// Mints YouTube WebPO (proof-of-origin) tokens on-device using YouTube's own
// BotGuard VM. Needed when YouTube bot-flags the current network: anonymous
// InnerTube /player calls then return LOGIN_REQUIRED and googlevideo answers
// 403. With a poToken those same requests succeed.
//
// Flow (reverse-engineered by the BgUtils project, MIT license):
//   1. InnerTube att/get        -> BotGuard program + interpreter script URL
//   2. Load interpreter script  -> global BotGuard VM
//   3. vm.a(program, ...)       -> asyncSnapshotFunction
//   4. snapshot                 -> botguardResponse + webPoSignalOutput[0]
//   5. api/jnn/v1/GenerateIT    -> integrityToken
//   6. webPoSignalOutput[0](integrityToken) -> mintCallback(binding) -> poToken

const YT_API_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const GOOG_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0';
const B64URL_CHARS = /[-_.]/g;
const B64URL_MAP: Record<string, string> = { '-': '+', _: '/', '.': '=' };

function base64ToU8(base64: string): Uint8Array {
  const mod = B64URL_CHARS.test(base64)
    ? base64.replace(B64URL_CHARS, m => B64URL_MAP[m])
    : base64;
  const bin = atob(mod);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function u8ToBase64Url(u8: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
}

function randomVisitorData(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  const bytes = new Uint8Array(11);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 11; i++) out += chars[bytes[i] % 64];
  return out;
}

export interface PoTokenMinter {
  visitorData: string;
  mint(contentBinding: string): Promise<string>;
}

let minterPromise: Promise<PoTokenMinter | null> | null = null;
let minterExpiresAt = 0;

export function getPoTokenMinter(forceRefresh = false): Promise<PoTokenMinter | null> {
  // The BotGuard VM needs a real browser environment, and the token requests
  // need CORS-free HTTP, so this runs in the phone apps only. (On PC it runs but
  // YouTube does not trust tokens from a non-youtube.com page; the desktop app
  // mints in a hidden youtube.com window instead, see src-tauri/src/po_token.rs.)
  if (!Capacitor.isNativePlatform()) return Promise.resolve(null);
  if (!forceRefresh && minterPromise && Date.now() < minterExpiresAt) {
    return minterPromise;
  }
  if (!forceRefresh && minterPromise) {
    // Init still in flight: share it. Parallel callers each running their own
    // BotGuard VM was pure waste — and when several resolves raced (foreground
    // handover + background requestStream) the herd made minting slower for
    // everyone.
    return minterPromise;
  }
  minterPromise = initMinter().then(
    minter => {
      // A settled failure must be retried on the next call, not cached.
      if (!minter) minterPromise = null;
      return minter;
    },
    () => {
      // A failed mint must not be cached as valid — force a retry next call.
      minterExpiresAt = 0;
      minterPromise = null;
      return null;
    }
  );
  return minterPromise;
}

async function initMinter(): Promise<PoTokenMinter | null> {
  // Stage markers surface exactly where on-device minting dies — the whole
  // flow is swallowed by getPoTokenMinter's catch, and "no stream" is
  // undebuggable without knowing whether attestation, the VM, or the mint
  // failed.
  const stage = (name: string, err?: unknown) => {
    const detail = err instanceof Error ? err.message : err ? String(err) : '';
    console.warn(`[poToken] ${name}${detail ? `: ${detail}` : ''}`);
  };
  try {
    // 1. Attestation challenge (BotGuard program + interpreter script location)
    const challengeRes = await Http.post({
      url: `https://www.youtube.com/youtubei/v1/att/get?key=${YT_API_KEY}&prettyPrint=false`,
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      data: {
        context: {
          client: { clientName: 'WEB', clientVersion: '2.20260617.01.00', hl: 'en', gl: 'US' },
        },
        engagementType: 'ENGAGEMENT_TYPE_UNBOUND',
      },
      connectTimeout: 6000,
      readTimeout: 6000,
    });
    const challengeData =
      typeof challengeRes.data === 'string' ? JSON.parse(challengeRes.data) : challengeRes.data;
    const bg = challengeData?.bgChallenge;
    const program: string | undefined = bg?.program;
    const globalName: string | undefined = bg?.globalName;
    const interpreterHash: string | undefined = bg?.interpreterHash;
    const interpreterUrlRaw: string | undefined =
      bg?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    if (!program || !globalName || !interpreterUrlRaw) {
      throw new Error('No BotGuard challenge');
    }

  const visitorData: string =
    challengeData?.responseContext?.visitorData || randomVisitorData();

  // 2. Load the BotGuard VM interpreter into the page
  const scriptUrl = interpreterUrlRaw.startsWith('http')
    ? interpreterUrlRaw
    : `https:${interpreterUrlRaw}`;
  const jsRes = await Http.get({
    url: scriptUrl,
    headers: { 'User-Agent': UA },
    connectTimeout: 6000,
    readTimeout: 6000,
  });
  const interpreterJavascript = String(jsRes.data || '');
  if (interpreterJavascript.length < 100) throw new Error('Empty BotGuard interpreter');
  stage('interpreter loaded', `${interpreterJavascript.length} bytes`);

  if (!document.getElementById(interpreterHash || 'bg-interpreter')) {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.id = interpreterHash || 'bg-interpreter';
    script.textContent = interpreterJavascript;
    document.head.appendChild(script);
  }

  const vm = (window as unknown as Record<string, any>)[globalName];
  if (!vm || typeof vm.a !== 'function') throw new Error('BotGuard VM unavailable');

  // The BotGuard program probes window.yt.config_ (the YouTube page's ytcfg)
  // while it runs. When it is missing — as in this WebView, which is not the
  // YouTube site — the program completes but silently skips the WebPO stage:
  // webPoSignalOutput stays empty and GenerateIT answers with the legacy
  // fallback instead of an integrity token. Any object at window.yt is enough
  // for the program to take the WebPO path and mint real tokens.
  const w = window as unknown as Record<string, any>;
  if (!w.yt) {
    w.yt = { config_: {} };
  }

  // 3. Load the program; the VM hands us its functions through the callback
  let resolveFns!: (v: any) => void;
  const fnsPromise = new Promise<any>(resolve => {
    resolveFns = resolve;
  });
  const vmSetupCallback = (
    asyncSnapshotFunction: any,
    shutdownFunction: any,
    passEventFunction: any,
    checkCameraFunction: any
  ) => {
    resolveFns({ asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction });
  };
  const loggerFunctions = [
    (event: string, elapsed: number) => stage('vm event', `${event} ${elapsed}ms`),
    (code: number) => stage('vm client error', String(code)),
    (size: number) => stage('vm payload size', String(size)),
    (latency: number, et: number) => stage('vm latency', `${latency} ${et}`),
    (event: string) => stage('vm event count', event),
  ];

  await vm
    .a(
      program,
      vmSetupCallback,
      true,
      undefined,
      () => {},
      [[], []],
      undefined,
      false,
      loggerFunctions
    )?.[0];
  stage('vm program loaded');

  const vmFunctions = await Promise.race([
    fnsPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('VM init timeout')), 5000)),
  ]);
  const asyncSnapshotFunction = (vmFunctions as any).asyncSnapshotFunction;
  if (!asyncSnapshotFunction) throw new Error('No asyncSnapshotFunction');

  // 4. Snapshot -> botguardResponse + WebPO minter factory
  const webPoSignalOutput: any[] = [];
  const botguardResponse: string = await Promise.race([
    new Promise<string>(resolve => {
      asyncSnapshotFunction((response: string) => resolve(response), [
        undefined,
        undefined,
        webPoSignalOutput,
        undefined,
      ]);
    }),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('Snapshot timeout')), 5000)
    ),
  ]);
  stage('snapshot ok', `signals=${webPoSignalOutput.length}`);

  // 5. Exchange the snapshot for an integrity token
  const itRes = await Http.post({
    url: 'https://www.youtube.com/api/jnn/v1/GenerateIT',
    headers: {
      'Content-Type': 'application/json+protobuf',
      'x-goog-api-key': GOOG_API_KEY,
      'x-user-agent': 'grpc-web-javascript/0.1',
      'User-Agent': UA,
    },
    data: JSON.stringify([REQUEST_KEY, botguardResponse]),
    connectTimeout: 6000,
    readTimeout: 6000,
  });
  const itData = typeof itRes.data === 'string' ? JSON.parse(itRes.data) : itRes.data;
  const integrityToken: string | undefined = Array.isArray(itData) ? itData[0] : undefined;
  if (!integrityToken) {
    stage(
      'GenerateIT response',
      JSON.stringify(itData)?.slice(0, 300) || `status ${itRes.status}`
    );
    throw new Error('No integrity token');
  }

  const ttlSecs = Number(Array.isArray(itData) ? itData[1] : 0) || 7200;
  minterExpiresAt = Date.now() + Math.min(ttlSecs, 7200) * 1000 - 60000;

  // 6. Create the minter
  const getMinter = webPoSignalOutput[0];
  if (typeof getMinter !== 'function') throw new Error('No WebPO minter function');
  const mintCallback = await getMinter(base64ToU8(integrityToken));
  if (!(mintCallback instanceof Function)) throw new Error('WebPO mint callback failed');
  stage('minter ready');

  return {
    visitorData,
    mint: async (contentBinding: string) => {
      const result = await mintCallback(new TextEncoder().encode(contentBinding));
      if (!(result instanceof Uint8Array)) throw new Error('Invalid mint result');
      return u8ToBase64Url(result);
    },
  };
  } catch (e) {
    stage('mint init failed', e);
    throw e;
  }
}
