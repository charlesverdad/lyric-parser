# Lyric Parser

**Turn a PDF chord chart into ProPresenter song files, entirely in your browser.**

Drop in a song sheet — the two-column, chords-above-lyrics kind a worship team
prints — and get back one ProPresenter document per song, with the chords
stripped, the section headings kept, and the lyrics re-laid-out two lines to a
slide.

**[Open Lyric Parser](https://charlesverdad.github.io/lyric-parser/)**

## What it does

| Input (chord chart) | Output (slide) |
|---|---|
| `C                    G`<br>`  Oh, what a love is this` | `Oh, what a love is this` |
| `That rescues and for-gives?` | `That rescues and forgives?` |
| `overcome with joy I     sing` | `overcome with joy I sing` |
| `[Intro] C\|C\|D\|G/B\| x2` | *(instrumental — no slide)* |

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
- **Everything is editable** before you download, and every judgement call the
  parser made is listed above the results.

## Output format

ProPresenter 7 and later — including 18 and 21 — store `.pro` documents as
protocol buffers. This writes that format directly, with no protobuf runtime
shipped to the browser. A plain-text copy is written alongside, which
ProPresenter also imports and which survives any future change to the binary
format.

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

No backend. The PDF is read in the browser and never leaves the machine. The
only network requests are the initial page load and two libraries from cdnjs
(pdf.js and JSZip), which a Content-Security-Policy restricts the page to.

## License

MIT
