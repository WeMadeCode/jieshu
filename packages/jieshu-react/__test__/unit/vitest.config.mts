import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const unitTests = resolve(packageRoot, '__test__/unit/**/*.test.ts');

export default defineConfig({
  root: packageRoot,
  test: {
    name: 'jieshu-react-unit',
    clearMocks: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    globals: true,
    include: [unitTests],
    coverage: {
      provider: 'istanbul',
      include: ['src/index.tsx'],
      reportsDirectory: 'coverage/unit',
      reporter: ['text', 'text-summary'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
