import { createApp, defineComponent, h, nextTick, reactive, ref, type App, type ComponentPublicInstance } from 'vue';
import type { Mock, MockInstance } from 'vitest';
import type { StartOptions } from 'wujie';
import WujieVue, { type WujieVueExposed } from '../../index';

interface MockController {
  start: Mock<(options: StartOptions) => Promise<void>>;
  refresh: Mock<(options: StartOptions) => Promise<void>>;
  destroy: Mock<(name: string) => Promise<void>>;
  dispose: Mock<() => void>;
}

const mocks = vi.hoisted(() => {
  const mockControllers: MockController[] = [];
  const mockNewController = (): MockController => ({
    start: vi.fn<(options: StartOptions) => Promise<void>>().mockResolvedValue(undefined),
    refresh: vi.fn<(options: StartOptions) => Promise<void>>().mockResolvedValue(undefined),
    destroy: vi.fn<(name: string) => Promise<void>>().mockResolvedValue(undefined),
    dispose: vi.fn<() => void>(),
  });
  const mockCreateAppController = vi.fn((): MockController => {
    const controller = mockNewController();
    mockControllers.push(controller);
    return controller;
  });

  return {
    mockBus: {
      $onAll: vi.fn(),
      $offAll: vi.fn(),
      $emit: vi.fn(),
    },
    mockSetupApp: vi.fn(),
    mockPreloadApp: vi.fn(),
    mockDestroyApp: vi.fn(),
    mockRefreshApp: vi.fn(),
    mockClearAssetsCache: vi.fn(),
    mockControllers,
    mockNewController,
    mockCreateAppController,
  };
});

vi.mock('wujie', () => ({
  bus: mocks.mockBus,
  setupApp: mocks.mockSetupApp,
  preloadApp: mocks.mockPreloadApp,
  destroyApp: mocks.mockDestroyApp,
  refreshApp: mocks.mockRefreshApp,
  clearAssetsCache: mocks.mockClearAssetsCache,
  createAppController: mocks.mockCreateAppController,
}));

const {
  mockBus,
  mockSetupApp,
  mockPreloadApp,
  mockDestroyApp,
  mockRefreshApp,
  mockClearAssetsCache,
  mockControllers,
  mockCreateAppController,
  mockNewController,
} = mocks;

type ExposedInstance = ComponentPublicInstance & WujieVueExposed;

interface MountedComponent {
  app: App;
  child: { value: ExposedInstance | null };
  host: HTMLDivElement;
  state: Record<string, unknown>;
  unmount(): void;
}

function mountComponent(
  initialProps: Record<string, unknown>,
  listeners: Record<string, (...payload: unknown[]) => void> = {},
): MountedComponent {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const state = reactive({ ...initialProps }) as Record<string, unknown>;
  const child = ref<ExposedInstance | null>(null);
  const Root = defineComponent({
    setup() {
      return () => h(WujieVue as never, { ...state, ...listeners, ref: child } as never);
    },
  });
  const app = createApp(Root);
  app.mount(host);
  let mounted = true;

  return {
    app,
    child,
    host,
    state,
    unmount(): void {
      if (!mounted) return;
      mounted = false;
      app.unmount();
      host.remove();
    },
  };
}

describe('WujieVue for Vue 3', () => {
  const mountedComponents: MountedComponent[] = [];
  let consoleError: MockInstance;

  beforeEach(() => {
    document.body.innerHTML = '';
    mockControllers.length = 0;
    mockCreateAppController.mockImplementation((): MockController => {
      const controller = mockNewController();
      mockControllers.push(controller);
      return controller;
    });
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    mountedComponents.forEach(({ unmount }) => unmount());
    mountedComponents.length = 0;
    document.body.innerHTML = '';
    consoleError.mockRestore();
  });

  test('mounts with every start option, forwards events, reacts to identity, and cleans up', async () => {
    const loading = document.createElement('span');
    const replace = vi.fn();
    const customFetch = vi.fn();
    const lifecycle = vi.fn();
    const eventHandler = vi.fn();
    const props = {
      name: 'first',
      url: 'https://first.test/',
      html: '<main>first</main>',
      width: '100%',
      height: '480px',
      style: { width: '75%', color: 'red' },
      loading,
      replace,
      fetch: customFetch,
      props: { token: 'secret' },
      attrs: { title: 'child' },
      degradeAttrs: { sandbox: 'allow-scripts' },
      sync: true,
      prefix: { prefix: '/child' },
      fiber: true,
      alive: true,
      degrade: false,
      plugins: [{ cssLoader: lifecycle }],
      iframeAddEventListeners: ['hashchange'],
      iframeOnEvents: ['load'],
      beforeLoad: lifecycle,
      beforeMount: lifecycle,
      afterMount: lifecycle,
      beforeUnmount: lifecycle,
      afterUnmount: lifecycle,
      activated: lifecycle,
      deactivated: lifecycle,
      loadError: lifecycle,
    };
    const mounted = mountComponent(props, { onAdapterEvent: eventHandler });
    mountedComponents.push(mounted);
    const controller = mockControllers[0];
    const childContainer = mounted.host.querySelector('div > div') as HTMLDivElement;

    expect(mockCreateAppController).toHaveBeenCalledTimes(1);
    expect(controller.start).toHaveBeenCalledWith({
      name: props.name,
      url: props.url,
      html: props.html,
      el: childContainer,
      loading,
      replace,
      fetch: customFetch,
      props: props.props,
      attrs: props.attrs,
      degradeAttrs: props.degradeAttrs,
      sync: props.sync,
      prefix: props.prefix,
      fiber: props.fiber,
      alive: props.alive,
      degrade: props.degrade,
      plugins: props.plugins,
      iframeAddEventListeners: props.iframeAddEventListeners,
      iframeOnEvents: props.iframeOnEvents,
      beforeLoad: lifecycle,
      beforeMount: lifecycle,
      afterMount: lifecycle,
      beforeUnmount: lifecycle,
      afterUnmount: lifecycle,
      activated: lifecycle,
      deactivated: lifecycle,
      loadError: lifecycle,
    });
    expect(childContainer.style.width).toBe('75%');
    expect(childContainer.style.height).toBe('480px');
    expect(childContainer.style.color).toBe('red');

    const forwardBusEvent = mockBus.$onAll.mock.calls[0][0];
    forwardBusEvent('adapterEvent', 'payload', 3);
    expect(eventHandler).toHaveBeenCalledWith('payload', 3);

    mounted.state['name'] = 'second';
    await nextTick();
    expect(controller.start).toHaveBeenCalledTimes(2);
    mounted.state['url'] = 'https://second.test/';
    await nextTick();
    expect(controller.start).toHaveBeenCalledTimes(3);

    const controls = mounted.child.value as ExposedInstance;
    await expect(controls.refresh()).resolves.toBeUndefined();
    expect(controller.refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'second',
        url: 'https://second.test/',
        el: childContainer,
      }),
    );
    await expect(controls.destroy()).resolves.toBeUndefined();
    expect(controller.destroy).toHaveBeenCalledWith('second');

    mounted.unmount();
    expect(mockBus.$offAll).toHaveBeenCalledWith(forwardBusEvent);
    expect(controller.dispose).toHaveBeenCalledTimes(1);
    await expect(controls.refresh()).rejects.toThrow('cannot start before its container is mounted');
  });

  test('uses default styles and preserves the plugin/static API', () => {
    const mounted = mountComponent({ name: 'defaults' });
    mountedComponents.push(mounted);
    const childContainer = mounted.host.querySelector('div > div') as HTMLDivElement;
    expect(childContainer.getAttribute('style') ?? '').toBe('');

    expect(WujieVue.bus).toBe(mockBus);
    expect(WujieVue.setupApp).toBe(mockSetupApp);
    expect(WujieVue.preloadApp).toBe(mockPreloadApp);
    expect(WujieVue.destroyApp).toBe(mockDestroyApp);
    expect(WujieVue.refreshApp).toBe(mockRefreshApp);
    expect(WujieVue.clearAssetsCache).toBe(mockClearAssetsCache);

    const app = { component: vi.fn() } as unknown as App;
    WujieVue.install(app);
    expect(app.component).toHaveBeenCalledWith('WujieVue', expect.anything());
  });

  test('reports controller start failures and rejects controller refresh failures', async () => {
    const startFailure = new Error('start failed');
    const refreshFailure = new Error('refresh failed');
    const controller = mockNewController();
    controller.start.mockImplementation(() => {
      throw startFailure;
    });
    controller.refresh.mockImplementation(() => {
      throw refreshFailure;
    });
    mockCreateAppController.mockImplementation(() => {
      mockControllers.push(controller);
      return controller;
    });
    const mounted = mountComponent({ name: 'broken' });
    mountedComponents.push(mounted);
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith('[wujie-vue3] failed to start application', startFailure);
    await expect((mounted.child.value as ExposedInstance).refresh()).rejects.toBe(refreshFailure);
  });

  test('guards pre-mount identity changes and supports import without HTMLElement', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
    if (!descriptor) throw new Error('jsdom HTMLElement descriptor is unavailable');
    let identityWatcher: (() => void) | undefined;
    let mountHook: (() => void) | undefined;
    let unmountHook: (() => void) | undefined;
    const isolatedContainer = document.createElement('div');

    try {
      delete (globalThis as unknown as Record<string, unknown>)['HTMLElement'];
      vi.resetModules();
      vi.doMock('vue', () => ({
        defineComponent: (options: unknown) => options,
        h: vi.fn(),
        onBeforeUnmount: (hook: () => void) => {
          unmountHook = hook;
        },
        onMounted: (hook: () => void) => {
          mountHook = hook;
        },
        ref: () => ({ value: isolatedContainer }),
        watch: (_sources: unknown, callback: () => void) => {
          identityWatcher = callback;
        },
      }));
      const isolatedComponent = (await import('../../index')).default as unknown as {
        setup(props: Record<string, unknown>, context: { emit: Mock }): WujieVueExposed;
      };
      const exposed = isolatedComponent.setup({ name: 'isolated', url: 'https://isolated.test/' }, { emit: vi.fn() });
      const controller = mockControllers[mockControllers.length - 1];

      identityWatcher?.();
      expect(controller.start).not.toHaveBeenCalled();
      mountHook?.();
      expect(controller.start).toHaveBeenCalledTimes(1);
      expect(exposed.destroy).toEqual(expect.any(Function));
      unmountHook?.();
      expect(controller.dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('vue');
      Object.defineProperty(globalThis, 'HTMLElement', descriptor);
      vi.resetModules();
    }
  });
});
