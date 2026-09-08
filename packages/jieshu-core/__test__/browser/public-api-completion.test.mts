import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import { build, createServer, type ViteDevServer } from 'vite';

declare global {
  interface Window {
    __publicCompletionCore?: typeof import('../../src/index');
  }
}

let server: ViteDevServer | undefined;
let origin: string;

test.beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const built = await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
        name: 'PublicCompletionCore',
        formats: ['iife'],
      },
    },
  });
  const outputs = Array.isArray(built) ? built : [built];
  let independentCore = '';
  for (const output of outputs) {
    if (!('output' in output)) {
      throw new Error('The independent core build must produce in-memory output');
    }
    for (const chunk of output.output) {
      if (chunk.type === 'chunk' && chunk.isEntry) {
        independentCore = `${chunk.code}\nwindow.__publicCompletionCore = PublicCompletionCore;`;
      }
    }
  }
  if (!independentCore) {
    throw new Error('The independent core build must contain an entry chunk');
  }
  server = await createServer({
    configFile: false,
    root,
    appType: 'custom',
    server: { host: '127.0.0.1', port: 0 },
  });
  server.middlewares.use((request, response, next) => {
    if (request.url === '/fixture-core.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(independentCore);
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
    throw new Error('The API completion regression server must expose a local URL');
  }
  origin = url;
});

test.afterAll(async () => {
  await server?.close();
});

for (const fiber of [false, true]) {
  for (const rejects of [false, true]) {
    test(`concurrent host destroy calls await the same teardown (fiber=${fiber}, rejects=${rejects})`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin);
      const result = await page.evaluate(
        async ({ fiber, rejects }) => {
          const coreUrl = '/packages/jieshu-core/src/index.ts';
          const commonUrl = '/packages/jieshu-core/src/common.ts';
          const { startApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
          const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
          const deferred = () => {
            let resolve = () => {};
            const promise = new Promise<void>((onResolve) => {
              resolve = onResolve;
            });
            return { promise, resolve };
          };
          const name = 'public-destroy-completion';
          await startApp({
            name,
            url: `${location.origin}/child/`,
            el: '#app',
            fiber,
            html: '<html><head><script>window.__JIESHU_MOUNT = () => {};</script></head><body>child</body></html>',
          });
          const sandbox = getJieshuById(name);
          const iframeWindow = sandbox?.iframe.contentWindow;
          if (!sandbox || !iframeWindow) {
            throw new Error('The fixture application must have a live iframe');
          }
          const iframe = sandbox.iframe;
          const entered = deferred();
          const gate = deferred();
          const failure = new Error('expected asynchronous unmount failure');
          let unmountCalls = 0;
          iframeWindow.__JIESHU_UNMOUNT = async () => {
            unmountCalls += 1;
            entered.resolve();
            await gate.promise;
            if (rejects) {
              throw failure;
            }
          };
          const states = ['pending', 'pending'];
          const causes: unknown[] = [];
          const observe = (work: Promise<void>, index: number) =>
            work.then(
              () => {
                states[index] = 'fulfilled';
              },
              (cause: unknown) => {
                states[index] = 'rejected';
                causes.push(cause);
              },
            );
          const first = observe(destroyApp(name), 0);
          await entered.promise;
          const second = observe(destroyApp(name), 1);
          // A new host task observes settlement without depending on an arbitrary delay.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const beforeRelease = states.slice();
          gate.resolve();
          await Promise.all([first, second]);
          return {
            beforeRelease,
            afterRelease: states,
            unmountCalls,
            failuresAreOriginal: causes.every((cause) => cause === failure),
            failureCount: causes.length,
            iframeReleased: !iframe.isConnected,
            registryReleased: getJieshuById(name) === null,
          };
        },
        { fiber, rejects },
      );

      expect(result).toEqual({
        beforeRelease: ['pending', 'pending'],
        afterRelease: rejects ? ['rejected', 'rejected'] : ['fulfilled', 'fulfilled'],
        unmountCalls: 1,
        failuresAreOriginal: true,
        failureCount: rejects ? 2 : 0,
        iframeReleased: true,
        registryReleased: true,
      });
      expect(errors).toEqual([]);
    });

    for (const operation of ['start', 'refresh']) {
      test(`host ${operation} awaits asynchronous unmount completion (fiber=${fiber}, rejects=${rejects})`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin);
        const result = await page.evaluate(
          async ({ fiber, rejects, operation }) => {
            const coreUrl = '/packages/jieshu-core/src/index.ts';
            const commonUrl = '/packages/jieshu-core/src/common.ts';
            const { startApp, refreshApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
            const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
            const deferred = () => {
              let resolve = () => {};
              const promise = new Promise<void>((onResolve) => {
                resolve = onResolve;
              });
              return { promise, resolve };
            };
            const options = {
              name: 'public-restart-completion',
              url: `${location.origin}/child/`,
              el: '#app',
              fiber,
              html: '<html><head><script>window.__JIESHU_MOUNT = () => {};</script></head><body>child</body></html>',
            };
            await startApp(options);
            const sandbox = getJieshuById(options.name);
            const iframeWindow = sandbox?.iframe.contentWindow;
            if (!sandbox || !iframeWindow) {
              throw new Error('The fixture application must have a live iframe');
            }
            const entered = deferred();
            const gate = deferred();
            const failure = new Error('expected asynchronous unmount failure');
            iframeWindow.__JIESHU_UNMOUNT = async () => {
              entered.resolve();
              await gate.promise;
              if (rejects) {
                throw failure;
              }
            };
            const unmounting = sandbox.unmount().catch((cause: unknown) => cause);
            await entered.promise;
            const states = ['pending'];
            let failureIsOriginal = false;
            const work = operation === 'start' ? startApp(options) : refreshApp(options);
            const restarting = work.then(
              (handler) => {
                states[0] = 'fulfilled';
                return handler;
              },
              (cause: unknown) => {
                states[0] = 'rejected';
                failureIsOriginal = cause === failure;
              },
            );
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            const beforeRelease = states.slice();
            gate.resolve();
            await unmounting;
            const handler = await restarting;
            const current = getJieshuById(options.name);
            const initializedBeforeResolution = Boolean(current?.activeFlag && current.initialized);
            const hasDestroyHandler = typeof handler === 'function';
            // A failing fixture hook must not fail the separate cleanup operation.
            iframeWindow.__JIESHU_UNMOUNT = () => {};
            if (typeof handler === 'function') {
              await handler();
            } else {
              await destroyApp(options.name);
            }
            return {
              beforeRelease,
              afterRelease: states,
              failureIsOriginal,
              initializedBeforeResolution,
              hasDestroyHandler,
              registryReleased: getJieshuById(options.name) === null,
            };
          },
          { fiber, rejects, operation },
        );

        expect(result).toEqual({
          beforeRelease: ['pending'],
          afterRelease: [rejects ? 'rejected' : 'fulfilled'],
          failureIsOriginal: rejects,
          initializedBeforeResolution: !rejects,
          hasDestroyHandler: !rejects,
          registryReleased: true,
        });
        expect(errors).toEqual([]);
      });
    }
  }
}

for (const mode of ['child', 'other-host', 'async-host']) {
  for (const afterAwait of mode === 'child' ? [false, true] : [mode === 'async-host']) {
    for (const operation of ['destroy', 'start', 'refresh']) {
      test(`independent ${mode} ${operation} reentry preserves external completion (afterAwait=${afterAwait})`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin);
        const result = await page.evaluate(
          async ({ mode, afterAwait, operation }) => {
            const coreUrl = '/packages/jieshu-core/src/index.ts';
            const commonUrl = '/packages/jieshu-core/src/common.ts';
            const source: typeof import('../../src/index') = await import(coreUrl);
            const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
            const deferred = () => {
              let resolve = () => {};
              const promise = new Promise<void>((onResolve) => {
                resolve = onResolve;
              });
              return { promise, resolve };
            };
            const name = 'public-reentrant-completion';
            const gate = deferred();
            const reentryCompleted = deferred();
            const trace: string[] = [];
            let independentCopy = false;
            const record = (value: unknown) => {
              trace.push(`${operation}:${typeof value}`);
              reentryCompleted.resolve();
            };
            const propsHtml = `<html><head><script>
              window.__JIESHU_MOUNT = () => {};
              window.__JIESHU_UNMOUNT = async () => {
                const props = window.$jieshu.props;
                await Promise.resolve();
                const value = await props.requestOperation();
                props.record(value);
                await props.gate;
              };
            </script></head><body>child</body></html>`;
            const childHtml = `<html><head>
              <script src="${location.origin}/fixture-core.js"></script>
              <script>
                window.__JIESHU_MOUNT = () => {};
                window.__JIESHU_UNMOUNT = async () => {
                  const api = window.__publicCompletionCore;
                  const props = window.$jieshu.props;
                  props.checkCopy(api.destroyApp);
                  ${afterAwait ? 'await Promise.resolve();' : ''}
                  const options = { name: ${JSON.stringify(name)}, url: location.href, el: '#unused' };
                  const value = await api[${JSON.stringify(`${operation}App`)}](
                    ${operation === 'destroy' ? JSON.stringify(name) : 'options'}
                  );
                  props.record(value);
                  await props.gate;
                };
              </script>
            </head><body>child</body></html>`;
            let secondary: typeof import('../../src/index') | undefined;
            const options = {
              name,
              url: `${location.origin}/child/`,
              el: '#app',
              fiber: true,
              html:
                mode === 'child'
                  ? childHtml
                  : mode === 'async-host'
                    ? propsHtml
                    : '<html><head><script>window.__JIESHU_MOUNT = () => {};</script></head><body>child</body></html>',
              props: {
                record,
                gate: gate.promise,
                checkCopy: (candidate: unknown) => {
                  independentCopy = typeof candidate === 'function' && candidate !== source.destroyApp;
                },
                requestOperation: async () => {
                  await Promise.resolve();
                  const hostCopy = secondary;
                  if (!hostCopy) {
                    throw new Error('The props callback must call the second host core');
                  }
                  const invoke = () => {
                    if (operation === 'destroy') {
                      return hostCopy.destroyApp(name);
                    }
                    const request = { name, url: `${location.origin}/child/`, el: '#app' };
                    if (operation === 'start') {
                      return hostCopy.startApp(request);
                    }
                    return hostCopy.refreshApp(request);
                  };
                  // Only the API invocation inherits the explicit context, including across core copies.
                  return source.runAsUnmountReentry(name, invoke);
                },
              },
            };
            if (mode !== 'child') {
              const script = document.createElement('script');
              script.src = '/fixture-core.js';
              const loaded = new Promise<void>((resolve, reject) => {
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('The second host core must load'));
              });
              document.head.appendChild(script);
              await loaded;
              secondary = window.__publicCompletionCore;
              if (!secondary) {
                throw new Error('The second host core must expose its API');
              }
              independentCopy = secondary.destroyApp !== source.destroyApp;
            }
            await source.startApp(options);
            const sandbox = getJieshuById(name);
            const iframeWindow = sandbox?.iframe.contentWindow;
            if (!sandbox || !iframeWindow) {
              throw new Error('The fixture application must have a live iframe');
            }
            const iframe = sandbox.iframe;
            if (secondary && mode === 'other-host') {
              const hostCopy = secondary;
              const invoke = () => {
                if (operation === 'destroy') {
                  return hostCopy.destroyApp(name);
                }
                if (operation === 'start') {
                  return hostCopy.startApp(options);
                }
                return hostCopy.refreshApp(options);
              };
              iframeWindow.__JIESHU_UNMOUNT = async () => {
                const value = await invoke();
                record(value);
                await gate.promise;
              };
            }
            const states = ['pending', 'pending'];
            const first = source.destroyApp(name).then(() => {
              states[0] = 'fulfilled';
            });
            await reentryCompleted.promise;
            const second = source.destroyApp(name).then(() => {
              states[1] = 'fulfilled';
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            const beforeRelease = states.slice();
            gate.resolve();
            await Promise.all([first, second]);
            return {
              independentCopy,
              trace,
              beforeRelease,
              afterRelease: states,
              iframeReleased: !iframe.isConnected,
              registryReleased: getJieshuById(name) === null,
            };
          },
          { mode, afterAwait, operation },
        );

        expect(result).toEqual({
          independentCopy: true,
          trace: [`${operation}:undefined`],
          beforeRelease: ['pending', 'pending'],
          afterRelease: ['fulfilled', 'fulfilled'],
          iframeReleased: true,
          registryReleased: true,
        });
        expect(errors).toEqual([]);
      });
    }
  }
}

for (const operation of ['destroy', 'start', 'refresh']) {
  for (const rejects of [false, true]) {
    test(`independent child ${operation} awaits a different application's teardown (rejects=${rejects})`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin);
      const result = await page.evaluate(
        async ({ operation, rejects }) => {
          const coreUrl = '/packages/jieshu-core/src/index.ts';
          const commonUrl = '/packages/jieshu-core/src/common.ts';
          const source: typeof import('../../src/index') = await import(coreUrl);
          const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
          const deferred = () => {
            let resolve = () => {};
            const promise = new Promise<void>((onResolve) => {
              resolve = onResolve;
            });
            return { promise, resolve };
          };
          const container = document.getElementById('app');
          if (!container) {
            throw new Error('The target application must have a host container');
          }
          const peerContainer = document.createElement('main');
          document.body.appendChild(peerContainer);
          const targetOptions = {
            name: 'public-cross-app-target',
            url: `${location.origin}/target/`,
            el: container,
            fiber: true,
            html: '<html><head><script>window.__JIESHU_MOUNT = () => {};</script></head><body>target</body></html>',
          };
          await source.startApp(targetOptions);
          const target = getJieshuById(targetOptions.name);
          const targetWindow = target?.iframe.contentWindow;
          if (!target || !targetWindow) {
            throw new Error('The target application must have a live iframe');
          }
          const targetIframe = target.iframe;
          const peerName = 'public-cross-app-peer';
          await source.startApp({
            name: peerName,
            url: `${location.origin}/peer/`,
            el: peerContainer,
            fiber: true,
            html: `<html><head><script src="${location.origin}/fixture-core.js"></script>
              <script>window.__JIESHU_MOUNT = () => {};</script></head><body>peer</body></html>`,
          });
          const peer = getJieshuById(peerName);
          const childCore = peer?.iframe.contentWindow?.__publicCompletionCore;
          if (!peer || !childCore) {
            throw new Error('The peer application must expose its independently bundled core');
          }
          const independentCopy = childCore.destroyApp !== source.destroyApp;
          const entered = deferred();
          const gate = deferred();
          const failure = new Error('expected different-application unmount failure');
          targetWindow.__JIESHU_UNMOUNT = async () => {
            entered.resolve();
            await gate.promise;
            if (rejects) {
              throw failure;
            }
          };
          const states = ['pending', 'pending'];
          let firstFailureIsOriginal = false;
          let secondFailureIsOriginal = false;
          const destroying = source.destroyApp(targetOptions.name).then(
            () => {
              states[0] = 'fulfilled';
            },
            (cause: unknown) => {
              states[0] = 'rejected';
              firstFailureIsOriginal = cause === failure;
            },
          );
          await entered.promise;
          // This exported function retains the peer iframe's independent core realm.
          const work =
            operation === 'destroy'
              ? childCore.destroyApp(targetOptions.name)
              : operation === 'start'
                ? childCore.startApp(targetOptions)
                : childCore.refreshApp(targetOptions);
          const fromPeer = work.then(
            (handler) => {
              states[1] = 'fulfilled';
              return handler;
            },
            (cause: unknown) => {
              states[1] = 'rejected';
              secondFailureIsOriginal = cause === failure;
            },
          );
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          const beforeRelease = states.slice();
          const replacementBeforeRelease = getJieshuById(targetOptions.name) !== null;
          gate.resolve();
          await destroying;
          const handler = await fromPeer;
          const current = getJieshuById(targetOptions.name);
          const initializedBeforeResolution = Boolean(current?.activeFlag && current.initialized);
          const hasDestroyHandler = typeof handler === 'function';
          if (typeof handler === 'function') {
            await handler();
          } else {
            await source.destroyApp(targetOptions.name);
          }
          const peerUnaffected = getJieshuById(peerName) === peer && peer.activeFlag && peer.iframe.isConnected;
          await source.destroyApp(peerName);
          return {
            independentCopy,
            beforeRelease,
            replacementBeforeRelease,
            afterRelease: states,
            firstFailureIsOriginal,
            secondFailureIsOriginal,
            initializedBeforeResolution,
            hasDestroyHandler,
            peerUnaffected,
            targetIframeReleased: !targetIframe.isConnected,
            registryReleased: getJieshuById(targetOptions.name) === null && getJieshuById(peerName) === null,
          };
        },
        { operation, rejects },
      );

      const restartSucceeds = operation === 'start' || (operation === 'refresh' && !rejects);
      expect(result).toEqual({
        independentCopy: true,
        beforeRelease: ['pending', 'pending'],
        replacementBeforeRelease: false,
        afterRelease: [rejects ? 'rejected' : 'fulfilled', rejects && operation !== 'start' ? 'rejected' : 'fulfilled'],
        firstFailureIsOriginal: rejects,
        secondFailureIsOriginal: rejects && operation !== 'start',
        initializedBeforeResolution: restartSucceeds,
        hasDestroyHandler: restartSucceeds,
        peerUnaffected: true,
        targetIframeReleased: true,
        registryReleased: true,
      });
      expect(errors).toEqual([]);
    });
  }
}
