import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLine, rejoinSyllableHyphens, normalizeSong } from '../js/lyrics.js';

test('rejoins syllable hyphens introduced for chord placement', () => {
  const cases = [
    ['That rescues and for-gives?', 'That rescues and forgives?'],
    ['Re-deemed to be Your bride', 'Redeemed to be Your bride'],
    ['By Your love I am ac-cepted', 'By Your love I am accepted'],
    ['You’ve saved me from my-self', 'You’ve saved me from myself'],
    ['I pour out my praise a-gain', 'I pour out my praise again'],
    ['Safe, secure in You for-ever', 'Safe, secure in You forever'],
    ['En-slaved and bound to my desires', 'Enslaved and bound to my desires'],
    ['All we adore forever-more', 'All we adore forevermore'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeLine(input).text, expected);
  }
});

test('reports every hyphen it joined', () => {
  const { joins } = rejoinSyllableHyphens('That rescues and for-gives?');
  assert.deepEqual(joins, ['for-gives → forgives']);
});

test('keeps hyphens in real compounds', () => {
  assert.equal(normalizeLine('Give me self-control').text, 'Give me self-control');
  assert.equal(normalizeLine('Make me Christ-like').text, 'Make me Christ-like');
  assert.equal(normalizeLine('Your ever-flowing grace').text, 'Your ever-flowing grace');
});

test('hyphen rejoining can be turned off', () => {
  assert.equal(
    normalizeLine('That rescues and for-gives?', { rejoinHyphens: false }).text,
    'That rescues and for-gives?',
  );
});

test('collapses chord-alignment padding', () => {
  assert.equal(normalizeLine('overcome with joy I     sing').text, 'overcome with joy I sing');
  assert.equal(normalizeLine('All we adore  forever more').text, 'All we adore forever more');
  assert.equal(normalizeLine('Your kingdom come !').text, 'Your kingdom come!');
});

test('optionally straightens typographic quotes', () => {
  assert.equal(normalizeLine('I’m Yours').text, 'I’m Yours');
  assert.equal(normalizeLine('I’m Yours', { straightQuotes: true }).text, "I'm Yours");
});

test('normalizes a whole song and collects its joins', () => {
  const song = {
    title: 'T', groups: [{ name: 'Verse 1', lines: ['for-gives', 'plain line'] }],
    arrangement: ['Verse 1'], warnings: [],
  };
  const result = normalizeSong(song);
  assert.deepEqual(result.groups[0].lines, ['forgives', 'plain line']);
  assert.deepEqual(result.hyphenJoins, ['for-gives → forgives']);
});
