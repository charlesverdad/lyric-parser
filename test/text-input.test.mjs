import test from 'node:test';
import assert from 'node:assert/strict';
import { linesFromText, firstLineIsTitle } from '../js/text-input.js';
import { parseSongs } from '../js/song-parser.js';
import { songsFromText } from '../js/pipeline.js';
import { samplePaste } from './helpers.mjs';

const texts = (input) => linesFromText(input).map((l) => l.text);

test('drops blank lines and trims the rest', () => {
  assert.deepEqual(texts('  a  \n\n\n  b\n'), ['a', 'b']);
});

test('lines are ordered top to bottom in PDF space', () => {
  const lines = linesFromText('a\nb\nc');
  assert.ok(lines[0].y > lines[1].y && lines[1].y > lines[2].y);
});

test('non-breaking spaces from a PDF paste become ordinary gaps', () => {
  assert.deepEqual(texts('C   G\n Oh, what a love '), ['C   G', 'Oh, what a love']);
});

test('empty input yields no lines rather than throwing', () => {
  assert.deepEqual(linesFromText(''), []);
  assert.deepEqual(linesFromText(undefined), []);
});

// ── title detection ──────────────────────────────────────────────────────────

test('a heading followed by a blank line is a title', () => {
  assert.equal(firstLineIsTitle(['Amazing Grace', '', 'Amazing grace how sweet']), true);
});

test('a heading followed by a section header is a title', () => {
  assert.equal(firstLineIsTitle(['Amazing Grace', '[Verse 1]', 'Amazing grace']), true);
});

test('a heading is still a title with a tempo marking in between', () => {
  assert.equal(firstLineIsTitle(['Yours Alone (G)', '4/4 170 BPM', '[Verse 1]', 'Oh']), true);
});

test('a paste that opens straight into lyrics has no title', () => {
  assert.equal(firstLineIsTitle(['Amazing grace how sweet the sound', 'That saved a wretch']), false);
});

test('a section header is not a title', () => {
  assert.equal(firstLineIsTitle(['[Verse 1]', 'Amazing grace']), false);
});

test('a chord line is not a title', () => {
  assert.equal(firstLineIsTitle(['C  G  Am', '', 'Amazing grace']), false);
});

test('the inferred title is parsed off the lyrics', () => {
  const [song] = parseSongs(linesFromText('Amazing Grace (G)\n\n[Verse 1]\nAmazing grace how sweet the sound'));
  assert.equal(song.title, 'Amazing Grace');
  assert.equal(song.key, 'G');
  assert.deepEqual(song.groups[0].lines, ['Amazing grace how sweet the sound']);
});

test('an untitled paste keeps its first line as a lyric', () => {
  const [song] = parseSongs(linesFromText('Amazing grace how sweet the sound\nThat saved a wretch like me'));
  assert.equal(song.title, 'Untitled');
  assert.deepEqual(song.groups[0].lines, [
    'Amazing grace how sweet the sound',
    'That saved a wretch like me',
  ]);
});

test('numbering wins over the single-title guess, so every song is found', () => {
  const songs = parseSongs(
    linesFromText('1. First Song (C)\n[Verse 1]\nLine one\n2. Second Song (D)\n[Verse 1]\nLine two'),
  );
  assert.deepEqual(songs.map((s) => [s.title, s.key]), [['First Song', 'C'], ['Second Song', 'D']]);
});

// ── the real paste ───────────────────────────────────────────────────────────

test('parses the pasted chart into its six songs', () => {
  const songs = songsFromText(samplePaste());
  assert.deepEqual(
    songs.map((s) => [s.title, s.key]),
    [
      ['Yours Alone', 'G'],
      ['Good and Gracious King', 'C'],
      ['More Like Jesus', 'C'],
      ['No Longer Slaves', 'A'],
      ['No Longer Slaves', 'A#'],
      ['I Offer My Life', 'D'],
    ],
  );
});

test('chords, tempo and progressions are stripped from the paste', () => {
  const songs = songsFromText(samplePaste());
  const everyLine = songs.flatMap((s) => s.groups.flatMap((g) => g.slides.flat()));
  assert.ok(everyLine.length > 0);
  for (const line of everyLine) {
    assert.doesNotMatch(line, /\|/, `chord progression survived: ${line}`);
    assert.doesNotMatch(line, /^\s*(?:[A-G][#b]?[^\s]*\s+)*[A-G][#b]?[^\s]*\s*$/, `chord line survived: ${line}`);
    assert.doesNotMatch(line, /\d\/\d|BPM/i, `tempo marking survived: ${line}`);
  }
});

test('the paste respects the slide limits', () => {
  const songs = songsFromText(samplePaste(), { maxLines: 2, maxChars: 40 });
  for (const song of songs) {
    for (const group of song.groups) {
      for (const slide of group.slides) {
        assert.ok(slide.length <= 2, `${song.title}/${group.name}: ${slide.length} lines`);
        for (const line of slide) assert.ok(line.length <= 40, `too long: ${line}`);
      }
    }
  }
});

test('repeats become an arrangement, not duplicated groups', () => {
  const [yoursAlone] = songsFromText(samplePaste());
  assert.ok(yoursAlone.arrangement.length > yoursAlone.groups.length);
  assert.equal(new Set(yoursAlone.groups.map((g) => g.name)).size, yoursAlone.groups.length);
});
