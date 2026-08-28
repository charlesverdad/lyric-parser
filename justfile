# lyric-parser - PDF song sheets -> ProPresenter files

default:
    @just --list

# Install dev dependencies
install:
    npm install

# Run the unit test suite
test:
    node --test test/

# Run a single test file, e.g. `just test-one parser`
test-one NAME:
    node --test test/{{NAME}}.test.mjs

# Serve the static site locally on :8080
serve:
    npx --yes serve -l 8080 .

# Dump pdf.js text items for a PDF (debugging aid)
dump PDF PAGE="":
    node tools/dump-items.mjs {{PDF}} {{PAGE}}

# Convert a PDF from the CLI into ./out
convert PDF OUT="out":
    node tools/convert.mjs {{PDF}} {{OUT}}

# Decode a generated .pro with protoc to verify it is a valid Presentation
verify-pro FILE:
    protoc --decode=rv.data.Presentation \
      --proto_path=proto \
      proto/presentation.proto < {{FILE}} | head -100

# Full check: tests + round-trip protoc validation of the sample fixture
check: test
    node tools/convert.mjs fixtures/sample-input.pdf out
    for f in out/*.pro; do \
      echo "== $f"; \
      protoc --decode=rv.data.Presentation --proto_path=proto proto/presentation.proto < "$f" > /dev/null \
        || exit 1; \
    done
    @echo "All generated .pro files decode cleanly."
