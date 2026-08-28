import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { extractLines } from '../js/pdf-text.js';
import { parseSongs } from '../js/song-parser.js';
import { normalizeSong } from '../js/lyrics.js';
import { layoutSong } from '../js/reflow.js';

const maxChars = Number(process.argv[3] ?? 40);
const maxLines = Number(process.argv[4] ?? 2);
const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise;
const songs = parseSongs(await extractLines(doc))
  .map((s) => normalizeSong(s))
  .map((s) => layoutSong(s, { maxChars, maxLines }));

for (const song of songs) {
  const slideCount = song.groups.reduce((n, g) => n + g.slides.length, 0);
  console.log(`\n═══ ${song.title} (${song.key ?? '?'}) — ${song.groups.length} groups, ${slideCount} slides`);
  if (song.hyphenJoins.length) console.log(`    joined: ${[...new Set(song.hyphenJoins)].join(', ')}`);
  for (const g of song.groups) {
    console.log(`  ┌─ ${g.name}`);
    g.slides.forEach((slide, i) => {
      console.log(`  │  ${String(i + 1).padStart(2)}. ${slide[0]}`);
      slide.slice(1).forEach((l) => console.log(`  │      ${l}`));
    });
  }
}
