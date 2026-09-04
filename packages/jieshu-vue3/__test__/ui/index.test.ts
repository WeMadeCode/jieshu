import { createApp, defineComponent, h, nextTick, reactive, ref, type App, type ComponentPublicInstance } from 'vue';
import { afterEach, describe, expect, test, vi } from 'vitest';

import JieshuVue, { type JieshuVueExposed, type JieshuVueProps } from '../consumer/runtime';

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

interface MountedComponent {
  app: App;
  componentRef: { value: (ComponentPublicInstance & JieshuVueExposed) | null };
  host: HTMLDivElement;
  state: Record<string, unknown>;
  unmount(): void;
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

async function waitForCalls(mock: { mock: { calls: unknown[][] } }, count: number): Promise<void> {
  await vi.waitFor(() => expect(mock.mock.calls).toHaveLength(count));
}

describe('published @cloud/jieshu-vue3 UI', () => {
  const applicationNames = new Set<string>();
  const mountedComponents = new Set<MountedComponent>();

  function mountComponent(
    initialProps: JieshuVueProps,
    listeners: Record<string, (...payload: unknown[]) => void> = {},
  ): MountedComponent {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const state = reactive({ ...initialProps }) as Record<string, unknown>;
    const componentRef = ref<(ComponentPublicInstance & JieshuVueExposed) | null>(null);
    const Root = defineComponent({
      setup() {
        return () => h(JieshuVue as never, { ...state, ...listeners, ref: componentRef } as never);
      },
    });
    const app = createApp(Root);
    app.mount(host);
    let isMounted = true;
    const mounted: MountedComponent = {
      app,
      componentRef,
      host,
      state,
      unmount(): void {
        if (!isMounted) return;
        isMounted = false;
        app.unmount();
        host.remove();
      },
    };
    mountedComponents.add(mounted);
    return mounted;
  }

  afterEach(async () => {
    mountedComponents.forEach((mounted) => mounted.unmount());
    mountedComponents.clear();
    await Promise.all([...applicationNames].map((name) => JieshuVue.destroyApp(name).catch((): void => undefined)));
    applicationNames.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  test('loads the built package with real core and forwards every public option through a full lifecycle', async () => {
    const name = `vue-options-${Date.now()}`;
    applicationNames.add(name);
    const mountedSignal = signal<TestChildWindow>();
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
    const afterMount = vi.fn((childWindow: Window): void => mountedSignal.resolve(childWindow as TestChildWindow));
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
      loadingSnapshots.push(Boolean(document.body.querySelector('[data-loading-flag] [data-test-loading="custom"]')));
      const testWindow = prepareChildWindow(childWindow);
      testWindow.__JIESHU_MOUNT = childMount;
      testWindow.__JIESHU_UNMOUNT = childUnmount;
    });
    const eventHandler = vi.fn();
    const props: JieshuVueProps = {
      name,
      url: 'http://localhost/vue-child/',
      html: '<html><head><style>.brand { color: tomato; }</style></head><body><main id="vue-child">child</main></body></html>',
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

    const mounted = mountComponent(props, { onAdapterEvent: eventHandler });
    const childWindow = await mountedSignal.promise;
    const componentContainer = mounted.host.firstElementChild as HTMLDivElement;
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
    expect(renderHost.shadowRoot?.querySelector('#vue-child')?.textContent).toBe('child');
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
    expect(sandbox.prefix).toEqual(prefix);
    expect(sandbox.replace).toBe(replace);
    expect(sandbox.iframeAddEventListeners).toEqual(iframeAddEventListeners);
    expect(sandbox.iframeOnEvents).toEqual(iframeOnEvents);
    expect(sandbox.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ cssLoader })]));
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
    expect(childWindow.$jieshu.props).toEqual(injectedProps);
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
    childWindow.$jieshu.bus.$emit('adapterEvent', 'payload', 7);
    expect(eventHandler).toHaveBeenCalledWith('payload', 7);

    const controls = mounted.componentRef.value as ComponentPublicInstance & JieshuVueExposed;
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

    mounted.unmount();
    await expect(controls.refresh()).rejects.toThrow('JieshuVue cannot start before its container is mounted');
  });

  test('forwards bus events, ignores non-identity updates, and restarts only for name or url changes', async () => {
    const firstName = `vue-identity-a-${Date.now()}`;
    const secondName = `vue-identity-b-${Date.now()}`;
    applicationNames.add(firstName);
    applicationNames.add(secondName);
    const childMount = vi.fn();
    const childUnmount = vi.fn(async (): Promise<void> => undefined);
    const beforeLoad = vi.fn((childWindow: Window): void => {
      const testWindow = prepareChildWindow(childWindow);
      testWindow.__JIESHU_MOUNT = childMount;
      testWindow.__JIESHU_UNMOUNT = childUnmount;
    });
    const activated = vi.fn();
    const deactivated = vi.fn();
    const eventHandler = vi.fn();
    const baseProps: JieshuVueProps = {
      name: firstName,
      url: 'http://localhost/vue-first/',
      html: '<html><head></head><body><main>first</main></body></html>',
      props: { revision: 1 },
      style: { color: 'red' },
      alive: true,
      fiber: false,
      beforeLoad,
      activated,
      deactivated,
    };
    const mounted = mountComponent(baseProps, { onIdentityEvent: eventHandler });
    await waitForCalls(activated, 1);
    const firstWindow = beforeLoad.mock.calls[0][0] as TestChildWindow;

    firstWindow.$jieshu.bus.$emit('identityEvent', 'first');
    expect(eventHandler).toHaveBeenCalledWith('first');

    mounted.state['html'] = '<html><body>ignored</body></html>';
    mounted.state['props'] = { revision: 2 };
    mounted.state['style'] = { color: 'blue' };
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(beforeLoad).toHaveBeenCalledOnce();
    expect(activated).toHaveBeenCalledOnce();
    expect(firstWindow.$jieshu.props).toEqual({ revision: 1 });
    expect((mounted.host.firstElementChild as HTMLDivElement).style.color).toBe('blue');

    mounted.state['url'] = 'http://localhost/vue-second/';
    mounted.state['props'] = { revision: 3 };
    await nextTick();
    await waitForCalls(activated, 2);
    expect(beforeLoad).toHaveBeenCalledOnce();
    expect(firstWindow.__JIESHU.url).toBe('http://localhost/vue-second/');
    expect(firstWindow.$jieshu.props).toEqual({ revision: 3 });

    mounted.state['name'] = secondName;
    mounted.state['url'] = 'http://localhost/vue-third/';
    await nextTick();
    await waitForCalls(beforeLoad, 2);
    await waitForCalls(activated, 3);
    expect((beforeLoad.mock.calls[1][0] as TestChildWindow).__JIESHU.id).toBe(secondName);
    expect(deactivated).toHaveBeenCalledOnce();

    mounted.unmount();
    firstWindow.$jieshu.bus.$emit('identityEvent', 'after-unmount');
    expect(eventHandler).toHaveBeenCalledOnce();
  });

  test('reports a synchronous lifecycle exception from real core', async () => {
    const name = `vue-sync-error-${Date.now()}`;
    applicationNames.add(name);
    const failure = new Error('synchronous beforeLoad failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const beforeLoad = (childWindow: Window): never => {
      prepareChildWindow(childWindow);
      throw failure;
    };

    mountComponent({
      name,
      url: 'http://localhost/vue-sync-error/',
      html: '<html><body></body></html>',
      beforeLoad,
    });

    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('[@cloud/jieshu-vue3] failed to start application', failure),
    );
  });

  test('reports an asynchronous loading exception and forwards it to loadError', async () => {
    const name = `vue-async-error-${Date.now()}`;
    applicationNames.add(name);
    const failure = new Error('asynchronous fetch failure');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const customFetch = vi.fn(async (input: RequestInfo): Promise<Response> => {
      void input;
      return Promise.reject(failure);
    });
    const loadError = vi.fn();

    mountComponent({
      name,
      url: 'http://localhost/vue-async-error/',
      fetch: customFetch,
      beforeLoad: prepareChildWindow,
      loadError,
    });

    await vi.waitFor(() => expect(loadError).toHaveBeenCalledWith('http://localhost/vue-async-error/', failure));
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith('[@cloud/jieshu-vue3] failed to start application', failure),
    );
    expect(customFetch).toHaveBeenCalledOnce();
  });

  test('installs the built component under its public plugin name', () => {
    const app = createApp(defineComponent({ render: () => h('div') }));
    app.use(JieshuVue);
    expect(app.component('JieshuVue')).toBe(JieshuVue);
  });
});
