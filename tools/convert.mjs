/**
 * CLI conversion: PDF in, ProPresenter files out.
 *
 *   node tools/convert.mjs fixtures/sample-input.pdf out
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { songsFromPdf, toFiles } from '../js/pipeline.js';

const [, , input, outDir = 'out'] = process.argv;
if (!input) {
  console.error('usage: node tools/convert.mjs <input.pdf> [outDir]');
  process.exit(2);
}

const doc = await getDocument({ data: new Uint8Array(readFileSync(input)) }).promise;
const songs = await songsFromPdf(doc);

mkdirSync(outDir, { recursive: true });
for (const { song, pro, text } of toFiles(songs)) {
  writeFileSync(join(outDir, pro.name), pro.bytes);
  writeFileSync(join(outDir, text.name), text.text);
  const slides = song.groups.reduce((n, g) => n + g.slides.length, 0);
  console.log(`${pro.name.padEnd(40)} ${song.groups.length} groups, ${slides} slides`);
}
console.log(`\n${songs.length} song(s) written to ${outDir}/`);
