// Bundle each test file with esbuild (same constraints as build.mjs:
// some deps ship ESM that relies on CommonJS-style directory imports, and
// the @meteora-ag/dlmm package's `source` field tricks tsx into loading
// raw .ts files), then run them with `node --test`.
//
// Test files: src/tests/**/*.spec.ts → dist/tests/<name>.spec.cjs

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'src/tests';
const OUT = 'dist/tests';

function findSpecs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...findSpecs(p));
    else if (name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const entries = findSpecs(SRC);
if (entries.length === 0) {
  console.log('No specs found.');
  process.exit(0);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// CJS output sidesteps both the ERR_UNSUPPORTED_DIR_IMPORT issue and
// node:test's experimental ESM loader bugs at this Node version.
await build({
  entryPoints: entries,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outdir: OUT,
  outbase: SRC,
  sourcemap: 'inline',
  outExtension: { '.js': '.cjs' },
  // node:test is a built-in; never bundle it.
  external: ['node:test', 'node:assert/strict', 'node:assert'],
});

const outFiles = entries.map((e) => {
  const rel = relative(SRC, e).replace(/\.ts$/, '.cjs');
  return join(OUT, rel);
});

const args = ['--test', ...outFiles];
const res = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(res.status ?? 1);
