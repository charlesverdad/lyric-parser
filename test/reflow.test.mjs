import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapLine, toSlides } from '../js/reflow.js';

test('leaves a line that fits alone', () => {
  assert.deepEqual(wrapLine('We are Yours alone', 40), ['We are Yours alone']);
});

test('splits a long line into two balanced halves', () => {
  assert.deepEqual(wrapLine('Lifting my praise to You as a pleasing sacrifice', 40), [
    'Lifting my praise to You',
    'as a pleasing sacrifice',
  ]);
  assert.deepEqual(wrapLine('Get rid of boundaries the rules are stifling', 40), [
    'Get rid of boundaries',
    'the rules are stifling',
  ]);
});

test('splits into more pieces when two would still overflow', () => {
  const pieces = wrapLine('one two three four five six seven eight nine ten', 16);
  assert.ok(pieces.length >= 3);
  assert.ok(pieces.every((p) => p.length <= 16), JSON.stringify(pieces));
});

test('a single word longer than the limit is left intact', () => {
  assert.deepEqual(wrapLine('supercalifragilisticexpialidocious', 10), [
    'supercalifragilisticexpialidocious',
  ]);
});

test('packs lines two to a slide', () => {
  assert.deepEqual(
    toSlides(
      ['Oh, what a love is this', 'That rescues and forgives?', 'You suffered in our place', 'To make us heirs of grace'],
      { maxLines: 2, maxChars: 40 },
    ),
    [
      ['Oh, what a love is this', 'That rescues and forgives?'],
      ['You suffered in our place', 'To make us heirs of grace'],
    ],
  );
});

test('a wrapped line keeps its halves together on one slide', () => {
  // Packing blindly would put "short one" with the first half of the long
  // line and strand its second half against "short two".
  assert.deepEqual(
    toSlides(['short one', 'Lifting my praise to You as a pleasing sacrifice', 'short two'], {
      maxLines: 2, maxChars: 40,
    }),
    [
      ['short one'],
      ['Lifting my praise to You', 'as a pleasing sacrifice'],
      ['short two'],
    ],
  );
});

test('an odd number of lines leaves a single line on the last slide', () => {
  assert.deepEqual(toSlides(['a', 'b', 'c'], { maxLines: 2, maxChars: 40 }), [
    ['a', 'b'], ['c'],
  ]);
});

test('honours a one-line-per-slide setting', () => {
  assert.deepEqual(toSlides(['a', 'b'], { maxLines: 1, maxChars: 40 }), [['a'], ['b']]);
});

test('a line wrapping to more lines than fit spills onto extra slides', () => {
  const slides = toSlides(['one two three four five six seven eight nine ten eleven twelve'], {
    maxLines: 2, maxChars: 12,
  });
  assert.ok(slides.length >= 3);
  assert.ok(slides.every((s) => s.length <= 2));
});

test('stays fast on a pathologically long line', () => {
  const long = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
  const started = Date.now();
  const pieces = wrapLine(long, 40);
  assert.ok(Date.now() - started < 2000, 'wrapLine should not blow up');
  assert.ok(pieces.every((p) => p.length <= 40));
});
