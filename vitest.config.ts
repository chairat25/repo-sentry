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
      exclude: [
        // Process entry point: argument parsing and dispatch only. Every branch
        // it takes calls into runCheck, hooks, or format, which are covered.
        'packages/cli/src/index.ts',
        // Editor API wiring. Its testable logic was deliberately extracted into
        // status-bar.ts, notifier.ts, messages.ts, and pull.ts — all covered.
        // Verified by launching the Extension Development Host instead.
        'packages/vscode-ext/src/extension.ts',
      ],
      thresholds: { lines: 80 },
    },
  },
});
