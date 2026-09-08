import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import { build, createServer, type ViteDevServer } from 'vite';

declare global {
  interface Window {
    __windowEventCore?: typeof import('../../src/index');
    __windowEventTracker?: typeof import('../../src/tracker');
    __writeWindowHandler?: (property: string, label: string) => void;
  }
}

let server: ViteDevServer | undefined;
let origin: string;

const root = fileURLToPath(new URL('../../../..', import.meta.url));

const buildIndependentEntry = async (entry: URL, name: string, globalProperty: string) => {
  const built = await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(entry),
        name,
        formats: ['iife'],
      },
    },
  });
  const outputs = Array.isArray(built) ? built : [built];
  let code = '';
  for (const output of outputs) {
    if (!('output' in output)) {
      throw new Error('The independent core build must produce in-memory output');
    }
    for (const chunk of output.output) {
      if (chunk.type === 'chunk' && chunk.isEntry) {
        code = `${chunk.code}\nwindow[${JSON.stringify(globalProperty)}] = ${name};`;
      }
    }
  }
  if (!code) {
    throw new Error('The independent core build must contain an entry chunk');
  }
  return code;
};

test.beforeAll(async () => {
  const [independentCore, independentTracker] = await Promise.all([
    buildIndependentEntry(new URL('../../src/index.ts', import.meta.url), 'WindowEventCore', '__windowEventCore'),
    buildIndependentEntry(
      new URL('../../src/tracker.ts', import.meta.url),
      'WindowEventTracker',
      '__windowEventTracker',
    ),
  ]);
  server = await createServer({
    configFile: false,
    root,
    appType: 'custom',
    server: { host: '127.0.0.1', port: 0 },
  });
  server.middlewares.use((request, response, next) => {
    if (request.url === '/window-event-tracker.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(independentTracker);
      return;
    }
    if (request.url === '/window-event-core.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(independentCore);
      return;
    }
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
    throw new Error('The window event regression server must expose a local URL');
  }
  origin = url;
});

test.afterAll(async () => {
  await server?.close();
});

for (const scenario of ['plain', 'repeat', 'host-between', 'host-last', 'multiple', 'normalize']) {
  for (const firstDestroyed of ['A', 'B']) {
    test(`independent cores restore window handlers (${scenario}, destroy ${firstDestroyed} first)`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin);
      const result = await page.evaluate(
        async ({ scenario, firstDestroyed }) => {
          const coreUrl = '/packages/jieshu-core/src/index.ts';
          const commonUrl = '/packages/jieshu-core/src/common.ts';
          const source: typeof import('../../src/index') = await import(coreUrl);
          const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
          const coreScript = document.createElement('script');
          coreScript.src = '/window-event-core.js';
          const loaded = new Promise<void>((resolve, reject) => {
            coreScript.onload = () => resolve();
            coreScript.onerror = () => reject(new Error('The independent core must load'));
          });
          document.head.appendChild(coreScript);
          await loaded;
          const secondCore = window.__windowEventCore;
          if (!secondCore) {
            throw new Error('The independent core must expose its public API');
          }
          const trace: string[] = [];
          const hostHandler = (event: string, version: number) => {
            Reflect.set(window, `on${event}`, () => {
              trace.push(`host:${event}:${version}`);
            });
          };
          hostHandler('resize', 0);
          hostHandler('online', 0);
          const html = `<html><head><script>
            window.__JIESHU_MOUNT = () => {};
            window.__writeWindowHandler = (property, label) => {
              const record = window.$jieshu.props.record;
              window[property] = () => record(label);
            };
          </script></head><body>event owner</body></html>`;
          await source.startApp({
            name: 'window-owner-a',
            url: `${location.origin}/a/`,
            el: '#app-a',
            fiber: true,
            html,
            props: { record: (label: string) => trace.push(label) },
          });
          await secondCore.startApp({
            name: 'window-owner-b',
            url: `${location.origin}/b/`,
            el: '#app-b',
            fiber: true,
            html,
            props: { record: (label: string) => trace.push(label) },
          });
          const first = getJieshuById('window-owner-a');
          const second = getJieshuById('window-owner-b');
          const writeFirst = first?.iframe.contentWindow?.__writeWindowHandler;
          const writeSecond = second?.iframe.contentWindow?.__writeWindowHandler;
          if (!first || !second || !writeFirst || !writeSecond) {
            throw new Error('Both applications must expose child-realm handler writers');
          }
          const firstIframe = first.iframe;
          const secondIframe = second.iframe;
          const independentCopies =
            source.startApp !== secondCore.startApp &&
            first.eventCleanupTracker.constructor !== second.eventCleanupTracker.constructor;
          writeFirst('onresize', 'A:resize:1');
          if (scenario === 'host-between') {
            hostHandler('resize', 9);
          }
          writeSecond('onresize', 'B:resize:1');
          if (scenario === 'repeat') {
            writeFirst('onresize', 'A:resize:2');
            writeFirst('onresize', 'A:resize:3');
          }
          if (scenario === 'normalize') {
            const firstWindow = firstIframe.contentWindow;
            if (!firstWindow) {
              throw new Error('The first application must have a live iframe');
            }
            // The native on* setter normalizes non-callable values to null.
            Reflect.set(firstWindow, 'onresize', 7);
          }
          if (scenario === 'host-last') {
            hostHandler('resize', 9);
          }
          if (scenario === 'multiple') {
            writeSecond('ononline', 'B:online:1');
            writeFirst('ononline', 'A:online:1');
          }
          const dispatch = () => {
            trace.length = 0;
            // Native browser dispatch exercises the on* accessor's internal handler slot.
            window.dispatchEvent(new UIEvent('resize'));
            if (scenario === 'multiple') {
              window.dispatchEvent(new Event('online'));
            }
            return trace.slice();
          };
          const beforeDestroy = dispatch();
          if (firstDestroyed === 'A') {
            await source.destroyApp('window-owner-a');
          } else {
            await secondCore.destroyApp('window-owner-b');
          }
          const afterFirstDestroy = dispatch();
          if (firstDestroyed === 'A') {
            await secondCore.destroyApp('window-owner-b');
          } else {
            await source.destroyApp('window-owner-a');
          }
          const afterBothDestroyed = dispatch();
          return {
            independentCopies,
            beforeDestroy,
            afterFirstDestroy,
            afterBothDestroyed,
            iframesReleased: !firstIframe.isConnected && !secondIframe.isConnected,
            registryReleased: getJieshuById('window-owner-a') === null && getJieshuById('window-owner-b') === null,
          };
        },
        { scenario, firstDestroyed },
      );

      let beforeDestroy = ['B:resize:1'];
      let afterFirstDestroy = firstDestroyed === 'A' ? ['B:resize:1'] : ['A:resize:1'];
      let afterBothDestroyed = ['host:resize:0'];
      if (scenario === 'repeat') {
        beforeDestroy = ['A:resize:3'];
        afterFirstDestroy = firstDestroyed === 'A' ? ['B:resize:1'] : ['A:resize:3'];
      }
      if (scenario === 'normalize') {
        beforeDestroy = [];
        afterFirstDestroy = firstDestroyed === 'A' ? ['B:resize:1'] : [];
      }
      if (scenario === 'host-between') {
        afterFirstDestroy = firstDestroyed === 'A' ? ['B:resize:1'] : ['host:resize:9'];
        afterBothDestroyed = ['host:resize:9'];
      }
      if (scenario === 'host-last') {
        beforeDestroy = ['host:resize:9'];
        afterFirstDestroy = ['host:resize:9'];
        afterBothDestroyed = ['host:resize:9'];
      }
      if (scenario === 'multiple') {
        beforeDestroy.push('A:online:1');
        afterFirstDestroy.push(firstDestroyed === 'A' ? 'B:online:1' : 'A:online:1');
        afterBothDestroyed.push('host:online:0');
      }
      expect(result).toEqual({
        independentCopies: true,
        beforeDestroy,
        afterFirstDestroy,
        afterBothDestroyed,
        iframesReleased: true,
        registryReleased: true,
      });
      expect(errors).toEqual([]);
    });
  }
}

for (const firstCleaned of ['host', 'iframe']) {
  test(`tracker ownership crosses ordinary iframe realms (${firstCleaned} cleanup first)`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    const result = await page.evaluate(async (firstCleaned) => {
      const trackerUrl = '/packages/jieshu-core/src/tracker.ts';
      const source: typeof import('../../src/tracker') = await import(trackerUrl);
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      const iframeWindow = iframe.contentWindow;
      if (!iframeWindow) {
        throw new Error('The ordinary same-origin iframe must have a window');
      }
      const script = iframeWindow.document.createElement('script');
      script.src = `${location.origin}/window-event-tracker.js`;
      const loaded = new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('The iframe tracker bundle must load'));
      });
      iframeWindow.document.head.appendChild(script);
      await loaded;
      const independent = iframeWindow.__windowEventTracker;
      if (!independent) {
        throw new Error('The iframe tracker bundle must expose its class');
      }
      const hostTracker = new source.EventCleanupTracker();
      const iframeTracker = new independent.EventCleanupTracker();
      const trace: string[] = [];
      window.onresize = () => {
        trace.push('original');
      };
      // This lower-level case isolates cross-realm registry sharing from app lifecycle behavior.
      hostTracker.setWindowOnEvent(window, 'onresize', () => trace.push('host owner'));
      iframeTracker.setWindowOnEvent(window, 'onresize', () => trace.push('iframe owner'));
      const dispatch = () => {
        trace.length = 0;
        window.dispatchEvent(new UIEvent('resize'));
        return trace.slice();
      };
      const beforeCleanup = dispatch();
      if (firstCleaned === 'host') {
        hostTracker.cleanupWindowOnEventOverrides(window);
      } else {
        iframeTracker.cleanupWindowOnEventOverrides(window);
      }
      const afterFirstCleanup = dispatch();
      if (firstCleaned === 'host') {
        iframeTracker.cleanupWindowOnEventOverrides(window);
      } else {
        hostTracker.cleanupWindowOnEventOverrides(window);
      }
      const afterBothCleaned = dispatch();
      const independentRealms =
        iframeWindow !== window && independent.EventCleanupTracker !== source.EventCleanupTracker;
      iframe.remove();
      return { independentRealms, beforeCleanup, afterFirstCleanup, afterBothCleaned };
    }, firstCleaned);

    expect(result).toEqual({
      independentRealms: true,
      beforeCleanup: ['iframe owner'],
      afterFirstCleanup: [firstCleaned === 'host' ? 'iframe owner' : 'host owner'],
      afterBothCleaned: ['original'],
    });
    expect(errors).toEqual([]);
  });
}
