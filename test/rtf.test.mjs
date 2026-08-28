import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeRtf, slideRtf } from '../js/rtf.js';

const decode = (bytes) => new TextDecoder().decode(bytes);

test('escapes RTF control characters', () => {
  assert.equal(escapeRtf('a\\b{c}d'), 'a\\\\b\\{c\\}d');
});

test('escapes non-ASCII as decimal UTF-16 code units', () => {
  assert.equal(escapeRtf('I’m'), 'I\\u8217?m');
  assert.equal(escapeRtf('oh – oh'), 'oh \\u8211? oh');
});

test('leaves plain ASCII alone', () => {
  assert.equal(escapeRtf('We are Yours alone'), 'We are Yours alone');
});

test('writes font size in half-points', () => {
  const rtf = decode(slideRtf(['x'], { fontFamily: 'Arial', fontSize: 64 }));
  assert.match(rtf, /\\fs128\b/);
});

test('separates slide lines with a Cocoa line break', () => {
  const rtf = decode(slideRtf(['first line', 'second line'], { fontSize: 60 }));
  assert.match(rtf, /first line\\\nsecond line/);
});

test('emits a well-formed document with font and colour tables', () => {
  const rtf = decode(slideRtf(['x'], { fontFamily: 'Helvetica', fontSize: 40, color: { red: 1, green: 0, blue: 0 } }));
  assert.ok(rtf.startsWith('{\\rtf1\\ansi'));
  assert.ok(rtf.endsWith('}'));
  assert.match(rtf, /\\fonttbl\\f0\\fnil\\fcharset0 Helvetica;/);
  assert.match(rtf, /\\red255\\green0\\blue0;/);
});

test('honours alignment', () => {
  assert.match(decode(slideRtf(['x'], { alignment: 'left' })), /\\pard\\ql/);
  assert.match(decode(slideRtf(['x'], { alignment: 'center' })), /\\pard\\qc/);
});
