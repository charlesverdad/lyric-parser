import test from 'node:test';
import assert from 'node:assert/strict';
import { songsFromPdf, toProFile, toTextFile } from '../js/pipeline.js';
import { sampleDocument, decodeProto, sub, str, fakeUuids } from './helpers.mjs';

const CUES = 13;

test('converts the sample PDF end to end', async () => {
  const songs = await songsFromPdf(await sampleDocument());

  assert.deepEqual(
    songs.map((s) => [s.title, s.groups.length, s.groups.reduce((n, g) => n + g.slides.length, 0)]),
    [
      ['Yours Alone', 5, 20],
      ['Good and Gracious King', 8, 21],
      ['More Like Jesus', 8, 26],
      ['No Longer Slaves', 8, 17],
      ['No Longer Slaves', 8, 17],
      ['I Offer My Life', 2, 7],
    ],
  );
});

test('no slide exceeds the configured line and character limits', async () => {
  const songs = await songsFromPdf(await sampleDocument(), { maxLines: 2, maxChars: 40 });
  for (const song of songs) {
    for (const group of song.groups) {
      for (const slide of group.slides) {
        assert.ok(slide.length <= 2, `${song.title}/${group.name}: ${slide.length} lines`);
        for (const line of slide) {
          // A single unbreakable word may exceed the limit; nothing else may.
          assert.ok(
            line.length <= 40 || !line.includes(' '),
            `${song.title}/${group.name}: "${line}" is ${line.length} chars`,
          );
        }
      }
    }
  }
});

test('no chord, tempo or performance note survives into a slide', async () => {
  const songs = await songsFromPdf(await sampleDocument());
  const banned = [/^\d+\/\d+\s/, /BPM/i, /^End on /i, /^\(Play /i, /\|/];
  for (const song of songs) {
    for (const group of song.groups) {
      for (const line of group.slides.flat()) {
        for (const pattern of banned) {
          assert.ok(!pattern.test(line), `leaked into ${song.title}: "${line}"`);
        }
      }
    }
  }
});

test('slide settings flow through to the layout', async () => {
  const doc = await sampleDocument();
  const wide = await songsFromPdf(doc, { maxLines: 4, maxChars: 60 });
  const narrow = await songsFromPdf(doc, { maxLines: 2, maxChars: 24 });
  const count = (songs) => songs.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.slides.length, 0), 0);
  assert.ok(count(wide) < count(narrow), 'wider slides should need fewer of them');
});

test('every song renders to a .pro whose cue count matches its slides', async () => {
  const songs = await songsFromPdf(await sampleDocument());
  for (const song of songs) {
    const { name, bytes } = toProFile(song, { uuid: fakeUuids(), now: new Date(0) });
    assert.match(name, /\.pro$/);
    const doc = decodeProto(bytes);
    const slides = song.groups.reduce((n, g) => n + g.slides.length, 0);
    assert.equal(doc[CUES].length, slides, `${song.title} cue count`);
    assert.equal(str(doc, 3), song.title);
  }
});

test('every song renders to text with a heading per section', async () => {
  const songs = await songsFromPdf(await sampleDocument());
  for (const song of songs) {
    const { name, text } = toTextFile(song);
    assert.match(name, /\.txt$/);
    for (const group of song.groups) {
      assert.ok(text.includes(`[${group.name}]`), `${song.title} missing [${group.name}]`);
    }
  }
});

test('hyphen rejoining can be disabled through the pipeline', async () => {
  const doc = await sampleDocument();
  const joined = await songsFromPdf(doc, { rejoinHyphens: true });
  const kept = await songsFromPdf(doc, { rejoinHyphens: false });
  const lines = (songs) => songs.flatMap((s) => s.groups.flatMap((g) => g.slides.flat()));
  assert.ok(lines(joined).some((l) => l.includes('forgives')));
  assert.ok(lines(kept).some((l) => l.includes('for-gives')));
});
