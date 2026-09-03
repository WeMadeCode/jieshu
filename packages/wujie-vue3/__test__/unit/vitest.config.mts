import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const unitTests = resolve(packageRoot, '__test__/unit/**/*.test.ts');

export default defineConfig({
  plugins: [vue()],
  root: packageRoot,
  test: {
    name: 'wujie-vue3',
    clearMocks: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    globals: true,
    include: [unitTests],
    coverage: {
      provider: 'istanbul',
      include: ['index.ts', 'WujieVue.vue'],
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
