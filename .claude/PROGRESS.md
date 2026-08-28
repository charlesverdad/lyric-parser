# lyric-parser — build progress

Goal: static site on GitHub Pages that turns a PDF chord chart into
ProPresenter `.pro` song files. Headings kept, chords stripped, max two lines
per slide, long lines split.

## Done

- [x] PR #1 `feat/pdf-extraction` — geometric text extraction, column detection
- [x] PR #2 `feat/song-parser` — chord grammar, sections, groups, arrangements
- [x] PR #3 `feat/reflow` — hyphen rejoining, line wrapping, slide packing
- [x] PR #4 `feat/propresenter` — protobuf writer, RTF, `.pro` + `.txt`
- [x] PR #5 `feat/web-app` — browser UI, Pages workflow
- [x] 76 unit tests, all green in CI
- [x] `protoc --decode=rv.data.Presentation` validates every generated file
- [x] Browser output byte-identical to node CLI output

## Remaining

- [ ] Address code-review findings
- [ ] Merge the stack into main (in order: 1 → 2 → 3 → 4 → 5)
- [ ] Enable GitHub Pages and confirm the deployed site converts the fixture
- [ ] Write `.claude/LEARNINGS.md`
- [ ] Delete the keep-alive cron job

## Notes

- Dev shell: `nix-shell`; tasks: `just test`, `just check`, `just serve`
- The one thing that cannot be verified here: opening a generated `.pro` in
  ProPresenter 18 itself. Flag this to the user.
