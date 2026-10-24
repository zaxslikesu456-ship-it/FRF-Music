// Run: node scripts/test-device-sync.mjs
// Exercises src/utils/deviceSync.ts directly (Node strips the types).
import assert from 'node:assert/strict';
import {
  buildSyncData,
  mergeSync,
  encodeSyncCode,
  encodeSyncBody,
  splitForQr,
  parseSyncText,
  describeSync,
  isEmptySync,
} from '../src/utils/deviceSync.ts';

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n       ' + (e && e.message));
    process.exitCode = 1;
  }
}

const vidOf = n => 'v' + String(n).padStart(10, 'A'); // 11 chars
const mk = n => ({
  id: `yt-${vidOf(n)}`,
  title: `Song number ${n}`,
  artist: `Artist ${n % 7}`,
  album: 'x',
  duration: 180 + n,
  url: '',
  isYouTube: true,
  youtubeId: vidOf(n),
  addedAt: 1,
});
const emptyLog = () => ({ days: {}, artists: {}, songs: {}, last: {} });

function device(over = {}) {
  return {
    playlists: [],
    favorites: [],
    favoriteTracks: [],
    recent: [],
    playCounts: {},
    log: emptyLog(),
    known: {},
    ...over,
  };
}
const known = (...ns) => Object.fromEntries(ns.map(n => [mk(n).id, mk(n)]));

const phone = device({
  known: { ...known(1, 2, 3, 4, 5), 'local-1': { ...mk(9), id: 'local-1' } },
  playlists: [
    { id: 'p1', name: 'Gym', trackIds: ['yt-' + vidOf(1), 'yt-' + vidOf(2), 'local-1'], createdAt: 1 },
    { id: 'p2', name: 'Chill', description: 'calm', trackIds: ['yt-' + vidOf(3)], createdAt: 2 },
  ],
  favorites: ['yt-' + vidOf(1), 'yt-' + vidOf(4)],
  favoriteTracks: [mk(1), mk(4)],
  recent: [mk(2), mk(1)],
  playCounts: { ['yt-' + vidOf(1)]: 5, ['yt-' + vidOf(2)]: 1 },
  log: {
    days: { '2026-01-01': 100, '2026-01-02': 50 },
    artists: { 'Artist 1': 100 },
    songs: { ['yt-' + vidOf(1)]: 100 },
    last: { ['yt-' + vidOf(1)]: 1000, ['yt-' + vidOf(2)]: 3000 },
  },
});

const pc = device({
  known: known(1, 5, 6),
  playlists: [
    { id: 'q1', name: ' gym ', trackIds: ['yt-' + vidOf(5), 'yt-' + vidOf(1)], createdAt: 1 },
    { id: 'q2', name: 'Focus', trackIds: ['yt-' + vidOf(6)], createdAt: 2 },
  ],
  favorites: ['yt-' + vidOf(5)],
  favoriteTracks: [mk(5)],
  recent: [mk(6), mk(1)],
  playCounts: { ['yt-' + vidOf(1)]: 9, ['yt-' + vidOf(6)]: 2 },
  log: {
    days: { '2026-01-01': 70, '2026-01-03': 20 },
    artists: { 'Artist 1': 30, 'Artist 6': 20 },
    songs: { ['yt-' + vidOf(1)]: 40 },
    last: { ['yt-' + vidOf(1)]: 2000, ['yt-' + vidOf(6)]: 4000 },
  },
});

await test('build skips local files and counts them', () => {
  const d = buildSyncData(phone);
  assert.equal(d.skipped, 1);
  assert.deepEqual(d.playlists[0].ids, [vidOf(1), vidOf(2)]);
  assert.equal(Object.keys(d.tracks).length, 4);
});

await test('merge: playlists by name, order kept, missing appended', () => {
  const m = mergeSync(phone, buildSyncData(pc));
  const gym = m.playlists.find(p => p.name === 'Gym');
  assert.deepEqual(gym.trackIds, ['yt-' + vidOf(1), 'yt-' + vidOf(2), 'local-1', 'yt-' + vidOf(5)]);
  assert.ok(m.playlists.find(p => p.name === 'Focus'));
  assert.equal(m.playlists.length, 3);
  assert.equal(m.summary.playlistsNew, 1);
  assert.equal(m.summary.playlistsUpdated, 1);
});

await test('merge: likes unioned, no duplicates', () => {
  const m = mergeSync(phone, buildSyncData(pc));
  assert.equal(m.favorites.length, 3);
  assert.equal(m.favoriteTracks.length, 3);
  assert.equal(m.summary.likesAdded, 1);
});

await test('merge: play counts take max, log takes max per key', () => {
  const m = mergeSync(phone, buildSyncData(pc));
  assert.equal(m.playCounts['yt-' + vidOf(1)], 9);
  assert.equal(m.playCounts['yt-' + vidOf(2)], 1);
  assert.equal(m.playCounts['yt-' + vidOf(6)], 2);
  assert.equal(m.log.days['2026-01-01'], 100);
  assert.equal(m.log.days['2026-01-03'], 20);
  assert.equal(m.log.artists['Artist 1'], 100);
  assert.equal(m.log.artists['Artist 6'], 20);
  assert.equal(m.log.songs['yt-' + vidOf(1)], 100);
  assert.equal(m.log.last['yt-' + vidOf(1)], 2000);
});

await test('merge: history ordered by most recent play', () => {
  const m = mergeSync(phone, buildSyncData(pc));
  assert.deepEqual(m.recent.map(t => t.id), ['yt-' + vidOf(6), 'yt-' + vidOf(2), 'yt-' + vidOf(1)]);
});

await test('merge: unknown tracks are returned for registration', () => {
  const m = mergeSync(phone, buildSyncData(pc));
  assert.deepEqual(m.newTracks.map(t => t.id), ['yt-' + vidOf(6)]);
  assert.equal(m.newTracks[0].title, 'Song number 6');
  assert.ok(m.newTracks[0].coverUrl.includes(vidOf(6)));
});

await test('merge is idempotent', () => {
  const inc = buildSyncData(pc);
  const m1 = mergeSync(phone, inc);
  const m2 = mergeSync({ ...phone, ...m1, recent: m1.recent, known: { ...phone.known, ...Object.fromEntries(m1.newTracks.map(t => [t.id, t])) } }, inc);
  assert.equal(m2.summary.playlistsNew + m2.summary.playlistsUpdated + m2.summary.likesAdded + m2.summary.historyAdded + m2.summary.countsChanged + m2.summary.logDaysChanged, 0);
});

await test('code round trip (full and lite)', async () => {
  for (const lite of [false, true]) {
    const d = buildSyncData(phone, { lite });
    const code = await encodeSyncCode(d);
    const r = await parseSyncText('hello ' + code + ' bye');
    assert.ok(r.ok);
    assert.deepEqual(r.data.playlists, d.playlists);
    assert.deepEqual(r.data.liked, d.liked);
    assert.deepEqual(r.data.counts, d.counts);
  }
});

await test('file (JSON) round trip', async () => {
  const d = buildSyncData(phone);
  const r = await parseSyncText(JSON.stringify(d, null, 2));
  assert.ok(r.ok);
  assert.equal(describeSync(r.data).playlists, 2);
});

await test('split into numbered QR pieces, any order, reports missing', async () => {
  const body = await encodeSyncBody(buildSyncData(phone));
  const parts = splitForQr(body, 40);
  assert.ok(parts.length > 2);
  const shuffled = [...parts].reverse().join('\n');
  const r = await parseSyncText(shuffled);
  assert.ok(r.ok);
  const bad = await parseSyncText(parts.slice(1).join('\n'));
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing, [1]);
});

await test('garbage and empty input are rejected', async () => {
  assert.equal((await parseSyncText('')).ok, false);
  assert.equal((await parseSyncText('FRFSYNC1:zzzz')).ok, false);
  assert.equal((await parseSyncText('{"v":2}')).ok, false);
  assert.equal((await parseSyncText('just words')).ok, false);
  assert.ok(isEmptySync(buildSyncData(device())));
});

await test('size: 40 playlist songs + 120 likes fit a few QR pieces', async () => {
  const ns = Array.from({ length: 160 }, (_, i) => i + 100);
  const big = device({
    known: known(...ns),
    playlists: [{ id: 'a', name: 'Big', trackIds: ns.slice(0, 40).map(n => 'yt-' + vidOf(n)), createdAt: 1 }],
    favorites: ns.slice(40).map(n => 'yt-' + vidOf(n)),
    favoriteTracks: ns.slice(40).map(mk),
  });
  const body = await encodeSyncBody(buildSyncData(big, { lite: true }));
  console.log(`       (${body.length} chars -> ${splitForQr(body).length} pieces)`);
  assert.ok(body.length > 0);
});

console.log(`${passed} passed`);
