import { defineConfig } from '@playwright/test';

const launchArgs = (process.env['PLAYWRIGHT_LAUNCH_ARGS'] ?? '').split(/\s+/).filter(Boolean);

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.test.mts',
  timeout: 30_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../../../../test-results/core-browser',
  use: {
    browserName: 'chromium',
    headless: true,
    launchOptions: launchArgs.length ? { args: launchArgs } : undefined,
    trace: 'retain-on-failure',
  },
});
