/** Confirms the node pipeline produces byte-identical output to the browser. */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { songsFromPdf } from '../js/pipeline.js';
import { buildPresentation } from '../js/propresenter.js';

const doc = await getDocument({ data: new Uint8Array(readFileSync('fixtures/sample-input.pdf')) }).promise;
const songs = await songsFromPdf(doc);
let n = 0;
const uuid = () => '00000000-0000-4000-8000-' + String(n++).padStart(12, '0');
const bytes = buildPresentation(songs[0], { uuid, now: new Date('2026-01-01T00:00:00Z') });
console.log(JSON.stringify({
  songs: songs.length,
  title: songs[0].title,
  slides: songs[0].groups.reduce((a, g) => a + g.slides.length, 0),
  proBytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}));
