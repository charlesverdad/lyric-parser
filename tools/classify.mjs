/** Debug aid: classify every extracted line of a PDF. */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { extractLines } from '../js/pdf-text.js';
import { isChordLine } from '../js/chords.js';

const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise;
const lines = await extractLines(doc);
const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
const bodySize = sizes[Math.floor(sizes.length / 2)];
for (const l of lines) {
  let kind = 'LYRIC';
  if (l.size > bodySize * 1.15) kind = 'TITLE';
  else if (/^\[.+?\]/.test(l.text)) kind = 'SECTION';
  else if (isChordLine(l.text)) kind = 'chord';
  console.log(kind.padEnd(8) + '| ' + l.text);
}
