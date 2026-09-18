import { defineConfig, type Plugin } from 'vitest/config';

// Plugin component test files (in each plugin's own tests folder) live
// outside client/tsconfig.json, so the oxc transform falls back to the
// classic JSX runtime (emitting React.createElement) and would fail with
// "React is not defined". Inject a React import so the classic output
// resolves. (Keep this comment free of the "star-slash" sequence — esbuild
// parses the config and would otherwise terminate the comment early.)
function pluginTestJsxRuntime(): Plugin {
  return {
    name: 'plugin-test-jsx-runtime',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/plugins/') || !id.endsWith('.tsx')) return null;
      if (/^\s*import\s+React\s+from\s+['"]react['"]/.test(code)) return null;
      return {
        code: `import React from 'react';\n${code}`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [pluginTestJsxRuntime()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      // Client-side plugin tests: component tests (.tsx) live directly in the
      // plugin's tests/ folder; non-component plugin tests (.ts) belong to the
      // server half and run under the server's vitest config — client .ts
      // plugin tests (e.g. ui/api unit tests) go in tests/client/.
      '../plugins/**/tests/**/*.test.tsx',
      '../plugins/**/tests/client/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
