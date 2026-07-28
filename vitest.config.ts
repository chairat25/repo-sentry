import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve to source, not dist. Without this, the cli and vscode-ext test
      // suites would fail until `pnpm --filter @repo-sentry/core build` had run.
      '@repo-sentry/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // Tests spawn real git processes against temp directories.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      thresholds: { lines: 80 },
    },
  },
});
