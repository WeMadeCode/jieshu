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
  const address = server.resolvedUrls?.local[0];
  if (!address) {
    throw new Error('The initial replace fixture requires a local server');
  }
  origin = address;
});

test.afterAll(async () => {
  await server?.close();
});

for (const fiber of [false, true]) {
  for (const mode of ['start', 'setup', 'preload', 'preload-exec', 'refresh', 'cache']) {
    test(`initial HTML, CSS and JS apply replace once in loader order (${mode}, fiber=${fiber})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin);
      const result = await page.evaluate(
        async ({ mode, fiber }) => {
          const coreUrl = '/packages/jieshu-core/src/index.ts';
          const commonUrl = '/packages/jieshu-core/src/common.ts';
          const core: typeof import('../../src/index') = await import(coreUrl);
          const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
          const name = 'initial-replace';
          const url = `${location.origin}/replace-child/index.html`;
          const html = `<html><head>
          <style>.inline-color { color: RAW_CSS_INLINE; }</style>
          <link rel="stylesheet" href="./external.css">
          <script>window.__replaceInline = "RAW_JS_INLINE"; window.__JIESHU_MOUNT = () => {}; window.__JIESHU_UNMOUNT = () => {};</script>
          <script src="./external.js"></script>
          </head><body><p id="replace-text">RAW_HTML</p><p class="inline-color">inline</p><p class="external-color">external</p></body></html>`;
          const calls: string[] = [];
          const requests: string[] = [];
          let htmlValue = 'FINAL_HTML';
          let preloadEntered = () => {};
          const entered = new Promise<void>((resolve) => {
            preloadEntered = resolve;
          });
          const options = {
            name,
            url,
            el: '#app',
            fiber,
            alive: true,
            beforeLoad: () => preloadEntered(),
            fetch: async (input: RequestInfo | URL) => {
              const source = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
              requests.push(source);
              if (source.endsWith('external.css')) {
                return new Response('.external-color { color: RAW_CSS_EXTERNAL; }');
              }
              if (source.endsWith('external.js')) {
                return new Response('window.__replaceExternal = "RAW_JS_EXTERNAL";');
              }
              if (source === url) {
                return new Response(html);
              }
              throw new Error(`Unexpected fixture request: ${source}`);
            },
            replace: (code: string) => {
              if (code.includes('id="replace-text"')) {
                calls.push('replace:template');
              } else if (code.includes('RAW_JS_INLINE')) {
                calls.push('replace:inline-js');
              } else if (code.includes('RAW_JS_EXTERNAL')) {
                calls.push('replace:external-js');
              }
              return code
                .split('LOADED_HTML')
                .join(htmlValue)
                .split('RAW_HTML')
                .join(htmlValue)
                .split('LOADED_CSS_INLINE')
                .join('rgb(11, 22, 33)')
                .split('LOADED_CSS_EXTERNAL')
                .join('rgb(44, 55, 66)')
                .split('RAW_JS_INLINE')
                .join('REPLACED_JS_INLINE')
                .split('RAW_JS_EXTERNAL')
                .join('REPLACED_JS_EXTERNAL');
            },
            plugins: [
              {
                // htmlLoader intentionally bypasses parsed HTML caching. The
                // cache scenario omits it so HTML, CSS and JS all hit caches.
                htmlLoader:
                  mode === 'cache'
                    ? undefined
                    : (code: string) => {
                        calls.push('html-loader');
                        return code.replace('RAW_HTML', 'LOADED_HTML');
                      },
                cssLoader: (code: string) => {
                  if (code.includes('RAW_CSS_INLINE')) {
                    calls.push('css-loader:inline');
                  } else if (code.includes('RAW_CSS_EXTERNAL')) {
                    calls.push('css-loader:external');
                  }
                  return code
                    .replace('RAW_CSS_INLINE', 'LOADED_CSS_INLINE')
                    .replace('RAW_CSS_EXTERNAL', 'LOADED_CSS_EXTERNAL');
                },
                jsLoader: (code: string) => {
                  if (code.includes('REPLACED_JS_INLINE')) {
                    calls.push('js-loader:inline');
                  } else if (code.includes('REPLACED_JS_EXTERNAL')) {
                    calls.push('js-loader:external');
                  } else {
                    throw new Error('JS replace must run before its loader');
                  }
                  return code
                    .replace('REPLACED_JS_INLINE', 'FINAL_JS_INLINE')
                    .replace('REPLACED_JS_EXTERNAL', 'FINAL_JS_EXTERNAL');
                },
              },
            ],
          };
          if (mode === 'refresh' || mode === 'cache') {
            htmlValue = 'PRIMED_HTML';
            await core.startApp(options);
            htmlValue = 'FINAL_HTML';
            calls.length = 0;
            if (mode === 'cache') {
              await core.destroyApp(name);
            }
          }
          if (mode === 'setup') {
            core.setupApp(options);
            await core.startApp({ name });
          } else if (mode === 'preload' || mode === 'preload-exec') {
            core.preloadApp({ ...options, exec: mode === 'preload-exec' });
            await entered;
            const preloaded = getJieshuById(name);
            if (!preloaded) {
              throw new Error('The preload fixture must have a sandbox');
            }
            await preloaded.preload;
            await core.startApp(options);
          } else if (mode === 'refresh') {
            await core.refreshApp(options);
          } else {
            await core.startApp(options);
          }
          const sandbox = getJieshuById(name);
          const child = sandbox?.iframe.contentWindow;
          const root = sandbox?.shadowRoot;
          const inline = root?.querySelector('.inline-color');
          const external = root?.querySelector('.external-color');
          if (!child || !root || !inline || !external) {
            throw new Error('The replacement fixture must render both style targets');
          }
          const snapshot = {
            text: root.querySelector('#replace-text')?.textContent,
            inlineColor: getComputedStyle(inline).color,
            externalColor: getComputedStyle(external).color,
            inlineJs: Reflect.get(child, '__replaceInline'),
            externalJs: Reflect.get(child, '__replaceExternal'),
            calls: [...calls],
            requests: [...requests],
          };
          await core.destroyApp(name);
          return snapshot;
        },
        { mode, fiber },
      );

      expect(result.text).toBe('FINAL_HTML');
      expect(result.inlineColor).toBe('rgb(11, 22, 33)');
      expect(result.externalColor).toBe('rgb(44, 55, 66)');
      expect(result.inlineJs).toBe('FINAL_JS_INLINE');
      expect(result.externalJs).toBe('FINAL_JS_EXTERNAL');
      const expected = [
        ...(mode === 'cache' ? [] : ['html-loader']),
        'css-loader:inline',
        'css-loader:external',
        'replace:template',
        ...(mode === 'preload' ? ['html-loader'] : []),
        'replace:inline-js',
        'js-loader:inline',
        'replace:external-js',
        'js-loader:external',
      ];
      expect(result.calls).toEqual(expected);
      if (mode === 'cache') {
        expect(result.requests).toHaveLength(3);
        expect(new Set(result.requests).size).toBe(3);
      }
      expect(errors).toEqual([]);
    });
  }
}
