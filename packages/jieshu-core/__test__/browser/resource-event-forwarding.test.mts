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
    if (request.url === '/resource-error.js') {
      response.statusCode = 404;
      response.end();
      return;
    }
    if (request.url !== '/') {
      next();
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><body><main id="app"></main></body></html>');
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    throw new Error('The resource event regression server must expose a local URL');
  }
  origin = url;
});

test.afterAll(async () => {
  await server?.close();
});

for (const fiber of [false, true]) {
  for (const kind of ['script', 'link']) {
    for (const outcome of ['load', 'error']) {
      for (const throwing of [false, true]) {
        test(`${kind} ${outcome} notifies all listeners and preserves the queue (fiber=${fiber}, throwing=${throwing})`, async ({
          page,
        }) => {
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.goto(origin);
          const result = await page.evaluate(
            async ({ fiber, kind, outcome, throwing }) => {
              const coreUrl = '/packages/jieshu-core/src/index.ts';
              const commonUrl = '/packages/jieshu-core/src/common.ts';
              const { startApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
              const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
              const executed: string[] = [];
              const name = 'resource-forwarding';
              await startApp({
                name,
                url: `${location.origin}/child/`,
                el: '#app',
                fiber,
                html: '<html><head><script>window.__JIESHU_MOUNT = () => {}; window.__JIESHU_UNMOUNT = () => {};</script></head><body>child</body></html>',
                fetch: async (input) => {
                  const url = String(input);
                  if (url.includes('resource-error')) {
                    return new Response('', { status: 404 });
                  }
                  if (url.endsWith('.css')) {
                    return new Response('body { color: rgb(1, 2, 3); }');
                  }
                  const label = url.endsWith('/following.js') ? 'following' : 'initial';
                  return new Response(`window.__resourceExecuted(${JSON.stringify(label)});`);
                },
                beforeLoad: (iframeWindow) => {
                  Reflect.set(iframeWindow, '__resourceExecuted', (label: string) => executed.push(label));
                },
                loadError: () => {},
              });
              const sandbox = getJieshuById(name);
              const iframeWindow = sandbox?.iframe.contentWindow;
              if (!sandbox || !iframeWindow) {
                throw new Error('The resource fixture must have a live iframe');
              }
              const original =
                kind === 'script'
                  ? iframeWindow.document.createElement('script')
                  : iframeWindow.document.createElement('link');
              if (kind === 'script') {
                original.setAttribute(
                  'src',
                  `${location.origin}/resource-${outcome === 'error' ? 'error' : 'load'}.js`,
                );
              } else {
                original.setAttribute('rel', 'stylesheet');
                original.setAttribute(
                  'href',
                  `${location.origin}/resource-${outcome === 'error' ? 'error' : 'load'}.css`,
                );
              }
              const calls: string[] = [];
              const snapshots: Array<{ target: boolean; current: boolean; receiver: boolean; realm: boolean }> = [];
              const events: Event[] = [];
              let release: () => void;
              const completed = new Promise<void>((resolve) => {
                release = resolve;
              });
              const finish = () => queueMicrotask(() => release());
              const record = (label: string, event: Event, receiver: unknown) => {
                calls.push(label);
                events.push(event);
                const EventConstructor = original.ownerDocument.defaultView?.Event ?? Event;
                snapshots.push({
                  target: event.target === original && event.srcElement === original,
                  current: event.currentTarget === original,
                  receiver: receiver === original,
                  realm: event instanceof EventConstructor,
                });
              };
              // Dynamic this verifies native listener receiver semantics across realms.
              const before = function (this: HTMLScriptElement | HTMLLinkElement, event: Event) {
                record('before', event, this);
              };
              original.addEventListener(outcome, before);
              Reflect.set(original, `on${outcome}`, function (this: HTMLScriptElement | HTMLLinkElement, event: Event) {
                record('property', event, this);
                if (throwing) {
                  throw new Error('expected resource callback failure');
                }
                finish();
              });
              const after = function (this: HTMLScriptElement | HTMLLinkElement, event: Event) {
                record('after', event, this);
                if (throwing) {
                  const following = iframeWindow.document.createElement('script');
                  following.src = `${location.origin}/following.js`;
                  following.onload = () => {
                    calls.push('following-property');
                    finish();
                  };
                  following.addEventListener('load', () => calls.push('following-listener'));
                  sandbox.head.appendChild(following);
                }
              };
              original.addEventListener(outcome, after);
              let onceCalls = 0;
              let removedCalls = 0;
              const removed = () => {
                removedCalls += 1;
              };
              original.addEventListener(
                outcome,
                () => {
                  onceCalls += 1;
                },
                { once: true },
              );
              original.addEventListener(outcome, removed);
              original.removeEventListener(outcome, removed);
              sandbox.head.appendChild(original);
              await completed;
              const queueLength = sandbox.execQueue?.length ?? 0;
              const originalCalls = calls.slice();
              const eventCount = new Set(events).size;
              const currentTargetCleared = events[0]?.currentTarget === null;
              Reflect.set(original, `on${outcome}`, null);
              original.removeEventListener(outcome, before);
              original.removeEventListener(outcome, after);
              // A later event must not replay once listeners or previously removed listeners.
              original.dispatchEvent(new Event(outcome));
              const replayOnceCalls = onceCalls;
              await destroyApp(name);
              return {
                calls: originalCalls,
                snapshots: snapshots.slice(0, 3),
                executed,
                eventCount,
                currentTargetCleared,
                onceCalls: replayOnceCalls,
                removedCalls,
                queueLength,
              };
            },
            { fiber, kind, outcome, throwing },
          );

          expect(result.calls).toEqual(
            throwing
              ? ['before', 'property', 'after', 'following-property', 'following-listener']
              : ['before', 'property', 'after'],
          );
          expect(result.snapshots).toEqual(
            Array.from({ length: 3 }, () => ({ target: true, current: true, receiver: true, realm: true })),
          );
          expect(result.eventCount).toBe(1);
          expect(result.currentTargetCleared).toBe(true);
          expect(result.onceCalls).toBe(1);
          expect(result.removedCalls).toBe(0);
          expect(result.queueLength).toBe(0);
          expect(result.executed).toEqual([
            ...(kind === 'script' && outcome === 'load' ? ['initial'] : []),
            ...(throwing ? ['following'] : []),
          ]);
          expect(errors).toEqual(throwing ? ['expected resource callback failure'] : []);
        });
      }
    }
  }
}
