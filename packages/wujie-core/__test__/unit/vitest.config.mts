import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const unitTests = resolve(packageRoot, '__test__/unit/**/*.test.ts');
const setupFile = resolve(packageRoot, '__test__/unit/vitest.setup.ts');

export default defineConfig({
  root: packageRoot,
  test: {
    name: 'wujie-core',
    clearMocks: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    globals: true,
    include: [unitTests],
    setupFiles: [setupFile],
    coverage: {
      provider: 'istanbul',
      reportsDirectory: 'coverage/unit',
      reporter: ['text', 'text-summary'],
    },
  },
});
