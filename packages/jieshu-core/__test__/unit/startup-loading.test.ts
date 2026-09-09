import { getJieshuById, idToSandboxCacheMap, sandboxTeardownById } from '../../src/common';
import { CONTAINER_OVERFLOW_DATA_FLAG, CONTAINER_POSITION_DATA_FLAG, LOADING_DATA_FLAG } from '../../src/constant';
import { clearAssetsCache, destroyApp, refreshApp, startApp } from '../../src/index';
import {
  addLoading,
  removeLoading,
  removeRenderedElementFromContainer,
  renderElementToContainer,
} from '../../src/shadow';

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
};

const loadingSelector = `div[${LOADING_DATA_FLAG}]`;
const pending: Array<Promise<unknown>> = [];
const gates: Array<ReturnType<typeof deferred>> = [];

const container = () => {
  const element = document.createElement('main');
  element.style.position = 'static';
  element.style.overflow = 'visible';
  document.body.appendChild(element);
  return element;
};

const options = (name: string, el: HTMLElement) => ({
  name,
  el,
  url: `https://example.test/${name}/`,
  fiber: false,
});

const startPending = (name: string, el: HTMLElement, run = startApp, failure?: Error) => {
  const html = deferred();
  const requested = deferred();
  gates.push(html);
  const starting = run({
    ...options(name, el),
    fetch: async () => {
      requested.resolve();
      await html.promise;
      if (failure) {
        throw failure;
      }
      return new Response('<html><head></head><body>late response</body></html>');
    },
  });
  pending.push(starting);
  return { starting, requested: requested.promise, release: html.resolve };
};

const expectRestored = (el: HTMLElement) => {
  expect(el.querySelector(loadingSelector)).toBeNull();
  expect(el.style.position).toBe('');
  expect(el.style.overflow).toBe('');
  expect(el.hasAttribute(CONTAINER_POSITION_DATA_FLAG)).toBe(false);
  expect(el.hasAttribute(CONTAINER_OVERFLOW_DATA_FLAG)).toBe(false);
};

describe('startup loading ownership before activation', () => {
  beforeEach(() => {
    idToSandboxCacheMap.clear();
    sandboxTeardownById.clear();
    clearAssetsCache();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    await Promise.all([...idToSandboxCacheMap.keys()].map((name) => destroyApp(name)));
    gates.splice(0).forEach((gate) => gate.resolve());
    await Promise.allSettled(pending.splice(0));
  });

  test.each([
    ['start', startApp],
    ['refresh', refreshApp],
  ] as const)('%s cancellation removes its loading before the HTML request settles', async (label, run) => {
    const el = container();
    const name = `cancel-${label}`;
    const work = startPending(name, el, run);
    await work.requested;
    expect(el.querySelector(loadingSelector)).not.toBeNull();
    expect(el.style.position).toBe('relative');
    expect(el.style.overflow).toBe('hidden');

    await destroyApp(name);
    expectRestored(el);
    await expect(work.starting).resolves.toBeUndefined();

    expect(getJieshuById(name)).toBeNull();
  });

  test('a same-name replacement in another container releases only the old startup loading', async () => {
    const firstContainer = container();
    const secondContainer = container();
    const first = startPending('moving-start', firstContainer);
    await first.requested;
    const second = startPending('moving-start', secondContainer);
    await second.requested;
    await expect(first.starting).resolves.toBeUndefined();

    expectRestored(firstContainer);
    expect(secondContainer.querySelector(loadingSelector)).not.toBeNull();
    expect(secondContainer.style.overflow).toBe('hidden');

    await destroyApp('moving-start');
    await second.starting;
    expectRestored(secondContainer);
  });

  test.each([false, true])('late old work preserves the new container content (activated=%s)', async (activated) => {
    const el = container();
    const old = startPending('old-request', el);
    await old.requested;
    const current = startPending('new-request', el);
    await current.requested;
    const newLoading = el.querySelector(loadingSelector);
    const host = document.createElement('section');
    host.textContent = 'new application';
    if (activated) {
      // The real renderer transfers loading ownership when another app adopts
      // the container. No browser bootstrap is needed to exercise that boundary.
      renderElementToContainer(host, el);
    }
    const position = el.style.position;
    const overflow = el.style.overflow;

    await destroyApp('old-request');
    await old.starting;
    old.release();
    await Promise.resolve();
    await Promise.resolve();

    expect(el.querySelector(loadingSelector)).toBe(newLoading);
    expect(newLoading?.isConnected).toBe(true);
    expect(el.style.position).toBe(position);
    expect(el.style.overflow).toBe(overflow);
    if (activated) {
      expect(host.parentNode).toBe(el);
      expect(host.textContent).toBe('new application');
    }

    await destroyApp('new-request');
    await current.starting;
    if (activated) {
      removeRenderedElementFromContainer(host, el);
    }
    expectRestored(el);
  });

  test('a failed beforeLoad restores startup loading and retains unrelated host content', async () => {
    const el = container();
    const aside = document.createElement('aside');
    const failure = new Error('beforeLoad failed');
    await expect(
      startApp({
        ...options('loading-hook-failure', el),
        beforeLoad: () => {
          el.appendChild(aside);
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expectRestored(el);
    expect(aside.parentNode).toBe(el);
    expect(getJieshuById('loading-hook-failure')).toBeNull();
  });

  test('a rejected HTML request releases its loading and preserves the original failure', async () => {
    const el = container();
    const failure = new Error('HTML request failed');
    const work = startPending('loading-fetch-failure', el, startApp, failure);
    await work.requested;
    const rejected = expect(work.starting).rejects.toBe(failure);
    work.release();
    await rejected;

    expectRestored(el);
    expect(getJieshuById('loading-fetch-failure')).toBeNull();
  });

  test.each(['relative', 'sticky'])(
    'cancellation restores a pre-positioned %s container overflow',
    async (position) => {
      const el = container();
      el.style.position = position;
      el.style.overflow = 'auto';
      const work = startPending(`position-${position}`, el);
      await work.requested;
      await destroyApp(`position-${position}`);
      await work.starting;

      expect(el.querySelector(loadingSelector)).toBeNull();
      expect(el.style.position).toBe(position);
      expect(el.style.overflow).toBe('auto');
      expect(el.hasAttribute(CONTAINER_OVERFLOW_DATA_FLAG)).toBe(false);
    },
  );

  test('startup cleanup does not release loading that another render has adopted', () => {
    const el = container();
    const releaseStartup = addLoading(el);
    const loading = el.querySelector(loadingSelector);
    const currentHost = document.createElement('section');
    renderElementToContainer(currentHost, el);

    releaseStartup?.();

    expect(el.querySelector(loadingSelector)).toBe(loading);
    expect(currentHost.parentNode).toBe(el);
    expect(el.style.position).toBe('relative');
    expect(el.style.overflow).toBe('hidden');

    removeRenderedElementFromContainer(currentHost, el);
    expectRestored(el);
  });

  test('replacing an outer container does not remove a nested container loading as its own', () => {
    const outer = container();
    const inner = document.createElement('section');
    outer.appendChild(inner);
    addLoading(inner);
    const innerLoading = inner.querySelector(loadingSelector);
    expect(innerLoading?.parentNode).toBe(inner);

    expect(() => addLoading(outer)).not.toThrow();

    expect(inner.parentNode).toBeNull();
    expect(innerLoading?.parentNode).toBe(inner);
    expect(outer.querySelector(loadingSelector)?.parentNode).toBe(outer);
    expect(outer.children).toHaveLength(1);
  });

  test.each(['startup', 'render', 'direct'])(
    '%s release ignores a nested loading prepended before its own overlay',
    (releasePath) => {
      const outer = container();
      const releaseStartup = addLoading(outer);
      const outerLoading = outer.querySelector(loadingSelector);
      const inner = container();
      outer.prepend(inner);
      const releaseInner = addLoading(inner);
      const innerLoading = inner.querySelector(loadingSelector);
      const host = document.createElement('section');
      if (releasePath === 'render') {
        renderElementToContainer(host, outer);
      }

      expect(() => {
        if (releasePath === 'startup') {
          releaseStartup?.();
        } else if (releasePath === 'render') {
          removeRenderedElementFromContainer(host, outer);
        } else {
          removeLoading(outer);
        }
      }).not.toThrow();

      expect(outerLoading?.parentNode).toBeNull();
      expect(outer.children).toHaveLength(1);
      expect(outer.firstElementChild).toBe(inner);
      expect(outer.style.position).toBe('');
      expect(outer.style.overflow).toBe('');
      expect(outer.hasAttribute(CONTAINER_POSITION_DATA_FLAG)).toBe(false);
      expect(outer.hasAttribute(CONTAINER_OVERFLOW_DATA_FLAG)).toBe(false);
      expect(innerLoading?.parentNode).toBe(inner);
      expect(inner.style.position).toBe('relative');
      expect(inner.style.overflow).toBe('hidden');

      releaseInner?.();
      expectRestored(inner);
    },
  );
});
