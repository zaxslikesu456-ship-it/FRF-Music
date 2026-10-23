// Run: node scripts/test-playlist-share.mjs
// Exercises src/utils/playlistShare.ts directly (Node strips the types).
import assert from 'node:assert/strict';
import {
  encodeShareCode,
  decodeShareCode,
  parseCsv,
  songsFromCsv,
  songsFromLines,
  parseImportText,
  trackFromSong,
} from '../src/utils/playlistShare.ts';

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

const sample = {
  name: 'Road trip ✨ 2026',
  songs: [
    { id: 'dQw4w9WgXcQ', t: 'Never Gonna Give You Up', a: 'Rick Astley', d: 213 },
    { id: '4NRXx6U8ABQ', t: 'Blinding Lights', a: 'The Weeknd', d: 200 },
    { t: 'Song without an id, "quoted", and commas, too', a: '日本語のアーティスト' },
  ],
};

await test('code round-trips name, ids, unicode and durations', async () => {
  const code = await encodeShareCode(sample);
  assert.ok(code.startsWith('FRFPL1:'));
  const back = await decodeShareCode(code);
  assert.deepEqual(back, {
    name: sample.name,
    songs: [
      { id: 'dQw4w9WgXcQ', t: 'Never Gonna Give You Up', a: 'Rick Astley', d: 213 },
      { id: '4NRXx6U8ABQ', t: 'Blinding Lights', a: 'The Weeknd', d: 200 },
      { id: undefined, t: sample.songs[2].t, a: sample.songs[2].a, d: undefined },
    ],
  });
});

await test('a code pasted inside a chat message still decodes', async () => {
  const code = await encodeShareCode(sample);
  const msg = `hey listen to this!!\n\n${code}\n\nthanks`;
  const back = await decodeShareCode(msg);
  assert.equal(back?.songs.length, 3);
});

await test('a 500-song playlist stays reasonably small', async () => {
  const songs = Array.from({ length: 500 }, (_, i) => ({
    id: ('abcdefghi' + String(i).padStart(2, '0')).slice(0, 11),
    t: 'Track number ' + i,
    a: 'Artist ' + (i % 20),
    d: 180 + (i % 60),
  }));
  const code = await encodeShareCode({ name: 'Big', songs });
  const back = await decodeShareCode(code);
  assert.equal(back?.songs.length, 500);
  assert.ok(code.length < 16000, 'code length ' + code.length);
});

await test('garbage, truncated and tampered codes are rejected, not thrown', async () => {
  assert.equal(await decodeShareCode('hello world'), null);
  assert.equal(await decodeShareCode('FRFPL1:'), null);
  assert.equal(await decodeShareCode('FRFPL1:zzzz'), null);
  assert.equal(await decodeShareCode('FRFPL1:z!!!!'), null);
  assert.equal(await decodeShareCode('FRFPL1:q' + 'A'.repeat(40)), null);
  const code = await encodeShareCode(sample);
  assert.equal(await decodeShareCode(code.slice(0, code.length - 12)), null);
});

await test('a code with invalid ids drops the id but keeps the song', async () => {
  const code = await encodeShareCode({ name: 'x', songs: [{ id: 'not-a-real-id!!', t: 'T', a: 'A' }] });
  const back = await decodeShareCode(code);
  assert.equal(back.songs[0].id, undefined);
  assert.equal(back.songs[0].t, 'T');
});

await test('csv parser handles quotes, commas, newlines in quotes and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",z\r\n');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x, y', 'he said "hi"'],
    ['multi\nline', 'z'],
  ]);
});

await test('Spotify/Exportify style csv gives title and first artist', () => {
  const csv =
    'Track URI,Track Name,Album Name,Artist Name(s),Duration (ms)\n' +
    'spotify:track:1,"Blinding Lights",After Hours,The Weeknd,200040\n' +
    'spotify:track:2,"Get Lucky (feat. Pharrell)",RAM,"Daft Punk, Pharrell Williams",369000\n';
  const songs = songsFromCsv(csv);
  assert.deepEqual(songs, [
    { t: 'Blinding Lights', a: 'The Weeknd', id: undefined },
    { t: 'Get Lucky (feat. Pharrell)', a: 'Daft Punk', id: undefined },
  ]);
});

await test('plain "title,artist" csv and a youtube id column work', () => {
  const songs = songsFromCsv('title,artist,video id\nHello,Adele,YQHsXMglC9A\nBare,Someone,\n');
  assert.equal(songs[0].id, 'YQHsXMglC9A');
  assert.equal(songs[1].id, undefined);
  assert.equal(songs.length, 2);
});

await test('csv without a title column yields nothing', () => {
  assert.deepEqual(songsFromCsv('foo,bar\n1,2\n'), []);
});

await test('line lists: numbering, bullets, dashes and comments', () => {
  const songs = songsFromLines('# my list\n1. Blinding Lights - The Weeknd\n- Dreams – Fleetwood Mac\n* Just a title\n\n  \n');
  assert.deepEqual(songs, [
    { t: 'Blinding Lights', a: 'The Weeknd' },
    { t: 'Dreams', a: 'Fleetwood Mac' },
    { t: 'Just a title', a: '' },
  ]);
});

await test('a hyphen inside a word is not treated as a separator', () => {
  const songs = songsFromLines('Spider-Man Theme');
  assert.deepEqual(songs, [{ t: 'Spider-Man Theme', a: '' }]);
});

await test('parseImportText detects code, csv, list and nothing', async () => {
  const code = await encodeShareCode(sample);
  assert.equal((await parseImportText(code)).kind, 'code');
  assert.equal((await parseImportText('title,artist\nA,B\n')).kind, 'csv');
  assert.equal((await parseImportText('Song A - Artist A\nSong B - Artist B')).kind, 'list');
  assert.equal((await parseImportText('   \n  ')).kind, 'none');
  assert.equal((await parseImportText('FRFPL1:broken')).kind, 'none');
});

await test('trackFromSong needs an id and builds a playable youtube track', () => {
  assert.equal(trackFromSong({ t: 'x', a: 'y' }), null);
  const t = trackFromSong({ id: 'dQw4w9WgXcQ', t: 'Never Gonna Give You Up', a: 'Rick Astley', d: 213 });
  assert.equal(t.id, 'yt-dQw4w9WgXcQ');
  assert.equal(t.youtubeId, 'dQw4w9WgXcQ');
  assert.equal(t.isYouTube, true);
  assert.equal(t.duration, 213);
  assert.ok(t.coverUrl.includes('dQw4w9WgXcQ'));
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
