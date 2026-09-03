import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launchArgs = (process.env['PLAYWRIGHT_LAUNCH_ARGS'] ?? '').split(/\s+/).filter(Boolean);
const reactMainWorkspace = process.env['WUJIE_REACT_MAIN_WORKSPACE'] ?? 'main-react';

const webServer = (workspace: string, script: string, port: number) => ({
  command: `pnpm --filter ${workspace} run ${script}`,
  cwd: repositoryRoot,
  url: `http://127.0.0.1:${port}`,
  reuseExistingServer: false,
  timeout: 60_000,
  stdout: 'ignore' as const,
  stderr: 'pipe' as const,
});

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.test.ts',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: '../../../../test-results/integration',
  use: {
    browserName: 'chromium',
    headless: true,
    launchOptions: launchArgs.length ? { args: launchArgs } : undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    webServer('react16', 'start', 7600),
    webServer('react17', 'start', 7100),
    webServer('vue2', 'start', 7200),
    webServer('vue3', 'start', 7300),
    webServer('vite', 'start', 7500),
    webServer('angular12', 'start', 7400),
    webServer(reactMainWorkspace, 'integration', 7700),
    webServer('main-vue', 'start', 8000),
  ],
});
