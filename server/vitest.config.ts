import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Plugin unit tests live in the plugin's own folder: plugins/<id>/tests/.
    include: ['tests/**/*.test.ts', '../plugins/**/tests/*.test.ts'],
    exclude: ['tests/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
