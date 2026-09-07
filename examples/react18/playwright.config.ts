import { defineConfig } from '@playwright/test';
import integrationConfig from '../../packages/jieshu-core/__test__/integration/playwright.config.mts';

const reuseExistingServer = process.env['JIESHU_REUSE_EXISTING_SERVERS'] === '1';

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
  webServer: [
    ...(Array.isArray(integrationConfig.webServer) ? integrationConfig.webServer : []),
    {
      command: 'pnpm --filter react18 start',
      url: 'http://localhost:7900',
      reuseExistingServer,
    },
    {
      command: 'pnpm --filter main-react-ts exec rspack dev --mode development --port 7801 --no-open',
      url: 'http://localhost:7801',
      reuseExistingServer,
      timeout: 60_000,
    },
  ],
});
