import { getJieshuById, idToSandboxCacheMap, sandboxTeardownById } from '../../src/common';
import { LOADING_DATA_FLAG } from '../../src/constant';
import { destroyApp } from '../../src/index';
import Jieshu from '../../src/sandbox';
import { addLoading, removeLoading, renderElementToContainer } from '../../src/shadow';

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
};

const createContainer = () => {
  const container = document.createElement('main');
  document.body.appendChild(container);
  return container;
};

const createApplication = (name: string, container: HTMLElement, keepLoading = false) => {
  addLoading(container);
  const sandbox = new Jieshu({
    name,
    url: `https://example.test/${name}/`,
    attrs: {},
    fiber: false,
    plugins: [],
    lifecycles: {},
  });
  const iframeWindow = sandbox.iframe.contentWindow;
  if (!iframeWindow) {
    throw new Error('The test application must have an iframe window');
  }
  const host = document.createElement('section');
  sandbox.shadowRoot = host.attachShadow({ mode: 'open' });
  sandbox.head = document.createElement('head');
  sandbox.body = document.createElement('body');
  sandbox.shadowRoot.append(sandbox.head, sandbox.body);
  sandbox.el = renderElementToContainer(host, container);
  sandbox.activeFlag = true;
  sandbox.mountFlag = true;
  const gate = deferred();
  const childUnmount = vi.fn(() => gate.promise);
  iframeWindow.__JIESHU_UNMOUNT = childUnmount;
  const afterUnmount = vi.fn();
  sandbox.lifecycles.afterUnmount = afterUnmount;
  if (!keepLoading) {
    removeLoading(container);
  }
  return { sandbox, host, iframe: sandbox.iframe, iframeWindow, gate, childUnmount, afterUnmount };
};

describe('destroy cleanup owns application nodes, not the whole container', () => {
  beforeEach(() => {
    idToSandboxCacheMap.clear();
    sandboxTeardownById.clear();
    document.body.innerHTML = '';
  });

  test.each([false, true])('A → B → C survives late A/B teardown (unmount rejects=%s)', async (rejects) => {
    const container = createContainer();
    const first = createApplication('container-first', container);
    const failure = new Error('old application unmount failed');
    first.childUnmount.mockImplementation(async () => {
      await first.gate.promise;
      if (rejects) {
        throw failure;
      }
    });
    const proxy = first.sandbox.proxy;
    const listener = vi.fn();
    document.addEventListener('fix003', listener);
    first.sandbox.eventCleanupTracker.trackMainDocumentListener({ type: 'fix003', callback: listener });
    const style = document.createElement('style');
    first.sandbox.head.appendChild(style);
    first.sandbox.styleSheetElements.push(style);
    const script = first.iframeWindow.document.createElement('script');
    first.iframeWindow.document.head.appendChild(script);
    first.sandbox.dynamicScriptElements.push(script);
    document.dispatchEvent(new Event('fix003'));
    expect(listener).toHaveBeenCalledTimes(1);

    const destroyingFirst = destroyApp(first.sandbox.id).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    const second = createApplication('container-second', container);
    const destroyingSecond = destroyApp(second.sandbox.id);
    const current = createApplication('container-current', container);

    second.gate.resolve();
    await destroyingSecond;
    first.gate.resolve();
    expect(await destroyingFirst).toBe(rejects ? failure : undefined);

    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(current.host);
    expect(current.host.isConnected).toBe(true);
    expect(getJieshuById(current.sandbox.id)).toBe(current.sandbox);
    expect(current.sandbox.destroyed).toBe(false);
    expect(current.childUnmount).not.toHaveBeenCalled();
    expect(current.afterUnmount).not.toHaveBeenCalled();
    expect(first.iframe.isConnected).toBe(false);
    expect(second.iframe.isConnected).toBe(false);
    expect(first.iframeWindow.__JIESHU).toBeNull();
    expect(first.childUnmount).toHaveBeenCalledTimes(1);
    expect(style.isConnected).toBe(false);
    expect(script.parentNode).toBeNull();
    expect(() => Reflect.get(proxy, 'document')).toThrow(TypeError);
    document.dispatchEvent(new Event('fix003'));
    expect(listener).toHaveBeenCalledTimes(1);

    current.gate.resolve();
    await destroyApp(current.sandbox.id);
    expect(container.children).toHaveLength(0);
  });

  test.each([false, true])(
    'cleans only its host/loading in an independent container (unmount rejects=%s)',
    async (rejects) => {
      const firstContainer = createContainer();
      firstContainer.style.position = 'static';
      firstContainer.style.overflow = 'visible';
      const first = createApplication('independent-first', firstContainer, true);
      const hostContent = document.createElement('aside');
      firstContainer.appendChild(hostContent);
      const secondContainer = createContainer();
      const second = createApplication('independent-second', secondContainer);
      const failure = new Error('independent unmount failed');
      first.childUnmount.mockImplementation(async () => {
        await first.gate.promise;
        if (rejects) {
          throw failure;
        }
      });
      const destroying = destroyApp(first.sandbox.id).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      first.gate.resolve();
      expect(await destroying).toBe(rejects ? failure : undefined);

      expect(first.host.isConnected).toBe(false);
      expect(first.iframe.isConnected).toBe(false);
      expect(firstContainer.querySelector(`div[${LOADING_DATA_FLAG}]`)).toBeNull();
      expect(firstContainer.style.position).toBe('');
      expect(firstContainer.style.overflow).toBe('');
      expect(firstContainer.firstElementChild).toBe(hostContent);
      expect(secondContainer.firstElementChild).toBe(second.host);
      expect(second.childUnmount).not.toHaveBeenCalled();
      second.gate.resolve();
      await destroyApp(second.sandbox.id);
    },
  );

  test('preserves the next application loading indicator before its host is mounted', async () => {
    const container = createContainer();
    const first = createApplication('loading-first', container, true);
    const destroying = destroyApp(first.sandbox.id);
    const nextLoading = document.createElement('span');
    nextLoading.textContent = 'next application loading';
    addLoading(container, nextLoading);
    const currentPosition = container.style.position;
    const currentOverflow = container.style.overflow;

    first.gate.resolve();
    await destroying;

    expect(nextLoading.isConnected).toBe(true);
    expect(container.querySelector(`div[${LOADING_DATA_FLAG}]`)?.firstChild).toBe(nextLoading);
    expect(container.style.position).toBe(currentPosition);
    expect(container.style.overflow).toBe(currentOverflow);
    expect(first.iframe.isConnected).toBe(false);
  });
});
