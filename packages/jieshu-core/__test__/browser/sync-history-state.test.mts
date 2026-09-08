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
    response.end(
      '<!doctype html><html><head></head><body><main id="app-a"></main><main id="app-b"></main></body></html>',
    );
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    throw new Error('The sync history regression server must expose a local URL');
  }
  origin = url;
});

test.afterAll(async () => {
  await server?.close();
});

for (const fiber of [false, true]) {
  test(`route synchronization preserves host state and encoded hash URLs (fiber=${fiber})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    const result = await page.evaluate(async (fiber) => {
      const coreUrl = '/packages/jieshu-core/src/index.ts';
      const commonUrl = '/packages/jieshu-core/src/common.ts';
      const { startApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
      const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
      const hostState = {
        key: 'host-entry',
        idx: 4,
        usr: { selected: ['中', 'a+b'], scroll: { left: 13, top: 29 } },
      };
      history.replaceState(hostState, '', '/host?keep=a%2Bb&raw=100%25%20%26%3D%20%E4%B8%AD#host-%E4%B8%AD');
      const options = {
        name: 'sync-child',
        url: `${location.origin}/child/`,
        el: '#app-a',
        sync: true,
        fiber,
        html: '<html><head><script>window.__JIESHU_MOUNT = () => {}; window.__JIESHU_UNMOUNT = () => {};</script></head><body>child</body></html>',
      };
      const snapshot = () => {
        const url = new URL(location.href);
        const state: unknown = structuredClone(history.state);
        return {
          state,
          childRoute: url.searchParams.get(options.name),
          keep: url.searchParams.get('keep'),
          raw: url.searchParams.get('raw'),
          hash: url.hash,
        };
      };
      await startApp(options);
      const started = snapshot();
      const iframeWindow = getJieshuById(options.name)?.iframe.contentWindow;
      if (!iframeWindow) {
        throw new Error('The synchronized child must have a live iframe');
      }
      iframeWindow.history.pushState({ child: 'push' }, '', '/child/push?q=%E4%B8%AD%2B%25#child');
      const pushed = snapshot();
      iframeWindow.history.replaceState({ child: 'replace' }, '', '/child/replace?q=a%2Bb#before');
      const replaced = snapshot();
      const childState: unknown = structuredClone(iframeWindow.history.state);
      const hashChanged = new Promise<void>((resolve) => {
        iframeWindow.addEventListener('hashchange', () => resolve(), { once: true });
      });
      iframeWindow.location.hash = '#changed';
      await hashChanged;
      const changedHash = snapshot();
      await startApp({ ...options, sync: false });
      const disabled = snapshot();
      await startApp(options);
      const enabled = snapshot();
      await destroyApp(options.name);
      const destroyed = snapshot();
      return { hostState, started, pushed, replaced, childState, changedHash, disabled, enabled, destroyed };
    }, fiber);

    for (const snapshot of [
      result.started,
      result.pushed,
      result.replaced,
      result.changedHash,
      result.disabled,
      result.enabled,
      result.destroyed,
    ]) {
      expect(snapshot.state).toEqual(result.hostState);
      expect(snapshot.keep).toBe('a+b');
      expect(snapshot.raw).toBe('100% &= 中');
      expect(snapshot.hash).toBe('#host-%E4%B8%AD');
    }
    expect(result.started.childRoute).toBe('/child/');
    expect(result.pushed.childRoute).toBe('/child/push?q=%E4%B8%AD%2B%25#child');
    expect(result.replaced.childRoute).toBe('/child/replace?q=a%2Bb#before');
    expect(result.childState).toEqual({ child: 'replace' });
    expect(result.changedHash.childRoute).toBe('/child/replace?q=a%2Bb#changed');
    expect(result.disabled.childRoute).toBeNull();
    expect(result.enabled.childRoute).toBe('/child/');
    expect(result.destroyed.childRoute).toBeNull();
    expect(errors).toEqual([]);
  });
}

test('alive unmount and per-app destroy preserve another app route and host state', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const coreUrl = '/packages/jieshu-core/src/index.ts';
    const commonUrl = '/packages/jieshu-core/src/common.ts';
    const { startApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
    const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
    const hostState = { key: 'two-apps', position: 7, scroll: { left: 4, top: 80 }, business: { count: 12 } };
    history.replaceState(hostState, '', '/host?keep=%E4%B8%AD%2B%25#dashboard');
    const options = {
      name: 'sync-alive',
      url: `${location.origin}/alive/`,
      el: '#app-a',
      sync: true,
      alive: true,
      fiber: true,
      html: '<html><head><script>window.__JIESHU_MOUNT = () => {};</script></head><body>child</body></html>',
    };
    const snapshot = () => {
      const url = new URL(location.href);
      const state: unknown = structuredClone(history.state);
      return {
        state,
        alive: url.searchParams.get('sync-alive'),
        peer: url.searchParams.get('sync-peer'),
        keep: url.searchParams.get('keep'),
        hash: url.hash,
      };
    };
    await startApp(options);
    await startApp({ ...options, name: 'sync-peer', url: `${location.origin}/peer/`, el: '#app-b', alive: false });
    const started = snapshot();
    const alive = getJieshuById(options.name);
    if (!alive) {
      throw new Error('The alive app must exist');
    }
    await alive.unmount();
    const unmounted = snapshot();
    await startApp(options);
    const reactivated = snapshot();
    await destroyApp(options.name);
    const destroyedAlive = snapshot();
    await destroyApp('sync-peer');
    const destroyedBoth = snapshot();
    return { hostState, started, unmounted, reactivated, destroyedAlive, destroyedBoth };
  });

  for (const snapshot of [
    result.started,
    result.unmounted,
    result.reactivated,
    result.destroyedAlive,
    result.destroyedBoth,
  ]) {
    expect(snapshot.state).toEqual(result.hostState);
    expect(snapshot.keep).toBe('中+%');
    expect(snapshot.hash).toBe('#dashboard');
  }
  expect(result.started).toMatchObject({ alive: '/alive/', peer: '/peer/' });
  expect(result.unmounted).toMatchObject({ alive: null, peer: '/peer/' });
  expect(result.reactivated).toMatchObject({ alive: '/alive/', peer: '/peer/' });
  expect(result.destroyedAlive).toMatchObject({ alive: null, peer: '/peer/' });
  expect(result.destroyedBoth).toMatchObject({ alive: null, peer: null });
  expect(errors).toEqual([]);
});

test('Vue Router web history retains its state through synchronization and host back/forward', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const coreUrl = '/packages/jieshu-core/src/index.ts';
    const commonUrl = '/packages/jieshu-core/src/common.ts';
    const routerUrl = '/examples/vue3/node_modules/vue-router/dist/vue-router.mjs';
    const { startApp, destroyApp }: typeof import('../../src/index') = await import(coreUrl);
    const { getJieshuById }: typeof import('../../src/common') = await import(commonUrl);
    const { createRouter, createWebHistory }: typeof import('../../../../examples/vue3/node_modules/vue-router') =
      await import(routerUrl);
    const routerHistory = createWebHistory('/');
    const router = createRouter({
      history: routerHistory,
      routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
    });
    await router.push('/host/one');
    await router.push({
      path: '/host/two',
      query: { keep: 'a+b' },
      hash: '#two',
      state: { business: { view: 'two' } },
    });
    const secondState: unknown = structuredClone(history.state);
    const secondPosition = routerHistory.state['position'];
    await startApp({
      name: 'sync-router',
      url: `${location.origin}/child/`,
      el: '#app-a',
      fiber: true,
      sync: true,
      html: '<html><head><script>window.__JIESHU_MOUNT = () => {};</script></head><body>child</body></html>',
    });
    const afterStart: unknown = structuredClone(history.state);
    const iframeWindow = getJieshuById('sync-router')?.iframe.contentWindow;
    if (!iframeWindow) {
      throw new Error('The router fixture must have a synchronized child');
    }
    iframeWindow.history.replaceState({ child: 'second' }, '', '/child/second');
    const afterSecondSync: unknown = structuredClone(history.state);
    await router.push({ path: '/host/three', state: { business: { view: 'three' } } });
    const thirdState: unknown = structuredClone(history.state);
    iframeWindow.history.replaceState({ child: 'third' }, '', '/child/third');
    const afterThirdSync: unknown = structuredClone(history.state);
    const travel = async (delta: number) => {
      const changed = new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
      });
      router.go(delta);
      await changed;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const state: unknown = structuredClone(history.state);
      return { state, route: router.currentRoute.value.path };
    };
    const back = await travel(-1);
    const forward = await travel(1);
    await destroyApp('sync-router');
    const afterDestroy: unknown = structuredClone(history.state);
    routerHistory.destroy();
    return {
      secondState,
      secondPosition,
      afterStart,
      afterSecondSync,
      thirdState,
      afterThirdSync,
      back,
      forward,
      afterDestroy,
    };
  });

  expect(result.afterStart).toEqual(result.secondState);
  expect(result.afterSecondSync).toEqual(result.secondState);
  expect(result.afterThirdSync).toEqual(result.thirdState);
  expect(result.back.route).toBe('/host/two');
  expect(result.back.state).toMatchObject({ business: { view: 'two' }, position: result.secondPosition });
  expect(result.forward.route).toBe('/host/three');
  expect(result.forward.state).toEqual(result.thirdState);
  expect(result.afterDestroy).toEqual(result.thirdState);
  expect(errors).toEqual([]);
});

test('href synchronization creates a null-state entry and back restores the original host state', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const syncUrl = '/packages/jieshu-core/src/sync.ts';
    const { pushUrlToWindow }: typeof import('../../src/sync') = await import(syncUrl);
    const originalState = { key: 'before-href', idx: 8, position: 12, business: { selected: '中+%' } };
    history.replaceState(originalState, '', '/host?keep=a%2Bb#original');
    const originalHref = location.href;
    const originalLength = history.length;
    pushUrlToWindow('href-child', 'https://example.test/target?q=%E4%B8%AD#child');
    const pushedState: unknown = structuredClone(history.state);
    const pushedLength = history.length;
    const pushed = new URL(location.href);
    const wentBack = new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
    });
    history.back();
    await wentBack;
    const restoredState: unknown = structuredClone(history.state);
    return {
      originalState,
      pushedState,
      addedOneEntry: pushedLength === originalLength + 1,
      childRoute: pushed.searchParams.get('href-child'),
      keep: pushed.searchParams.get('keep'),
      hash: pushed.hash,
      restoredState,
      restoredHref: location.href === originalHref,
    };
  });

  expect(result.pushedState).toBeNull();
  expect(result.addedOneEntry).toBe(true);
  expect(result.childRoute).toBe('https://example.test/target?q=%E4%B8%AD#child');
  expect(result.keep).toBe('a+b');
  expect(result.hash).toBe('#original');
  expect(result.restoredState).toEqual(result.originalState);
  expect(result.restoredHref).toBe(true);
});
