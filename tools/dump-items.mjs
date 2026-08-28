import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const wantPage = process.argv[3] ? Number(process.argv[3]) : null;
const data = new Uint8Array(readFileSync(path));
const doc = await getDocument({ data, useSystemFonts: false }).promise;

for (let p = 1; p <= doc.numPages; p++) {
  if (wantPage && p !== wantPage) continue;
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  console.log(`--- page ${p}  ${vp.width.toFixed(1)}x${vp.height.toFixed(1)} items=${tc.items.length}`);
  for (const it of tc.items) {
    if (!it.str) { continue; }
    const [a, b, c, d, x, y] = it.transform;
    console.log(`x=${x.toFixed(1).padStart(6)} y=${y.toFixed(1).padStart(6)} w=${(it.width||0).toFixed(1).padStart(6)} h=${(it.height||0).toFixed(1)} f=${it.fontName} eol=${it.hasEOL?1:0} :${JSON.stringify(it.str)}`);
  }
}
