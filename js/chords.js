/**
 * Chord recognition.
 *
 * Chord charts interleave a chord line above each lyric line. Nothing marks
 * them structurally — they are ordinary text — so they are identified by
 * grammar: a line is a chord line when every token on it is a chord, a bar
 * separator, or a repeat marker.
 *
 * The grammar is deliberately strict about what may follow the root note.
 * Lyrics are full of words starting with A-G, and a loose pattern happily
 * swallows "All", "And", "Grace" or "Christ". Requiring the remainder to be
 * built only from real chord qualities and extensions rejects all of those
 * while still accepting F#m7b5, Dsus4, A#sus and C/E.
 */

const ROOT = '[A-G][#b♯♭]?';
const QUALITY = '(?:maj|min|sus|dim|aug|add|alt|m|M|°|ø|Δ|\\+)';
const EXTENSION = '(?:[0-9]+|[#b][0-9]+)';

const CHORD_RE = new RegExp(
  `^${ROOT}(?:${QUALITY}|${EXTENSION})*(?:/${ROOT})?$`,
);

/** Repeat markers written beside a section or progression, e.g. "x2". */
const REPEAT_RE = /^[xX]\s*\d+$/;

/** "No chord" — a rest in the progression. */
const NO_CHORD_RE = /^(?:N\.?C\.?|NC)$/i;

/** Performance annotations that sit on a chord line, e.g. "(Hold G)". */
const HOLD_RE = /^\(?(?:hold|let\s+ring|stop|tacet|break)\b/i;

/**
 * Is this token a chord (or chord-line furniture)?
 *
 * Handles bar-separated progressions ("C|C|D|G/B|"), parenthesised chords
 * ("(C)"), repeat markers and "N.C.".
 */
export function isChordToken(token) {
  const cleaned = token.trim().replace(/[,;]+$/, '');
  if (cleaned === '') return true;
  if (cleaned === '|' || /^[|]+$/.test(cleaned)) return true;
  if (/^[-–—]+$/.test(cleaned)) return true;
  if (REPEAT_RE.test(cleaned)) return true;
  if (NO_CHORD_RE.test(cleaned)) return true;

  // A bar-separated progression: every non-empty segment must be a chord.
  if (cleaned.includes('|')) {
    const parts = cleaned.split('|').filter((p) => p !== '');
    return parts.length > 0 && parts.every((p) => isChordToken(p));
  }

  const unwrapped = cleaned.replace(/^\(+/, '').replace(/\)+$/, '');
  if (unwrapped === '') return false;
  return CHORD_RE.test(unwrapped);
}

/** Does this token name an actual chord (not just furniture)? */
export function isRealChord(token) {
  const cleaned = token.trim().replace(/[,;]+$/, '').replace(/^\(+/, '').replace(/\)+$/, '');
  if (NO_CHORD_RE.test(cleaned)) return true;
  if (cleaned.includes('|')) {
    return cleaned.split('|').some((p) => p !== '' && CHORD_RE.test(p));
  }
  return CHORD_RE.test(cleaned);
}

/**
 * Is this whole line a chord line?
 *
 * Requires every token to be chord-line furniture *and* at least one token to
 * be a real chord, so a stray "x2" on its own is not treated as chords.
 */
export function isChordLine(text) {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if (HOLD_RE.test(trimmed)) return true;
  const tokens = trimmed.split(/\s+/);
  if (!tokens.every(isChordToken)) return false;
  return tokens.some(isRealChord);
}

/**
 * Strip chord annotations that are written inline with lyrics, e.g. the
 * bracketed ChordPro style "[C]Amazing [F]grace". Chord charts in the sample
 * use the two-line style instead, but inline charts are common enough that
 * handling them costs one regex.
 */
export function stripInlineChords(text) {
  return text
    .replace(/\[[^\]]*\]/g, (match) => {
      const inner = match.slice(1, -1).trim();
      return inner !== '' && isChordToken(inner) ? '' : match;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}
