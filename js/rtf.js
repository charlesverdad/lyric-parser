/**
 * RTF generation for ProPresenter slide text.
 *
 * ProPresenter stores each slide's text as an RTF document rather than plain
 * characters, because the formatting travels with the text. The dialect is the
 * one Cocoa's text system produces on macOS: a line break inside a slide is a
 * backslash followed by a newline, and any character outside the ANSI range is
 * escaped as `\uN?` with a decimal UTF-16 code unit.
 */

/** Characters that are structural in RTF and must be escaped. */
const RESERVED = /[\\{}]/g;

/**
 * Escape one line of text for RTF.
 *
 * Non-ASCII becomes `\uN?` where N is the UTF-16 code unit as a *signed* 16-bit
 * value — RTF readers expect the signed form, so U+FEFF and friends come out
 * negative. Astral characters are emitted as their surrogate pair, which is
 * what Cocoa does.
 */
export function escapeRtf(text) {
  let out = '';
  for (const char of text.replace(RESERVED, (c) => `\\${c}`)) {
    const code = char.codePointAt(0);
    if (code < 0x80) {
      out += char;
      continue;
    }
    for (let i = 0; i < char.length; i++) {
      const unit = char.charCodeAt(i);
      out += `\\u${unit > 0x7fff ? unit - 0x10000 : unit}?`;
    }
  }
  return out;
}

/**
 * @typedef {object} TextStyle
 * @property {string} fontFamily   Font family name, e.g. "Arial".
 * @property {number} fontSize     Point size.
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {{red:number,green:number,blue:number}} [color] 0-1 components.
 * @property {'left'|'center'|'right'} [alignment]
 */

const ALIGNMENT_CONTROL = { left: '\\ql', center: '\\qc', right: '\\qr' };

/**
 * Build an RTF document for one slide.
 *
 * @param {string[]} lines One entry per projected line.
 * @param {TextStyle} style
 * @returns {Uint8Array} RTF bytes, ready for `Graphics.Text.rtf_data`
 */
export function slideRtf(lines, style) {
  const {
    fontFamily = 'Arial',
    fontSize = 60,
    bold = true,
    italic = false,
    color = { red: 1, green: 1, blue: 1 },
    alignment = 'center',
  } = style ?? {};

  const to255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const halfPoints = Math.round(fontSize * 2);

  const header =
    '{\\rtf1\\ansi\\ansicpg1252\\uc1\n' +
    `{\\fonttbl\\f0\\fnil\\fcharset0 ${escapeRtf(fontFamily)};}\n` +
    '{\\colortbl;' +
    `\\red${to255(color.red)}\\green${to255(color.green)}\\blue${to255(color.blue)};}\n`;

  const paragraph =
    `\\pard${ALIGNMENT_CONTROL[alignment] ?? '\\qc'}\\partightenfactor0\n` +
    `\\f0\\fs${halfPoints}${bold ? '\\b' : ''}${italic ? '\\i' : ''}\\cf1 `;

  // A backslash-newline is Cocoa's in-paragraph line break, which is what
  // ProPresenter writes for a multi-line slide.
  const body = lines.map(escapeRtf).join('\\\n');

  return new TextEncoder().encode(`${header}${paragraph}${body}}`);
}
