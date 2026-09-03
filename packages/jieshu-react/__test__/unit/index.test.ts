import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';
import type { Mock, MockInstance } from 'vitest';
import type { StartOptions } from 'jieshu-core';
import JieshuReact, { type JieshuReactRef } from '../../src';

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
    mockBus: { $emit: vi.fn() },
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

vi.mock('jieshu-core', () => ({
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

function renderComponent(
  container: HTMLDivElement,
  props: Record<string, unknown>,
  forwardedRef: React.RefObject<JieshuReactRef>,
): void {
  act(() => {
    ReactDOM.render(React.createElement(JieshuReact, { ...props, ref: forwardedRef } as never), container);
  });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('JieshuReact', () => {
  let host: HTMLDivElement;
  let consoleError: MockInstance;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    mockControllers.length = 0;
    mockCreateAppController.mockImplementation((): MockController => {
      const controller = mockNewController();
      mockControllers.push(controller);
      return controller;
    });
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (host.childNodes.length > 0) {
      act(() => {
        ReactDOM.unmountComponentAtNode(host);
      });
    }
    host.remove();
    consoleError.mockRestore();
  });

  test('mounts with every start option, restarts only for identity changes, and exposes controls', async () => {
    const loading = document.createElement('span');
    const replace = vi.fn();
    const customFetch = vi.fn();
    const lifecycle = vi.fn();
    const forwardedRef = React.createRef<JieshuReactRef>();
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

    renderComponent(host, props, forwardedRef);

    const controller = mockControllers[0];
    const childContainer = host.firstElementChild as HTMLDivElement;
    expect(mockCreateAppController).toHaveBeenCalledTimes(1);
    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(controller.start).toHaveBeenLastCalledWith({
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

    renderComponent(host, { ...props, html: '<main>updated</main>' }, forwardedRef);
    expect(controller.start).toHaveBeenCalledTimes(1);

    renderComponent(host, { ...props, name: 'second' }, forwardedRef);
    expect(controller.start).toHaveBeenCalledTimes(2);

    renderComponent(host, { ...props, name: 'second', url: 'https://second.test/' }, forwardedRef);
    expect(controller.start).toHaveBeenCalledTimes(3);

    await expect(forwardedRef.current?.refresh()).resolves.toBeUndefined();
    expect(controller.refresh).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'second',
        url: 'https://second.test/',
        el: childContainer,
      }),
    );

    await expect(forwardedRef.current?.destroy()).resolves.toBeUndefined();
    expect(controller.destroy).toHaveBeenCalledWith('second');

    const controls = forwardedRef.current as JieshuReactRef;
    act(() => {
      ReactDOM.unmountComponentAtNode(host);
    });
    expect(controller.dispose).toHaveBeenCalledTimes(1);
    await expect(controls.refresh()).rejects.toThrow('cannot start before its container is mounted');
    expect(mockCreateAppController).toHaveBeenCalledTimes(2);
  });

  test('preserves the public static API', () => {
    expect(JieshuReact.bus).toBe(mockBus);
    expect(JieshuReact.setupApp).toBe(mockSetupApp);
    expect(JieshuReact.preloadApp).toBe(mockPreloadApp);
    expect(JieshuReact.destroyApp).toBe(mockDestroyApp);
    expect(JieshuReact.refreshApp).toBe(mockRefreshApp);
    expect(JieshuReact.clearAssetsCache).toBe(mockClearAssetsCache);
    expect(JieshuReact.displayName).toBe('JieshuReact');
    expect('propTypes' in JieshuReact).toBe(false);
  });

  test('reports synchronous automatic-start failures and disposes the controller', async () => {
    const failure = new Error('start failed');
    const controller = mockNewController();
    controller.start.mockImplementation(() => {
      throw failure;
    });
    mockCreateAppController.mockImplementation(() => {
      mockControllers.push(controller);
      return controller;
    });

    renderComponent(host, { name: 'broken' }, React.createRef<JieshuReactRef>());
    await flushPromises();

    expect(consoleError).toHaveBeenCalledWith('[jieshu-react] failed to start application', failure);
    act(() => {
      ReactDOM.unmountComponentAtNode(host);
    });
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  test('reports controller-construction failures and safely unmounts without a controller', async () => {
    const failure = new Error('controller failed');
    mockCreateAppController.mockImplementation(() => {
      throw failure;
    });

    renderComponent(host, { name: 'broken-controller' }, React.createRef<JieshuReactRef>());
    await flushPromises();

    expect(consoleError).toHaveBeenCalledWith('[jieshu-react] failed to start application', failure);
    expect(() => {
      act(() => {
        ReactDOM.unmountComponentAtNode(host);
      });
    }).not.toThrow();
  });

  test('turns synchronous refresh failures into rejected promises', async () => {
    const failure = new Error('refresh failed');
    const controller = mockNewController();
    controller.refresh.mockImplementation(() => {
      throw failure;
    });
    mockCreateAppController.mockImplementation(() => {
      mockControllers.push(controller);
      return controller;
    });
    const forwardedRef = React.createRef<JieshuReactRef>();

    renderComponent(host, { name: 'refresh-error' }, forwardedRef);

    await expect(forwardedRef.current?.refresh()).rejects.toBe(failure);
  });

  test('selects the passive ownership effect when imported without a browser window', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    if (!descriptor) throw new Error('jsdom window descriptor is unavailable');

    try {
      delete (globalThis as unknown as Record<string, unknown>)['window'];
      vi.resetModules();
      const serverComponent = (await import('../../src')).default;
      expect(serverComponent.displayName).toBe('JieshuReact');
    } finally {
      Object.defineProperty(globalThis, 'window', descriptor);
      vi.resetModules();
    }
  });
});
