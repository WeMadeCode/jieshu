import { defineConfig } from '@playwright/test';
import integrationConfig from '../../packages/jieshu-core/__test__/integration/playwright.config.mts';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  outputDir: '../../test-results/react18',
  use: {
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: integrationConfig.webServer,
});
