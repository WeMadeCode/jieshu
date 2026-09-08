import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

interface AsyncLoadSnapshot {
  trace: string[];
  state: string;
}
interface AsyncLoadFixture {
  snapshot(): AsyncLoadSnapshot;
  finished(): Promise<void>;
  destroy(): Promise<void>;
  unmount(): Promise<void>;
}
declare global {
  interface Window {
    __asyncLoadFixture?: AsyncLoadFixture;
  }
}
let server: ViteDevServer | undefined;
let origin: string;

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../../..', import.meta.url)),
    appType: 'custom',
    server: { host: '127.0.0.1', port: 0 },
  });
  server.middlewares.use((request, response, next) => {
    if (request.url !== '/') {
      next();
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head></head><body><main id="app"></main></body></html>');
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    throw new Error('The async load regression server must expose a local URL');
  }
  origin = url;
});

test.afterAll(async () => {
  await server?.close();
});

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
};

const initialize = async (page: Page, mode: string, fiber: boolean) => {
  await page.goto(origin);
  await page.evaluate(
    async ({ mode, fiber }) => {
      const coreUrl = '/packages/jieshu-core/src/index.ts';
      const commonUrl = '/packages/jieshu-core/src/common.ts';
      const { startApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
      const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
      const trace: string[] = [];
      let state = 'pending';
      const name = 'async-load';
      const asyncScript =
        mode === 'inline'
          ? '<script async type="module">import "/fixtures/async.js"; globalThis.__asyncRecord("inline");</script>'
          : `<script async ${mode.startsWith('module') ? 'type="module"' : ''} src="/fixtures/async.js"></script>`;
      const options = {
        name,
        url: `${location.origin}/`,
        el: '#app',
        fiber,
        html: `<html><head><script>
        window.__JIESHU_MOUNT = () => window.__asyncRecord('mount');
        window.__JIESHU_UNMOUNT = () => {};
        window.addEventListener('DOMContentLoaded', () => window.__asyncRecord('dcl'));
        window.addEventListener('load', () => window.__asyncRecord('load'));
      </script>${asyncScript}${mode === 'multiple' ? '<script async type="module" src="/fixtures/second.js"></script>' : ''}</head>
      <body>async load</body></html>`,
        beforeLoad: (appWindow: Window) => {
          Reflect.set(appWindow, '__asyncRecord', (value: string) => trace.push(value));
        },
        plugins: mode === 'native' || mode === 'error' ? [{ jsIgnores: [`${location.origin}/fixtures/async.js`] }] : [],
        fetch:
          mode === 'fallback'
            ? async (input: RequestInfo) => {
                if (String(input).endsWith('/fixtures/async.js')) {
                  throw new Error('expected fetch failure before native retry');
                }
                return fetch(input);
              }
            : undefined,
        loadError: () => trace.push('fetch-error'),
      };
      const starting = startApp(options).then((handler) => {
        state = typeof handler === 'function' ? 'started' : 'cancelled';
      });
      window.__asyncLoadFixture = {
        snapshot: () => ({ trace: [...trace], state }),
        finished: () => starting,
        destroy: () => destroyApp(name),
        unmount: async () => {
          await getJieshuById(name)?.unmount();
        },
      };
    },
    { mode, fiber },
  );
};

const snapshot = (page: Page) => page.evaluate(() => window.__asyncLoadFixture?.snapshot());

for (const fiber of [false, true]) {
  for (const mode of ['fetch', 'native', 'module', 'fallback', 'error', 'module-error']) {
    test(`initial async ${mode} settles before window load without holding DOMContentLoaded (fiber=${fiber})`, async ({
      page,
    }) => {
      const gate = deferred();
      const requested = deferred();
      const requestKinds: string[] = [];
      const fails = mode === 'error' || mode === 'module-error';
      await page.route('**/fixtures/async.js', async (route) => {
        requestKinds.push(route.request().resourceType());
        requested.resolve();
        await gate.promise;
        await route.fulfill({
          status: fails ? 404 : 200,
          contentType: 'text/javascript',
          body: fails ? '' : 'globalThis.__asyncRecord("async");',
        });
      });
      await initialize(page, mode, fiber);
      await requested.promise;
      await expect.poll(async () => (await snapshot(page))?.trace).toContain('dcl');
      const pending = await snapshot(page);
      gate.resolve();
      if (!fails) {
        await expect.poll(async () => (await snapshot(page))?.trace).toContain('async');
      }
      await page.evaluate(() => window.__asyncLoadFixture?.finished());
      const completed = await snapshot(page);
      await page.evaluate(() => window.__asyncLoadFixture?.destroy());

      expect(requestKinds).toEqual([mode === 'fetch' ? 'fetch' : 'script']);
      expect(pending?.state).toBe('pending');
      expect(pending?.trace).not.toContain('load');
      expect(pending?.trace).not.toContain('async');
      expect(completed?.state).toBe('started');
      expect(completed?.trace.filter((event) => event === 'dcl')).toHaveLength(1);
      expect(completed?.trace.filter((event) => event === 'load')).toHaveLength(1);
      expect(completed?.trace.indexOf('load')).toBeGreaterThan(completed?.trace.indexOf('dcl') ?? -1);
      if (!fails) {
        expect(completed?.trace.indexOf('load')).toBeGreaterThan(completed?.trace.indexOf('async') ?? -1);
      }
    });
  }
}

test('window load waits for every initial async outcome, including the last native error', async ({ page }) => {
  const firstGate = deferred();
  const secondGate = deferred();
  const secondRequested = deferred();
  await page.route('**/fixtures/async.js', async (route) => {
    await firstGate.promise;
    await route.fulfill({ contentType: 'text/javascript', body: 'globalThis.__asyncRecord("async");' });
  });
  await page.route('**/fixtures/second.js', async (route) => {
    secondRequested.resolve();
    await secondGate.promise;
    await route.fulfill({ status: 404, contentType: 'text/javascript', body: '' });
  });
  await initialize(page, 'multiple', true);
  await secondRequested.promise;
  await expect.poll(async () => (await snapshot(page))?.trace).toContain('dcl');
  firstGate.resolve();
  await expect.poll(async () => (await snapshot(page))?.trace).toContain('async');
  const pending = await snapshot(page);
  secondGate.resolve();
  await page.evaluate(() => window.__asyncLoadFixture?.finished());
  const completed = await snapshot(page);
  await page.evaluate(() => window.__asyncLoadFixture?.destroy());
  expect(pending?.state).toBe('pending');
  expect(pending?.trace).not.toContain('load');
  expect(completed?.state).toBe('started');
  expect(completed?.trace.filter((event) => event === 'load')).toHaveLength(1);
});

test('async external module load observes native evaluation start without awaiting top-level await', async ({
  page,
}) => {
  await page.route('**/fixtures/async.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `globalThis.__asyncRecord('async');
        await new Promise((resolve) => { globalThis.__releaseAsyncAwait = resolve; });
        globalThis.__asyncRecord('await-end');`,
    }),
  );
  await initialize(page, 'module', true);
  await page.evaluate(() => window.__asyncLoadFixture?.finished());
  const loaded = await snapshot(page);
  await page.evaluate(async () => {
    const commonUrl = '/packages/jieshu-core/src/common.ts';
    const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
    const appWindow = getJieshuById('async-load')?.iframe.contentWindow;
    const release: unknown = appWindow && Reflect.get(appWindow, '__releaseAsyncAwait');
    if (typeof release !== 'function') {
      throw new Error('The async module must expose its pending await continuation');
    }
    release();
  });
  await expect.poll(async () => (await snapshot(page))?.trace).toContain('await-end');
  await page.evaluate(() => window.__asyncLoadFixture?.destroy());
  expect(loaded?.state).toBe('started');
  expect(loaded?.trace).toContain('async');
  expect(loaded?.trace).toContain('load');
  expect(loaded?.trace).not.toContain('await-end');
});

test('explicit async inline modules keep their scheduled boundary and native module syntax', async ({ page }) => {
  const gate = deferred();
  const requested = deferred();
  await page.route('**/fixtures/async.js', async (route) => {
    requested.resolve();
    await gate.promise;
    await route.fulfill({ contentType: 'text/javascript', body: 'export const value = 7;' });
  });
  await initialize(page, 'inline', true);
  await requested.promise;
  await page.evaluate(() => window.__asyncLoadFixture?.finished());
  const scheduled = await snapshot(page);
  gate.resolve();
  await expect.poll(async () => (await snapshot(page))?.trace).toContain('inline');
  await page.evaluate(() => window.__asyncLoadFixture?.destroy());
  expect(scheduled?.state).toBe('started');
  expect(scheduled?.trace).toContain('dcl');
  expect(scheduled?.trace).toContain('load');
  expect(scheduled?.trace).not.toContain('inline');
});

for (const mode of ['fetch', 'native']) {
  for (const stopping of ['destroy', 'unmount']) {
    test(`${stopping} cancels initial async ${mode} without a late load`, async ({ page }) => {
      const gate = deferred();
      const requested = deferred();
      const requestKinds: string[] = [];
      await page.route('**/fixtures/async.js', async (route) => {
        requestKinds.push(route.request().resourceType());
        requested.resolve();
        await gate.promise;
        await route.fulfill({ contentType: 'text/javascript', body: 'globalThis.__asyncRecord("stale");' });
      });
      await initialize(page, mode, true);
      await requested.promise;
      await expect.poll(async () => (await snapshot(page))?.trace).toContain('dcl');
      const pending = await snapshot(page);
      await page.evaluate(async (stopping) => {
        if (stopping === 'destroy') {
          await window.__asyncLoadFixture?.destroy();
        } else {
          await window.__asyncLoadFixture?.unmount();
        }
        await window.__asyncLoadFixture?.finished();
      }, stopping);
      gate.resolve();
      await page.unrouteAll({ behavior: 'wait' });
      const cancelled = await snapshot(page);
      await page.evaluate(() => window.__asyncLoadFixture?.destroy());
      expect(requestKinds).toEqual([mode === 'fetch' ? 'fetch' : 'script']);
      expect(pending?.state).toBe('pending');
      expect(cancelled?.state).toBe('cancelled');
      expect(cancelled?.trace).not.toContain('load');
      expect(cancelled?.trace).not.toContain('stale');
    });
  }
}
