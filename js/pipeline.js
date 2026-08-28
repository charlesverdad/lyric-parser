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
export function toTextFile(song) {
  return { name: textFileName(song), text: songToText(song) };
}

/**
 * Make a list of filenames unique by numbering collisions.
 *
 * A PDF can hold two songs with the same title and key - or two blocks that
 * both fall back to "Untitled" - and without this one silently overwrites the
 * other on disk, or becomes a duplicate entry in the zip that most extractors
 * discard.
 */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot === -1 ? name : name.slice(0, dot);
    const extension = dot === -1 ? '' : name.slice(dot);
    return `${stem} (${count + 1})${extension}`;
  });
}

/**
 * Render every song to a `.pro` and a `.txt`, with collision-free names.
 *
 * @param {object[]} songs Laid-out songs.
 * @param {object} [options] Passed through to the ProPresenter builder.
 * @returns {{song: object, pro: {name: string, bytes: Uint8Array}, text: {name: string, text: string}}[]}
 */
export function toFiles(songs, options = {}) {
  const proNames = uniqueNames(songs.map((s) => proFileName(s)));
  const textNames = uniqueNames(songs.map((s) => textFileName(s)));
  return songs.map((song, i) => ({
    song,
    pro: { name: proNames[i], bytes: buildPresentation(song, options) },
    text: { name: textNames[i], text: songToText(song) },
  }));
}
