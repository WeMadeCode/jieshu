import { destroyApp, refreshApp, runAsUnmountReentry, startApp } from '../../src/index';
import {
  idToSandboxCacheMap,
  isSandboxUnmountHookActive,
  registerSandboxTeardown,
  sandboxTeardownById,
} from '../../src/common';
import { observeOperation } from '../../src/operation-intent';

const deferred = () => {
  let complete: () => void;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: () => complete() };
};

describe('explicit unmount reentry', () => {
  beforeEach(() => {
    idToSandboxCacheMap.clear();
    sandboxTeardownById.clear();
  });

  test('without pending cleanup invokes the callback normally and preserves its return value', () => {
    const value = Promise.resolve(1);
    const result = runAsUnmountReentry('idle', () => {
      expect(isSandboxUnmountHookActive('idle')).toBe(false);
      return value;
    });
    expect(result).toBe(value);
  });

  test('nested scopes stay active until their own synchronous exit and clean up after throws', async () => {
    const gate = deferred();
    const teardown = registerSandboxTeardown('nested', gate.promise);
    const failure = new Error('callback failed');
    expect(() =>
      runAsUnmountReentry('nested', () => {
        expect(isSandboxUnmountHookActive('nested')).toBe(true);
        expect(isSandboxUnmountHookActive('other')).toBe(false);
        expect(runAsUnmountReentry('nested', () => 7)).toBe(7);
        expect(isSandboxUnmountHookActive('nested')).toBe(true);
        throw failure;
      }),
    ).toThrow(failure);
    expect(isSandboxUnmountHookActive('nested')).toBe(false);
    gate.resolve();
    await teardown;
  });

  test('an asynchronous callback does not mark its continuation or concurrent host calls', async () => {
    const gate = deferred();
    const teardown = registerSandboxTeardown('async-scope', gate.promise);
    let callbackSettled = false;
    let hostSettled = false;
    const callback = runAsUnmountReentry('async-scope', async () => {
      expect(isSandboxUnmountHookActive('async-scope')).toBe(true);
      await Promise.resolve();
      expect(isSandboxUnmountHookActive('async-scope')).toBe(false);
      await destroyApp('async-scope');
      callbackSettled = true;
    });
    const host = destroyApp('async-scope').then(() => {
      hostSettled = true;
    });
    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve();
    }
    expect(callbackSettled).toBe(false);
    expect(hostSettled).toBe(false);
    gate.resolve();
    await Promise.all([teardown, callback, host]);
    expect(callbackSettled).toBe(true);
    expect(hostSettled).toBe(true);
  });

  test.each([startApp, refreshApp])(
    'same-app reentrant %s is cancelled without replacing the current intent',
    async (run) => {
      const gate = deferred();
      const teardown = registerSandboxTeardown('cancel-reentry', gate.promise);
      const intent = observeOperation('cancel-reentry');
      const result = runAsUnmountReentry('cancel-reentry', () => run({ name: 'cancel-reentry' }));
      await expect(result).resolves.toBeUndefined();
      expect(observeOperation('cancel-reentry').revision).toBe(intent.revision);
      expect(sandboxTeardownById.has('cancel-reentry')).toBe(true);
      gate.resolve();
      await teardown;
    },
  );

  test('marking one application does not detach an operation for another application', async () => {
    const firstGate = deferred();
    const secondGate = deferred();
    const first = registerSandboxTeardown('one', firstGate.promise);
    const second = registerSandboxTeardown('two', secondGate.promise);
    let settled = false;
    const destroying = runAsUnmountReentry('one', () => destroyApp('two')).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    secondGate.resolve();
    await destroying;
    expect(settled).toBe(true);
    expect(sandboxTeardownById.has('one')).toBe(true);
    firstGate.resolve();
    await Promise.all([first, second]);
  });
});
