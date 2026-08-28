import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FIXTURE = fileURLToPath(
  new URL('../fixtures/sample-input.pdf', import.meta.url),
);

let cached;

/** Load the sample chord chart once and share it across test files. */
export async function sampleDocument() {
  if (!cached) {
    const data = new Uint8Array(readFileSync(FIXTURE));
    cached = await getDocument({ data }).promise;
  }
  return cached;
}

/** Build a fake pdf.js text item at a given position. */
export function item(str, x, y, { width, size = 10 } = {}) {
  return {
    str,
    width: width ?? str.length * size * 0.6,
    height: str.trim() === '' ? 0 : size,
    transform: [size, 0, 0, size, x, y],
  };
}
