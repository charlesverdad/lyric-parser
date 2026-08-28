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

/**
 * Minimal protobuf reader for assertions.
 *
 * Decodes wire format into `{ [fieldNumber]: value[] }` without a schema, so
 * tests can assert the shape of generated documents. Length-delimited fields
 * are returned as raw bytes; call `sub()` to descend into a nested message.
 */
export function decodeProto(bytes) {
  const out = {};
  let i = 0;
  const varint = () => {
    let result = 0;
    let shift = 1;
    for (;;) {
      const b = bytes[i++];
      result += (b & 0x7f) * shift;
      if ((b & 0x80) === 0) return result;
      shift *= 128;
    }
  };
  while (i < bytes.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key & 7;
    let value;
    if (wire === 0) value = varint();
    else if (wire === 1) { value = new DataView(bytes.buffer, bytes.byteOffset + i, 8).getFloat64(0, true); i += 8; }
    else if (wire === 5) { value = new DataView(bytes.buffer, bytes.byteOffset + i, 4).getFloat32(0, true); i += 4; }
    else if (wire === 2) { const len = varint(); value = bytes.subarray(i, i + len); i += len; }
    else throw new Error(`unsupported wire type ${wire}`);
    (out[field] ??= []).push(value);
  }
  return out;
}

/** Descend into a nested message: `sub(msg, 12, 0)` = field 12, first entry. */
export const sub = (msg, field, index = 0) => decodeProto(msg[field][index]);

/** Read a length-delimited field as a UTF-8 string. */
export const str = (msg, field, index = 0) =>
  new TextDecoder().decode(msg[field][index]);

/** A deterministic UUID source so generated files are byte-reproducible. */
export function fakeUuids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;
}
