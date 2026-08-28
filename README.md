# Lyric Parser

**Turn a chord chart into ProPresenter song files, entirely in your browser.**

Drop in a song sheet — the two-column, chords-above-lyrics kind a worship team
prints — or just paste the lyrics in, and get back one ProPresenter document
per song, with the chords stripped, the section headings kept, and the lyrics
re-laid-out two lines to a slide. Copy the result straight into ProPresenter,
or download it as a `.pro` file.

**[Open Lyric Parser](https://charlesverdad.github.io/lyric-parser/)**

## What it does

| Input (chord chart) | Output (slide) |
|---|---|
| `C                    G`<br>`  Oh, what a love is this` | `Oh, what a love is this` |
| `That rescues and for-gives?` | `That rescues and forgives?` |
| `overcome with joy I     sing` | `overcome with joy I sing` |
| `[Intro] C\|C\|D\|G/B\| x2` | *(instrumental — no slide)* |

- **Takes a file or a paste.** Drop in a PDF, or paste the lyrics — chords and
  all — into the box. Both go through the same pipeline from the point the
  lines are read onward, so pasting a chart gives exactly what opening it does.
  A test holds the two together.
- **Reads the real layout.** Song sheets are usually two columns. Lines are
  rebuilt from glyph positions and read left column top-to-bottom, then right —
  not in whatever order the PDF happens to store them.
- **Strips the chords.** A line is chords when every token on it is one. The
  grammar is strict, so `All`, `And`, `Grace` and `Christ` stay in the lyrics
  while `F#m7b5`, `Esus`, `N.C.` and `C|C|D|G/B|` go.
- **Rebuilds the lines.** Syllable breaks are rejoined, chord-alignment padding
  collapses, and over-long lines split into two balanced halves that stay
  together on one slide.
- **Keeps the structure.** Verse, Chorus and Bridge become ProPresenter groups
  in their usual colours, with an arrangement that plays them back in printed
  order — repeats (`x2`, `x5`) included.
- **Everything is editable** before you export: type into any slide, add or
  remove slides with the controls on each card, and every judgement call the
  parser made is listed above the results. Clearing a slide leaves a
  placeholder you can type back into; removing one takes it away, and a section
  left with no slides drops out of both exports.

## Two ways in

**PDF.** Structure is recovered from glyph geometry: column gutters, reading
order, and title lines found by their size.

**Pasted text.** There is no geometry, so structure comes from the text itself
— chord lines above lyric lines, `[Verse 1]` headings, and `1. Title (Key)`
numbering. That is exactly the shape you get from selecting everything in a PDF
viewer and copying, so a paste and the file it came from parse the same. When a
paste has no numbering, the first line is taken as the title only if it is
followed by a blank line or a section heading — a paste that opens straight
into lyrics keeps every line.

## Output format

Two forms, both from the same laid-out songs:

**Import-ready text**, shown next to each song and copied with one click. A
blank line starts a new slide and `[Chorus 1]` names a group, which is what
ProPresenter's text import expects — so it can go straight in with no file
involved.

**A `.pro` document.** — including 18 and 21 — stores `.pro` documents as protocol buffers. This
writes that format directly, with no protobuf runtime shipped to the browser.
It carries the group colours and the arrangement, which plain text cannot.

Field definitions are the reverse-engineered ones from
[greyshirtguy/ProPresenter7-Proto](https://github.com/greyshirtguy/ProPresenter7-Proto),
vendored in `proto/`. They are unofficial and unsupported by Renewed Vision.

## Project layout

```
index.html          the app
styles.css
js/
  app.js            browser wiring: load, render, edit, download
  pipeline.js       the whole conversion, shared by app and CLI
  pdf-text.js       glyph positions -> reading-ordered lines
  text-input.js     pasted text -> the same lines
  chords.js         chord grammar
  song-parser.js    lines -> songs, sections, arrangements
  lyrics.js         syllable rejoining, padding collapse
  reflow.js         line wrapping and slide packing
  propresenter.js   the .pro document
  protobuf.js       minimal wire-format writer
  rtf.js            slide text
  plaintext.js      .txt export
proto/              vendored ProPresenter definitions (for validation)
tools/              CLI conversion and debugging aids
test/               unit tests, run with node --test
fixtures/           the sample song sheet everything is tested against
```

## Development

The project uses Nix for binary dependencies and `just` as the task runner:

```bash
nix-shell            # node, just, poppler, protoc
just                 # list tasks
just install
just test            # unit tests
just check           # tests + decode every generated .pro with protoc
just serve           # http://localhost:8080
just convert fixtures/sample-input.pdf out
```

`just check` is the one that matters: it converts the sample PDF and decodes
every generated document with `protoc --decode=rv.data.Presentation` against
the vendored protos, so a malformed file fails rather than reaching
ProPresenter.

Debugging aids for a PDF that parses badly:

```bash
just dump  input.pdf 3       # raw pdf.js text items for page 3
node tools/dump-lines.mjs  input.pdf   # reading-ordered lines
node tools/classify.mjs    input.pdf   # every line, labelled
node tools/dump-songs.mjs  input.pdf   # parsed songs
node tools/dump-slides.mjs input.pdf   # final slides
```

## Privacy

No backend. The PDF or pasted text is read in the browser and never leaves the
machine. The
only network requests are the initial page load and two libraries from cdnjs
(pdf.js and JSZip), which a Content-Security-Policy restricts the page to.

## License

MIT
