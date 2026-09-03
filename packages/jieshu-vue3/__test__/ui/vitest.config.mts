import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const uiTests = resolve(packageRoot, '__test__/ui/**/*.test.ts');

export default defineConfig({
  plugins: [vue()],
  root: packageRoot,
  test: {
    name: 'jieshu-vue3-ui',
    clearMocks: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    include: [uiTests],
  },
});
