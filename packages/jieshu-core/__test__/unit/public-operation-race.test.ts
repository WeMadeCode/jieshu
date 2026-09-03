import { clearAssetsCache, destroyApp, preloadApp, setupApp, startApp } from '../../src/index';
import { getJieshuById, idToSandboxCacheMap, sandboxTeardownById } from '../../src/common';

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function response(html: string): Response {
  return new Response(html) as Response;
}

function startOptions(name: string, container: HTMLElement) {
  return {
    name,
    url: `https://example.test/${name}/`,
    el: container,
    fiber: false,
  };
}

describe('public operation races', () => {
  beforeEach(() => {
    window.__JIESHU_CORE_INTENTS = undefined;
    idToSandboxCacheMap.clear();
    sandboxTeardownById.clear();
    clearAssetsCache();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('destroy interrupts a start whose HTML request is still pending', async () => {
    const htmlGate = deferred<Response>();
    const container = document.createElement('main');
    document.body.appendChild(container);

    const starting = startApp({
      ...startOptions('pending-html', container),
      fetch: () => htmlGate.promise,
    });
    await Promise.resolve();
    await Promise.resolve();
    const sandbox = getJieshuById('pending-html');
    expect(sandbox).not.toBeNull();

    await expect(destroyApp('pending-html')).resolves.toBeUndefined();
    expect(sandbox?.destroyed).toBe(true);
    expect(getJieshuById('pending-html')).toBeNull();
    await expect(starting).resolves.toBeUndefined();

    htmlGate.resolve(response('<html><head></head><body>late</body></html>'));
    await Promise.resolve();
    await Promise.resolve();
    expect(getJieshuById('pending-html')).toBeNull();
  });

  test('a newer start replaces an unfinished ordinary bootstrap', async () => {
    const firstHtml = deferred<Response>();
    const container = document.createElement('main');
    document.body.appendChild(container);

    const first = startApp({
      ...startOptions('latest-start', container),
      fetch: () => firstHtml.promise,
    });
    await Promise.resolve();
    await Promise.resolve();
    const staleSandbox = getJieshuById('latest-start');
    expect(staleSandbox).not.toBeNull();

    const second = startApp({
      ...startOptions('latest-start', container),
      html: '<html><head></head><body><p>latest</p></body></html>',
      beforeLoad: () => {
        const current = getJieshuById('latest-start');
        if (!current || current === staleSandbox) return;
        current.active = vi.fn(async () => {
          current.activeFlag = true;
        });
        current.start = vi.fn(async () => undefined);
      },
    });
    await expect(first).resolves.toBeUndefined();
    let replacement = getJieshuById('latest-start');
    for (let attempt = 0; attempt < 20 && (!replacement || replacement === staleSandbox); attempt += 1) {
      await Promise.resolve();
      replacement = getJieshuById('latest-start');
    }
    expect(staleSandbox?.destroyed).toBe(true);
    expect(replacement).not.toBeNull();
    expect(replacement).not.toBe(staleSandbox);
    await expect(second).resolves.toEqual(expect.any(Function));
    expect(replacement?.initialized).toBe(true);

    await destroyApp('latest-start');

    firstHtml.resolve(response('<html><head></head><body>stale</body></html>'));
    await Promise.resolve();
    await Promise.resolve();
    expect(getJieshuById('latest-start')).toBeNull();
  });

  test('an unmount during beforeMount cannot publish a partial initialization', async () => {
    const container = document.createElement('main');
    document.body.appendChild(container);
    const childMount = vi.fn();
    const afterMount = vi.fn();
    let unmounting: Promise<void> | undefined;

    const starting = startApp({
      ...startOptions('interrupted-mount', container),
      html: '<html><head></head><body></body></html>',
      beforeLoad: (iframeWindow) => {
        iframeWindow.__JIESHU_MOUNT = childMount;
        iframeWindow.__JIESHU_UNMOUNT = vi.fn();
        const current = getJieshuById('interrupted-mount');
        if (current) {
          current.el = container;
          current.active = vi.fn(async () => {
            current.activeFlag = true;
          });
        }
      },
      beforeMount: () => {
        const sandbox = getJieshuById('interrupted-mount');
        if (sandbox) unmounting = sandbox.unmount();
      },
      afterMount,
    });
    await Promise.resolve();
    await Promise.resolve();
    const sandbox = getJieshuById('interrupted-mount');
    expect(sandbox).not.toBeNull();
    await expect(starting).resolves.toBeUndefined();
    await unmounting;
    expect(childMount).not.toHaveBeenCalled();
    expect(afterMount).not.toHaveBeenCalled();
    expect(sandbox?.initialized).toBe(false);
    expect(sandbox?.destroyed).toBe(true);
    expect(getJieshuById('interrupted-mount')).toBeNull();
  });

  test('a failed new bootstrap removes its partially-created sandbox', async () => {
    const container = document.createElement('main');
    document.body.appendChild(container);
    const failure = new Error('beforeLoad failed');

    await expect(
      startApp({
        ...startOptions('failed-bootstrap', container),
        html: '<html><head></head><body></body></html>',
        beforeLoad: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expect(getJieshuById('failed-bootstrap')).toBeNull();
    expect(sandboxTeardownById.has('failed-bootstrap')).toBe(false);
  });

  test('startApp can resolve url and container from setupApp using only the name', async () => {
    const name = 'cached-start-options';
    const container = document.createElement('main');
    document.body.appendChild(container);
    setupApp({
      name,
      url: `https://example.test/${name}/`,
      el: container,
      html: '<html><head></head><body>cached</body></html>',
      fiber: false,
      beforeLoad: () => {
        const sandbox = getJieshuById(name);
        if (!sandbox) return;
        sandbox.active = vi.fn(async () => {
          sandbox.activeFlag = true;
        });
        sandbox.start = vi.fn(async () => undefined);
      },
    });

    await expect(startApp({ name })).resolves.toEqual(expect.any(Function));
    expect(getJieshuById(name)?.initialized).toBe(true);
    await destroyApp(name);
  });

  test('startApp reports missing cached requirements before creating a sandbox', async () => {
    await expect(startApp({ name: 'missing-start-options' })).rejects.toThrow(
      'Jieshu application "missing-start-options" requires a url',
    );
    expect(getJieshuById('missing-start-options')).toBeNull();
  });

  test('idle preload uses the options snapshot captured at call time', async () => {
    vi.useFakeTimers();
    const request = {
      name: 'preload-snapshot',
      url: 'https://example.test/preload-snapshot/',
      html: '<html><head></head><body></body></html>',
      fiber: false,
    };

    preloadApp(request);
    request.name = 'mutated-name';
    request.url = 'https://example.test/mutated/';
    vi.advanceTimersByTime(1);

    expect(getJieshuById('preload-snapshot')).not.toBeNull();
    expect(getJieshuById('mutated-name')).toBeNull();
    await destroyApp('preload-snapshot');
    await Promise.resolve();
    vi.useRealTimers();
  });

  test('destroy issued before idle time prevents a queued preload from reviving the app', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => Promise.resolve(response('<html></html>')));

    preloadApp({
      name: 'cancelled-preload',
      url: 'https://example.test/cancelled-preload/',
      fetch,
      fiber: false,
    });
    await destroyApp('cancelled-preload');
    vi.advanceTimersByTime(1);
    await Promise.resolve();

    expect(getJieshuById('cancelled-preload')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  test('a start adopts an in-flight preload instead of being discarded with its stale idle intent', async () => {
    vi.useFakeTimers();
    const htmlGate = deferred<Response>();
    const container = document.createElement('main');
    document.body.appendChild(container);
    preloadApp({
      name: 'adopted-preload',
      url: 'https://example.test/adopted-preload/',
      fetch: () => htmlGate.promise,
      fiber: false,
    });
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    const preloadSandbox = getJieshuById('adopted-preload');
    expect(preloadSandbox).not.toBeNull();
    if (preloadSandbox) {
      preloadSandbox.active = vi.fn(async () => {
        preloadSandbox.activeFlag = true;
      });
    }

    const starting = startApp({
      ...startOptions('adopted-preload', container),
      html: '<html><head></head><body><p>started</p></body></html>',
      beforeLoad: () => {
        const current = getJieshuById('adopted-preload');
        if (!current || current === preloadSandbox) return;
        current.active = vi.fn(async () => {
          current.activeFlag = true;
        });
        current.start = vi.fn(async () => undefined);
      },
    });

    htmlGate.resolve(response('<html><head></head><body>preloaded</body></html>'));
    await expect(starting).resolves.toEqual(expect.any(Function));
    const activeSandbox = getJieshuById('adopted-preload');
    expect(preloadSandbox?.destroyed).toBe(true);
    expect(activeSandbox).not.toBeNull();
    expect(activeSandbox).not.toBe(preloadSandbox);
    expect(activeSandbox?.initialized).toBe(true);

    await destroyApp('adopted-preload');
    vi.useRealTimers();
  });
});
