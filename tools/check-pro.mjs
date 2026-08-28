/**
 * End-to-end guard: convert the sample PDF and decode every generated `.pro`
 * with `protoc` against the vendored ProPresenter definitions. If protoc can
 * parse the bytes as an `rv.data.Presentation`, the wire format and every
 * field number are right.
 *
 * Skips with a warning when protoc is unavailable so the unit suite still runs
 * on a bare machine.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function hasProtoc() {
  try {
    execFileSync('protoc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!hasProtoc()) {
  console.warn('protoc not found - skipping ProPresenter wire-format validation');
  process.exit(0);
}

const outDir = process.argv[3] ?? 'out';
execFileSync('node', ['tools/convert.mjs', process.argv[2] ?? 'fixtures/sample-input.pdf', outDir], {
  stdio: 'inherit',
});

const files = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.pro')) : [];
if (!files.length) {
  console.error('No .pro files were produced.');
  process.exit(1);
}

/**
 * protoc prints a field it cannot name as "  12: value". That happens when a
 * field number does not exist in the schema, or lands on a reserved one - and
 * crucially it does *not* make protoc exit non-zero, so decoding successfully
 * is not on its own proof that every field number is right.
 */
const UNKNOWN_FIELD = /^\s*\d+: /;

let failed = false;
for (const file of files) {
  const path = join(outDir, file);
  const decoded = execFileSync(
    'protoc',
    ['--decode=rv.data.Presentation', '--proto_path=proto', 'proto/presentation.proto'],
    { input: readFileSync(path), stdio: ['pipe', 'pipe', 'inherit'], encoding: 'utf8' },
  );

  const unknown = [...new Set(decoded.split('\n').filter((l) => UNKNOWN_FIELD.test(l)))];
  if (unknown.length) {
    console.error(`FAIL ${path}: ${unknown.length} field(s) protoc could not name:`);
    for (const line of unknown.slice(0, 10)) console.error(`       ${line.trim()}`);
    failed = true;
    continue;
  }
  console.log(`ok  ${path}`);
}

if (failed) {
  console.error('\nA field number is wrong or reserved. Check js/propresenter.js against proto/.');
  process.exit(1);
}
console.log(`\n${files.length} ProPresenter file(s) decoded cleanly.`);
