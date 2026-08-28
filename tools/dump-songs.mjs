import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { extractLines } from '../js/pdf-text.js';
import { parseSongs } from '../js/song-parser.js';

const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise;
const songs = parseSongs(await extractLines(doc));
for (const s of songs) {
  console.log(`\n### ${s.index ?? '-'} | ${s.title} | key=${s.key ?? '-'} | note=${s.note ?? '-'}`);
  console.log(`arrangement: ${s.arrangement.join(' > ')}`);
  for (const g of s.groups) {
    console.log(`  [${g.name}]`);
    for (const l of g.lines) console.log(`    ${l}`);
  }
  for (const w of s.warnings) console.log(`  ! ${w}`);
}
