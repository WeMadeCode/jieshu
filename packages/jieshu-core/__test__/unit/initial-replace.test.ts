import { clearAssetsCache, destroyApp, preloadApp, setupApp, startApp } from '../../src/index';
import { getJieshuById, idToSandboxCacheMap, sandboxTeardownById } from '../../src/common';
import type Jieshu from '../../src/sandbox';

describe('replace during initial template processing', () => {
  beforeEach(() => {
    clearAssetsCache();
    idToSandboxCacheMap.clear();
    sandboxTeardownById.clear();
    document.head.innerHTML = '';
    document.body.innerHTML = '<main id="app"></main>';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const optionsFor = (name: string) => ({
    name,
    url: `https://example.test/${name}/`,
    el: '#app',
    fiber: false,
    html: '<html><head><style>.probe { color: RAW_CSS; }</style></head><body>RAW_HTML</body></html>',
  });

  test.each([false, true])('prepares replace before the first template is activated (setup=%s)', async (setup) => {
    const name = 'initial-template';
    const calls: string[] = [];
    let activatedTemplate: string | undefined;
    const replace = vi.fn((code: string) => {
      calls.push('replace');
      return code.split('LOADED_HTML').join('REPLACED_HTML').split('LOADED_CSS').join('red');
    });
    const options = {
      ...optionsFor(name),
      replace,
      plugins: [
        {
          htmlLoader: (code: string) => {
            calls.push('html');
            return code.replace('RAW_HTML', 'LOADED_HTML');
          },
          cssLoader: (code: string) => {
            calls.push('css');
            return code.replace('RAW_CSS', 'LOADED_CSS');
          },
        },
      ],
      beforeLoad: () => {
        const sandbox = getJieshuById(name);
        if (!sandbox) {
          throw new Error('The template fixture requires a sandbox');
        }
        sandbox.active = async ({ template }) => {
          activatedTemplate = template;
          sandbox.activeFlag = true;
        };
        sandbox.start = async () => {};
      },
    };
    if (setup) {
      setupApp(options);
      await startApp({ name });
    } else {
      await startApp(options);
    }
    expect(activatedTemplate).toContain('REPLACED_HTML');
    expect(activatedTemplate).toContain('color: red;');
    expect(activatedTemplate).not.toContain('RAW_');
    expect(calls).toEqual(['html', 'css', 'replace']);
    expect(replace).toHaveBeenCalledOnce();
    await destroyApp(name);
  });

  for (const preload of [false, true]) {
    for (const failure of ['throw', 'destroy']) {
      test(`cleans a ${preload ? 'preload' : 'start'} when initial replace performs ${failure}`, async () => {
        const name = `replace-${preload}-${failure}`;
        const error = new Error('template replace failed');
        let sandbox: Jieshu | null = null;
        let iframe: HTMLIFrameElement | undefined;
        let teardown: Promise<void> | undefined;
        const active = vi.fn();
        const options = {
          ...optionsFor(name),
          beforeLoad: () => {
            sandbox = getJieshuById(name);
            if (!sandbox) {
              throw new Error('The failure fixture requires a sandbox');
            }
            iframe = sandbox.iframe;
            sandbox.active = active;
          },
          replace: (code: string) => {
            if (failure === 'throw') {
              throw error;
            }
            teardown = destroyApp(name);
            return code;
          },
        };
        let completion: Promise<unknown> | undefined;
        if (preload) {
          vi.useFakeTimers();
          preloadApp(options);
          vi.advanceTimersByTime(1);
          completion = getJieshuById(name)?.preload;
          expect(completion).toBeDefined();
        } else {
          completion = startApp(options);
        }
        if (failure === 'throw') {
          await expect(completion).rejects.toBe(error);
        } else {
          await completion;
          await teardown;
        }
        expect(active).not.toHaveBeenCalled();
        expect(getJieshuById(name)).toBeNull();
        expect(sandboxTeardownById.has(name)).toBe(false);
        expect(iframe?.isConnected).toBe(false);
      });
    }
  }
});
