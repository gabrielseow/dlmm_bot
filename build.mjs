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
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/index.js',
  sourcemap: true,
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
