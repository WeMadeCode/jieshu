import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const uiTests = resolve(packageRoot, '__test__/ui/**/*.test.ts');

export default defineConfig({
  root: packageRoot,
  test: {
    name: 'jieshu-react-ui',
    clearMocks: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    include: [uiTests],
  },
});
