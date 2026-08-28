import test from 'node:test';
import assert from 'node:assert/strict';
import { encode } from '../js/protobuf.js';
import { decodeProto, str } from './helpers.mjs';

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

test('encodes the canonical protobuf examples', () => {
  // From the protobuf encoding guide: field 1 varint 150, field 2 string.
  assert.equal(hex(encode((w) => w.uint(1, 150))), '08 96 01');
  assert.equal(
    hex(encode((w) => w.string(2, 'testing'))),
    '12 07 74 65 73 74 69 6e 67',
  );
});

test('omits proto3 default values', () => {
  assert.equal(encode((w) => w.uint(1, 0)).length, 0);
  assert.equal(encode((w) => w.bool(1, false)).length, 0);
  assert.equal(encode((w) => w.string(1, '')).length, 0);
  assert.equal(encode((w) => w.double(1, 0)).length, 0);
});

test('encodes varints larger than 32 bits', () => {
  const decoded = decodeProto(encode((w) => w.uint(1, 1787887680)));
  assert.equal(decoded[1][0], 1787887680);
});

test('round-trips doubles and floats', () => {
  assert.equal(decodeProto(encode((w) => w.double(1, 1920)))[1][0], 1920);
  assert.ok(Math.abs(decodeProto(encode((w) => w.float(1, 0.27)))[1][0] - 0.27) < 1e-6);
});

test('skips an embedded message with nothing in it', () => {
  assert.equal(encode((w) => w.message(1, () => {})).length, 0);
});

test('emits an emptyable message even when empty', () => {
  assert.equal(hex(encode((w) => w.emptyableMessage(1, () => {}))), '0a 00');
});

test('encodes UTF-8 strings by byte length, not character count', () => {
  const decoded = decodeProto(encode((w) => w.string(1, 'I’m Yours')));
  assert.equal(str(decoded, 1), 'I’m Yours');
});

test('repeated fields accumulate in order', () => {
  const decoded = decodeProto(encode((w) => {
    w.string(3, 'a');
    w.string(3, 'b');
    w.string(3, 'c');
  }));
  assert.deepEqual(decoded[3].map((b) => new TextDecoder().decode(b)), ['a', 'b', 'c']);
});

test('encodes a negative int64 as a full ten-byte varint', () => {
  // Emitting a negative value as if unsigned yields an unterminated varint
  // that no decoder can read.
  assert.equal(hex(encode((w) => w.uint(1, -1))), '08 ff ff ff ff ff ff ff ff ff 01');
  const decoded = encode((w) => w.uint(1, -1234567));
  assert.equal(decoded.length, 11);
});

test('rejects values it cannot encode losslessly', () => {
  assert.throws(() => encode((w) => w.uint(1, 2 ** 60)), RangeError);
  assert.throws(() => encode((w) => w.double(1, NaN)), RangeError);
  assert.throws(() => encode((w) => w.double(1, Infinity)), RangeError);
  assert.throws(() => encode((w) => w.float(1, NaN)), RangeError);
});

test('does not mistake NaN for a proto3 default', () => {
  // `if (!value)` silently drops NaN as though it were zero.
  assert.throws(() => encode((w) => w.double(1, NaN)), RangeError);
});
