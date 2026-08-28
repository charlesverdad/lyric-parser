/**
 * Lyric clean-up.
 *
 * Chord charts spell lyrics for the musician, not the projector. Words are
 * broken at syllables so a chord can sit over the right beat ("for-gives",
 * "Re-deemed", "ac-cepted"), and words are padded with runs of spaces to line
 * up with chords. Neither belongs on a slide.
 */

/**
 * Hyphens that are part of the word rather than a syllable break.
 *
 * There is no reliable rule here: "for-gives" must be joined and "self-control"
 * must not, yet both are lowercase-hyphen-lowercase and both halves are real
 * words. Chord charts overwhelmingly use the hyphen as a syllable marker, so
 * joining is the right default; this list covers the compounds common enough
 * in worship lyrics to be worth special-casing, and every join is reported so
 * a wrong one is visible rather than silent.
 */
const COMPOUND_EXCEPTIONS = new Set([
  'self-control', 'self-same', 'christ-like', 'god-given', 'god-breathed',
  'ever-present', 'ever-flowing', 'ever-living', 'life-giving', 'blood-bought',
  'heaven-sent', 'new-born', 'well-spring', 'co-heir', 'co-heirs',
  'far-reaching', 'all-consuming', 'all-sufficient', 'never-ending',
  'ever-after', 'day-by-day', 'sin-sick', 'twenty-four', 'thirty-three',
]);

/**
 * A capitalised word of at least this length before a hyphen is treated as a
 * real compound ("Christ-like"), not a syllable break ("Re-deemed").
 */
const PROPER_PREFIX_MIN = 4;

/**
 * A whole hyphenated run, e.g. "for-gives" or "hal-le-lu-jah".
 *
 * Matching the entire run rather than one hyphen at a time matters: a pattern
 * that consumes the word to the right of the hyphen resumes past it, so every
 * second hyphen in a chain is missed and "hal-le-lu-jah" comes out as
 * "halle-lujah" - with the leftover hyphen going onto the slide.
 */
const HYPHEN_RUN_RE = /\p{L}[\p{L}’']*(?:-\p{Ll}[\p{L}’']*)+/gu;

/**
 * Rejoin syllable hyphens: "That rescues and for-gives?" -> "forgives".
 *
 * @returns {{text: string, joins: string[]}} joined text and what was joined
 */
export function rejoinSyllableHyphens(text) {
  const joins = [];
  const out = text.replace(HYPHEN_RUN_RE, (match) => {
    if (COMPOUND_EXCEPTIONS.has(match.toLowerCase())) return match;
    const [first] = match.split('-');
    // "Christ-like" keeps its hyphen; "Re-deemed" does not.
    const properPrefix =
      first.length >= PROPER_PREFIX_MIN && first[0] === first[0].toUpperCase();
    if (properPrefix) return match;
    const joined = match.replace(/-/g, '');
    joins.push(`${match} → ${joined}`);
    return joined;
  });
  return { text: out, joins };
}

/**
 * Normalise a single lyric line.
 *
 * @param {string} text
 * @param {{rejoinHyphens?: boolean, straightQuotes?: boolean}} [options]
 * @returns {{text: string, joins: string[]}}
 */
export function normalizeLine(text, options = {}) {
  const { rejoinHyphens = true, straightQuotes = false } = options;

  let out = text
    .replace(/ /g, ' ') // non-breaking spaces used for chord padding
    .replace(/\s+/g, ' ')
    .trim()
    // A space before punctuation is chord alignment leaking through.
    .replace(/\s+([,.;:!?])/g, '$1');

  let joins = [];
  if (rejoinHyphens) {
    const joined = rejoinSyllableHyphens(out);
    out = joined.text;
    joins = joined.joins;
  }

  if (straightQuotes) {
    out = out.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"');
  }

  return { text: out, joins };
}

/**
 * Normalise every lyric line of every group in a song.
 *
 * @param {import('./song-parser.js').Song} song
 * @param {object} [options] Passed through to `normalizeLine`.
 * @returns {import('./song-parser.js').Song} a new song, joins appended to notes
 */
export function normalizeSong(song, options = {}) {
  const joins = [];
  const groups = song.groups.map((group) => ({
    ...group,
    lines: group.lines.map((line) => {
      const result = normalizeLine(line, options);
      joins.push(...result.joins);
      return result.text;
    }),
  }));
  return { ...song, groups, hyphenJoins: joins };
}
