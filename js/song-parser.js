/**
 * Turn reading-ordered PDF lines into structured songs.
 *
 * A chord chart is a flat sequence of lines with no structural markup, so
 * everything is recovered from shape:
 *
 *   - a title starts a new song (larger glyphs, or "1. Title (Key)" numbering)
 *   - "[Verse 1]" starts a section
 *   - a line whose every token is a chord is a chord line and is discarded
 *   - tempo, capo and performance notes are annotations and are discarded
 *   - everything else is a lyric
 *
 * Sections are then deduplicated into ProPresenter *groups* (each distinct
 * Verse/Chorus/Bridge once) plus an *arrangement* — the order they are played
 * in, including repeats. A section header with a chord progression and no
 * lyrics beneath it is instrumental and produces no slides; a header with no
 * lyrics whose name matches an earlier section is a repeat reference.
 */

import { isChordLine, isRealChord, stripInlineChords } from './chords.js';

/** Glyph size ratio above the body text that marks a song title. */
const TITLE_SIZE_RATIO = 1.15;

/** "1. ", "12) ", "C. " — a song number or set-position marker. */
const NUMBERING_RE = /^\s*([0-9]{1,3}|[A-Za-z])[.)]\s+(?=\S)/;

/** "[Chorus 1] x2" — a section header, optionally with a progression. */
const SECTION_RE = /^\[\s*([^\]]+?)\s*\]\s*(.*)$/;

/** "x2", "X3" — how many times a section is played. */
const REPEAT_RE = /(?:^|\s)[xX]\s*(\d+)\b/;

/** A musical key in a title, e.g. "(G)", "(A#)", "(Bbm)". */
const KEY_RE = /^[A-G][#b♯♭]?(?:m|min|maj|major|minor)?$/;

/** Lines that are performance directions rather than lyrics. */
const ANNOTATION_RES = [
  /^\d+\/\d+\b/, // time signature, e.g. "4/4 170 BPM"
  /^\d+\s*bpm\b/i,
  /^\(.*\)$/, // fully parenthesised aside, e.g. "(Play Chorus chords for prayer)"
  /^ends?\s+on\b/i,
  /^repeat\b/i,
  /^(?:fine|coda|tacet|outro|segue|rit\.?|a\s*tempo)$/i,
  /^d\.[cs]\.(?:\s|$)/i,
  /^capo\b/i,
  /^key\s*:/i,
  /^tempo\s*:/i,
  /^ccli\b/i,
  /^(?:©|\(c\)\s*\d)/i,
];

/** Is this line a performance direction rather than a lyric? */
export function isAnnotationLine(text) {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  return ANNOTATION_RES.some((re) => re.test(trimmed));
}

/**
 * Split "1. Yours Alone (G)" or "C. No Longer Slaves (A) – Capo 1" into parts.
 * Trailing parentheses are only read as a key when they actually contain one,
 * so a title like "Above All (Live)" keeps its parenthetical.
 */
export function parseTitle(raw) {
  let rest = raw.trim();
  let index = null;

  const numbered = rest.match(NUMBERING_RE);
  if (numbered) {
    index = numbered[1];
    rest = rest.slice(numbered[0].length).trim();
  }

  let note = null;
  const dash = rest.match(/\s+[–—-]\s+(.+)$/);
  if (dash) {
    note = dash[1].trim();
    rest = rest.slice(0, dash.index).trim();
  }

  let key = null;
  const paren = rest.match(/\(([^()]*)\)\s*$/);
  if (paren && KEY_RE.test(paren[1].trim())) {
    key = paren[1].trim();
    rest = rest.slice(0, paren.index).trim();
  }

  return { index, title: rest, key, note };
}

/** The most common glyph size across lines — the body text size. */
function bodySize(lines) {
  const counts = new Map();
  for (const line of lines) {
    const key = Math.round(line.size * 10) / 10;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [size, count] of counts) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

/** Split the line stream into one block per song. */
function splitIntoSongs(lines) {
  const body = bodySize(lines);
  const hasSizeCue = lines.some((l) => l.size > body * TITLE_SIZE_RATIO);

  const isTitle = (line) =>
    hasSizeCue
      ? line.size > body * TITLE_SIZE_RATIO
      : NUMBERING_RE.test(line.text) && !SECTION_RE.test(line.text);

  const songs = [];
  for (const line of lines) {
    if (isTitle(line) || songs.length === 0) {
      songs.push({ titleLine: isTitle(line) ? line.text : null, lines: [] });
      if (isTitle(line)) continue;
    }
    songs[songs.length - 1].lines.push(line);
  }
  return songs.filter((s) => s.titleLine !== null || s.lines.length > 0);
}

/** Walk a song's lines into raw, in-document-order sections. */
function readSections(lines) {
  const sections = [];
  let current = null;
  const open = (name, repeat, instrumental) => {
    current = { name, repeat, instrumental, lines: [] };
    sections.push(current);
  };

  for (const line of lines) {
    const header = line.text.match(SECTION_RE);
    if (header) {
      const trailer = header[2].trim();
      const repeat = Number(trailer.match(REPEAT_RE)?.[1] ?? 1);
      const progression = trailer.replace(REPEAT_RE, '').trim();
      const instrumental =
        progression !== '' &&
        progression.split(/\s+/).some((t) => isRealChord(t) || t.includes('|'));
      open(header[1], repeat, instrumental);
      continue;
    }
    if (isChordLine(line.text) || isAnnotationLine(line.text)) continue;

    const lyric = stripInlineChords(line.text);
    if (lyric === '') continue;
    if (!current) open('Verse 1', 1, false);
    current.lines.push(lyric);
  }
  return sections;
}

/**
 * Collapse raw sections into unique groups plus a play order.
 *
 * ProPresenter models a song as a set of groups (each Verse/Chorus once) and
 * an arrangement referencing them, so a chorus printed twice in the PDF
 * becomes one group cued twice rather than duplicated slides.
 */
function buildGroups(sections, warnings) {
  const groups = [];
  const arrangement = [];
  const byName = new Map();

  for (const section of sections) {
    const push = (name, times) => {
      for (let i = 0; i < times; i++) arrangement.push(name);
    };

    if (section.lines.length === 0) {
      // No lyrics: either a repeat reference to an earlier section, or an
      // instrumental break that has nothing to project.
      if (byName.has(section.name)) push(section.name, section.repeat);
      continue;
    }

    const existing = byName.get(section.name);
    if (!existing) {
      const group = { name: section.name, lines: section.lines };
      groups.push(group);
      byName.set(section.name, group);
      push(section.name, section.repeat);
      continue;
    }

    if (existing.lines.join('\n') === section.lines.join('\n')) {
      push(section.name, section.repeat);
      continue;
    }

    // Same heading, different words — keep both under distinct names so no
    // lyrics are silently dropped.
    let suffix = 2;
    while (byName.has(`${section.name} (${suffix})`)) suffix++;
    const name = `${section.name} (${suffix})`;
    const group = { name, lines: section.lines };
    groups.push(group);
    byName.set(name, group);
    push(name, section.repeat);
    warnings.push(
      `Section "${section.name}" appears more than once with different lyrics; kept the second as "${name}".`,
    );
  }

  return { groups, arrangement };
}

/**
 * @typedef {object} Song
 * @property {string|null} index    Song number or set marker ("1", "C").
 * @property {string} title
 * @property {string|null} key      Musical key from the title, e.g. "G".
 * @property {string|null} note     Trailing note, e.g. "Capo 1".
 * @property {{name: string, lines: string[]}[]} groups
 * @property {string[]} arrangement Group names in play order, repeats included.
 * @property {string[]} warnings
 */

/**
 * Parse extracted PDF lines into songs.
 *
 * @param {import('./pdf-text.js').Line[]} lines
 * @returns {Song[]}
 */
export function parseSongs(lines) {
  return splitIntoSongs(lines).map((block) => {
    const warnings = [];
    const meta = block.titleLine
      ? parseTitle(block.titleLine)
      : { index: null, title: 'Untitled', key: null, note: null };
    if (!block.titleLine) warnings.push('No song title was found; using "Untitled".');

    const sections = readSections(block.lines);
    const { groups, arrangement } = buildGroups(sections, warnings);
    if (groups.length === 0) warnings.push('No lyrics were found for this song.');

    return { ...meta, groups, arrangement, warnings };
  });
}
