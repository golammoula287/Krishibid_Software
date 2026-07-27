import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // One replica set for the whole run (see globalSetup.ts).
    globalSetup: ['./src/test/globalSetup.ts'],
    setupFiles: ['./src/test/setup.ts'],
    // The database is a single shared resource and the concurrency tests assert on
    // global state (bid counts, ledger totals). Running files in parallel against
    // one database would make them flaky for reasons unrelated to the code.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/scripts/**', 'src/**/*.test.ts', 'src/server.ts'],
    },
  },
  resolve: {
    alias: {
      // path.resolve (not new URL().pathname) — the latter yields "/D:/..." on
      // Windows, which Vite cannot resolve.
      '@krishibid/shared': path.resolve(here, '../shared/src/index.ts'),
    },
  },
});
