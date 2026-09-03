import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/jieshu-core/__test__/unit/vitest.config.mts',
      'packages/jieshu-react/__test__/unit/vitest.config.mts',
      'packages/jieshu-vue3/__test__/unit/vitest.config.mts',
    ],
    coverage: {
      provider: 'istanbul',
      reportsDirectory: 'coverage/unit',
      reporter: ['text', 'text-summary'],
      thresholds: {
        'packages/jieshu-react/src/index.tsx': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'packages/jieshu-vue3/src/index.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'packages/jieshu-vue3/src/JieshuVue.vue': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
