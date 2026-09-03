import Vue, { type VueConstructor } from 'vue';
import type { Mock, MockInstance } from 'vitest';
import type { StartOptions } from 'wujie-core';
import WujieVue, { type WujieVueInstance } from '../../index';

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

vi.mock('wujie-core', () => ({
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

type TestInstance = WujieVueInstance & {
  _isDestroyed: boolean;
  _props: Record<string, unknown>;
  appController: MockController;
  stopIdentityWatch: (() => void) | null;
  forwardBusEvent(eventName: string, ...payload: unknown[]): void;
  startAutomatically(): Promise<void>;
};

function mountComponent(props: Record<string, unknown>): TestInstance {
  const instance = new WujieVue({ propsData: props } as never) as TestInstance;
  instance.$mount();
  document.body.appendChild(instance.$el);
  return instance;
}

describe('WujieVue for Vue 2', () => {
  const instances: TestInstance[] = [];
  let consoleError: MockInstance;

  beforeAll(() => {
    Vue.config.productionTip = false;
    Vue.config.devtools = false;
  });

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
    instances.forEach((instance) => {
      if (!instance._isDestroyed) instance.$destroy();
    });
    instances.length = 0;
    document.body.innerHTML = '';
    consoleError.mockRestore();
  });

  test('mounts with every start option, forwards events, reacts to identity, and cleans up', async () => {
    const loading = document.createElement('span');
    const replace = vi.fn();
    const customFetch = vi.fn();
    const lifecycle = vi.fn();
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
    const instance = mountComponent(props);
    instances.push(instance);
    const controller = mockControllers[0];
    const childContainer = instance.$refs['wujieContainer'] as HTMLDivElement;

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

    const eventHandler = vi.fn();
    instance.$on('adapter-event', eventHandler);
    const forwardBusEvent = mockBus.$onAll.mock.calls[0][0];
    forwardBusEvent('adapter-event', 'payload', 2);
    expect(eventHandler).toHaveBeenCalledWith('payload', 2);

    instance._props['name'] = 'second';
    await Vue.nextTick();
    expect(controller.start).toHaveBeenCalledTimes(2);
    instance._props['url'] = 'https://second.test/';
    await Vue.nextTick();
    expect(controller.start).toHaveBeenCalledTimes(3);

    await expect(instance.refresh()).resolves.toBeUndefined();
    expect(controller.refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'second',
        url: 'https://second.test/',
        el: childContainer,
      }),
    );
    await expect(instance.destroy()).resolves.toBeUndefined();
    expect(controller.destroy).toHaveBeenCalledWith('second');

    const stopWatch = vi.fn(instance.stopIdentityWatch as () => void);
    instance.stopIdentityWatch = stopWatch;
    instance.$destroy();
    expect(stopWatch).toHaveBeenCalledTimes(1);
    expect(mockBus.$offAll).toHaveBeenCalledWith(instance.forwardBusEvent);
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  test('uses default styles and preserves the plugin/static API', () => {
    const instance = mountComponent({ name: 'defaults' });
    instances.push(instance);
    const childContainer = instance.$refs['wujieContainer'] as HTMLDivElement;
    expect(childContainer.getAttribute('style') ?? '').toBe('');

    expect(WujieVue.bus).toBe(mockBus);
    expect(WujieVue.setupApp).toBe(mockSetupApp);
    expect(WujieVue.preloadApp).toBe(mockPreloadApp);
    expect(WujieVue.destroyApp).toBe(mockDestroyApp);
    expect(WujieVue.refreshApp).toBe(mockRefreshApp);
    expect(WujieVue.clearAssetsCache).toBe(mockClearAssetsCache);

    const VueConstructor = { component: vi.fn() } as unknown as VueConstructor;
    WujieVue.install(VueConstructor);
    expect(VueConstructor.component).toHaveBeenCalledWith('WujieVue', expect.anything());
  });

  test('turns pre-mount start and refresh failures into settled promises', async () => {
    const instance = new WujieVue({ propsData: { name: 'not-mounted' } } as never) as TestInstance;
    instances.push(instance);

    await expect(instance.startAutomatically()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      '[wujie-vue2] failed to start application',
      expect.objectContaining({ message: 'WujieVue cannot start before its container is mounted' }),
    );
    await expect(instance.refresh()).rejects.toThrow('cannot start before its container is mounted');
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
    const instance = mountComponent({ name: 'broken' });
    instances.push(instance);
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith('[wujie-vue2] failed to start application', startFailure);
    await expect(instance.refresh()).rejects.toBe(refreshFailure);
  });

  test('destroys an unmounted instance without an identity watcher', () => {
    const instance = new WujieVue({ propsData: { name: 'unmounted' } } as never) as TestInstance;
    instances.push(instance);

    expect(instance.stopIdentityWatch).toBeNull();
    expect(() => instance.$destroy()).not.toThrow();
    expect(instance.appController.dispose).toHaveBeenCalledTimes(1);
  });

  test('uses an object prop validator when imported without HTMLElement', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
    if (!descriptor) throw new Error('jsdom HTMLElement descriptor is unavailable');

    try {
      delete (globalThis as unknown as Record<string, unknown>)['HTMLElement'];
      vi.resetModules();
      const serverComponent = (await import('../../index')).default as unknown as {
        options: { name: string };
      };
      expect(serverComponent.options.name).toBe('WujieVue');
    } finally {
      Object.defineProperty(globalThis, 'HTMLElement', descriptor);
      vi.resetModules();
    }
  });
});
