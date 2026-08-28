/**
 * Geometric text extraction for PDF song sheets.
 *
 * pdf.js hands back positioned text runs in content-stream order, which is not
 * reliable reading order for the multi-column layouts these chord charts use.
 * This module rebuilds lines from glyph positions, detects column gutters, and
 * emits lines in true reading order (full-width headings first, then each
 * column top-to-bottom within the band it belongs to).
 *
 * The only pdf.js-specific input is a page's `getTextContent()` result, so the
 * same code runs in the browser and under node in the test suite.
 */

/** Rows within this many points of each other are the same visual line. */
const ROW_TOLERANCE = 2.5;

/**
 * A gutter must be at least this wide (points) to split columns.
 *
 * Kept deliberately low: real gutters in tightly-set chord charts can be under
 * 10pt, so width alone cannot separate a gutter from an incidental chord gap.
 * `findGutters` additionally requires the gutter to line up with the left edge
 * of many rows, which is what actually distinguishes a column boundary.
 */
const MIN_GUTTER_WIDTH = 6;

/** A column boundary must start at least this fraction of the page's rows. */
const MIN_COLUMN_START_RATIO = 0.12;

/** Absolute floor on the number of rows starting at a column boundary. */
const MIN_COLUMN_START_ROWS = 3;

/** Tolerance (points) for a row's left edge matching a column boundary. */
const COLUMN_EDGE_TOLERANCE = 3;

/** Gutters are only looked for inside this fraction of the content width. */
const GUTTER_SEARCH_MARGIN = 0.15;

/** Histogram bin size (points) used for column-occupancy analysis. */
const BIN_SIZE = 2;

/**
 * @typedef {object} Line
 * @property {string} text     Reconstructed line text.
 * @property {number} page     1-based page number.
 * @property {number} column   0-based column index within the page.
 * @property {number} x        Left edge of the line.
 * @property {number} right    Right edge of the line.
 * @property {number} y        Baseline, in PDF units (larger = higher).
 * @property {number} size     Dominant glyph height on the line.
 */

/** Normalise a raw pdf.js text item into the shape the rest of the code uses. */
function toGlyphRun(item) {
  const x = item.transform[4];
  const y = item.transform[5];
  const width = item.width || 0;
  // `height` is 0 for whitespace-only runs; fall back to the transform scale.
  const size = item.height || Math.abs(item.transform[3]) || 0;
  return { str: item.str, x, y, width, size, blank: item.str.trim() === '' };
}

/** Group runs into visual rows by baseline. */
function groupIntoRows(runs) {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const run of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - run.y) <= ROW_TOLERANCE) {
      last.runs.push(run);
    } else {
      rows.push({ y: run.y, runs: [run] });
    }
  }
  for (const row of rows) {
    row.runs.sort((a, b) => a.x - b.x);
    const visible = row.runs.filter((r) => !r.blank);
    row.x = visible.length ? visible[0].x : row.runs[0].x;
    row.right = visible.length
      ? Math.max(...visible.map((r) => r.x + r.width))
      : row.x;
    row.size = dominantSize(visible);
  }
  return rows.filter((row) => row.runs.some((r) => !r.blank));
}

/** The glyph height covering the most horizontal space on a row. */
function dominantSize(runs) {
  const byHeight = new Map();
  for (const run of runs) {
    const key = Math.round(run.size * 10) / 10;
    byHeight.set(key, (byHeight.get(key) || 0) + Math.max(run.width, 1));
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, weight] of byHeight) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

/**
 * Join a row's runs into a string.
 *
 * Word gaps are recovered from geometry rather than from the run strings:
 * LibreOffice emits a run of N spaces as a single `" "` string whose width
 * encodes the real gap, so string content alone loses the separation.
 */
function renderRuns(runs) {
  let out = '';
  let cursor = null;
  for (const run of runs) {
    if (run.blank) {
      if (out !== '' && !out.endsWith(' ')) out += ' ';
      cursor = Math.max(cursor ?? run.x, run.x + run.width);
      continue;
    }
    if (cursor !== null && !out.endsWith(' ')) {
      const charWidth = run.str.length ? run.width / run.str.length : run.size * 0.5;
      const gap = run.x - cursor;
      if (gap >= Math.max(charWidth * 0.5, 0.8)) out += ' ';
    }
    out += run.str;
    cursor = run.x + run.width;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Find vertical gutters: x ranges with no glyphs on any row, bounded by
 * content on both sides.
 *
 * Chord charts have wide intra-line gaps (chords are sparse), so occupancy is
 * accumulated across every row on the page: a real gutter is empty on *all*
 * rows, whereas chord gaps are filled in by neighbouring lyric lines.
 */
export function findGutters(rows, { minWidth = MIN_GUTTER_WIDTH } = {}) {
  const bodyRows = rows.filter((r) => !r.fullWidthCandidate);
  const source = bodyRows.length ? bodyRows : rows;
  if (!source.length) return [];

  const left = Math.min(...source.map((r) => r.x));
  const right = Math.max(...source.map((r) => r.right));
  if (right - left < minWidth * 3) return [];

  const binCount = Math.ceil((right - left) / BIN_SIZE) + 1;
  const occupied = new Uint8Array(binCount);
  for (const row of source) {
    for (const run of row.runs) {
      if (run.blank) continue;
      const from = Math.floor((run.x - left) / BIN_SIZE);
      const to = Math.ceil((run.x + run.width - left) / BIN_SIZE);
      for (let i = Math.max(0, from); i < Math.min(binCount, to); i++) occupied[i] = 1;
    }
  }

  const searchFrom = left + (right - left) * GUTTER_SEARCH_MARGIN;
  const searchTo = right - (right - left) * GUTTER_SEARCH_MARGIN;
  const minStarts = Math.max(MIN_COLUMN_START_ROWS, source.length * MIN_COLUMN_START_RATIO);

  const gutters = [];
  let runStart = null;
  for (let i = 0; i <= binCount; i++) {
    const isEmpty = i < binCount && occupied[i] === 0;
    if (isEmpty && runStart === null) runStart = i;
    if (!isEmpty && runStart !== null) {
      const from = left + runStart * BIN_SIZE;
      const to = left + i * BIN_SIZE;
      const centre = (from + to) / 2;
      const wideEnough = to - from >= minWidth;
      const inSearchBand = centre > searchFrom && centre < searchTo;
      // The right edge of a true gutter is a column's left margin, so many
      // distinct lines begin there. An incidental gap between chords does not:
      // chords sit at whatever x their lyric syllable happens to fall on.
      const starts = source.filter((r) =>
        r.runs.some((run) => !run.blank && Math.abs(run.x - to) <= COLUMN_EDGE_TOLERANCE),
      ).length;
      if (wideEnough && inSearchBand && starts >= minStarts) {
        gutters.push({ from, to, centre, starts });
      }
      runStart = null;
    }
  }
  return gutters;
}

/** Column index for an x position given gutter centres. */
function columnFor(x, gutters) {
  let col = 0;
  for (const g of gutters) if (x >= g.centre) col++;
  return col;
}

/**
 * Order rows for reading: full-width rows act as band separators, and within
 * each band every column is read top-to-bottom in turn.
 */
function readingOrder(rows, gutters) {
  if (!gutters.length) {
    return rows.map((row) => ({ ...row, column: 0, runs: row.runs }));
  }

  /**
   * A row only spans the page if an oversized row (a title) crosses a gutter.
   * Body rows never legitimately cross one — the gutter is, by construction,
   * empty on every body row — so a body row with content on both sides is two
   * separate lines that merely share a baseline, and must be split.
   */
  const bands = [{ heading: null, lines: [] }];
  for (const row of rows) {
    const spansGutter = gutters.some((g) => row.x < g.from && row.right > g.to);
    if (spansGutter && row.fullWidthCandidate) {
      bands.push({ heading: row, lines: [] });
      continue;
    }
    const byColumn = new Map();
    for (const run of row.runs) {
      const col = columnFor(run.x, gutters);
      if (!byColumn.has(col)) byColumn.set(col, []);
      byColumn.get(col).push(run);
    }
    for (const [col, runs] of byColumn) {
      if (!runs.some((r) => !r.blank)) continue;
      const visible = runs.filter((r) => !r.blank);
      bands[bands.length - 1].lines.push({
        ...row,
        column: col,
        runs,
        x: visible[0].x,
        right: Math.max(...visible.map((r) => r.x + r.width)),
        size: dominantSize(visible),
      });
    }
  }

  const out = [];
  for (const band of bands) {
    if (band.heading) out.push({ ...band.heading, column: 0 });
    const columns = new Map();
    for (const line of band.lines) {
      if (!columns.has(line.column)) columns.set(line.column, []);
      columns.get(line.column).push(line);
    }
    for (const col of [...columns.keys()].sort((a, b) => a - b)) {
      out.push(...columns.get(col));
    }
  }
  return out;
}

/**
 * Extract reading-ordered lines from one page's text content.
 *
 * @param {{items: object[]}} textContent Result of `page.getTextContent()`.
 * @param {number} pageNumber 1-based page number.
 * @returns {Line[]}
 */
export function linesFromTextContent(textContent, pageNumber) {
  const runs = textContent.items
    .filter((it) => typeof it.str === 'string' && it.str !== '')
    .map(toGlyphRun);
  if (!runs.length) return [];

  const rows = groupIntoRows(runs);
  const bodySize = dominantSize(rows.flatMap((r) => r.runs.filter((x) => !x.blank)));
  // Oversized rows (titles) must not distort gutter detection.
  for (const row of rows) row.fullWidthCandidate = row.size > bodySize * 1.15;

  const gutters = findGutters(rows);
  return readingOrder(rows, gutters).map((row) => ({
    text: renderRuns(row.runs),
    page: pageNumber,
    column: row.column,
    x: row.x,
    right: row.right,
    y: row.y,
    size: row.size,
  }));
}

/**
 * Extract reading-ordered lines from every page of a pdf.js document.
 *
 * @param {object} pdfDoc A pdf.js `PDFDocumentProxy`.
 * @returns {Promise<Line[]>}
 */
export async function extractLines(pdfDoc) {
  const all = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent();
    all.push(...linesFromTextContent(content, p));
    page.cleanup?.();
  }
  return all.filter((line) => line.text !== '');
}
