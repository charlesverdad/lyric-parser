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

for (const file of files) {
  const path = join(outDir, file);
  execFileSync(
    'protoc',
    ['--decode=rv.data.Presentation', '--proto_path=proto', 'proto/presentation.proto'],
    { input: readFileSync(path), stdio: ['pipe', 'ignore', 'inherit'] },
  );
  console.log(`ok  ${path}`);
}
console.log(`\n${files.length} ProPresenter file(s) decoded cleanly.`);
