import { clearAssetsCache, destroyApp, startApp } from '../../src/index';
import { getJieshuById, idToSandboxCacheMap, sandboxTeardownById } from '../../src/common';

const name = 'startup-reuse';
const options = () => ({
  name,
  url: `https://example.test/${name}/`,
  el: '#app',
  html: '<html><head></head><body>ready</body></html>',
  fiber: false,
});

const prepareSandbox = async () => {
  await startApp({
    ...options(),
    beforeLoad: () => {
      const sandbox = getJieshuById(name);
      if (!sandbox) {
        throw new Error('The startup fixture requires a sandbox');
      }
      sandbox.active = vi.fn(async () => {
        sandbox.activeFlag = true;
      });
      sandbox.start = vi.fn(async () => {});
    },
  });
  const sandbox = getJieshuById(name);
  const iframeWindow = sandbox?.iframe.contentWindow;
  if (!sandbox || !iframeWindow) {
    throw new Error('The initialized fixture requires a child window');
  }
  iframeWindow.__JIESHU_MOUNT = vi.fn();
  return { sandbox, iframeWindow };
};

beforeEach(() => {
  clearAssetsCache();
  idToSandboxCacheMap.clear();
  sandboxTeardownById.clear();
  document.head.innerHTML = '';
  document.body.innerHTML = '<main id="app"></main>';
});

afterEach(async () => {
  await destroyApp(name);
  vi.restoreAllMocks();
});

test.each([false, true])('alive reuse executes a prepared child only when needed (exec=%s)', async (exec) => {
  const { sandbox, iframeWindow } = await prepareSandbox();
  const calls: string[] = [];
  sandbox.execFlag = exec;
  const active = vi.spyOn(sandbox, 'active').mockImplementation(async () => {
    calls.push('active');
    sandbox.activeFlag = true;
  });
  const start = vi.spyOn(sandbox, 'start').mockImplementation(async () => {
    calls.push('start');
  });
  active.mockClear();
  start.mockClear();
  const beforeLoad = vi.fn(() => calls.push('beforeLoad'));
  const activated = vi.fn(() => calls.push('activated'));

  const destroy = await startApp({ ...options(), alive: true, beforeLoad, activated });

  expect(calls).toEqual(exec ? ['active', 'activated'] : ['active', 'beforeLoad', 'start', 'activated']);
  expect(active).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledTimes(exec ? 0 : 1);
  expect(activated).toHaveBeenCalledExactlyOnceWith(iframeWindow);
  expect(getJieshuById(name)).toBe(sandbox);
  expect(sandbox.initialized).toBe(true);
  expect(destroy).toEqual(expect.any(Function));
  await destroy?.();
  expect(getJieshuById(name)).toBeNull();
});

test('non-alive reuse restores styles before mount and keeps the same instance', async () => {
  const { sandbox } = await prepareSandbox();
  const calls: string[] = [];
  vi.spyOn(sandbox, 'unmount').mockImplementation(async () => {
    calls.push('unmount');
    sandbox.activeFlag = false;
  });
  vi.spyOn(sandbox, 'active').mockImplementation(async () => {
    calls.push('active');
    sandbox.activeFlag = true;
  });
  vi.spyOn(sandbox, 'rebuildStyleSheets').mockImplementation(() => {
    calls.push('styles');
  });
  const mount = vi.spyOn(sandbox, 'mount').mockImplementation(() => {
    calls.push('mount');
  });

  await expect(startApp(options())).resolves.toEqual(expect.any(Function));

  expect(calls).toEqual(['unmount', 'active', 'styles', 'mount']);
  expect(mount).toHaveBeenCalledExactlyOnceWith(false);
  expect(getJieshuById(name)).toBe(sandbox);
  expect(sandbox.initialized).toBe(true);
});

test.each([false, true])('failed reuse cleans the old instance without rebuilding (alive=%s)', async (alive) => {
  const { sandbox } = await prepareSandbox();
  const failure = new Error('activation failed');
  vi.spyOn(sandbox, 'active').mockRejectedValue(failure);

  await expect(startApp({ ...options(), alive })).rejects.toBe(failure);

  expect(sandbox.destroyed).toBe(true);
  expect(getJieshuById(name)).toBeNull();
});

test.each([false, true])('interrupted reuse never falls through to creation (alive=%s)', async (alive) => {
  const { sandbox } = await prepareSandbox();
  vi.spyOn(sandbox, 'active').mockImplementation(async () => {
    sandbox.activeFlag = false;
  });

  await expect(startApp({ ...options(), alive })).resolves.toBeUndefined();

  expect(sandbox.initialized).toBe(false);
  expect(sandbox.destroyed).toBe(true);
  expect(getJieshuById(name)).toBeNull();
});

test('reuse cancellation during activation does not recreate the child', async () => {
  const { sandbox } = await prepareSandbox();
  vi.spyOn(sandbox, 'active').mockImplementation(async () => {
    await destroyApp(name);
  });

  await expect(startApp({ ...options(), alive: true })).resolves.toBeUndefined();

  expect(sandbox.initialized).toBe(false);
  expect(getJieshuById(name)).toBeNull();
});

test('a child without a mount hook is rebuilt and publishes only its replacement', async () => {
  const { sandbox, iframeWindow } = await prepareSandbox();
  Reflect.deleteProperty(iframeWindow, '__JIESHU_MOUNT');

  const { sandbox: replacement } = await prepareSandbox();

  expect(sandbox.destroyed).toBe(true);
  expect(replacement).not.toBe(sandbox);
  expect(replacement.initialized).toBe(true);
  expect(getJieshuById(name)).toBe(replacement);
});
