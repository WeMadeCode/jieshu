import Jieshu from '../../src/sandbox';
import { createAppController, destroyApp, startApp, refreshApp, runAsUnmountReentry } from '../../src/index';
import { idToSandboxCacheMap, sandboxTeardownById } from '../../src/common';
import { registerSandboxDynamicResource } from '../../src/sandbox-runtime';
import { patchRenderEffect } from '../../src/effect';
import type { StartOptions } from '../../src/contracts';

type SandboxWithIframeRealm = Jieshu & {
  iframe: HTMLIFrameElement & {
    contentDocument: Document;
    contentWindow: Window;
  };
};

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function createSandbox(name: string): SandboxWithIframeRealm {
  const container = document.createElement('main');
  document.body.appendChild(container);
  const sandbox = new Jieshu({
    name,
    url: `https://example.test/${name}/`,
    attrs: {},
    fiber: false,
    plugins: [],
    lifecycles: {},
  });
  sandbox.el = container;
  sandbox.alive = false;
  sandbox.hrefFlag = false;
  sandbox.activeFlag = true;
  const iframeDocument = sandbox.iframe.contentDocument;
  const iframeWindow = sandbox.iframe.contentWindow;
  if (!iframeDocument || !iframeWindow) throw new Error('The sandbox iframe realm must be available in tests');
  sandbox.head = iframeDocument.head;
  sandbox.body = iframeDocument.body as HTMLBodyElement;
  return sandbox as SandboxWithIframeRealm;
}

function createRenderRoot(): ShadowRoot {
  const root = document.createElement('div').attachShadow({ mode: 'open' });
  const head = document.createElement('head');
  const body = document.createElement('body');
  root.append(head, body);
  root.head = head;
  root.body = body;
  return root;
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe('sandbox lifecycle races', () => {
  beforeEach(() => {
    idToSandboxCacheMap.clear();
    sandboxTeardownById.clear();
    document.body.innerHTML = '';
  });

  test('coalesces concurrent unmount calls', async () => {
    const sandbox = createSandbox('coalesced-unmount');
    const gate = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((onResolve) => {
        resolve = onResolve;
      });
      return { promise, resolve };
    })();
    const childUnmount = vi.fn(() => gate.promise);
    sandbox.mountFlag = true;
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = childUnmount;

    const first = sandbox.unmount();
    const second = sandbox.unmount();

    expect(second).toBe(first);
    expect(childUnmount).toHaveBeenCalledTimes(1);
    gate.resolve();
    await first;
    expect(sandbox.mountFlag).toBe(false);
    await sandbox.destroy();
  });

  test.each([false, true])('stops native requests only for non-alive unmount (alive=%s)', async (alive) => {
    const sandbox = createSandbox('native-unmount');
    sandbox.alive = alive;
    const stop = vi.spyOn(sandbox.iframe.contentWindow, 'stop');
    await sandbox.unmount();
    expect(stop).toHaveBeenCalledTimes(alive ? 0 : 1);
    stop.mockRestore();
    await sandbox.destroy();
  });

  test('a replaced native stop cannot prevent unmount from settling', async () => {
    const sandbox = createSandbox('throwing-native-stop');
    const stop = vi.spyOn(sandbox.iframe.contentWindow, 'stop').mockImplementation(() => {
      throw new Error('stop failed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(sandbox.unmount()).resolves.toBeUndefined();
    expect(sandbox.activeFlag).toBe(false);
    expect(warn).toHaveBeenCalled();
    stop.mockRestore();
    warn.mockRestore();
    await sandbox.destroy();
  });

  test('does not deactivate an already inactive alive generation twice', async () => {
    const sandbox = createSandbox('idempotent-alive-unmount');
    const deactivated = vi.fn();
    sandbox.alive = true;
    sandbox.lifecycles = { deactivated };

    await sandbox.unmount();
    await sandbox.unmount();

    expect(deactivated).toHaveBeenCalledTimes(1);
    await sandbox.destroy();
  });

  test('public destroy called from child unmount does not wait on its own tombstone', async () => {
    const name = 'reentrant-public-destroy';
    const sandbox = createSandbox(name);
    sandbox.mountFlag = true;
    const childUnmount = vi.fn(() => destroyApp(name));
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = childUnmount;

    await expect(destroyApp(name)).resolves.toBeUndefined();

    expect(childUnmount).toHaveBeenCalledTimes(1);
    expect(idToSandboxCacheMap.has(name)).toBe(false);
    expect(sandboxTeardownById.has(name)).toBe(false);
  });

  test('async child unmount can reenter public destroy after an await', async () => {
    const name = 'async-reentrant-public-destroy';
    const sandbox = createSandbox(name);
    sandbox.mountFlag = true;
    const childUnmount = vi.fn(async () => {
      await Promise.resolve();
      await destroyApp(name);
    });
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = childUnmount;

    const previousPowered = window.__POWERED_BY_JIESHU__;
    const previousOwner = window.__JIESHU;
    window.__POWERED_BY_JIESHU__ = true;
    window.__JIESHU = sandbox;
    try {
      await expect(destroyApp(name)).resolves.toBeUndefined();
    } finally {
      window.__POWERED_BY_JIESHU__ = previousPowered;
      window.__JIESHU = previousOwner;
    }

    expect(childUnmount).toHaveBeenCalledTimes(1);
    expect(idToSandboxCacheMap.has(name)).toBe(false);
    expect(sandboxTeardownById.has(name)).toBe(false);
  });

  test('async child unmount explicitly marks reentry through a host callback passed in props', async () => {
    const name = 'async-props-reentrant-destroy';
    const sandbox = createSandbox(name);
    const hostDestroy = vi.fn(async () => {
      await Promise.resolve();
      await runAsUnmountReentry(name, () => destroyApp(name));
    });
    const props = Object.freeze({
      getLifecycle: () => Object.freeze({ destroy: hostDestroy }),
    });
    sandbox.provide.props = props;
    sandbox.mountFlag = true;
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = async () => {
      await Promise.resolve();
      const { getLifecycle } = sandbox.provide.props ?? {};
      if (typeof getLifecycle !== 'function') {
        throw new TypeError('Expected the injected lifecycle callback');
      }
      const lifecycle: unknown = getLifecycle();
      if (
        typeof lifecycle !== 'object' ||
        lifecycle === null ||
        !('destroy' in lifecycle) ||
        typeof lifecycle.destroy !== 'function'
      ) {
        throw new TypeError('Expected the injected destroy callback');
      }
      await lifecycle.destroy();
    };

    await expect(destroyApp(name)).resolves.toBeUndefined();

    expect(hostDestroy).toHaveBeenCalledTimes(1);
    expect(idToSandboxCacheMap.has(name)).toBe(false);
    expect(sandboxTeardownById.has(name)).toBe(false);
  });

  test('a concurrent public destroy waits until the first teardown completes', async () => {
    const name = 'external-concurrent-destroy';
    const sandbox = createSandbox(name);
    const gate = deferred<void>();
    sandbox.mountFlag = true;
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = () => gate.promise;

    const firstDestroy = destroyApp(name);
    let concurrentSettled = false;
    const concurrentDestroy = destroyApp(name).then(() => {
      concurrentSettled = true;
    });
    await Promise.resolve();
    expect(concurrentSettled).toBe(false);
    expect(sandboxTeardownById.has(name)).toBe(true);

    gate.resolve();
    await Promise.all([firstDestroy, concurrentDestroy]);
    expect(concurrentSettled).toBe(true);
  });

  test.each([
    { label: 'public start', run: startApp },
    { label: 'public refresh', run: refreshApp },
    { label: 'controller start', run: (options: StartOptions) => createAppController().start(options) },
    { label: 'controller refresh', run: (options: StartOptions) => createAppController().refresh(options) },
  ])('$label waits for async host cleanup and returns the new destroy handler', async ({ run }) => {
    const name = 'queued-start-after-host-cleanup';
    const sandbox = createSandbox(name);
    const cleanupGate = deferred<void>();
    let cleanupFinished = false;
    const cleanup = async () => {
      await cleanupGate.promise;
      cleanupFinished = true;
    };
    sandbox.provide.props = Object.freeze({ cleanup });
    sandbox.mountFlag = true;
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = async () => {
      const { cleanup: hostCleanup } = sandbox.provide.props ?? {};
      if (typeof hostCleanup !== 'function') {
        throw new TypeError('Expected the injected cleanup callback');
      }
      await hostCleanup();
    };

    const destroying = destroyApp(name);
    await Promise.resolve();

    const replacementContainer = document.createElement('main');
    document.body.appendChild(replacementContainer);
    const beforeLoad = vi.fn(() => {
      expect(cleanupFinished).toBe(true);
      const replacement = idToSandboxCacheMap.get(name)?.jieshu;
      if (!replacement) {
        return;
      }
      replacement.active = vi.fn(async () => {
        replacement.activeFlag = true;
      });
      replacement.start = vi.fn(async () => undefined);
    });
    let startSettled = false;
    const starting = run({
      name,
      url: `https://example.test/${name}/`,
      html: '<html><head></head><body>replacement</body></html>',
      el: replacementContainer,
      beforeLoad,
      fiber: false,
    });
    void starting.then(() => {
      startSettled = true;
    });
    await flushPromises();
    expect(startSettled).toBe(false);
    expect(beforeLoad).not.toHaveBeenCalled();

    cleanupGate.resolve();
    await destroying;
    const destroy = await starting;
    if (!destroy) {
      throw new Error('Expected a completed application destroy handler');
    }

    expect(beforeLoad).toHaveBeenCalledTimes(1);
    await destroy();
    expect(idToSandboxCacheMap.has(name)).toBe(false);
  });

  test.each([false, true])(
    'controller destroy shares external completion and failure (rejects=%s)',
    async (rejects) => {
      const name = 'controller-external-waiter';
      const sandbox = createSandbox(name);
      const gate = deferred<void>();
      const failure = new Error('unmount failed');
      sandbox.mountFlag = true;
      sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = async () => {
        await gate.promise;
        if (rejects) {
          throw failure;
        }
      };
      const controller = createAppController();
      let settled = 0;
      const observe = (operation: Promise<void>) =>
        operation.then(
          () => {
            settled += 1;
            return undefined;
          },
          (cause: unknown) => {
            settled += 1;
            return cause;
          },
        );
      const first = observe(destroyApp(name));
      const second = observe(controller.destroy(name));
      await flushPromises();
      expect(settled).toBe(0);
      gate.resolve();
      expect(await Promise.all([first, second])).toEqual(rejects ? [failure, failure] : [undefined, undefined]);
      expect(settled).toBe(2);
      expect(sandboxTeardownById.has(name)).toBe(false);
    },
  );

  test('a new start recovers after a failed prior teardown while the destroy caller sees its failure', async () => {
    const name = 'start-after-failed-teardown';
    const sandbox = createSandbox(name);
    const gate = deferred<void>();
    const failure = new Error('old unmount failed');
    sandbox.mountFlag = true;
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = async () => {
      await gate.promise;
      throw failure;
    };
    const destroying = destroyApp(name).catch((cause: unknown) => cause);
    const starting = startApp({
      name,
      url: 'https://example.test/recovery/',
      html: '<html><head></head><body>replacement</body></html>',
      el: sandbox.el,
      beforeLoad: () => {
        const replacement = idToSandboxCacheMap.get(name)?.jieshu;
        if (!replacement) {
          throw new Error('Expected a replacement sandbox');
        }
        replacement.active = vi.fn(async () => {
          replacement.activeFlag = true;
        });
        replacement.start = vi.fn(async () => undefined);
      },
    });
    gate.resolve();
    expect(await destroying).toBe(failure);
    const destroy = await starting;
    if (!destroy) {
      throw new Error('Expected recovery to produce a destroy handler');
    }
    await destroy();
  });

  test('a same-app destroy from a refresh unmount hook remains the newest cancellation intent', async () => {
    const name = 'reentry-cancels-refresh';
    const sandbox = createSandbox(name);
    sandbox.mountFlag = true;
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = () => destroyApp(name);
    const beforeLoad = vi.fn();
    await expect(
      refreshApp({
        name,
        url: 'https://example.test/refresh/',
        el: sandbox.el,
        beforeLoad,
      }),
    ).resolves.toBeUndefined();
    await sandbox.destroy();
    expect(beforeLoad).not.toHaveBeenCalled();
    expect(idToSandboxCacheMap.has(name)).toBe(false);
  });

  test('explicit async reentry during standalone unmount still requests full destruction', async () => {
    const name = 'unmount-requests-destroy';
    const sandbox = createSandbox(name);
    const iframe = sandbox.iframe;
    sandbox.mountFlag = true;
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = async () => {
      await Promise.resolve();
      await runAsUnmountReentry(name, () => destroyApp(name));
    };
    await sandbox.unmount();
    await sandbox.destroy();
    expect(iframe.isConnected).toBe(false);
    expect(idToSandboxCacheMap.has(name)).toBe(false);
  });

  test('disposing a controller cancels its completion-tracked start behind an unmount', async () => {
    const name = 'disposed-controller-behind-unmount';
    const sandbox = createSandbox(name);
    const cleanupGate = deferred<void>();
    sandbox.mountFlag = true;
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = () => cleanupGate.promise;
    const unmounting = sandbox.unmount();
    const replacementContainer = document.createElement('main');
    document.body.appendChild(replacementContainer);
    const controller = createAppController();

    const starting = controller.start({
      name,
      url: `https://example.test/${name}/`,
      html: '<html><head></head><body>replacement</body></html>',
      el: replacementContainer,
      fiber: false,
    });
    await Promise.resolve();
    controller.dispose();
    cleanupGate.resolve();

    await unmounting;
    await expect(starting).resolves.toBeUndefined();
    for (let attempt = 0; attempt < 20 && idToSandboxCacheMap.has(name); attempt += 1) await Promise.resolve();
    expect(idToSandboxCacheMap.has(name)).toBe(false);
  });

  test('a child realm can request a same-id start from async unmount without cycling', async () => {
    const name = 'async-reentrant-public-start';
    const sandbox = createSandbox(name);
    const replacementContainer = document.createElement('main');
    document.body.appendChild(replacementContainer);
    sandbox.mountFlag = true;
    const childUnmount = vi.fn(async () => {
      await Promise.resolve();
      await startApp({
        name,
        url: `https://example.test/${name}/`,
        html: '<html><head></head><body>replacement</body></html>',
        el: replacementContainer,
        fiber: false,
      });
    });
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = childUnmount;
    const previousPowered = window.__POWERED_BY_JIESHU__;
    const previousOwner = window.__JIESHU;
    window.__POWERED_BY_JIESHU__ = true;
    window.__JIESHU = sandbox;

    try {
      await expect(destroyApp(name)).resolves.toBeUndefined();
    } finally {
      window.__POWERED_BY_JIESHU__ = previousPowered;
      window.__JIESHU = previousOwner;
    }

    expect(childUnmount).toHaveBeenCalledTimes(1);
    await destroyApp(name);
  });

  test('publishes inactive unmount state before resource error callbacks can re-enter', async () => {
    const sandbox = createSandbox('resource-reentrant-unmount');
    let reentered: Promise<void> | undefined;
    const cancellation = vi.fn(() => {
      expect(sandbox.activeFlag).toBe(false);
      reentered = sandbox.unmount();
    });
    registerSandboxDynamicResource(sandbox, cancellation);

    const unmounting = sandbox.unmount();

    expect(cancellation).toHaveBeenCalledTimes(1);
    expect(reentered).toBe(unmounting);
    await unmounting;
    await sandbox.destroy();
  });

  test('alive deactivation preserves a deferred stylesheet observer until href arrives', async () => {
    const sandbox = createSandbox('alive-deferred-style');
    const root = createRenderRoot();
    const loaded = vi.fn();
    const failed = vi.fn();
    const fetch = vi.fn(() =>
      Promise.resolve({
        status: 200,
        text: () => Promise.resolve('body { color: green; }'),
      } as Response),
    );
    sandbox.alive = true;
    sandbox.fetch = fetch;
    sandbox.replace = (code) => code;
    patchRenderEffect(root, sandbox.id);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.onload = loaded;
    link.onerror = failed;
    root.head.appendChild(link);
    expect(sandbox.deferredStyleObservers).toHaveLength(1);

    await sandbox.unmount();
    expect(sandbox.activeFlag).toBe(false);
    expect(sandbox.deferredStyleObservers).toHaveLength(1);

    link.href = 'https://assets.example/deferred-after-deactivate.css';
    await flushPromises();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(sandbox.deferredStyleObservers).toEqual([]);
    await sandbox.destroy();
  });

  test('a reusable unmount rotates the pending asset cache generation', async () => {
    const sandbox = createSandbox('rotated-asset-scope');
    const previousScope = sandbox.assetCacheScope;

    await sandbox.unmount();

    expect(sandbox.assetCacheScope).not.toBe(previousScope);
    await sandbox.destroy();
  });

  test('a destroy triggered by beforeMount prevents child mount', async () => {
    const sandbox = createSandbox('destroy-before-mount');
    const childMount = vi.fn();
    const afterMount = vi.fn();
    let destroying: Promise<void> | undefined;
    sandbox.mountFlag = false;
    sandbox.execQueue = [vi.fn()];
    sandbox.iframe.contentWindow.__JIESHU_MOUNT = childMount;
    sandbox.lifecycles = {
      beforeMount: () => {
        destroying = sandbox.destroy();
      },
      afterMount,
    };

    sandbox.mount();
    await destroying;

    expect(childMount).not.toHaveBeenCalled();
    expect(afterMount).not.toHaveBeenCalled();
  });

  test('an ordinary unmount triggered by beforeMount aborts the stale mount and advances its task', async () => {
    const sandbox = createSandbox('unmount-before-mount');
    const childMount = vi.fn();
    const afterMount = vi.fn();
    const advance = vi.fn();
    let unmounting: Promise<void> | undefined;
    sandbox.mountFlag = false;
    sandbox.execQueue = [advance];
    sandbox.iframe.contentWindow.__JIESHU_MOUNT = childMount;
    sandbox.lifecycles = {
      beforeMount: () => {
        unmounting = sandbox.unmount();
      },
      afterMount,
    };

    sandbox.mount();
    await unmounting;

    expect(childMount).not.toHaveBeenCalled();
    expect(afterMount).not.toHaveBeenCalled();
    expect(sandbox.mountFlag).toBe(false);
    expect(sandbox.activeFlag).toBe(false);
    expect(advance).toHaveBeenCalledTimes(1);
    await sandbox.destroy();
  });

  test('a destroy triggered inside child mount observes mounted state and unmounts it', async () => {
    const sandbox = createSandbox('destroy-inside-mount');
    const childUnmount = vi.fn();
    const afterMount = vi.fn();
    let destroying: Promise<void> | undefined;
    sandbox.mountFlag = false;
    sandbox.execQueue = [vi.fn()];
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = childUnmount;
    sandbox.iframe.contentWindow.__JIESHU_MOUNT = () => {
      destroying = sandbox.destroy();
    };
    sandbox.lifecycles = { afterMount };

    sandbox.mount();
    await destroying;

    expect(childUnmount).toHaveBeenCalledTimes(1);
    expect(afterMount).not.toHaveBeenCalled();
  });

  test('an ordinary unmount inside child mount prevents afterMount', async () => {
    const sandbox = createSandbox('unmount-inside-mount');
    const childUnmount = vi.fn();
    const afterMount = vi.fn();
    let unmounting: Promise<void> | undefined;
    sandbox.mountFlag = false;
    sandbox.execQueue = [vi.fn()];
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = childUnmount;
    sandbox.iframe.contentWindow.__JIESHU_MOUNT = () => {
      unmounting = sandbox.unmount();
    };
    sandbox.lifecycles = { afterMount };

    sandbox.mount();
    await unmounting;

    expect(childUnmount).toHaveBeenCalledTimes(1);
    expect(afterMount).not.toHaveBeenCalled();
    expect(sandbox.mountFlag).toBe(false);
    await sandbox.destroy();
  });
});
