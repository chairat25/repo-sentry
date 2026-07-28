import { build } from 'esbuild';

// VS Code loads extensions as CommonJS, so bundle to .cjs and keep `vscode`
// external — the host provides it at runtime.
await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.cjs',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
  minify: process.env.NODE_ENV === 'production',
});
