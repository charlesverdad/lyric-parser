# lyric-parser — build progress

Goal: static site on GitHub Pages that turns a PDF chord chart into
ProPresenter `.pro` song files. Headings kept, chords stripped, max two lines
per slide, long lines split.

Live: https://charlesverdad.github.io/lyric-parser/

## Done

- [x] PR #1 `feat/pdf-extraction` — geometric text extraction, column detection
- [x] PR #3 `feat/reflow` — chord grammar, sections, groups, arrangements;
      hyphen rejoining, line wrapping, slide packing (carries PR #2's work)
- [x] PR #6 `feat/propresenter` — protobuf writer, RTF, `.pro` + `.txt`
      (replaces PR #4, which a stacked-merge mishap auto-closed)
- [x] PR #5 `feat/web-app` — browser UI, Pages workflow
- [x] PR #7 — CSP fix so pdf.js can load its worker off the main thread
- [x] 96 unit tests, all green in CI
- [x] `protoc --decode=rv.data.Presentation` validates every generated file,
      and `tools/check-pro.mjs` fails the build on unknown/reserved fields
- [x] Code-review findings from `/codex:review` and the code-reviewer agent
      all addressed
- [x] Merged to main; Pages deployed

## Verified on the deployed site

- [x] `connect-src` allows cdnjs, so pdf.js fetches its worker script and
      constructs exactly one `blob:` module Worker — no CSP violations
- [x] Full UI run over `fixtures/sample-input.pdf`: 6 songs, 108 slides
- [x] Every one of the 108 slides is ≤2 lines and ≤40 characters per line
- [x] Browser `.pro` bytes identical to the node CLI's for all 6 songs
      (SHA-256 match with a pinned uuid source and timestamp; the only
      non-deterministic field is the document timestamp, by design)

## Not verifiable here

- Opening a generated `.pro` in ProPresenter 18 itself. Everything short of
  that is checked: the schema, the wire format, and four real ProPresenter
  documents used as a reference.
