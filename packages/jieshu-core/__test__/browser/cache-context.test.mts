import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

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
    response.end(
      '<!doctype html><html><head></head><body><main id="app-a"></main><main id="app-b"></main></body></html>',
    );
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    throw new Error('The fetch cache regression server must expose a local URL');
  }
  origin = url;
});

test.afterAll(async () => {
  await server?.close();
});

for (const scenario of ['isolate', 'reuse', 'invalidate']) {
  test(`real applications ${scenario} HTML, CSS and JavaScript by fetch context`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    const result = await page.evaluate(async (scenario) => {
      const coreUrl = '/packages/jieshu-core/src/index.ts';
      const commonUrl = '/packages/jieshu-core/src/common.ts';
      const { startApp, refreshApp, destroyApp, clearAssetsCache }: typeof import('../../src/index') = await import(
        coreUrl
      );
      const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
      const prefix = `${location.origin}/shared/`;
      const createContext = (initialTenant: string) => {
        let tenant = initialTenant;
        const calls = { html: 0, css: 0, js: 0 };
        const fetcher = async (input: RequestInfo) => {
          const path = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname;
          if (path === '/shared/index.html') {
            calls.html += 1;
            return new Response(
              `<html><head><link rel="stylesheet" href="./style.css"><script src="./script.js"></script></head>
              <body><div id="tenant">HTML:${tenant}</div></body></html>`,
              { headers: { 'Content-Type': 'text/html' } },
            );
          }
          if (path === '/shared/style.css') {
            calls.css += 1;
            return new Response(`#tenant { --cache-tenant: ${tenant}; color: rgb(12, 34, 56); }`, {
              headers: { 'Content-Type': 'text/css' },
            });
          }
          if (path === '/shared/script.js') {
            calls.js += 1;
            return new Response(
              `window.__cacheJs = ${JSON.stringify(tenant)};
              window.__cacheExecutions = (window.__cacheExecutions || 0) + 1;
              window.__JIESHU_MOUNT = () => {};
              window.__JIESHU_UNMOUNT = () => {};`,
              { headers: { 'Content-Type': 'text/javascript' } },
            );
          }
          throw new Error(`Unexpected resource request: ${path}`);
        };
        return {
          calls,
          fetch: fetcher,
          setTenant: (value: string) => {
            tenant = value;
          },
        };
      };
      const options = (name: string, context: ReturnType<typeof createContext>, el = '#app-a') => ({
        name,
        url: `${prefix}index.html`,
        el,
        fiber: true,
        fetch: context.fetch,
      });
      const snapshot = (name: string) => {
        const sandbox = getJieshuById(name);
        const iframeWindow = sandbox?.iframe.contentWindow;
        const tenantElement = sandbox?.shadowRoot.querySelector('#tenant');
        if (!sandbox || !iframeWindow || !tenantElement) {
          throw new Error('The cache fixture must have rendered its tenant element');
        }
        const js: unknown = Reflect.get(iframeWindow, '__cacheJs');
        const runs: unknown = Reflect.get(iframeWindow, '__cacheExecutions');
        if (typeof js !== 'string' || typeof runs !== 'number') {
          throw new Error('The fixture JavaScript must have executed in its iframe');
        }
        return {
          html: tenantElement.textContent,
          css: getComputedStyle(tenantElement).getPropertyValue('--cache-tenant').trim(),
          js,
          runs,
        };
      };
      const appendCachedResources = async (name: string) => {
        const sandbox = getJieshuById(name);
        const iframeWindow = sandbox?.iframe.contentWindow;
        if (!sandbox || !iframeWindow) {
          throw new Error('The cache fixture must have a live iframe');
        }
        const script = iframeWindow.document.createElement('script');
        script.src = `${prefix}script.js`;
        const link = iframeWindow.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `${prefix}style.css`;
        const scriptLoaded = new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('The cached dynamic script must load'));
        });
        const styleLoaded = new Promise<void>((resolve, reject) => {
          link.onload = () => resolve();
          link.onerror = () => reject(new Error('The cached dynamic stylesheet must load'));
        });
        sandbox.head.appendChild(script);
        sandbox.head.appendChild(link);
        await Promise.all([scriptLoaded, styleLoaded]);
      };
      const firstContext = createContext('A');
      const name = 'cache-context-first';
      const firstOptions = options(name, firstContext);
      if (scenario === 'isolate') {
        const secondContext = createContext('B');
        const peer = 'cache-context-second';
        await Promise.all([startApp(firstOptions), startApp(options(peer, secondContext, '#app-b'))]);
        const snapshots = [snapshot(name), snapshot(peer)];
        await Promise.all([destroyApp(name), destroyApp(peer)]);
        return { snapshots, firstCalls: firstContext.calls, secondCalls: secondContext.calls };
      }
      await startApp(firstOptions);
      const snapshots = [snapshot(name)];
      if (scenario === 'reuse') {
        await appendCachedResources(name);
        snapshots.push(snapshot(name));
        await destroyApp(name);
        const replacement = 'cache-context-replacement';
        const replacementOptions = options(replacement, firstContext);
        await startApp(replacementOptions);
        snapshots.push(snapshot(replacement));
        await refreshApp(replacementOptions);
        snapshots.push(snapshot(replacement));
        await appendCachedResources(replacement);
        snapshots.push(snapshot(replacement));
        await destroyApp(replacement);
      } else {
        firstContext.setTenant('B');
        await refreshApp(firstOptions);
        snapshots.push(snapshot(name));
        clearAssetsCache(prefix);
        await refreshApp(firstOptions);
        snapshots.push(snapshot(name));
        await destroyApp(name);
      }
      return { snapshots, firstCalls: firstContext.calls };
    }, scenario);

    const first = { html: 'HTML:A', css: 'A', js: 'A', runs: 1 };
    if (scenario === 'isolate') {
      expect(result.snapshots).toEqual([first, { html: 'HTML:B', css: 'B', js: 'B', runs: 1 }]);
      expect(result.firstCalls).toEqual({ html: 1, css: 1, js: 1 });
      expect(result.secondCalls).toEqual({ html: 1, css: 1, js: 1 });
    } else if (scenario === 'reuse') {
      expect(result.snapshots).toEqual([first, { ...first, runs: 2 }, first, first, { ...first, runs: 2 }]);
      expect(result.firstCalls).toEqual({ html: 1, css: 1, js: 1 });
    } else {
      expect(result.snapshots).toEqual([first, first, { html: 'HTML:B', css: 'B', js: 'B', runs: 1 }]);
      expect(result.firstCalls).toEqual({ html: 2, css: 2, js: 2 });
    }
    expect(errors).toEqual([]);
  });
}
