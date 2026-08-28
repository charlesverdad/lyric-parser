/**
 * The whole conversion, front to back.
 *
 * Shared by the browser app and the CLI in `tools/` so both exercise exactly
 * the same code path — the CLI is what CI validates against `protoc`.
 */

import { extractLines } from './pdf-text.js';
import { parseSongs } from './song-parser.js';
import { normalizeSong } from './lyrics.js';
import { layoutSong } from './reflow.js';
import { buildPresentation, proFileName } from './propresenter.js';
import { songToText, textFileName } from './plaintext.js';

/**
 * @typedef {object} ConvertOptions
 * @property {number} [maxLines]        Max lines per slide (default 2).
 * @property {number} [maxChars]        Max characters per line (default 40).
 * @property {boolean} [rejoinHyphens]  Rejoin syllable hyphens (default true).
 * @property {boolean} [straightQuotes] Convert curly quotes to ASCII.
 */

/**
 * Parse a PDF into laid-out songs, ready to render or export.
 *
 * @param {object} pdfDoc A pdf.js `PDFDocumentProxy`.
 * @param {ConvertOptions} [options]
 */
export async function songsFromPdf(pdfDoc, options = {}) {
  const lines = await extractLines(pdfDoc);
  return parseSongs(lines)
    .map((song) => normalizeSong(song, options))
    .map((song) => layoutSong(song, options));
}

/** Render one laid-out song to its `.pro` file. */
export function toProFile(song, options = {}) {
  return { name: proFileName(song), bytes: buildPresentation(song, options) };
}

/** Render one laid-out song to a plain-text file. */
export function toTextFile(song, options = {}) {
  return {
    name: textFileName(song),
    text: songToText(song, options),
  };
}
