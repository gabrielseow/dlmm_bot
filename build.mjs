import { build } from 'esbuild';

// We bundle with esbuild instead of emitting per-file with tsc because some
// dependencies (@meteora-ag/dlmm, @coral-xyz/anchor) ship an ESM build that
// relies on CommonJS-style directory imports (e.g. `import ".../utils/bytes"`).
// Strict Node ESM rejects those (ERR_UNSUPPORTED_DIR_IMPORT). esbuild resolves
// every import at build time into one self-contained file `node` can run.
//
// The banner re-creates the CommonJS globals that bundled CJS deps expect but
// that don't exist in an ESM output: `require`, `__filename`, `__dirname`.
await build({
  entryPoints: [
    'src/index.ts',
    'src/cli/sim-backtest.ts',
    'src/cli/sim-report.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: 'dist',
  outbase: 'src',
  sourcemap: true,
  // better-sqlite3 is a native N-API addon; esbuild can't bundle it. Left
  // external so it loads from node_modules at runtime (used by the
  // forthcoming persistence layer; safe to mark external pre-emptively).
  external: ['better-sqlite3'],
  banner: {
    js: [
      "import { createRequire } from 'module';",
      "import { fileURLToPath } from 'url';",
      "import { dirname } from 'path';",
      'const require = createRequire(import.meta.url);',
      'const __filename = fileURLToPath(import.meta.url);',
      'const __dirname = dirname(__filename);',
    ].join('\n'),
  },
});
