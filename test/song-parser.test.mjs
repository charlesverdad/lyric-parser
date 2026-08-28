import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLines } from '../js/pdf-text.js';
import { parseSongs, parseTitle, isAnnotationLine } from '../js/song-parser.js';
import { sampleDocument } from './helpers.mjs';

const line = (text, { size = 10, page = 1 } = {}) => ({
  text, size, page, column: 0, x: 14, right: 200, y: 0,
});

test('parses numbering, title, key and note out of a title line', () => {
  assert.deepEqual(parseTitle('1. Yours Alone (G)'), {
    index: '1', title: 'Yours Alone', key: 'G', note: null,
  });
  assert.deepEqual(parseTitle('C. No Longer Slaves (A) – Capo 1'), {
    index: 'C', title: 'No Longer Slaves', key: 'A', note: 'Capo 1',
  });
  assert.deepEqual(parseTitle('O. I Offer My Life (D)'), {
    index: 'O', title: 'I Offer My Life', key: 'D', note: null,
  });
});

test('keeps a trailing parenthetical that is not a musical key', () => {
  assert.deepEqual(parseTitle('Above All (Live)'), {
    index: null, title: 'Above All (Live)', key: null, note: null,
  });
});

test('recognises performance directions', () => {
  for (const text of ['4/4 170 BPM', 'End on C', '(Play Chorus chords for prayer)', 'Capo 1', 'CCLI 1234']) {
    assert.ok(isAnnotationLine(text), `expected annotation: ${text}`);
  }
  for (const text of ['I am a child of God', 'We are Yours alone']) {
    assert.ok(!isAnnotationLine(text), `expected lyric: ${text}`);
  }
});

test('drops chord lines and keeps lyrics under their section', () => {
  const [song] = parseSongs([
    line('1. Test Song (G)', { size: 14 }),
    line('4/4 120 BPM'),
    line('[Verse 1]'),
    line('C          G'),
    line('Oh, what a love is this'),
    line('Em             C'),
    line('You suffered in our place'),
  ]);
  assert.equal(song.title, 'Test Song');
  assert.deepEqual(song.groups, [
    { name: 'Verse 1', lines: ['Oh, what a love is this', 'You suffered in our place'] },
  ]);
});

test('an instrumental section produces no group', () => {
  const [song] = parseSongs([
    line('1. Test (C)', { size: 14 }),
    line('[Intro] C|C|D|G/B| x2'),
    line('[Verse 1]'),
    line('We are Yours alone'),
  ]);
  assert.deepEqual(song.groups.map((g) => g.name), ['Verse 1']);
  assert.deepEqual(song.arrangement, ['Verse 1']);
});

test('a repeated section is cued again rather than duplicated', () => {
  const [song] = parseSongs([
    line('1. Test (C)', { size: 14 }),
    line('[Chorus 1]'),
    line('We are Yours alone'),
    line('[Verse 1]'),
    line('You saved us to proclaim'),
    line('[Chorus 1]'),
    line('We are Yours alone'),
  ]);
  assert.equal(song.groups.length, 2);
  assert.deepEqual(song.arrangement, ['Chorus 1', 'Verse 1', 'Chorus 1']);
});

test('a bare repeat reference with no lyrics still cues the section', () => {
  const [song] = parseSongs([
    line('1. Test (C)', { size: 14 }),
    line('[Chorus 2]'),
    line('We are Yours alone'),
    line('[Chorus 2] x2'),
  ]);
  assert.equal(song.groups.length, 1);
  assert.deepEqual(song.arrangement, ['Chorus 2', 'Chorus 2', 'Chorus 2']);
});

test('a section header repeat count expands the arrangement', () => {
  const [song] = parseSongs([
    line('1. Test (C)', { size: 14 }),
    line('[Bridge] x3'),
    line('Holy, holy, Lord Almighty'),
  ]);
  assert.deepEqual(song.arrangement, ['Bridge', 'Bridge', 'Bridge']);
});

test('same heading with different lyrics keeps both and warns', () => {
  const [song] = parseSongs([
    line('1. Test (C)', { size: 14 }),
    line('[Verse 1]'),
    line('first words'),
    line('[Verse 1]'),
    line('different words'),
  ]);
  assert.deepEqual(song.groups.map((g) => g.name), ['Verse 1', 'Verse 1 (2)']);
  assert.equal(song.warnings.length, 1);
});

test('parses every song in the sample PDF', async () => {
  const songs = parseSongs(await extractLines(await sampleDocument()));

  assert.deepEqual(
    songs.map((s) => `${s.index}. ${s.title} (${s.key})`),
    [
      '1. Yours Alone (G)',
      '2. Good and Gracious King (C)',
      '3. More Like Jesus (C)',
      'C. No Longer Slaves (A)',
      'C. No Longer Slaves (A#)',
      'O. I Offer My Life (D)',
    ],
  );
  assert.equal(songs[3].note, 'Capo 1');

  const yoursAlone = songs[0];
  assert.deepEqual(yoursAlone.groups.map((g) => g.name), [
    'Verse 1', 'Chorus 1', 'Verse 2', 'Bridge', 'Chorus 2',
  ]);
  assert.deepEqual(yoursAlone.arrangement, [
    'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 1', 'Bridge', 'Chorus 2',
  ]);
  assert.deepEqual(yoursAlone.groups[0].lines, [
    'Oh, what a love is this',
    'That rescues and for-gives?',
    'You suffered in our place',
    'To make us heirs of grace',
    'You chose unworthy ones',
    'As daughters and as sons',
    'Re-deemed to be Your bride',
    'The prize for which You died',
  ]);

  // "[Bridge] x2" in Good and Gracious King is cued twice.
  const bridgeCount = songs[1].arrangement.filter((n) => n === 'Bridge').length;
  assert.equal(bridgeCount, 2);

  // "[Tag 1] x5" in No Longer Slaves.
  assert.equal(songs[3].arrangement.filter((n) => n === 'Tag 1').length, 5);

  // No chord line survived anywhere.
  for (const song of songs) {
    for (const group of song.groups) {
      for (const l of group.lines) {
        assert.ok(!/^[A-G][#b]?m?7?$/.test(l), `chord leaked into lyrics: ${l}`);
      }
    }
  }

  assert.deepEqual(songs.flatMap((s) => s.warnings), []);
});
