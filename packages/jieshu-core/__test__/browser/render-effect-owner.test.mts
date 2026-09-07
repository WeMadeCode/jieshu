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

for (const fiber of [false, true]) {
  test(`stale head/body and saved methods cannot affect a replacement (fiber=${fiber})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    const result = await page.evaluate(async (fiber) => {
      const coreUrl = '/packages/jieshu-core/src/index.ts';
      const commonUrl = '/packages/jieshu-core/src/common.ts';
      const { startApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
      const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
      const requests: string[] = [];
      let hookCalls = 0;
      const options = {
        name: 'render-effect-owner',
        url: `${location.origin}/child/`,
        el: '#app',
        fiber,
        html: '<html><head></head><body>current application</body></html>',
        fetch: async (input: RequestInfo) => {
          const url = String(input);
          requests.push(url);
          return new Response(
            url.endsWith('.css')
              ? 'body { color: red; }'
              : url.endsWith('/current.js')
                ? 'window.__fix002Current = true;'
                : 'window.__fix002Stale = true;',
          );
        },
        plugins: [
          {
            appendOrInsertElementHook: () => {
              hookCalls += 1;
            },
          },
        ],
      };
      const oldNodes: Array<{
        parent: HTMLHeadElement | HTMLBodyElement;
        append: <T extends Node>(child: T) => T;
        insert: <T extends Node>(child: T, ref: Node | null) => T;
        contains: (child: Node | null) => boolean;
        remove: <T extends Node>(child: T) => T;
      }> = [];

      for (let generation = 0; generation < 2; generation += 1) {
        await startApp(options);
        const sandbox = getJieshuById(options.name);
        if (!sandbox) {
          throw new Error('The old sandbox must exist before destroy');
        }
        for (const parent of [sandbox.head, sandbox.body]) {
          oldNodes.push({
            parent,
            append: parent.appendChild.bind(parent),
            insert: parent.insertBefore.bind(parent),
            contains: parent.contains.bind(parent),
            remove: parent.removeChild.bind(parent),
          });
        }
        await destroyApp(options.name);
      }

      await startApp(options);
      const replacement = getJieshuById(options.name);
      const iframeWindow = replacement?.iframe.contentWindow;
      if (!replacement || !iframeWindow) {
        throw new Error('The replacement must have a live iframe');
      }
      const baselineStyles = replacement.styleSheetElements.length;
      const baselineScripts = replacement.dynamicScriptElements.length;
      requests.length = 0;
      hookCalls = 0;

      for (const [index, old] of oldNodes.entries()) {
        const script = document.createElement('script');
        script.src = `${location.origin}/late-${index}.js`;
        old.parent.appendChild(script);
        const inline = document.createElement('script');
        inline.textContent = 'window.__fix002Stale = true;';
        old.append(inline);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `${location.origin}/late-${index}.css`;
        old.parent.insertBefore(link, null);
        const style = document.createElement('style');
        style.textContent = 'body { color: red; }';
        old.insert(style, null);
      }

      const staleEffects = {
        requests: [...requests],
        hookCalls,
        queuedScripts: replacement.execQueue.length,
        addedScripts: replacement.dynamicScriptElements.length - baselineScripts,
        addedStyles: replacement.styleSheetElements.length - baselineStyles,
      };
      let currentScriptInsertedIntoBody = false;
      await new Promise<void>((resolve, reject) => {
        const currentScript = iframeWindow.document.createElement('script');
        currentScript.src = `${location.origin}/current.js`;
        currentScript.onload = () => resolve();
        currentScript.onerror = () => reject(new Error('The current instance must still load scripts'));
        replacement.head.appendChild.call(replacement.body, currentScript);
        currentScriptInsertedIntoBody = currentScript.parentNode === replacement.body;
      });

      const currentScript = replacement.dynamicScriptElements[replacement.dynamicScriptElements.length - 1];
      if (!currentScript) {
        throw new Error('The current dynamic script must be registered');
      }
      const currentParent = currentScript.parentNode;
      const containsResults: boolean[] = [];
      const removeErrors: string[] = [];
      for (const old of oldNodes) {
        containsResults.push(old.parent.contains(currentScript), old.contains(currentScript));
        try {
          old.remove(currentScript);
          removeErrors.push('no error');
        } catch (error: unknown) {
          removeErrors.push(error instanceof DOMException ? error.name : String(error));
        }
      }
      const result = {
        staleEffects,
        staleCodeRan: Reflect.get(iframeWindow, '__fix002Stale') === true,
        currentCodeRan: Reflect.get(iframeWindow, '__fix002Current') === true,
        currentScriptInsertedIntoBody,
        currentScriptRetained: currentScript.parentNode === currentParent && currentParent !== null,
        containsResults,
        removeErrors,
        finalRequests: [...requests],
        finalQueueLength: replacement.execQueue.length,
      };
      await destroyApp(options.name);
      return result;
    }, fiber);

    expect(result.staleEffects).toEqual({
      requests: [],
      hookCalls: 0,
      queuedScripts: 0,
      addedScripts: 0,
      addedStyles: 0,
    });
    expect(result.staleCodeRan).toBe(false);
    expect(result.currentCodeRan).toBe(true);
    expect(result.currentScriptInsertedIntoBody).toBe(true);
    expect(result.currentScriptRetained).toBe(true);
    expect(result.containsResults).toEqual(Array(8).fill(false));
    expect(result.removeErrors).toEqual(Array(4).fill('NotFoundError'));
    expect(result.finalRequests).toEqual([new URL('/current.js', origin).href]);
    expect(result.finalQueueLength).toBe(0);
    expect(errors).toEqual([]);
  });
}
