/**
 * Adapter for pasted lyrics.
 *
 * The PDF path recovers structure from glyph geometry. Pasted text has no
 * geometry, so every line is given the same size and the structure comes from
 * the text itself: "[Verse 1]" headers, chord lines above lyric lines, and
 * "1. Title (Key)" numbering. That is exactly what you get when you select all
 * in a PDF viewer and copy, so a paste and the original file parse the same.
 *
 * The output is the same `Line` shape `pdf-text.js` produces, so `parseSongs`
 * and everything downstream is shared between the two inputs.
 */

import { isChordLine } from './chords.js';
import { isAnnotationLine } from './song-parser.js';

/** Nominal glyph size for pasted body text. Any constant would do. */
const BODY_SIZE = 10;

/**
 * Size given to an inferred title.
 *
 * Must exceed `BODY_SIZE * TITLE_SIZE_RATIO` (1.15) so `song-parser` reads it
 * as a title the same way it reads an oversized heading in a PDF.
 */
const TITLE_SIZE = 14;

/** "1. ", "12) ", "C. " — the numbering that marks a title in a song book. */
const NUMBERING_RE = /^(?:[0-9]{1,3}|[A-Za-z])[.)]\s+\S/;

/** "[Verse 1]" — a section header. */
const SECTION_RE = /^\[[^\]]+\]/;

/**
 * Would this line be thrown away as a chord line or a performance direction?
 *
 * Used to look past "4/4 170 BPM" when deciding whether the first line of a
 * paste is a title, since a tempo marking commonly sits between the two.
 */
const isNoise = (text) => text === '' || isChordLine(text) || isAnnotationLine(text);

/**
 * Does the first line of a paste read as a song title?
 *
 * Only asked when nothing in the paste is numbered, so there is no other
 * candidate. The test is deliberately conservative: a title is a line that is
 * not itself structure, and that is *followed* by structure — a blank line or
 * a section header. A paste that opens straight into lyrics has no title, and
 * guessing one would eat a real line of the song.
 *
 * @param {string[]} lines Trimmed lines, blanks included.
 * @returns {boolean}
 */
export function firstLineIsTitle(lines) {
  const start = lines.findIndex((l) => l !== '');
  if (start === -1) return false;

  const candidate = lines[start];
  if (SECTION_RE.test(candidate) || isNoise(candidate)) return false;

  // A blank immediately below separates a heading from the body.
  if (lines[start + 1] !== undefined && lines[start + 1] === '') return true;

  // Otherwise the next line that carries structure has to be a section header,
  // looking past a tempo or capo marking on the way.
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '' || isNoise(lines[i])) continue;
    return SECTION_RE.test(lines[i]);
  }
  return false;
}

/**
 * Turn pasted text into the `Line` records the song parser consumes.
 *
 * @param {string} text Raw pasted text.
 * @returns {import('./pdf-text.js').Line[]}
 */
export function linesFromText(text) {
  const all = String(text ?? '')
    .split(/\r\n|\r|\n/)
    // A paste out of a PDF viewer carries non-breaking spaces where the
    // original had chord padding; they are word gaps, not characters.
    .map((line) => line.replace(/[   ]/g, ' ').trim());

  // Numbering is the strongest signal and the only one that can mark *several*
  // titles, so it wins outright; the single-title guess is the fallback.
  const numbered = all.some((line) => NUMBERING_RE.test(line) && !SECTION_RE.test(line));
  const titleAt = numbered || !firstLineIsTitle(all) ? -1 : all.findIndex((l) => l !== '');

  return all
    .map((line, index) => ({
      text: line,
      page: 1,
      column: 0,
      x: 0,
      right: line.length,
      // Later lines sit lower on the page, and y grows upward in PDF space.
      y: -index,
      size: index === titleAt ? TITLE_SIZE : BODY_SIZE,
    }))
    .filter((line) => line.text !== '');
}
