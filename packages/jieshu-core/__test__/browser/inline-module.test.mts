import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

interface ModuleSnapshot {
  trace: string[];
  events: string[];
  queue: number;
  markers: number;
}
interface ModuleFixture {
  append(content: string, label?: string, type?: string): void;
  snapshot(): ModuleSnapshot;
  releaseGate(): void;
  unmount(): Promise<void>;
  activate(): Promise<void>;
  destroy(): Promise<void>;
}
declare global {
  interface Window {
    __inlineModuleFixture?: ModuleFixture;
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
    if (request.url?.startsWith('/fixtures/')) {
      response.setHeader('Content-Type', 'text/javascript');
      if (request.url.endsWith('/missing.js')) {
        response.statusCode = 404;
        response.end();
      } else {
        response.end('export const value = 7; export default 11;');
      }
      return;
    }
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
    throw new Error('Expected a local regression server');
  }
  origin = url;
});
test.afterAll(async () => {
  await server?.close();
});

const initialize = async (
  page: Page,
  options: { fiber?: boolean; alive?: boolean; html?: string; preset?: string } = {},
) => {
  await page.goto(origin);
  await page.evaluate(async ({ fiber = false, alive = true, html, preset }) => {
    const coreUrl = '/packages/jieshu-core/src/index.ts';
    const commonUrl = '/packages/jieshu-core/src/common.ts';
    const { startApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
    const { getJieshuById, rawDocumentQuerySelector }: typeof import('../../src/common') = await import(commonUrl);
    const trace: string[] = [];
    const events: string[] = [];
    let releaseGate: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const appOptions = {
      name: 'inline-module',
      url: `${location.origin}/`,
      el: '#app',
      alive,
      fiber,
      html:
        html ??
        '<html><head><script>window.__JIESHU_MOUNT = () => {}; window.__JIESHU_UNMOUNT = () => {};</script></head><body>module test</body></html>',
      beforeLoad: (appWindow: Window) => {
        Reflect.set(appWindow, '__moduleRecord', (value: string) => trace.push(value));
        Reflect.set(appWindow, '__moduleGate', gate);
      },
      plugins: preset ? [{ jsBeforeLoaders: [{ module: true, content: preset }] }] : [],
    };
    await startApp(appOptions);
    const sandbox = getJieshuById(appOptions.name);
    const appWindow = sandbox?.iframe.contentWindow;
    if (!sandbox || !appWindow) {
      throw new Error('Expected an initialized iframe');
    }
    const head = rawDocumentQuerySelector.call(appWindow.document, 'head');
    if (!head) {
      throw new Error('Expected the native iframe head');
    }
    const base = head.querySelector('base');
    if (base) {
      base.href = `${location.origin}/fixtures/`;
    }
    window.__inlineModuleFixture = {
      append: (content, label = 'inline', type = 'module') => {
        const script = appWindow.document.createElement('script');
        script.type = type;
        script.textContent = content;
        script.onload = () => events.push(`${label}:load`);
        script.onerror = () => events.push(`${label}:error`);
        sandbox.head.appendChild(script);
      },
      snapshot: () => ({
        trace: [...trace],
        events: [...events],
        queue: sandbox.execQueue?.length ?? 0,
        markers: head.querySelectorAll('[data-jieshu-module-completion]').length,
      }),
      releaseGate: () => releaseGate(),
      unmount: () => sandbox.unmount(),
      activate: async () => {
        await startApp(appOptions);
      },
      destroy: () => destroyApp(appOptions.name),
    };
  }, options);
};
const snapshot = (page: Page) => page.evaluate(() => window.__inlineModuleFixture?.snapshot());
const appendFollowing = (page: Page) =>
  page.evaluate(() => {
    window.__inlineModuleFixture?.append("globalThis.__moduleRecord('following');", 'following', 'text/javascript');
  });

for (const fiber of [false, true]) {
  for (const inactive of [false, true]) {
    test(`inline module advances after evaluation starts (fiber=${fiber}, inactive=${inactive})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await initialize(page, { fiber });
      if (inactive) {
        await page.evaluate(() => window.__inlineModuleFixture?.unmount());
      }
      await page.evaluate(() =>
        window.__inlineModuleFixture?.append("export const value = 1; globalThis.__moduleRecord('module');"),
      );
      await appendFollowing(page);
      await expect.poll(async () => (await snapshot(page))?.trace).toEqual(['module', 'following']);
      expect(await snapshot(page)).toEqual({ trace: ['module', 'following'], events: [], queue: 0, markers: 0 });
      if (inactive) {
        await page.evaluate(() => window.__inlineModuleFixture?.activate());
        await appendFollowing(page);
        await expect.poll(async () => (await snapshot(page))?.trace.length).toBe(3);
      }
      expect(errors).toEqual([]);
    });
  }

  test(`delayed imports preserve module order (fiber=${fiber})`, async ({ page }) => {
    let resolveGate: () => void;
    const release = () => resolveGate();
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    await page.route('**/fixtures/slow.js', async (route) => {
      await gate;
      await route.fulfill({ contentType: 'text/javascript', body: 'export const value = 9;' });
    });
    await initialize(page, { fiber });
    const requested = page.waitForRequest('**/fixtures/slow.js');
    await page.evaluate(() =>
      window.__inlineModuleFixture?.append(
        "import {value} from './slow.js'; globalThis.__moduleRecord(String(value));",
      ),
    );
    await requested;
    await appendFollowing(page);
    expect((await snapshot(page))?.trace).toEqual([]);
    release();
    await expect.poll(async () => (await snapshot(page))?.trace).toEqual(['9', 'following']);
    expect((await snapshot(page))?.queue).toBe(0);
  });

  test(`module imports and metadata keep their native base (fiber=${fiber})`, async ({ page }) => {
    await initialize(page, { fiber });
    await page.evaluate(() => {
      const fixture = window.__inlineModuleFixture;
      fixture?.append(
        JSON.stringify({ imports: { mapped: `${location.origin}/fixtures/mapped.js` } }),
        'map',
        'importmap',
      );
      fixture?.append(`import {value} from './dep.js';
        import mapped from 'mapped';
        export {value};
        globalThis.__moduleRecord(String(value + mapped));
        globalThis.__moduleRecord(import.meta.url);
        const name = './dynamic.js';
        import(name).then(({value}) => globalThis.__moduleRecord('dynamic:' + value));`);
    });
    await appendFollowing(page);
    await expect.poll(async () => (await snapshot(page))?.trace.length).toBe(4);
    const state = await snapshot(page);
    expect(state?.trace.slice(0, 3)).toEqual(['18', new URL('/fixtures/', origin).href, 'following']);
    expect(state?.trace).toContain('dynamic:7');
    expect(state?.events).toEqual([]);
    expect(state?.queue).toBe(0);
  });

  test(`top-level await has the same nonblocking boundary as native module load (fiber=${fiber})`, async ({ page }) => {
    await initialize(page, { fiber });
    await page.evaluate(() =>
      window.__inlineModuleFixture?.append(
        "globalThis.__moduleRecord('before-await'); await globalThis.__moduleGate; globalThis.__moduleRecord('after-await');",
      ),
    );
    await appendFollowing(page);
    await expect.poll(async () => (await snapshot(page))?.trace).toEqual(['before-await', 'following']);
    expect((await snapshot(page))?.queue).toBe(0);
    await page.evaluate(() => window.__inlineModuleFixture?.releaseGate());
    await expect.poll(async () => (await snapshot(page))?.trace).toEqual(['before-await', 'following', 'after-await']);
  });

  test(`static and preset inline modules allow start to finish (fiber=${fiber})`, async ({ page }) => {
    await initialize(page, {
      fiber,
      preset: "export const preset = 1; globalThis.__moduleRecord('preset');",
      html: '<html><head><script type="module">export const app = 1; globalThis.__moduleRecord("static");</script></head><body>static module</body></html>',
    });
    expect((await snapshot(page))?.trace).toEqual(['preset', 'static']);
    expect((await snapshot(page))?.queue).toBe(0);
  });
}

for (const scenario of [
  { name: 'missing dependency', code: "import './missing.js';", event: 'inline:error', error: '' },
  { name: 'syntax error', code: 'export const = ;', event: '', error: 'Unexpected token' },
  {
    name: 'runtime error',
    code: "throw new Error('module runtime failure');",
    event: '',
    error: 'module runtime failure',
  },
  {
    name: 'await rejection',
    code: "await Promise.reject(new Error('module await failure'));",
    event: '',
    error: 'module await failure',
  },
  { name: 'empty module', code: '', event: '', error: '' },
]) {
  test(`${scenario.name} does not hold the queue`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await initialize(page);
    await page.evaluate((code) => window.__inlineModuleFixture?.append(code), scenario.code);
    await appendFollowing(page);
    await expect.poll(async () => (await snapshot(page))?.trace).toEqual(['following']);
    const state = await snapshot(page);
    expect(state?.events).toEqual(scenario.event ? [scenario.event] : []);
    expect(state?.queue).toBe(0);
    expect(state?.markers).toBe(0);
    if (scenario.error) {
      await expect.poll(() => errors.length).toBe(1);
      expect(errors[0]).toContain(scenario.error);
    } else {
      expect(errors).toEqual([]);
    }
  });
}

for (const fiber of [false, true]) {
  test(`async inline modules do not serialize later startup modules (fiber=${fiber})`, async ({ page }) => {
    let resolveGate: () => void;
    const release = () => resolveGate();
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    await page.route('**/fixtures/async-slow.js', async (route) => {
      await gate;
      await route.fulfill({ contentType: 'text/javascript', body: 'export default 1;' });
    });
    await initialize(page, {
      fiber,
      html: '<html><head><script async type="module">import "/fixtures/async-slow.js"; globalThis.__moduleRecord("async");</script><script type="module">globalThis.__moduleRecord("serial");</script></head><body>async module</body></html>',
    });
    expect((await snapshot(page))?.trace).toEqual(['serial']);
    release();
    await expect.poll(async () => (await snapshot(page))?.trace).toEqual(['serial', 'async']);
    expect((await snapshot(page))?.queue).toBe(0);
  });

  for (const destroy of [false, true]) {
    test(`pending imports cannot hold a later activation (fiber=${fiber}, destroy=${destroy})`, async ({ page }) => {
      let resolveGate: () => void;
      const release = () => resolveGate();
      const gate = new Promise<void>((resolve) => {
        resolveGate = resolve;
      });
      await page.route('**/fixtures/cancelled.js', async (route) => {
        await gate;
        await route.fulfill({ contentType: 'text/javascript', body: 'export default 1;' });
      });
      await initialize(page, { fiber, alive: false });
      const requested = page.waitForRequest('**/fixtures/cancelled.js');
      await page.evaluate(() =>
        window.__inlineModuleFixture?.append("import './cancelled.js'; globalThis.__moduleRecord('stale');"),
      );
      await requested;
      await appendFollowing(page);
      if (destroy) {
        await page.evaluate(() => window.__inlineModuleFixture?.destroy());
      } else {
        await page.evaluate(() => window.__inlineModuleFixture?.unmount());
      }
      expect((await snapshot(page))?.queue).toBe(0);
      expect((await snapshot(page))?.markers).toBe(0);
      if (destroy) {
        // Keep this page and registry, creating a same-name replacement in place.
        await page.evaluate(async () => {
          const coreUrl = '/packages/jieshu-core/src/index.ts';
          const commonUrl = '/packages/jieshu-core/src/common.ts';
          const { startApp }: typeof import('../../src/index') = await import(coreUrl);
          const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
          await startApp({
            name: 'inline-module',
            url: `${location.origin}/`,
            el: '#app',
            html: '<html><head></head><body>replacement</body></html>',
          });
          const replacement = getJieshuById('inline-module');
          const appWindow = replacement?.iframe.contentWindow;
          if (!replacement || !appWindow) {
            throw new Error('Expected a replacement runtime');
          }
          await new Promise<void>((resolve) => {
            Reflect.set(appWindow, '__replacementDone', resolve);
            const script = appWindow.document.createElement('script');
            script.type = 'module';
            script.textContent = 'globalThis.__replacementDone();';
            replacement.head.appendChild(script);
          });
        });
      } else {
        await page.evaluate(() => window.__inlineModuleFixture?.activate());
        await page.evaluate(() => window.__inlineModuleFixture?.append("globalThis.__moduleRecord('new-module');"));
        await expect.poll(async () => (await snapshot(page))?.trace).toEqual(['new-module']);
      }
      // The old request is deliberately still unresolved when the new module runs.
      release();
      await page.unrouteAll({ behavior: 'wait' });
      if (!destroy) {
        await appendFollowing(page);
        await expect.poll(async () => (await snapshot(page))?.trace).toEqual(['new-module', 'following']);
      }
      expect((await snapshot(page))?.trace).not.toContain('stale');
    });
  }
}
