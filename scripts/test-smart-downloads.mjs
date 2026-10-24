// Run: node scripts/test-smart-downloads.mjs
// Exercises src/utils/smartDownloads.ts directly (Node strips the types).
import assert from 'node:assert/strict';
import { planSmartDownloads, scoreCandidate, EST_TRACK_BYTES } from '../src/utils/smartDownloads.ts';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n       ' + (e && e.message));
    process.exitCode = 1;
  }
}

const MB = 1024 * 1024;
const NOW = Date.UTC(2026, 0, 1);
const song = (id, o = {}) => ({
  id, liked: false, plays: 0, lastPlayed: 0, offline: false, smartOwned: false, ...o,
});
const base = { keepLiked: true, topPlayed: 10, limitBytes: 100 * MB, now: NOW };

test('liked outranks played, plays outrank recency', () => {
  assert.ok(scoreCandidate(song('a', { liked: true }), NOW) > scoreCandidate(song('b', { plays: 50 }), NOW));
  assert.ok(scoreCandidate(song('a', { plays: 20 }), NOW) > scoreCandidate(song('b', { plays: 1, lastPlayed: NOW }), NOW));
});

test('wanted = liked + top played, best first', () => {
  const plan = planSmartDownloads(
    [song('plays9', { plays: 9 }), song('liked', { liked: true }), song('once', { plays: 1 }), song('plays5', { plays: 5 })],
    base
  );
  assert.deepEqual(plan.wanted, ['liked', 'plays9', 'plays5']);
  assert.deepEqual(plan.toDownload, ['liked', 'plays9', 'plays5']);
});

test('toggles: likes off / top played off', () => {
  const c = [song('l', { liked: true }), song('p', { plays: 9 })];
  assert.deepEqual(planSmartDownloads(c, { ...base, keepLiked: false }).wanted, ['p']);
  assert.deepEqual(planSmartDownloads(c, { ...base, topPlayed: 0 }).wanted, ['l']);
});

test('top N cap', () => {
  const c = [song('a', { plays: 9 }), song('b', { plays: 8 }), song('c', { plays: 7 })];
  assert.deepEqual(planSmartDownloads(c, { ...base, topPlayed: 2, keepLiked: false }).wanted, ['a', 'b']);
});

test('limit uses estimate for missing songs', () => {
  const c = Array.from({ length: 10 }, (_, i) => song('s' + i, { liked: true, plays: 10 - i }));
  const plan = planSmartDownloads(c, { ...base, limitBytes: 3.5 * 3 * MB });
  assert.equal(plan.wanted.length, 3);
  assert.equal(plan.plannedBytes, 3 * EST_TRACK_BYTES);
});

test('stored sizes are used, small songs fill leftover room', () => {
  const c = [
    song('big', { liked: true, plays: 9, offline: true, smartOwned: true, sizeBytes: 90 * MB }),
    song('huge', { liked: true, plays: 8, offline: true, smartOwned: true, sizeBytes: 50 * MB }),
    song('new', { liked: true, plays: 1 }),
  ];
  const plan = planSmartDownloads(c, base);
  assert.deepEqual(plan.wanted, ['big', 'new']);
  assert.deepEqual(plan.toDownload, ['new']);
});

test('manual downloads do not use the smart budget', () => {
  const c = [song('mine', { liked: true, offline: true, sizeBytes: 500 * MB }), song('x', { liked: true })];
  const plan = planSmartDownloads(c, base);
  assert.deepEqual(plan.wanted.sort(), ['mine', 'x']);
  assert.deepEqual(plan.toDownload, ['x']);
});

test('evicts only smart-owned, unwanted, lowest ranked first, until under limit', () => {
  const c = [
    song('keep', { liked: true, offline: true, smartOwned: true, sizeBytes: 40 * MB }),
    song('old1', { plays: 1, offline: true, smartOwned: true, sizeBytes: 30 * MB }),
    song('old2', { plays: 0, offline: true, smartOwned: true, sizeBytes: 30 * MB }),
    song('manual', { plays: 0, offline: true, smartOwned: false, sizeBytes: 80 * MB }),
  ];
  const plan = planSmartDownloads(c, { ...base, limitBytes: 80 * MB, topPlayed: 0 });
  assert.deepEqual(plan.toEvict, ['old2']); // 40+30+30=100 > 80: drop worst (old2), 70 fits
  assert.ok(!plan.toEvict.includes('manual'));
});

test('no eviction when under the limit', () => {
  const c = [song('old', { offline: true, smartOwned: true, sizeBytes: 10 * MB })];
  assert.deepEqual(planSmartDownloads(c, base).toEvict, []);
});

test('protected (playing / user-kept) songs are never evicted', () => {
  const c = [
    song('playing', { offline: true, smartOwned: true, sizeBytes: 60 * MB, protectedFromEviction: true }),
    song('other', { offline: true, smartOwned: true, sizeBytes: 60 * MB, plays: 1 }),
  ];
  const plan = planSmartDownloads(c, { ...base, limitBytes: 70 * MB, topPlayed: 0 });
  assert.deepEqual(plan.toEvict, ['other']);
});

test('eviction makes room for new wanted songs', () => {
  const c = [
    song('fresh', { liked: true }),
    song('stale', { offline: true, smartOwned: true, sizeBytes: 98 * MB }),
  ];
  const plan = planSmartDownloads(c, base);
  assert.deepEqual(plan.toDownload, ['fresh']);
  assert.deepEqual(plan.toEvict, ['stale']);
});

console.log(`\n${passed} passed`);
