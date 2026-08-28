# Learnings — lyric-parser

Notes worth carrying into similar work. Concise on purpose.

## PDF text extraction

- `pdf.js` `getTextContent()` returns runs in **content-stream order**, which is
  not reading order. For multi-column chord charts you must rebuild lines from
  `transform[4]`/`transform[5]` yourself. See `js/pdf-text.js`.
- **Detect gutters by accumulating x-occupancy across every row on the page**,
  not per row. A chord line is mostly whitespace, so per-row gaps are
  meaningless; a true gutter is empty on *all* rows.
- Width alone cannot identify a gutter — real ones can be under 10pt while an
  incidental chord gap is 8pt. The reliable signal is that a gutter's right edge
  is a column's left margin, so **many distinct lines start there**.
- A body row that appears to span a gutter is really two lines sharing a
  baseline; split it. Only oversized (title) rows legitimately span.
- LibreOffice emits N spaces as a single `" "` run whose *width* encodes the
  gap, so recover word spacing from geometry, not from string content.
- A Chinese-OSS ML pipeline (MinerU / PaddleOCR) is the right tool for *scanned*
  PDFs, but it is Python + models, i.e. server-side. It cannot ship to GitHub
  Pages, and it is unnecessary when the PDF has an exact embedded text layer.

## Chord vs lyric discrimination

- Lyrics beginning with A–G are the whole problem: "All", "And", "As", "Grace",
  "Christ", "Amen", "Add". Use a **strict chord grammar** (root + quality +
  extension + optional bass), and require a line to contain **at least one real
  chord** before classifying it as a chord line.
- Score direction words (`hold`, `let ring`, `tacet`) **per token**, not per
  line, or "Break every chain" gets eaten.
- Beware over-eager cleanup rules. Each of these deleted real lyrics:
  `/^repeat\b/i` ate "Repeat the sounding joy"; `/^\(.*\)$/` ate "(Oh oh oh)";
  "out"/"only"/"time" in a directive keyword list ate "(sing it out)".
- `[C]Amazing [F]grace` is inline ChordPro, not a section named "C". Guard on
  "brackets contain a chord **and** text follows on the same line".
- Match the **whole** hyphenated run when rejoining syllables, or "hal-le-lu-jah"
  becomes "halle-lujah". Keep an exceptions set so "Christ-like" survives.

## Pasted text as a second input

- A PDF viewer's "select all and copy" produces **chord lines above lyric
  lines, `[Verse 1]` headings and `1. Title (Key)` numbering** — the same
  structure the PDF path recovers from geometry. So a paste adapter only has to
  emit the same `Line` records and everything downstream is shared for free.
  `js/text-input.js` is 100 lines because of this.
- Assert the equivalence in a test (`songsFromText(paste)` deepEqual
  `songsFromPdf(file)`), or the two inputs will silently drift apart.
- Without numbering there is no reliable title signal, so **only** treat the
  first line as a title when a blank line or a section heading follows it.
  Guessing costs you a real lyric line; not guessing costs you a filename.
- A paste out of a PDF carries **non-breaking spaces** where chord padding was.
  Normalise them or they survive into the lyrics as odd characters.
- Anything that separates blocks with a blank line becomes **a slide** on
  import. That rules out title banners and footers inside the text — the same
  trap `plaintext.js` documents. A multi-song "copy all" cannot be both
  import-clean and self-labelling; pick one and say which.

## ProPresenter `.pro` files

- ProPresenter **7 and later (17, 18, 19, 21) are protobuf**, not the XML of
  `.pro6`. Do not go looking for XML.
- The document model is **unique groups + an arrangement that references them in
  play order**. A chorus sung three times is one group cued three times — do not
  emit three copies.
- `protoc --decode` **exits zero on unknown and reserved fields**, printing them
  as bare `N: value`. That is not validation. `tools/check-pro.mjs` greps for
  `^\s*\d+: ` and fails — that is what caught `Action.Label.text` being written
  to reserved field 1 instead of field 2.
- Validate against **real documents**, not only the schema. Four files written by
  a real ProPresenter build revealed `Slide.Element.info = 2` on every text
  element and the correct cue-naming convention.
- proto3 omits empty messages, which silently drops meaningful ones: a rectangle
  path's `(0,0)` corner and a fully-transparent `Fill.color`. Needed an explicit
  `emptyableMessage` that forces a zero-length field to be written.
- Hand-rolled varints: negative int64 must be emitted as the **full ten-byte
  two's-complement** form (`BigInt.asUintN(64, …)`). Emitting it unsigned
  produces an unterminated varint and an undecodable document.
- Guard the writer against `NaN` and unsafe integers. `if (!value)` silently
  swallows `NaN`; values above 2^53 round without complaint.
- RTF is the **Cocoa dialect**: `\fs` in half-points, `\uN?` with *signed*
  UTF-16 units, and backslash-newline for an in-paragraph line break.

## Browser / GitHub Pages

- **A Worker can never be constructed cross-origin.** pdf.js works around this by
  `fetch`-ing its worker script and running it from a `blob:` URL. So a CSP needs
  the CDN in **`connect-src`**, not just `script-src`, plus `worker-src blob:`.
  Get this wrong and pdf.js *silently* falls back to main-thread parsing and
  freezes the page — no error, just a hang.
- Verify a CSP change against the **deployed** page with a cache-busting query
  string; the browser will happily keep serving the pre-fix HTML.
- To prove a fix rather than assume it, instrument the constructor:
  `window.Worker = class extends Worker { constructor(u, o) { log(u, o); super(u, o); } }`
  and listen for `securitypolicyviolation`.
- For a static site with no build step, keep the pipeline as plain ES modules so
  the browser and the node CLI import **literally the same files**. Byte-parity
  then becomes a real test: pin the uuid source and timestamp, hash both sides.

## Process

- `node --test test/` fails ("resolves the directory as a module specifier").
  Glob instead: `node --test test/*.test.mjs`.
- Squash-merging a **stacked** PR chain with `--delete-branch` auto-closes the
  downstream PRs when their base branch disappears. The commits survive; recover
  with `git rebase --onto main <old-base> <branch>` and reopen. Better: retarget
  each PR to `main` *before* merging the one below it.
- A zero value in a layout limit (`maxLines: 0`) made the overflow loop advance by
  zero and spin until V8 OOMed. Floor user-supplied limits at 1.
