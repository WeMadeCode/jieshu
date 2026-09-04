import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';

import JieshuReact, { type JieshuReactProps, type JieshuReactRef } from '../consumer/runtime';

interface TestSandbox {
  id: string;
  url: string;
  el: HTMLElement;
  fiber: boolean;
  alive?: boolean;
  sync?: boolean;
  prefix: Record<string, string>;
  replace: (code: string) => string;
  iframeAddEventListeners?: string[];
  iframeOnEvents?: string[];
  plugins: object[];
  lifecycles: Record<string, unknown>;
  cancelIframeReady?: () => void;
}

interface TestChildWindow extends Window {
  __JIESHU: TestSandbox;
  __JIESHU_MOUNT: () => void;
  __JIESHU_UNMOUNT: () => void | Promise<void>;
  $jieshu: {
    props?: object;
    bus: {
      $emit(event: string, ...payload: unknown[]): unknown;
    };
  };
}

interface Signal<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function signal<Value>(): Signal<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function prepareChildWindow(childWindow: Window): TestChildWindow {
  const testWindow = childWindow as TestChildWindow;
  testWindow.history.pushState = (): void => undefined;
  testWindow.history.replaceState = (): void => undefined;
  testWindow.__JIESHU.cancelIframeReady?.();
  return testWindow;
}

function renderComponent(
  host: HTMLDivElement,
  props: JieshuReactProps,
  componentRef: React.RefObject<JieshuReactRef>,
): void {
  act(() => {
    ReactDOM.render(React.createElement(JieshuReact, { ...props, ref: componentRef }), host);
  });
}

function unmountComponent(host: HTMLDivElement): void {
  if (!host.childNodes.length) return;
  act(() => {
    ReactDOM.unmountComponentAtNode(host);
  });
}

async function waitForCalls(mock: { mock: { calls: unknown[][] } }, count: number): Promise<void> {
  await vi.waitFor(() => expect(mock.mock.calls).toHaveLength(count));
}

describe('published jieshu-react UI', () => {
  const applicationNames = new Set<string>();
  const hosts = new Set<HTMLDivElement>();
  const busCleanups = new Set<() => void>();

  function createHost(): HTMLDivElement {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.add(host);
    return host;
  }

  afterEach(async () => {
    busCleanups.forEach((cleanup) => cleanup());
    busCleanups.clear();
    hosts.forEach((host) => {
      unmountComponent(host);
      host.remove();
    });
    hosts.clear();
    await Promise.all([...applicationNames].map((name) => JieshuReact.destroyApp(name).catch((): void => undefined)));
    applicationNames.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  test('loads the built package with real core and forwards every public option through a full lifecycle', async () => {
    const name = `react-options-${Date.now()}`;
    applicationNames.add(name);
    const host = createHost();
    const componentRef = React.createRef<JieshuReactRef>();
    const mounted = signal<TestChildWindow>();
    const loading = document.createElement('span');
    loading.dataset['testLoading'] = 'custom';
    loading.textContent = 'Loading child';
    const childMount = vi.fn();
    const childUnmount = vi.fn(async (): Promise<void> => undefined);
    const loadingSnapshots: boolean[] = [];
    const replace = vi.fn((code: string): string => code.split('tomato').join('royalblue'));
    const customFetch = vi.fn(async (input: RequestInfo): Promise<Response> => {
      void input;
      return new Response('fetched');
    });
    const cssLoader = vi.fn((code: string): string => code.split('tomato').join('royalblue'));
    const windowPropertyOverride = vi.fn();
    const documentPropertyOverride = vi.fn();
    const plugin = { cssLoader, windowPropertyOverride, documentPropertyOverride };
    const beforeMount = vi.fn();
    const afterMount = vi.fn((childWindow: Window): void => mounted.resolve(childWindow as TestChildWindow));
    const beforeUnmount = vi.fn();
    const afterUnmount = vi.fn();
    const activated = vi.fn();
    const deactivated = vi.fn();
    const loadError = vi.fn();
    const attrs = { title: 'execution-frame', 'data-execution-option': 'forwarded' };
    const injectedProps = { token: 'published-entry', count: 3 };
    const prefix = { '/legacy': '/current' };
    const iframeAddEventListeners = ['hashchange', 'custom-window-event'];
    const iframeOnEvents = ['load', 'pagehide'];
    const beforeLoad = vi.fn((childWindow: Window): void => {
      loadingSnapshots.push(Boolean(host.querySelector('[data-loading-flag] [data-test-loading="custom"]')));
      const testWindow = prepareChildWindow(childWindow);
      testWindow.__JIESHU_MOUNT = childMount;
      testWindow.__JIESHU_UNMOUNT = childUnmount;
    });
    const props: JieshuReactProps = {
      name,
      url: 'http://localhost/react-child/',
      html: '<html><head><style>.brand { color: tomato; }</style></head><body><main id="react-child">child</main></body></html>',
      width: '100%',
      height: '360px',
      style: { width: '80%', color: 'purple' },
      loading,
      replace,
      fetch: customFetch,
      props: injectedProps,
      attrs,
      sync: false,
      prefix,
      fiber: false,
      alive: false,
      plugins: [plugin],
      iframeAddEventListeners,
      iframeOnEvents,
      beforeLoad,
      beforeMount,
      afterMount,
      beforeUnmount,
      afterUnmount,
      activated,
      deactivated,
      loadError,
    };

    renderComponent(host, props, componentRef);
    const childWindow = await mounted.promise;
    const componentContainer = host.firstElementChild as HTMLDivElement;
    const executionFrame = document.body.querySelector(`iframe[name="${name}"]`) as HTMLIFrameElement;
    const renderHost = componentContainer.querySelector(`jieshu-app[data-jieshu-id="${name}"]`) as HTMLElement;
    const sandbox = childWindow.__JIESHU;

    expect(componentContainer.style.width).toBe('80%');
    expect(componentContainer.style.height).toBe('360px');
    expect(componentContainer.style.color).toBe('purple');
    expect(loadingSnapshots).toEqual([true]);
    expect(componentContainer.querySelector('[data-loading-flag]')).toBeNull();
    expect(executionFrame.getAttribute('title')).toBe('execution-frame');
    expect(executionFrame.dataset['executionOption']).toBe('forwarded');
    expect(renderHost.shadowRoot?.querySelector('#react-child')?.textContent).toBe('child');
    expect(
      [...(renderHost.shadowRoot?.querySelectorAll('style') ?? [])]
        .map((styleElement) => styleElement.textContent)
        .join('\n'),
    ).toContain('royalblue');

    expect(sandbox.id).toBe(name);
    expect(sandbox.url).toBe(props.url);
    expect(sandbox.el).toBe(componentContainer);
    expect(sandbox.fiber).toBe(false);
    expect(sandbox.alive).toBe(false);
    expect(sandbox.sync).toBe(false);
    expect(sandbox.prefix).toBe(prefix);
    expect(sandbox.replace).toBe(replace);
    expect(sandbox.iframeAddEventListeners).toBe(iframeAddEventListeners);
    expect(sandbox.iframeOnEvents).toBe(iframeOnEvents);
    expect(sandbox.plugins).toContain(plugin);
    expect(sandbox.lifecycles).toEqual({
      beforeLoad,
      beforeMount,
      afterMount,
      beforeUnmount,
      afterUnmount,
      activated,
      deactivated,
      loadError,
    });
    expect(childWindow.$jieshu.props).toBe(injectedProps);
    expect(replace).toHaveBeenCalled();
    expect(cssLoader).toHaveBeenCalled();
    expect(windowPropertyOverride).toHaveBeenCalledWith(childWindow);
    expect(documentPropertyOverride).toHaveBeenCalledWith(childWindow);
    expect(beforeLoad).toHaveBeenCalledOnce();
    expect(beforeMount).toHaveBeenCalledWith(childWindow);
    expect(afterMount).toHaveBeenCalledWith(childWindow);
    expect(childMount).toHaveBeenCalledOnce();
    expect(activated).not.toHaveBeenCalled();
    expect(deactivated).not.toHaveBeenCalled();
    expect(loadError).not.toHaveBeenCalled();

    await expect(childWindow.fetch('/api/ping')).resolves.toBeInstanceOf(Response);
    expect(String(customFetch.mock.calls[0][0])).toContain('/api/ping');

    const eventName = `react-event-${Date.now()}`;
    const eventListener = vi.fn();
    JieshuReact.bus.$on(eventName, eventListener);
    busCleanups.add(() => JieshuReact.bus.$off(eventName, eventListener));
    childWindow.$jieshu.bus.$emit(eventName, 'payload', 7);
    expect(eventListener).toHaveBeenCalledWith('payload', 7);

    const controls = componentRef.current as JieshuReactRef;
    await expect(controls.refresh()).resolves.toEqual(expect.any(Function));
    await waitForCalls(afterMount, 2);
    expect(beforeLoad).toHaveBeenCalledTimes(2);
    expect(beforeUnmount).toHaveBeenCalledTimes(1);
    expect(afterUnmount).toHaveBeenCalledTimes(1);

    await expect(controls.destroy()).resolves.toBeUndefined();
    applicationNames.delete(name);
    expect(childUnmount).toHaveBeenCalledTimes(2);
    expect(beforeUnmount).toHaveBeenCalledTimes(2);
    expect(afterUnmount).toHaveBeenCalledTimes(2);

    unmountComponent(host);
    await expect(controls.refresh()).rejects.toThrow('JieshuReact cannot start before its container is mounted');
  });

  test('ignores non-identity updates and restarts real core only when name or url changes', async () => {
    const firstName = `react-identity-a-${Date.now()}`;
    const secondName = `react-identity-b-${Date.now()}`;
    applicationNames.add(firstName);
    applicationNames.add(secondName);
    const host = createHost();
    const componentRef = React.createRef<JieshuReactRef>();
    const childMount = vi.fn();
    const childUnmount = vi.fn(async (): Promise<void> => undefined);
    const beforeLoad = vi.fn((childWindow: Window): void => {
      const testWindow = prepareChildWindow(childWindow);
      testWindow.__JIESHU_MOUNT = childMount;
      testWindow.__JIESHU_UNMOUNT = childUnmount;
    });
    const activated = vi.fn();
    const deactivated = vi.fn();
    const baseProps: JieshuReactProps = {
      name: firstName,
      url: 'http://localhost/react-first/',
      html: '<html><head></head><body><main>first</main></body></html>',
      props: { revision: 1 },
      style: { color: 'red' },
      alive: true,
      fiber: false,
      beforeLoad,
      activated,
      deactivated,
    };

    renderComponent(host, baseProps, componentRef);
    await waitForCalls(activated, 1);
    const firstWindow = beforeLoad.mock.calls[0][0] as TestChildWindow;

    renderComponent(
      host,
      { ...baseProps, html: '<html><body>ignored</body></html>', props: { revision: 2 }, style: { color: 'blue' } },
      componentRef,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(beforeLoad).toHaveBeenCalledOnce();
    expect(activated).toHaveBeenCalledOnce();
    expect(firstWindow.$jieshu.props).toEqual({ revision: 1 });
    expect((host.firstElementChild as HTMLDivElement).style.color).toBe('blue');

    renderComponent(
      host,
      { ...baseProps, url: 'http://localhost/react-second/', props: { revision: 3 }, style: { color: 'green' } },
      componentRef,
    );
    await waitForCalls(activated, 2);
    expect(beforeLoad).toHaveBeenCalledOnce();
    expect(firstWindow.__JIESHU.url).toBe('http://localhost/react-second/');
    expect(firstWindow.$jieshu.props).toEqual({ revision: 3 });

    renderComponent(host, { ...baseProps, name: secondName, url: 'http://localhost/react-third/' }, componentRef);
    await waitForCalls(beforeLoad, 2);
    await waitForCalls(activated, 3);
    expect((beforeLoad.mock.calls[1][0] as TestChildWindow).__JIESHU.id).toBe(secondName);
    expect(deactivated).toHaveBeenCalledOnce();

    unmountComponent(host);
    expect(componentRef.current).toBeNull();
    expect(deactivated).toHaveBeenCalledTimes(2);
  });

  test('reports a synchronous lifecycle exception from real core', async () => {
    const name = `react-sync-error-${Date.now()}`;
    applicationNames.add(name);
    const host = createHost();
    const failure = new Error('synchronous beforeLoad failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const beforeLoad = (childWindow: Window): never => {
      prepareChildWindow(childWindow);
      throw failure;
    };

    renderComponent(
      host,
      {
        name,
        url: 'http://localhost/react-sync-error/',
        html: '<html><body></body></html>',
        beforeLoad,
      },
      React.createRef<JieshuReactRef>(),
    );

    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('[jieshu-react] failed to start application', failure),
    );
  });

  test('reports an asynchronous loading exception and forwards it to loadError', async () => {
    const name = `react-async-error-${Date.now()}`;
    applicationNames.add(name);
    const host = createHost();
    const failure = new Error('asynchronous fetch failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const customFetch = vi.fn(async (input: RequestInfo): Promise<Response> => {
      void input;
      return Promise.reject(failure);
    });
    const loadError = vi.fn();

    renderComponent(
      host,
      {
        name,
        url: 'http://localhost/react-async-error/',
        fetch: customFetch,
        beforeLoad: prepareChildWindow,
        loadError,
      },
      React.createRef<JieshuReactRef>(),
    );

    await vi.waitFor(() => expect(loadError).toHaveBeenCalledWith('http://localhost/react-async-error/', failure));
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('[jieshu-react] failed to start application', failure),
    );
    expect(customFetch).toHaveBeenCalledOnce();
  });
});
