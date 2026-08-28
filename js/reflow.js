/**
 * Slide layout.
 *
 * Two rules, both from how lyrics are actually projected:
 *
 *   1. At most N lines per slide (two by default).
 *   2. A line too wide for the screen is wrapped onto more lines.
 *
 * The order matters. Wrapping first and then packing blindly would put the
 * tail of one sentence on the same slide as the start of the next, so a
 * wrapped line stays together as a unit and takes its own slide.
 */

/** Default maximum characters on one projected line. */
export const DEFAULT_MAX_CHARS = 40;

/** Default maximum lines on one slide. */
export const DEFAULT_MAX_LINES = 2;

/**
 * Break `text` into `parts` pieces at word boundaries, as evenly as possible.
 *
 * Evenness matters visually: splitting "Lifting my praise to You as a pleasing
 * sacrifice" as 45 + 2 characters looks broken, 24 + 23 does not.
 *
 * Solved by dynamic programming over word indices — minimise the longest
 * piece — so cost stays polynomial no matter how long the line is.
 */
function balancedSplit(text, parts) {
  const words = text.split(' ').filter((w) => w !== '');
  if (parts <= 1 || words.length <= 1) return [text];
  const n = words.length;
  const k = Math.min(parts, n);

  // pieceLength[i][j] = rendered length of words[i..j)
  const pieceLength = [];
  for (let i = 0; i < n; i++) {
    pieceLength[i] = [];
    let total = -1;
    for (let j = i; j < n; j++) {
      total += words[j].length + 1;
      pieceLength[i][j + 1] = total;
    }
  }

  // best[p][i] = smallest achievable longest piece splitting words[i..n) into p
  const best = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(-1));
  for (let i = 0; i < n; i++) best[1][i] = pieceLength[i][n];
  for (let p = 2; p <= k; p++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j <= n - (p - 1); j++) {
        const longest = Math.max(pieceLength[i][j], best[p - 1][j]);
        if (longest < best[p][i]) {
          best[p][i] = longest;
          cut[p][i] = j;
        }
      }
    }
  }

  const pieces = [];
  let i = 0;
  for (let p = k; p > 1; p--) {
    const j = cut[p][i];
    if (j < 0) break;
    pieces.push(words.slice(i, j).join(' '));
    i = j;
  }
  pieces.push(words.slice(i).join(' '));
  return pieces;
}

/**
 * Wrap one lyric line to at most `maxChars` per line.
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]} one entry per projected line
 */
export function wrapLine(text, maxChars = DEFAULT_MAX_CHARS) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars || !trimmed.includes(' ')) return [trimmed];

  // Start from the fewest pieces that could possibly fit and widen a little;
  // a single word longer than maxChars can never fit and is left intact.
  const minParts = Math.max(2, Math.ceil(trimmed.length / maxChars));
  for (let parts = minParts; parts <= minParts + 2; parts++) {
    const pieces = balancedSplit(trimmed, parts);
    if (pieces.every((p) => p.length <= maxChars)) return pieces;
  }
  return balancedSplit(trimmed, minParts);
}

/**
 * Lay a group's lyric lines out into slides.
 *
 * @param {string[]} lines
 * @param {{maxLines?: number, maxChars?: number}} [options]
 * @returns {string[][]} slides, each an array of projected lines
 */
export function toSlides(lines, options = {}) {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  // A source line becomes one unit; wrapping keeps its pieces together so a
  // sentence is never split across a slide boundary.
  const units = lines
    .map((line) => wrapLine(line, maxChars))
    .filter((unit) => unit.length > 0 && unit.some((l) => l !== ''));

  const slides = [];
  let current = [];
  for (const unit of units) {
    if (unit.length > maxLines) {
      // A line that wraps to more lines than fit on a slide: flush, then give
      // it consecutive slides of its own.
      if (current.length) slides.push(current);
      current = [];
      for (let i = 0; i < unit.length; i += maxLines) {
        slides.push(unit.slice(i, i + maxLines));
      }
      continue;
    }
    if (current.length + unit.length > maxLines) {
      slides.push(current);
      current = [];
    }
    current.push(...unit);
  }
  if (current.length) slides.push(current);
  return slides;
}

/**
 * Lay out every group of a song.
 *
 * @param {import('./song-parser.js').Song} song
 * @param {object} [options]
 * @returns {import('./song-parser.js').Song & {groups: {name: string, slides: string[][]}[]}}
 */
export function layoutSong(song, options = {}) {
  return {
    ...song,
    groups: song.groups.map((group) => ({
      ...group,
      slides: toSlides(group.lines, options),
    })),
  };
}
