import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLines, linesFromTextContent } from '../js/pdf-text.js';
import { sampleDocument, item } from './helpers.mjs';

test('reconstructs a line from positioned glyph runs', () => {
  const lines = linesFromTextContent(
    { items: [item('All we adore', 314, 521), item(' ', 386, 521, { width: 24 }), item('forever-more', 410, 521)] },
    1,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'All we adore forever-more');
});

test('does not insert a space between adjacent glyph runs', () => {
  // "(", "C", ")" are emitted as three abutting runs by LibreOffice.
  const lines = linesFromTextContent(
    { items: [item('(', 232.7, 816, { width: 8.4, size: 14 }), item('C', 241.1, 816, { width: 8.4, size: 14 }), item(')', 249.4, 816, { width: 8.4, size: 14 })] },
    1,
  );
  assert.equal(lines[0].text, '(C)');
});

test('collapses runs of padding spaces to a single space', () => {
  const lines = linesFromTextContent(
    { items: [item('overcome with joy I', 14, 100), item(' ', 128, 100, { width: 30 }), item('sing', 158, 100)] },
    1,
  );
  assert.equal(lines[0].text, 'overcome with joy I sing');
});

test('treats a single column page as one column', () => {
  const items = [
    item('All that I am, all that I have', 14, 751),
    item('I lay them down before You, o Lord', 14, 726),
    item('All my regrets, all my acclaim', 14, 700),
  ];
  const lines = linesFromTextContent({ items }, 1);
  assert.deepEqual(lines.map((l) => l.column), [0, 0, 0]);
});

test('splits two columns and reads left column fully before the right', () => {
  const items = [];
  for (let i = 0; i < 6; i++) {
    items.push(item(`left line number ${i}`, 14, 700 - i * 13));
    items.push(item(`right line number ${i}`, 302, 700 - i * 13));
  }
  const lines = linesFromTextContent({ items }, 1);
  assert.equal(lines.length, 12);
  assert.ok(lines.slice(0, 6).every((l) => l.text.startsWith('left')));
  assert.ok(lines.slice(6).every((l) => l.text.startsWith('right')));
});

test('a wide chord gap is not mistaken for a column gutter', () => {
  // Chords are sparse, but every gap is covered by some other row's lyrics.
  const items = [
    item('Em', 44, 700, { width: 12 }),
    item('C', 140, 700, { width: 6 }),
    item('To make Your glory known', 14, 687, { width: 144 }),
    item('D', 140, 674, { width: 6 }),
    item('For we are not our own', 14, 661, { width: 132 }),
    item('You saved us to proclaim', 14, 648, { width: 144 }),
  ];
  const lines = linesFromTextContent({ items }, 1);
  assert.ok(lines.every((l) => l.column === 0), 'expected a single column');
});

test('extracts the real sample PDF in reading order', async () => {
  const doc = await sampleDocument();
  const lines = await extractLines(doc);

  // Six songs, one per page, each titled in a larger font.
  const titles = lines.filter((l) => l.size > 12).map((l) => l.text);
  assert.deepEqual(titles, [
    '1. Yours Alone (G)',
    '2. Good and Gracious King (C)',
    '3. More Like Jesus (C)',
    'C. No Longer Slaves (A) – Capo 1',
    'C. No Longer Slaves (A#)',
    'O. I Offer My Life (D)',
  ]);

  // Pages 1-5 are two-column, page 6 is single-column.
  for (const page of [1, 2, 3, 4, 5]) {
    const cols = new Set(lines.filter((l) => l.page === page).map((l) => l.column));
    assert.deepEqual([...cols].sort(), [0, 1], `page ${page} should have 2 columns`);
  }
  const page6 = new Set(lines.filter((l) => l.page === 6).map((l) => l.column));
  assert.deepEqual([...page6], [0]);
});

test('right column content follows left column content on the same page', async () => {
  const doc = await sampleDocument();
  const lines = await extractLines(doc);
  const page1 = lines.filter((l) => l.page === 1);
  const lastLeft = page1.findLastIndex((l) => l.column === 0);
  const firstRight = page1.findIndex((l) => l.column === 1);
  assert.ok(lastLeft < firstRight, 'all left-column lines must precede right-column lines');
  assert.equal(page1[lastLeft].text, '[Interlude] C|C|D|D|G/B|G/B|Em|D|');
  assert.equal(page1[firstRight].text, '[Bridge]');
});
