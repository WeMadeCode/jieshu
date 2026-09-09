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
    response.end('<!doctype html><html><head></head><body></body></html>');
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    throw new Error('The startup loading regression server must expose a local URL');
  }
  origin = url;
});

test.afterAll(async () => {
  await server?.close();
});

const scenarios = [
  'destroy',
  'refresh-destroy',
  'replace-other-container',
  'replace-loading',
  'replace-dom',
  'hook-failure',
  'fetch-failure',
] as const;

for (const scenario of scenarios) {
  test(`startup loading ownership: ${scenario}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    const result = await page.evaluate(async (scenario) => {
      const coreUrl = '/packages/jieshu-core/src/index.ts';
      const { startApp, refreshApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
      const container = () => {
        const el = document.createElement('main');
        el.style.position = 'static';
        el.style.overflow = 'visible';
        document.body.appendChild(el);
        return el;
      };
      const snapshot = (el: HTMLElement) => ({
        loadingCount: el.querySelectorAll('[data-loading-flag]').length,
        position: el.style.position,
        overflow: el.style.overflow,
        restoredFlags:
          !el.hasAttribute('data-container-position-flag') && !el.hasAttribute('data-container-overflow-flag'),
      });
      const deferred = () => {
        let resolve = () => {};
        const promise = new Promise<void>((onResolve) => {
          resolve = onResolve;
        });
        return { promise, resolve };
      };
      const twoFrames = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const html = `<html><head><script>
        let count = 0;
        window.__JIESHU_MOUNT = () => {
          const button = document.createElement('button');
          button.id = 'counter';
          button.textContent = '0';
          button.onclick = () => { count += 1; button.textContent = String(count); };
          document.body.appendChild(button);
        };
        window.__JIESHU_UNMOUNT = () => document.body.replaceChildren();
      </script></head><body></body></html>`;
      const options = (name: string, el: HTMLElement) => ({
        name,
        el,
        fiber: false,
        url: `${location.origin}/${name}/`,
      });
      const firstContainer = container();
      const firstName = `loading-${scenario}`;

      if (scenario === 'hook-failure' || scenario === 'fetch-failure') {
        const failure = new Error(`expected ${scenario}`);
        const sibling = document.createElement('aside');
        let reason = '';
        try {
          await startApp({
            ...options(firstName, firstContainer),
            beforeLoad: () => {
              firstContainer.appendChild(sibling);
              if (scenario === 'hook-failure') {
                throw failure;
              }
            },
            fetch: async () => {
              throw failure;
            },
          });
        } catch (cause) {
          reason = cause instanceof Error ? cause.message : String(cause);
        }
        return { reason, first: snapshot(firstContainer), siblingPreserved: sibling.parentNode === firstContainer };
      }

      const pendingStart = (name: string, el: HTMLElement, run = startApp) => {
        const htmlGate = deferred();
        const requested = deferred();
        const starting = run({
          ...options(name, el),
          fetch: async () => {
            requested.resolve();
            await htmlGate.promise;
            return new Response(html);
          },
        });
        return { starting, requested: requested.promise, release: htmlGate.resolve };
      };
      const old = pendingStart(firstName, firstContainer, scenario === 'refresh-destroy' ? refreshApp : startApp);
      await old.requested;

      if (scenario === 'destroy' || scenario === 'refresh-destroy') {
        await destroyApp(firstName);
        // Observe cleanup while the original response is still pending.
        const beforeResponse = snapshot(firstContainer);
        const cancelled = await old.starting;
        old.release();
        await twoFrames();
        return {
          cancelled: cancelled === undefined,
          first: beforeResponse,
          afterResponse: snapshot(firstContainer),
          empty: firstContainer.children.length === 0,
        };
      }

      const nextContainer = scenario === 'replace-other-container' ? container() : firstContainer;
      let startingNext: ReturnType<typeof startApp>;
      let preservedLoading = true;
      if (scenario === 'replace-loading') {
        const next = pendingStart(firstName, nextContainer);
        await next.requested;
        const indicator = nextContainer.querySelector('[data-loading-flag]');
        await old.starting;
        old.release();
        await twoFrames();
        preservedLoading = indicator !== null && indicator.isConnected && nextContainer.style.overflow === 'hidden';
        next.release();
        startingNext = next.starting;
      } else {
        startingNext = startApp({ ...options(firstName, nextContainer), html });
      }
      const cancelled = await old.starting;
      await startingNext;
      const host = nextContainer.querySelector('jieshu-app');
      old.release();
      await twoFrames();
      const preservedHost = host !== null && host.isConnected && nextContainer.querySelector('jieshu-app') === host;
      const button = host?.shadowRoot?.querySelector<HTMLButtonElement>('#counter');
      if (!button) {
        throw new Error('The replacement must render an actual clickable child button');
      }
      button.click();
      const count = button.textContent;
      const first = snapshot(firstContainer);
      await destroyApp(firstName);
      return {
        cancelled: cancelled === undefined,
        first,
        preservedLoading,
        preservedHost,
        count,
        nextAfterDestroy: snapshot(nextContainer),
        emptyAfterDestroy: nextContainer.children.length === 0,
      };
    }, scenario);

    const restored = { loadingCount: 0, position: '', overflow: '', restoredFlags: true };
    expect(result.first).toEqual(restored);
    if (scenario === 'hook-failure' || scenario === 'fetch-failure') {
      expect(result.reason).toBe(`expected ${scenario}`);
      expect(result.siblingPreserved).toBe(true);
    } else if (scenario === 'destroy' || scenario === 'refresh-destroy') {
      expect(result.cancelled).toBe(true);
      expect(result.afterResponse).toEqual(restored);
      expect(result.empty).toBe(true);
    } else {
      expect(result.cancelled).toBe(true);
      expect(result.preservedLoading).toBe(true);
      expect(result.preservedHost).toBe(true);
      expect(result.count).toBe('1');
      expect(result.nextAfterDestroy).toEqual(restored);
      expect(result.emptyAfterDestroy).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
