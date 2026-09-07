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
    if (request.url === '/fallback.js' || request.url === '/module.js') {
      response.setHeader('Content-Type', 'text/javascript');
      const label = request.url === '/module.js' ? 'module' : 'fallback';
      response.end(`globalThis.__fix001Trace.push('${label}');`);
      return;
    }
    if (request.url === '/native-error.js') {
      response.statusCode = 404;
      response.end();
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
    throw new Error('The core regression server must expose a local URL');
  }
  origin = url;
});

test.afterAll(async () => {
  await server?.close();
});

for (const fiber of [false, true]) {
  test(`alive scripts finish in the background, resume, and stop on destroy (fiber=${fiber})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    const result = await page.evaluate(async (fiber) => {
      const coreUrl = '/packages/jieshu-core/src/index.ts';
      const commonUrl = '/packages/jieshu-core/src/common.ts';
      const { startApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
      const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
      const trace: string[] = [];
      const events: string[] = [];
      const requests: string[] = [];
      const deferResponse = (label: string) => {
        let resolveResponse: (response: Response) => void;
        const promise = new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        });
        return {
          promise,
          resolve: () => resolveResponse(new Response(`globalThis.__fix001Trace.push('${label}');`)),
        };
      };
      const pendingActive = deferResponse('pending-active');
      const pendingLate = deferResponse('late');
      const options = {
        name: 'alive-dynamic-script',
        url: `${location.origin}/child/`,
        el: '#app',
        alive: true,
        fiber,
        html: '<html><head></head><body>alive application</body></html>',
        fetch: async (input: RequestInfo) => {
          const path = new URL(String(input)).pathname;
          requests.push(path);
          if (path === '/pending-active.js') {
            return pendingActive.promise;
          }
          if (path === '/late.js') {
            return pendingLate.promise;
          }
          if (path === '/fallback.js' || path === '/native-error.js') {
            return new Response('');
          }
          const label = path.slice(1, -3);
          return new Response(`globalThis.__fix001Trace.push('${label}');`);
        },
        plugins: [
          {
            jsLoader: (code: string, src: string) => {
              if (src.endsWith('/transform-error.js')) {
                throw new Error('Expected transform failure');
              }
              return code;
            },
          },
        ],
      };
      await startApp(options);
      const sandbox = getJieshuById(options.name);
      const iframeWindow = sandbox?.iframe.contentWindow;
      if (!sandbox || !iframeWindow) {
        throw new Error('Expected an active iframe');
      }
      Reflect.set(iframeWindow, '__fix001Trace', trace);

      const waitFor = async <Value,>(label: string, promise: Promise<Value>) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${label} stalled: ${JSON.stringify({
                    trace,
                    events,
                    requests,
                    active: sandbox.activeFlag,
                    destroyed: sandbox.destroyed,
                    queue: sandbox.execQueue?.length,
                  })}`,
                ),
              ),
            5000,
          );
        });
        try {
          return await Promise.race([promise, timeout]);
        } finally {
          clearTimeout(timer);
        }
      };

      const append = (label: string, module = false, inline = false) => {
        const script = iframeWindow.document.createElement('script');
        script.type = module ? 'module' : 'text/javascript';
        if (inline) {
          script.textContent = `globalThis.__fix001Trace.push('${label}');`;
        } else {
          script.src = `${location.origin}/${label}.js`;
        }
        const completion = new Promise<string>((resolve) => {
          script.onload = () => {
            events.push(`${label}:load`);
            resolve('load');
          };
          script.onerror = () => {
            events.push(`${label}:error`);
            resolve('error');
          };
        });
        sandbox.head.appendChild(script);
        return completion;
      };

      // The request starts while active and returns only after deactivation.
      const activeCompletion = append('pending-active');
      await waitFor('unmount', sandbox.unmount());
      const inactive = sandbox.activeFlag === false;
      pendingActive.resolve();
      await waitFor('pending-active', activeCompletion);

      // New requests and native modules continue using the same inactive runtime.
      const background = append('background');
      void append('inline', false, true);
      const externalModule = append('module', true);
      const fallback = append('fallback');
      await waitFor('background scripts', Promise.all([background, externalModule, fallback]));
      const nativeError = await waitFor('native error', append('native-error'));
      const transformError = await waitFor('transform error', append('transform-error'));
      const inactiveQueueLength = sandbox.execQueue.length;

      await startApp(options);
      const reused = getJieshuById(options.name) === sandbox;
      await append('reactivated');
      const resumedQueueLength = sandbox.execQueue.length;

      void append('late');
      const oldIframe = sandbox.iframe;
      await destroyApp(options.name);
      pendingLate.resolve();
      // A following live application drains the same promise/fiber machinery;
      // a late old result must not execute in either the old or replacement realm.
      await startApp(options);
      const replacement = getJieshuById(options.name);
      const replacementWindow = replacement?.iframe.contentWindow;
      if (!replacement || !replacementWindow) {
        throw new Error('Expected a replacement iframe');
      }
      const replacementTrace: string[] = [];
      Reflect.set(replacementWindow, '__fix001Trace', replacementTrace);
      await new Promise<void>((resolve, reject) => {
        const script = replacementWindow.document.createElement('script');
        script.src = `${location.origin}/replacement.js`;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Replacement script failed'));
        replacement.head.appendChild(script);
      });
      const result = {
        trace,
        events,
        requests,
        inactive,
        reused,
        nativeError,
        transformError,
        inactiveQueueLength,
        resumedQueueLength,
        oldIframeConnected: oldIframe.isConnected,
        replacementTrace,
        replacementQueueLength: replacement.execQueue.length,
      };
      await destroyApp(options.name);
      return result;
    }, fiber);

    expect(result.inactive).toBe(true);
    expect(result.reused).toBe(true);
    expect(result.trace).toHaveLength(6);
    expect([...result.trace].sort()).toEqual([
      'background',
      'fallback',
      'inline',
      'module',
      'pending-active',
      'reactivated',
    ]);
    expect(result.trace[0]).toBe('pending-active');
    expect(result.trace[5]).toBe('reactivated');
    expect([...result.events].sort()).toEqual([
      'background:load',
      'fallback:load',
      'module:load',
      'native-error:error',
      'pending-active:load',
      'reactivated:load',
      'transform-error:error',
    ]);
    expect(result.requests.filter((path) => path === '/late.js')).toHaveLength(1);
    expect(result.nativeError).toBe('error');
    expect(result.transformError).toBe('error');
    expect(result.inactiveQueueLength).toBe(0);
    expect(result.resumedQueueLength).toBe(0);
    expect(result.oldIframeConnected).toBe(false);
    expect(result.replacementTrace).toEqual(['replacement']);
    expect(result.replacementQueueLength).toBe(0);
    expect(errors).toEqual([]);
  });
}
