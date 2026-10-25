import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Maps TEST_DATABASE_URL onto DATABASE_URL (and refuses to run without it).
    setupFiles: ['tests/helpers/integrationEnv.ts'],
    // Plugin integration tests live in the plugin's own folder: plugins/<id>/tests/integration/.
    include: ['tests/integration/**/*.test.ts', '../plugins/**/tests/integration/**/*.test.ts'],
    // Integration suites share a single test database; run files sequentially.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage-integration',
    },
  },
});
