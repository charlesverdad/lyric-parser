/**
 * Minimal protocol buffer *writer*.
 *
 * ProPresenter documents are protobuf, but this app only ever writes them and
 * always to the same fixed schema, so a full runtime plus a compiled
 * descriptor (several hundred KB) would be dead weight in a static site.
 * Encoding the wire format directly is about a hundred lines and ships nothing.
 *
 * Field numbers live in `js/propresenter.js`, taken from the vendored `.proto`
 * files in `proto/`. `tools/check-pro.mjs` decodes generated files with
 * `protoc` against those same definitions, so a mismatch fails CI.
 *
 * Follows proto3 rules: scalar fields equal to their default are omitted.
 */

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH = 2;

const textEncoder = new TextEncoder();

export class Writer {
  constructor() {
    /** @type {number[]} */
    this.bytes = [];
  }

  /** Raw base-128 varint. */
  varint(value) {
    let v = value;
    while (v > 0x7f) {
      this.bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.bytes.push(v);
    return this;
  }

  tag(field, wireType) {
    return this.varint(field * 8 + wireType);
  }

  /** uint32 / uint64 / enum. Omitted when zero. */
  uint(field, value) {
    if (!value) return this;
    return this.tag(field, WIRE_VARINT).varint(value);
  }

  /** Alias that reads better at call sites setting an enum. */
  enum(field, value) {
    return this.uint(field, value);
  }

  bool(field, value) {
    if (!value) return this;
    return this.tag(field, WIRE_VARINT).varint(1);
  }

  /** double (fixed64, little-endian IEEE-754). Omitted when zero. */
  double(field, value) {
    if (!value) return this;
    this.tag(field, WIRE_FIXED64);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, true);
    this.bytes.push(...new Uint8Array(buf));
    return this;
  }

  /** float (fixed32, little-endian). Omitted when zero. */
  float(field, value) {
    if (!value) return this;
    this.tag(field, 5);
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    this.bytes.push(...new Uint8Array(buf));
    return this;
  }

  string(field, value) {
    if (!value) return this;
    return this.bytes_(field, textEncoder.encode(value));
  }

  bytes_(field, value) {
    if (!value || value.length === 0) return this;
    this.tag(field, WIRE_LENGTH).varint(value.length);
    for (let i = 0; i < value.length; i++) this.bytes.push(value[i]);
    return this;
  }

  /**
   * Embedded message. `build` receives a fresh Writer; the field is skipped
   * when nothing is written to it, matching proto3's treatment of an unset
   * message.
   */
  message(field, build) {
    const inner = new Writer();
    build(inner);
    if (inner.bytes.length === 0) return this;
    return this.bytes_(field, inner.finish());
  }

  /**
   * Embedded message that is written even when empty.
   *
   * Needed where presence itself is the information: a rectangle path's
   * corner at the origin encodes as an empty message, and dropping it as
   * proto3 normally would leaves the rectangle with three corners.
   */
  emptyableMessage(field, build) {
    const inner = new Writer();
    build(inner);
    const payload = inner.finish();
    this.tag(field, WIRE_LENGTH).varint(payload.length);
    for (let i = 0; i < payload.length; i++) this.bytes.push(payload[i]);
    return this;
  }

  finish() {
    return Uint8Array.from(this.bytes);
  }
}

/** Encode a single message and return its bytes. */
export function encode(build) {
  const writer = new Writer();
  build(writer);
  return writer.finish();
}
