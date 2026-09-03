import Jieshu from '../../src/sandbox';
import { createAppController, destroyApp, startApp } from '../../src/index';
import { idToSandboxCacheMap, sandboxTeardownById } from '../../src/common';
import { registerSandboxDynamicResource } from '../../src/sandbox-runtime';
import { patchRenderEffect } from '../../src/effect';

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
    degradeAttrs: {},
    fiber: false,
    degrade: true,
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

  test('async child unmount can reenter through a host callback passed in props', async () => {
    const name = 'async-props-reentrant-destroy';
    const sandbox = createSandbox(name);
    const hostDestroy = vi.fn(async () => {
      await Promise.resolve();
      await destroyApp(name);
    });
    const props = Object.freeze({
      getLifecycle: () => Object.freeze({ destroy: hostDestroy }),
    });
    sandbox.provide.props = props;
    sandbox.mountFlag = true;
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = async () => {
      await Promise.resolve();
      const getLifecycle = sandbox.provide.props?.['getLifecycle'] as () => { destroy(): Promise<void> };
      const lifecycle = getLifecycle();
      await lifecycle.destroy();
    };

    await expect(destroyApp(name)).resolves.toBeUndefined();

    expect(hostDestroy).toHaveBeenCalledTimes(1);
    expect(idToSandboxCacheMap.has(name)).toBe(false);
    expect(sandboxTeardownById.has(name)).toBe(false);
  });

  test('a concurrent public destroy acknowledges ownership while the first teardown continues', async () => {
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
    expect(concurrentSettled).toBe(true);
    expect(sandboxTeardownById.has(name)).toBe(true);

    gate.resolve();
    await Promise.all([firstDestroy, concurrentDestroy]);
    expect(concurrentSettled).toBe(true);
  });

  test('a concurrent start stays queued until an async host cleanup really settles', async () => {
    const name = 'queued-start-after-host-cleanup';
    const sandbox = createSandbox(name);
    const cleanupGate = deferred<void>();
    let cleanupFinished = false;
    const cleanup = async (): Promise<void> => {
      await cleanupGate.promise;
      cleanupFinished = true;
    };
    sandbox.provide.props = Object.freeze({ cleanup });
    sandbox.mountFlag = true;
    sandbox.iframe.contentWindow.__JIESHU_UNMOUNT = async () => {
      const hostCleanup = sandbox.provide.props?.['cleanup'] as () => Promise<void>;
      await hostCleanup();
    };

    const destroying = destroyApp(name);
    await Promise.resolve();

    const replacementContainer = document.createElement('main');
    document.body.appendChild(replacementContainer);
    const beforeLoad = vi.fn(() => {
      expect(cleanupFinished).toBe(true);
      const replacement = idToSandboxCacheMap.get(name)?.jieshu;
      if (!replacement) return;
      replacement.active = vi.fn(async () => {
        replacement.activeFlag = true;
      });
      replacement.start = vi.fn(async () => undefined);
    });
    await expect(
      startApp({
        name,
        url: `https://example.test/${name}/`,
        html: '<html><head></head><body>replacement</body></html>',
        el: replacementContainer,
        beforeLoad,
        fiber: false,
      }),
    ).resolves.toBeUndefined();
    expect(beforeLoad).not.toHaveBeenCalled();

    cleanupGate.resolve();
    await destroying;
    for (let attempt = 0; attempt < 20 && !beforeLoad.mock.calls.length; attempt += 1) await Promise.resolve();

    expect(beforeLoad).toHaveBeenCalledTimes(1);
    await destroyApp(name);
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
    patchRenderEffect(root, sandbox.id, false);
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
