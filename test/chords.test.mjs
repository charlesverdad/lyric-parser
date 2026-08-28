import test from 'node:test';
import assert from 'node:assert/strict';
import { isChordLine, isChordToken, stripInlineChords } from '../js/chords.js';

const CHORD_LINES = [
  'C', 'G/B', 'Em', 'F#m7', 'A#sus', 'N.C.', 'Cmaj7', 'F#m7b5', 'Dsus4',
  'C G', 'Em C', 'G Em D', 'D/F#', 'E/G#', 'C/E', 'Am7 F',
  'C|C|D|G/B| x2', '(C)|C|G|G|Am|Am|F|F', 'Gm F/A A# D# Gm F/A A# D#',
  'F#m|E|A|D| x2', '(Hold G)', 'D# Fsus A#',
];

// Lyrics are full of words beginning with A-G; a loose chord pattern eats them.
const LYRIC_LINES = [
  'All that I am, all that I have', 'And that is not freedom', 'Amen',
  'Grace', 'Christ is King', 'I am a child of God', 'Add to my joy',
  'As daughters and as sons', 'Be still', 'Do whatever makes me feel good',
  'Come and fill me', 'Every day a little more like Jesus',
  'For we are not our own', 'God of mercy', 'Oh – oh, oh – oh',
  'Everything I do done so I can honour You', 'End on C',
  'Chase good feelings soon we’ll be gone', 'Father, Emmanuel',
];

test('recognises chord lines', () => {
  for (const line of CHORD_LINES) {
    assert.ok(isChordLine(line), `expected chord line: ${line}`);
  }
});

test('does not mistake lyrics for chords', () => {
  for (const line of LYRIC_LINES) {
    assert.ok(!isChordLine(line), `expected lyric line: ${line}`);
  }
});

test('a bare repeat marker is not a chord line', () => {
  assert.equal(isChordLine('x2'), false);
  assert.equal(isChordToken('x2'), true);
});

test('an empty line is not a chord line', () => {
  assert.equal(isChordLine(''), false);
  assert.equal(isChordLine('   '), false);
});

test('strips inline ChordPro annotations but keeps bracketed lyrics', () => {
  assert.equal(stripInlineChords('[C]Amazing [F]grace'), 'Amazing grace');
  assert.equal(stripInlineChords('[Verse 1]'), '[Verse 1]');
});

test('a direction word only counts next to a chord', () => {
  // "(Hold G)" is chord-line furniture; the same words on their own are lyrics.
  assert.ok(isChordLine('(Hold G)'));
  assert.ok(isChordLine('Hold C'));
  for (const lyric of [
    'Break every chain',
    'Break every chain that binds me',
    'Hold me close',
    'Stop and listen',
    'Let ring out the sound',
    'Out of the depths',
  ]) {
    assert.ok(!isChordLine(lyric), `expected lyric: ${lyric}`);
  }
});
