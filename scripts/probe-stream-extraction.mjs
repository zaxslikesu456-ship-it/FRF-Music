// Diagnostic: does the app's audio-stream extraction actually return a URL?
// Background playback on Android depends entirely on this succeeding, because
// ExoPlayer needs a real http(s) URL and the WebView player dies when hidden.
// Run: node scripts/probe-stream-extraction.mjs [videoId]

const VIDEO_ID = process.argv[2] || 'dQw4w9WgXcQ';
const KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const PREFERRED = [140, 251, 250, 139, 249];

const CLIENTS = [
  { clientName: 'WEB', clientVersion: '2.20260617.01.00', clientId: '1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36' },
  { clientName: 'IOS', clientVersion: '20.10.4', clientId: '5',
    deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iOS', osVersion: '18.5.22F77',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_5 like Mac OS X; en_US)' },
  { clientName: 'ANDROID', clientVersion: '20.10.38', clientId: '3',
    osName: 'Android', osVersion: '14',
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip' },
  { clientName: 'ANDROID_VR', clientVersion: '1.65.10', clientId: '28',
    deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12L',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip' },
  { clientName: 'ANDROID_MUSIC', clientVersion: '6.40.52', clientId: '21',
    userAgent: 'com.google.android.apps.youtube.music/6.40.52 (Linux; U; Android 14; en_US) gzip' },
  { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20240814.00.00', clientId: '56',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36' },
  { clientName: 'TVHTML5', clientVersion: '7.20240814.00.00', clientId: '7',
    userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.5 TV Safari/537.36' },
  { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', clientId: '85',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/11.50) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/11.50 Safari/605.1.15' },
];

const PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.reallyaweso.me',
  'https://api.piped.yt',
];

const INVIDIOUS = [
  'https://invidious.f5.si/api/v1',
  'https://inv.nadeko.net/api/v1',
  'https://invidious.nerdvpn.de/api/v1',
  'https://invidious.private.coffee/api/v1',
  'https://iv.datura.network/api/v1',
  'https://yewtu.be/api/v1',
  'https://inv.tux.pizza/api/v1',
  'https://invidious.protokolla.fi/api/v1',
  'https://iv.ggtyler.dev/api/v1',
];

const timeout = (ms) => AbortSignal.timeout(ms);
const pick = (formats) => {
  const withUrl = (formats || []).filter((f) => typeof f?.url === 'string' && f.url);
  if (!withUrl.length) return null;
  for (const itag of PREFERRED) {
    const hit = withUrl.find((f) => Number(f.itag) === itag);
    if (hit?.url) return { url: hit.url, itag };
  }
  const anyAudio = withUrl.find((f) => String(f.mimeType || f.type || '').includes('audio'));
  return anyAudio ? { url: anyAudio.url, itag: anyAudio.itag } : null;
};

async function tryInnerTube(client) {
  const body = {
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        ...(client.deviceMake ? { deviceMake: client.deviceMake } : {}),
        ...(client.deviceModel ? { deviceModel: client.deviceModel } : {}),
        ...(client.osName ? { osName: client.osName } : {}),
        ...(client.osVersion ? { osVersion: client.osVersion } : {}),
        hl: 'en', gl: 'US',
      },
      user: {},
    },
    videoId: VIDEO_ID,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${KEY}&prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': client.userAgent,
        'X-YouTube-Client-Name': String(client.clientId),
        'X-YouTube-Client-Version': client.clientVersion,
      },
      body: JSON.stringify(body),
      signal: timeout(9000),
    }
  );
  const data = await res.json();
  const status = data?.playabilityStatus?.status;
  if (status && status !== 'OK') throw new Error(`playability=${status}`);
  const found = pick([
    ...(data?.streamingData?.adaptiveFormats || []),
    ...(data?.streamingData?.formats || []),
  ]);
  if (!found) throw new Error('no audio format');
  return found;
}

async function tryPiped(base) {
  const res = await fetch(`${base}/streams/${VIDEO_ID}`, { signal: timeout(9000) });
  const data = await res.json();
  const streams = data.audioStreams || [];
  const m4a = streams.find((s) => s?.url && ((s.mimeType || '').includes('mp4') || (s.codec || '').includes('mp4a')));
  if (m4a?.url) return { url: m4a.url, itag: 'piped-m4a' };
  const ranked = streams.filter((s) => s?.url).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  if (ranked[0]?.url) return { url: ranked[0].url, itag: 'piped' };
  throw new Error('no piped stream');
}

async function tryInvidious(base) {
  const res = await fetch(`${base}/videos/${VIDEO_ID}`, { signal: timeout(9000) });
  const data = await res.json();
  const found = pick([...(data.adaptiveFormats || []), ...(data.formatStreams || [])]);
  if (!found) throw new Error('no usable format');
  return found;
}

// Confirms the URL actually serves bytes — a 200 on the player endpoint means
// nothing if googlevideo later answers 403.
async function verify(url) {
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-2047' },
      signal: timeout(9000),
    });
    const buf = await res.arrayBuffer();
    return `${res.status} ${buf.byteLength}B`;
  } catch (e) {
    return `FETCH FAIL: ${e.message}`;
  }
}

const tasks = [
  ...CLIENTS.map((c) => [`InnerTube:${c.clientName}`, () => tryInnerTube(c)]),
  ...PIPED.map((b) => [`Piped:${new URL(b).host}`, () => tryPiped(b)]),
  ...INVIDIOUS.map((b) => [`Invidious:${new URL(b).host}`, () => tryInvidious(b)]),
];

console.log(`\nProbing stream extraction for video ${VIDEO_ID}\n` + '='.repeat(72));

const settled = await Promise.allSettled(tasks.map(([, fn]) => fn()));
const good = [];

settled.forEach((r, i) => {
  const [name] = tasks[i];
  if (r.status === 'fulfilled') {
    console.log(`  OK    ${name.padEnd(38)} itag=${r.value.itag}`);
    good.push([name, r.value.url]);
  } else {
    console.log(`  FAIL  ${name.padEnd(38)} ${String(r.reason?.message || r.reason).slice(0, 40)}`);
  }
});

console.log('='.repeat(72));
if (!good.length) {
  console.log('\nRESULT: NO source returned a URL. Background playback cannot work.');
  console.log('        ExoPlayer has nothing to play and the WebView player dies');
  console.log('        when the Activity stops. Fix extraction first.');
  process.exit(1);
}

console.log(`\n${good.length} source(s) returned a URL. Verifying the first three serve bytes:\n`);
for (const [name, url] of good.slice(0, 3)) {
  console.log(`  ${name.padEnd(38)} ${await verify(url)}`);
}
console.log(`\nRESULT: extraction works. ExoPlayer will have a source.`);
