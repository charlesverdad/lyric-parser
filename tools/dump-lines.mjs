import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { extractLines } from '../js/pdf-text.js';

const data = new Uint8Array(readFileSync(process.argv[2]));
const doc = await getDocument({ data }).promise;
const lines = await extractLines(doc);
for (const l of lines) {
  console.log(`p${l.page} c${l.column} y=${l.y.toFixed(0).padStart(3)} s=${l.size.toFixed(0)} | ${l.text}`);
}
