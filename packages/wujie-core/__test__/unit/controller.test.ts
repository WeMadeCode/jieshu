import { RuntimeAppController, AppRuntime } from '../../src/controller';
import type { DestroyHandler, StartOptions } from '../../src/contracts';

function options(name = 'catalog', url = 'https://example.test/app'): StartOptions {
  return { name, url, el: document.createElement('div') };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function runtime(overrides: Partial<AppRuntime> = {}): AppRuntime {
  return {
    start: jest.fn(async () => undefined),
    refresh: jest.fn(async () => undefined),
    destroy: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
    ...overrides,
  };
}

describe('RuntimeAppController', () => {
  test('starts a newer intent immediately and cleans up a stale result', async () => {
    const first = deferred<DestroyHandler | void>();
    const second = deferred<DestroyHandler | void>();
    const staleDestroy = jest.fn(async () => undefined);
    const currentDestroy = jest.fn(async () => undefined);
    const start = jest
      .fn<ReturnType<AppRuntime['start']>, Parameters<AppRuntime['start']>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = new RuntimeAppController(runtime({ start }));

    const firstRun = controller.start(options());
    const secondRun = controller.start(options('catalog', 'https://example.test/next'));

    expect(start).toHaveBeenCalledTimes(2);
    second.resolve(currentDestroy);
    await expect(secondRun).resolves.toBe(currentDestroy);
    first.resolve(staleDestroy);
    await expect(firstRun).resolves.toBeUndefined();
    expect(staleDestroy).toHaveBeenCalledTimes(1);
    expect(currentDestroy).not.toHaveBeenCalled();
  });

  test('releases a pending previous name before a replacement uses the same container', async () => {
    const catalogResult = deferred<DestroyHandler | void>();
    const checkoutResult = deferred<DestroyHandler | void>();
    const catalogReleased = deferred<void>();
    const staleDestroy = jest.fn(async () => undefined);
    const start = jest
      .fn<ReturnType<AppRuntime['start']>, Parameters<AppRuntime['start']>>()
      .mockReturnValueOnce(catalogResult.promise)
      .mockReturnValueOnce(checkoutResult.promise);
    const destroy = jest.fn(() => catalogReleased.promise);
    const controller = new RuntimeAppController(runtime({ start, destroy }));

    const catalog = controller.start(options('catalog'));
    const checkout = controller.start(options('checkout'));

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith('catalog');
    expect(start).toHaveBeenCalledTimes(1);

    catalogReleased.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'checkout' }));

    checkoutResult.resolve(undefined);
    catalogResult.resolve(staleDestroy);
    await Promise.all([catalog, checkout]);
    expect(staleDestroy).toHaveBeenCalledTimes(1);
  });

  test('carries an outstanding release barrier across a rapid A to B to C switch', async () => {
    const catalogResult = deferred<DestroyHandler | void>();
    const reportsResult = deferred<DestroyHandler | void>();
    const catalogReleased = deferred<void>();
    const start = jest
      .fn<ReturnType<AppRuntime['start']>, Parameters<AppRuntime['start']>>()
      .mockReturnValueOnce(catalogResult.promise)
      .mockReturnValueOnce(reportsResult.promise);
    const destroy = jest.fn(() => catalogReleased.promise);
    const controller = new RuntimeAppController(runtime({ start, destroy }));

    const catalog = controller.start(options('catalog'));
    const checkout = controller.start(options('checkout'));
    const reports = controller.start(options('reports'));

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith('catalog');
    expect(start).toHaveBeenCalledTimes(1);

    catalogReleased.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'reports' }));

    reportsResult.resolve(undefined);
    catalogResult.resolve(undefined);
    await Promise.all([catalog, checkout, reports]);
  });

  test('releases a completed previous name before starting a new identity', async () => {
    const previousReleased = deferred<void>();
    const start = jest.fn(async () => undefined);
    const destroy = jest.fn(() => previousReleased.promise);
    const controller = new RuntimeAppController(runtime({ start, destroy }));

    await controller.start(options('catalog'));
    const checkout = controller.start(options('checkout'));

    expect(destroy).toHaveBeenCalledWith('catalog');
    expect(start).toHaveBeenCalledTimes(1);

    previousReleased.resolve();
    await checkout;
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'checkout' }));
  });

  test('unmounts a completed alive application before an identity switch while keeping it cacheable', async () => {
    const start = jest.fn(async () => undefined);
    const destroy = jest.fn(async () => undefined);
    const release = jest.fn(async () => undefined);
    const controller = new RuntimeAppController(runtime({ start, destroy, release }));
    const aliveOptions = options('catalog');
    aliveOptions.alive = true;

    await controller.start(aliveOptions);
    await controller.start(options('checkout'));

    expect(destroy).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('catalog');
    expect(start).toHaveBeenCalledTimes(2);
  });

  test('honors core-resolved reusable state from alive or mount/unmount lifecycles', async () => {
    const start = jest.fn(async () => undefined);
    const destroy = jest.fn(async () => undefined);
    const release = jest.fn(async () => undefined);
    const controller = new RuntimeAppController(
      runtime({ start, destroy, release, shouldPreserveOnDisconnect: (name) => name === 'catalog' }),
    );

    await controller.start(options('catalog'));
    await controller.start(options('checkout'));

    expect(destroy).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('catalog');
  });

  test('waits for an asynchronous reusable unmount before mounting the replacement', async () => {
    const released = deferred<void>();
    const start = jest.fn(async () => undefined);
    const release = jest.fn(() => released.promise);
    const controller = new RuntimeAppController(
      runtime({ start, release, shouldPreserveOnDisconnect: (name) => name === 'catalog' }),
    );

    await controller.start(options('catalog'));
    const checkout = controller.start(options('checkout'));

    expect(release).toHaveBeenCalledWith('catalog');
    expect(start).toHaveBeenCalledTimes(1);
    released.resolve();
    await checkout;
    expect(start).toHaveBeenCalledTimes(2);
  });

  test('falls back to full destroy when reusable unmount rejects', async () => {
    const destroyed = deferred<void>();
    const start = jest.fn(async () => undefined);
    const release = jest.fn(async () => {
      throw new Error('child unmount failed');
    });
    const destroy = jest.fn(() => destroyed.promise);
    const controller = new RuntimeAppController(
      runtime({ start, release, destroy, shouldPreserveOnDisconnect: (name) => name === 'catalog' }),
    );

    await controller.start(options('catalog'));
    const checkout = controller.start(options('checkout'));
    await Promise.resolve();

    expect(release).toHaveBeenCalledWith('catalog');
    expect(destroy).toHaveBeenCalledWith('catalog');
    expect(start).toHaveBeenCalledTimes(1);
    destroyed.resolve();
    await checkout;
    expect(start).toHaveBeenCalledTimes(2);
  });

  test('keeps a top-level options snapshot', async () => {
    const seen: StartOptions[] = [];
    const controller = new RuntimeAppController(
      runtime({
        start: jest.fn(async (request) => {
          seen.push(request);
          return undefined;
        }),
      }),
    );
    const request = options('catalog', 'https://example.test/original');

    const running = controller.start(request);
    request.url = 'https://example.test/mutated';
    await running;

    expect(seen[0].url).toBe('https://example.test/original');
  });

  test('does not let a rejection poison later work', async () => {
    const failure = new Error('start failed');
    const start = jest
      .fn<ReturnType<AppRuntime['start']>, Parameters<AppRuntime['start']>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const controller = new RuntimeAppController(runtime({ start }));

    await expect(controller.start(options())).rejects.toBe(failure);
    await expect(controller.start(options())).resolves.toBeUndefined();
  });

  test('refresh delegates one atomic runtime intent with captured options', async () => {
    const refreshGate = deferred<DestroyHandler | void>();
    const refresh = jest.fn(() => refreshGate.promise);
    const appRuntime = runtime({
      refresh,
    });
    const controller = new RuntimeAppController(appRuntime);
    const request = options('catalog', 'https://example.test/original');

    const refreshing = controller.refresh(request);
    request.url = 'https://example.test/mutated';
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.test/original' }));
    refreshGate.resolve(undefined);
    await refreshing;
  });

  test('dispose interrupts an in-flight start and cleans up a late result', async () => {
    const pending = deferred<DestroyHandler | void>();
    const lateDestroy = jest.fn(async () => undefined);
    const destroy = jest.fn(async () => undefined);
    const controller = new RuntimeAppController(runtime({ start: jest.fn(() => pending.promise), destroy }));

    const running = controller.start(options());
    controller.dispose();

    expect(destroy).toHaveBeenCalledWith('catalog');
    pending.resolve(lateDestroy);
    await running;
    expect(lateDestroy).toHaveBeenCalledTimes(1);
  });

  test('dispose leaves an already completed cached application to the disconnect path', async () => {
    const destroy = jest.fn(async () => undefined);
    const controller = new RuntimeAppController(runtime({ destroy }));

    await controller.start(options());
    controller.dispose();

    expect(destroy).not.toHaveBeenCalled();
  });

  test('explicit destroy interrupts a pending start without waiting for it', async () => {
    const blocker = deferred<DestroyHandler | void>();
    const destroyGate = deferred<void>();
    const destroy = jest.fn(() => destroyGate.promise);
    const controller = new RuntimeAppController(runtime({ start: jest.fn(() => blocker.promise), destroy }));

    const running = controller.start(options());
    const destroying = controller.destroy('catalog');
    expect(destroy).toHaveBeenCalledWith('catalog');

    destroyGate.resolve();
    await destroying;
    blocker.resolve(undefined);
    await running;
  });

  test('a newer start supersedes a refresh before its destroy finishes', async () => {
    const refreshGate = deferred<DestroyHandler | void>();
    const start = jest.fn(async () => undefined);
    const controller = new RuntimeAppController(runtime({ start, refresh: jest.fn(() => refreshGate.promise) }));

    const refreshing = controller.refresh(options('catalog', 'https://example.test/refresh'));
    const starting = controller.start(options('catalog', 'https://example.test/latest'));
    refreshGate.resolve(undefined);
    await Promise.all([refreshing, starting]);

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.test/latest' }));
  });
});
