import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';

// Bundles @repo-sentry/core and minimatch inline, so the output runs as a
// single file with no node_modules — that's what makes it downloadable on
// its own as a GitHub Release asset, with no clone and no `npm link` needed.
// No `banner` here: src/index.ts already starts with its own shebang, and
// esbuild preserves an entry point's shebang as the output's first line on
// its own. Adding banner too produced two `#!` lines — a syntax error, since
// node only treats line one specially.
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist-standalone/repo-sentry.cjs',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: true,
});

await chmod('dist-standalone/repo-sentry.cjs', 0o755);
