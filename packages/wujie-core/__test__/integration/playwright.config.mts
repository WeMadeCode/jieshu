import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { defineConfig } from '@playwright/test';

const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const lernaExecutable = resolve(repositoryRoot, 'node_modules/.bin/lerna');
const launchArgs = (process.env['PLAYWRIGHT_LAUNCH_ARGS'] ?? '').split(/\s+/).filter(Boolean);

const webServer = (command: string, port: number) => ({
  command: `${lernaExecutable} ${command}`,
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
    webServer('run start --scope react16', 7600),
    webServer('run start --scope react17', 7100),
    webServer('run start --scope vue2', 7200),
    webServer('run start --scope vue3', 7300),
    webServer('run start --scope vite', 7500),
    webServer('run start --scope angular12', 7400),
    webServer('run integration --scope main-react', 7700),
    webServer('run start --scope main-vue', 8000),
  ],
});
