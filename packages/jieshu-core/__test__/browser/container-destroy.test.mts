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
    response.end('<!doctype html><html><head></head><body><main id="app"></main></body></html>');
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    throw new Error('The core regression server must expose a local URL');
  }
  origin = url;
});

test.afterAll(async () => {
  await server?.close();
});

for (const rejects of [false, true]) {
  for (const loading of [false, true]) {
    test(`old teardown preserves the current container (rejects=${rejects}, loading=${loading})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin);
      const result = await page.evaluate(
        async ({ rejects, loading }) => {
          const coreUrl = '/packages/jieshu-core/src/index.ts';
          const commonUrl = '/packages/jieshu-core/src/common.ts';
          const { startApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
          const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
          const container = document.getElementById('app');
          if (!container) {
            throw new Error('The test page must have a container');
          }
          const deferred = () => {
            let resolve = () => {};
            const promise = new Promise<void>((onResolve) => {
              resolve = onResolve;
            });
            return { promise, resolve };
          };
          const options = {
            el: container,
            fiber: true,
            html: '<html><head><script>window.__JIESHU_MOUNT = () => {};</script></head><body>old</body></html>',
          };
          const startOld = async (name: string) => {
            await startApp({ ...options, name, url: `${location.origin}/${name}/` });
            const sandbox = getJieshuById(name);
            const iframeWindow = sandbox?.iframe.contentWindow;
            if (!sandbox || !iframeWindow) {
              throw new Error('The old application must have a live iframe');
            }
            return { sandbox, iframe: sandbox.iframe, iframeWindow };
          };
          const first = await startOld('container-first');
          const firstGate = deferred();
          let firstUnmountCalls = 0;
          first.iframeWindow.__JIESHU_UNMOUNT = async () => {
            firstUnmountCalls += 1;
            await firstGate.promise;
            if (rejects) {
              throw new Error('expected old unmount failure');
            }
          };
          const destroyingFirst = destroyApp(first.sandbox.id).then(
            () => 'completed',
            (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
          );
          // FIX-004 currently acknowledges this second call before the first teardown ends.
          await destroyApp(first.sandbox.id);

          const second = await startOld('container-second');
          const secondGate = deferred();
          second.iframeWindow.__JIESHU_UNMOUNT = () => secondGate.promise;
          const destroyingSecond = destroyApp(second.sandbox.id);
          const fetchStarted = deferred();
          const htmlGate = deferred();
          const customLoading = document.createElement('span');
          customLoading.textContent = 'current application loading';
          let currentUnmountCalls = 0;
          const startingCurrent = startApp({
            name: 'container-current',
            url: `${location.origin}/current/`,
            el: container,
            fiber: true,
            loading: customLoading,
            fetch: async () => {
              fetchStarted.resolve();
              await htmlGate.promise;
              return new Response(
                '<html><head><script>window.__fix003Current = true;</script></head><body>current application</body></html>',
              );
            },
            beforeUnmount: () => {
              currentUnmountCalls += 1;
            },
            deactivated: () => {
              currentUnmountCalls += 1;
            },
          });
          await fetchStarted.promise;
          if (!loading) {
            htmlGate.resolve();
            await startingCurrent;
          }
          const contentBeforeCleanup = container.firstElementChild;
          const positionBeforeCleanup = container.style.position;
          const overflowBeforeCleanup = container.style.overflow;

          secondGate.resolve();
          await destroyingSecond;
          firstGate.resolve();
          const firstOutcome = await destroyingFirst;
          const preservedDuringCleanup =
            contentBeforeCleanup !== null &&
            container.firstElementChild === contentBeforeCleanup &&
            contentBeforeCleanup.isConnected;
          const layoutPreserved =
            container.style.position === positionBeforeCleanup && container.style.overflow === overflowBeforeCleanup;
          const loadingPreserved = !loading || customLoading.isConnected;
          if (loading) {
            htmlGate.resolve();
            await startingCurrent;
          }

          const current = getJieshuById('container-current');
          const currentWindow = current?.iframe?.contentWindow;
          const result = {
            firstOutcome,
            firstUnmountCalls,
            preservedDuringCleanup,
            layoutPreserved,
            loadingPreserved,
            currentUnmountCalls,
            currentHostConnected: current?.shadowRoot?.host.isConnected === true,
            currentIframeConnected: current?.iframe?.isConnected === true,
            currentDestroyed: current?.destroyed,
            currentText: current?.body?.textContent,
            currentCodeRan: Boolean(currentWindow && Reflect.get(currentWindow, '__fix003Current')),
            oldIframesReleased: !first.iframe.isConnected && !second.iframe.isConnected,
            oldGlobalsReleased: first.iframeWindow.__JIESHU === null && second.iframeWindow.__JIESHU === null,
            oldRegistryEntriesReleased:
              getJieshuById(first.sandbox.id) === null && getJieshuById(second.sandbox.id) === null,
          };
          await destroyApp('container-current');
          return { ...result, containerEmptyAfterCurrentDestroy: container.childNodes.length === 0 };
        },
        { rejects, loading },
      );

      expect(result).toEqual({
        firstOutcome: rejects ? 'expected old unmount failure' : 'completed',
        firstUnmountCalls: 1,
        preservedDuringCleanup: true,
        layoutPreserved: true,
        loadingPreserved: true,
        currentUnmountCalls: 0,
        currentHostConnected: true,
        currentIframeConnected: true,
        currentDestroyed: false,
        currentText: 'current application',
        currentCodeRan: true,
        oldIframesReleased: true,
        oldGlobalsReleased: true,
        oldRegistryEntriesReleased: true,
        containerEmptyAfterCurrentDestroy: true,
      });
      expect(errors).toEqual([]);
    });
  }
}
