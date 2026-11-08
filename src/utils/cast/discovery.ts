// Finds TVs on the Wi-Fi network:
//   - Google Cast devices (Chromecast, Google TV, TVs with Chromecast built in)
//     answer an mDNS query for "_googlecast._tcp.local".
//   - DLNA TVs (most Samsung, LG, Sony, Philips...) answer an SSDP search for a
//     media renderer, with the address of an XML file describing them.
import { lanFetch, udpQuery } from './native';

export interface CastDevice {
  /** Stable across scans (Cast id or DLNA UDN). */
  id: string;
  name: string;
  kind: 'chromecast' | 'dlna';
  host: string;
  port: number;
  model?: string;
  /** DLNA only: where the commands go. */
  avTransport?: { url: string; type: string };
  renderingControl?: { url: string; type: string };
}

// ---------------------------------------------------------------- mDNS

const enc = new TextEncoder();

function mdnsQuery(name: string): Uint8Array {
  const parts: number[] = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  for (const label of name.split('.')) {
    const b = enc.encode(label);
    parts.push(b.length, ...b);
  }
  // type PTR (12), class IN with the "unicast response" bit
  parts.push(0, 0, 12, 0x80, 1);
  return new Uint8Array(parts);
}

function readName(b: Uint8Array, start: number): [string, number] {
  const labels: string[] = [];
  let pos = start;
  let end = -1;
  let jumps = 0;
  while (pos < b.length) {
    const len = b[pos];
    if (len === 0) {
      pos += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = pos + 2;
      pos = ((len & 0x3f) << 8) | b[pos + 1];
      if (++jumps > 20) break;
      continue;
    }
    labels.push(new TextDecoder().decode(b.subarray(pos + 1, pos + 1 + len)));
    pos += 1 + len;
  }
  return [labels.join('.'), end >= 0 ? end : pos];
}

interface DnsRecord {
  name: string;
  type: number;
  data: Uint8Array;
  offset: number; // where data starts in the packet (names inside may point back)
}

function parseDns(b: Uint8Array): DnsRecord[] {
  if (b.length < 12) return [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const qd = view.getUint16(4);
  const total = view.getUint16(6) + view.getUint16(8) + view.getUint16(10);
  let pos = 12;
  for (let i = 0; i < qd; i++) {
    pos = readName(b, pos)[1] + 4;
  }
  const out: DnsRecord[] = [];
  for (let i = 0; i < total && pos + 10 <= b.length; i++) {
    const [name, p] = readName(b, pos);
    const type = view.getUint16(p);
    const len = view.getUint16(p + 8);
    const offset = p + 10;
    out.push({ name: name.toLowerCase(), type, data: b.subarray(offset, offset + len), offset });
    pos = offset + len;
  }
  return out;
}

function parseTxt(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < data.length) {
    const len = data[i];
    const s = new TextDecoder().decode(data.subarray(i + 1, i + 1 + len));
    const eq = s.indexOf('=');
    if (eq > 0) out[s.slice(0, eq).toLowerCase()] = s.slice(eq + 1);
    i += 1 + len;
  }
  return out;
}

async function findCastDevices(waitMs: number): Promise<CastDevice[]> {
  const replies = await udpQuery('224.0.0.251', 5353, mdnsQuery('_googlecast._tcp.local'), waitMs, true);
  const instances = new Map<string, { from: string }>();
  const srv = new Map<string, { port: number; target: string }>();
  const txt = new Map<string, Record<string, string>>();
  const addr = new Map<string, string>();
  for (const r of replies) {
    for (const rec of parseDns(r.data)) {
      // The packet the record came from is needed to follow compressed names.
      const packet = r.data;
      if (rec.type === 12 && rec.name === '_googlecast._tcp.local') {
        const [inst] = readName(packet, rec.offset);
        if (!instances.has(inst.toLowerCase())) instances.set(inst.toLowerCase(), { from: r.address });
      } else if (rec.type === 33 && rec.data.length >= 7) {
        const port = (rec.data[4] << 8) | rec.data[5];
        const [target] = readName(packet, rec.offset + 6);
        srv.set(rec.name, { port, target: target.toLowerCase() });
        if (!instances.has(rec.name) && rec.name.endsWith('._googlecast._tcp.local')) {
          instances.set(rec.name, { from: r.address });
        }
      } else if (rec.type === 16) {
        txt.set(rec.name, parseTxt(rec.data));
      } else if (rec.type === 1 && rec.data.length === 4) {
        addr.set(rec.name, Array.from(rec.data).join('.'));
      }
    }
  }
  const out: CastDevice[] = [];
  for (const [inst, { from }] of instances) {
    const t = txt.get(inst) || {};
    const s = srv.get(inst);
    const host = (s && addr.get(s.target)) || from;
    const label = inst.replace(/\._googlecast\._tcp\.local$/, '');
    out.push({
      id: `cast:${t.id || label}`,
      name: t.fn || label.replace(/-[0-9a-f]{32}$/i, '').replace(/-/g, ' '),
      kind: 'chromecast',
      host,
      port: s?.port || 8009,
      model: t.md,
    });
  }
  return out;
}

// ---------------------------------------------------------------- SSDP / DLNA

function ssdpSearch(st: string): Uint8Array {
  return enc.encode(
    'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\n' +
      `ST: ${st}\r\nUSER-AGENT: FRF-Music/1.0 UPnP/1.1\r\n\r\n`
  );
}

function first(el: Element | Document, tag: string): string {
  const n = el.getElementsByTagName(tag)[0];
  return (n?.textContent || '').trim();
}

async function describeRenderer(location: string): Promise<CastDevice | null> {
  const res = await lanFetch(location, {}, 4000);
  if (res.status >= 400) return null;
  const doc = new DOMParser().parseFromString(res.text, 'text/xml');
  const base = first(doc, 'URLBase') || location;
  let av: CastDevice['avTransport'];
  let rc: CastDevice['renderingControl'];
  for (const svc of Array.from(doc.getElementsByTagName('service'))) {
    const type = first(svc, 'serviceType');
    const ctl = first(svc, 'controlURL');
    if (!ctl) continue;
    let url: string;
    try {
      url = new URL(ctl, base).toString();
    } catch {
      continue;
    }
    if (type.includes(':AVTransport:') && !av) av = { url, type };
    else if (type.includes(':RenderingControl:') && !rc) rc = { url, type };
  }
  if (!av) return null;
  const host = new URL(location).hostname;
  return {
    id: `dlna:${first(doc, 'UDN') || location}`,
    name: first(doc, 'friendlyName') || first(doc, 'modelName') || host,
    kind: 'dlna',
    host,
    port: Number(new URL(location).port) || 80,
    model: [first(doc, 'manufacturer'), first(doc, 'modelName')].filter(Boolean).join(' ') || undefined,
    avTransport: av,
    renderingControl: rc,
  };
}

async function findDlnaDevices(waitMs: number): Promise<CastDevice[]> {
  const queries = await Promise.all(
    ['urn:schemas-upnp-org:device:MediaRenderer:1', 'urn:schemas-upnp-org:service:AVTransport:1'].map(st =>
      udpQuery('239.255.255.250', 1900, ssdpSearch(st), waitMs).catch(() => [])
    )
  );
  const locations = new Set<string>();
  const dec = new TextDecoder();
  for (const r of queries.flat()) {
    const text = dec.decode(r.data);
    const loc = /^location:\s*(\S+)/im.exec(text)?.[1];
    if (loc) locations.add(loc);
  }
  const found = await Promise.all([...locations].map(l => describeRenderer(l).catch(() => null)));
  const byId = new Map<string, CastDevice>();
  for (const d of found) if (d && !byId.has(d.id)) byId.set(d.id, d);
  return [...byId.values()];
}

/** Every TV that answered within about waitMs. */
export async function discoverDevices(waitMs = 2500): Promise<CastDevice[]> {
  const [cast, dlna] = await Promise.all([
    findCastDevices(waitMs).catch(e => {
      console.warn('[cast] mDNS:', e);
      return [] as CastDevice[];
    }),
    findDlnaDevices(waitMs).catch(e => {
      console.warn('[cast] SSDP:', e);
      return [] as CastDevice[];
    }),
  ]);
  // A TV that does both shows up once, as a Cast device (the better of the two).
  const castHosts = new Set(cast.map(d => d.host));
  const all = [...cast, ...dlna.filter(d => !castHosts.has(d.host))];
  return all.sort((a, b) => a.name.localeCompare(b.name));
}
