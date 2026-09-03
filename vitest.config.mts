import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/wujie-core/__test__/unit/vitest.config.mts',
      'packages/wujie-react/__test__/unit/vitest.config.mts',
      'packages/wujie-vue3/__test__/unit/vitest.config.mts',
    ],
    coverage: {
      provider: 'istanbul',
      reportsDirectory: 'coverage/unit',
      reporter: ['text', 'text-summary'],
      thresholds: {
        'packages/wujie-react/index.tsx': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'packages/wujie-vue3/index.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'packages/wujie-vue3/WujieVue.vue': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
