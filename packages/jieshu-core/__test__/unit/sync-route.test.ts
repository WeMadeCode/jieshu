const mockGetJieshuById = vi.hoisted(() => vi.fn());

vi.mock('../../src/common', () => ({
  getJieshuById: mockGetJieshuById,
}));

vi.mock('../../src/iframe', () => ({
  renderIframeReplaceApp: vi.fn(),
}));

vi.mock('../../src/shadow', () => ({
  renderElementToContainer: vi.fn(),
}));

vi.mock('../../src/utils', () => ({
  appRouteParse: (url: string) => {
    const parsed = new URL(url, 'https://fallback.test');
    return {
      urlElement: globalThis.document.createElement('a'),
      appHostPath: parsed.origin,
      appRoutePath: parsed.pathname + parsed.search + parsed.hash,
    };
  },
}));

import {
  clearInactiveAppUrl,
  processAppForHrefJump,
  pushUrlToWindow,
  syncUrlToIframe,
  syncUrlToWindow,
} from '../../src/sync';

describe('sync route orchestration', () => {
  beforeEach(() => {
    mockGetJieshuById.mockReset();
    window.history.replaceState(null, '', '/shell#/all');
  });

  test('syncUrlToWindow 使用最长 prefix，并保留主应用 hash 与既有 query', () => {
    window.history.replaceState(null, '', '/shell?keep=hello%20world#/all');
    const iframeWindow = {
      location: {
        pathname: '/products/special/item',
        search: '?q=a b',
        hash: '#intro',
      },
      __JIESHU: {
        id: 'app',
        sync: true,
        prefix: {
          product: '/products',
          detail: '/products/special',
        },
      },
    } as unknown as Window;

    syncUrlToWindow(iframeWindow);

    expect(window.location.href).toBe(
      'http://localhost/shell?keep=hello%20world&app=%7Bdetail%7D%2Fitem%3Fq%3Da%20b%23intro#/all',
    );
  });

  test('syncUrlToWindow 在关闭同步后只删除当前应用参数', () => {
    window.history.replaceState(null, '', '/shell?app=%2Fold&keep=1#/all');
    const iframeWindow = {
      location: { pathname: '/ignored', search: '', hash: '' },
      __JIESHU: { id: 'app', sync: false },
    } as unknown as Window;

    syncUrlToWindow(iframeWindow);

    expect(window.location.href).toBe('http://localhost/shell?keep=1#/all');
  });

  test('clearInactiveAppUrl 仅清除已执行且失活的同步应用', () => {
    window.history.replaceState(null, '', '/shell?inactive=%2Fold&active=%2Fhome#/all');
    mockGetJieshuById.mockImplementation((id: string) =>
      id === 'inactive'
        ? { execFlag: true, sync: true, hrefFlag: false, activeFlag: false }
        : { execFlag: true, sync: true, hrefFlag: false, activeFlag: true },
    );

    clearInactiveAppUrl();

    expect(window.location.href).toBe('http://localhost/shell?active=%2Fhome#/all');
  });

  test('clearInactiveAppUrl 可清除已经先从注册表移除的销毁中应用', () => {
    window.history.replaceState(null, '', '/shell?destroying=%2Fold&keep=1#/all');
    mockGetJieshuById.mockReturnValue(null);

    clearInactiveAppUrl({
      id: 'destroying',
      execFlag: true,
      sync: true,
      hrefFlag: false,
      activeFlag: false,
    });

    expect(window.location.href).toBe('http://localhost/shell?keep=1#/all');
  });

  test('pushUrlToWindow 追加解码态路由且不改变主应用 hash', () => {
    window.history.replaceState(null, '', '/shell?keep=1#/all');

    pushUrlToWindow('app', '/detail?q=a b');

    expect(window.location.href).toBe('http://localhost/shell?keep=1&app=%2Fdetail%3Fq%3Da%20b#/all');
  });

  test('syncUrlToIframe 首次执行时展开短路径并替换 iframe 路由', () => {
    window.history.replaceState(null, '', '/shell?app=%7Bdetail%7D%2Fitem#/all');
    const replaceState = vi.fn();
    const iframeWindow = {
      location: { pathname: '/old', search: '', hash: '' },
      history: { replaceState },
      __JIESHU: {
        id: 'app',
        url: 'https://app.test/home',
        sync: true,
        execFlag: false,
        prefix: { detail: '/products/special' },
        inject: { mainHostPath: 'https://main-host.test' },
      },
    } as unknown as Window;

    syncUrlToIframe(iframeWindow);

    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://main-host.test/products/special/item');
  });

  test('processAppForHrefJump 遇到已脱离 document 的容器时安全跳过', () => {
    window.history.replaceState(null, '', '/shell?app=https%3A%2F%2Fchild.test%2Fnext#/all');
    mockGetJieshuById.mockReturnValue({
      id: 'app',
      iframe: { contentDocument: null },
    });
    processAppForHrefJump();

    expect(() => window.dispatchEvent(new PopStateEvent('popstate'))).not.toThrow();
  });
});

describe('route synchronization preserves host history state', () => {
  const frames: HTMLIFrameElement[] = [];
  const hostStates = [
    { label: 'null', state: null },
    { label: 'zero', state: 0 },
    { label: 'string', state: 'host-state' },
    { label: 'object', state: { idx: 7, key: 'host-route', usr: { selected: ['a', 'b'] }, scroll: { top: 120 } } },
  ];

  const createRouteWindow = (id: string, sync = true, path = '/products/special/item?q=a%20b#intro') => {
    const iframe = document.createElement('iframe');
    iframe.src = new URL(path, window.location.href).href;
    document.body.appendChild(iframe);
    frames.push(iframe);
    const iframeWindow = iframe.contentWindow;
    if (!iframeWindow) {
      throw new Error('Expected a window for the route fixture');
    }
    iframeWindow.history.replaceState({ child: 'private-state' }, '');
    // Only route metadata is consumed here; complete sandbox behavior is covered in Chromium.
    Object.defineProperty(iframeWindow, '__JIESHU', {
      value: { id, sync, prefix: { detail: '/products/special' } },
      configurable: true,
    });
    return iframeWindow;
  };

  beforeEach(() => {
    mockGetJieshuById.mockReset();
    window.history.replaceState(null, '', '/shell?keep=hello%20world#/all');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const frame of frames) {
      frame.remove();
    }
    frames.length = 0;
  });

  test.each(hostStates)('synchronization preserves $label host state without importing child state', ({ state }) => {
    const child = createRouteWindow('app');
    window.history.replaceState(state, '', window.location.href);
    const historyLength = window.history.length;

    syncUrlToWindow(child);

    expect(window.history.state).toEqual(state);
    expect(child.history.state).toEqual({ child: 'private-state' });
    expect(window.history.length).toBe(historyLength);
    expect(window.location.href).toBe(
      'http://localhost/shell?keep=hello%20world&app=%7Bdetail%7D%2Fitem%3Fq%3Da%2520b%23intro#/all',
    );
  });

  test.each(hostStates)('inactive app cleanup preserves $label host state and active app routes', ({ state }) => {
    window.history.replaceState(state, '', '/shell?inactive=%2Fold&active=%2Fhome&keep=1#/all');
    mockGetJieshuById.mockImplementation((id: string) => ({
      id,
      execFlag: true,
      sync: true,
      hrefFlag: false,
      activeFlag: id !== 'inactive',
    }));
    const historyLength = window.history.length;

    clearInactiveAppUrl();

    expect(window.history.state).toEqual(state);
    expect(window.history.length).toBe(historyLength);
    expect(window.location.href).toBe('http://localhost/shell?active=%2Fhome&keep=1#/all');
  });

  test('sync toggles retain each latest host state and only remove the current app route', () => {
    const child = createRouteWindow('app');
    window.history.replaceState({ key: 'initial' }, '', '/shell?app=%2Fold&other=%2Fhome#/all');
    syncUrlToWindow(child);
    expect(window.history.state).toEqual({ key: 'initial' });

    window.history.replaceState({ key: 'host-update' }, '', window.location.href);
    child.__JIESHU.sync = false;
    syncUrlToWindow(child);
    expect(window.history.state).toEqual({ key: 'host-update' });
    expect(window.location.href).toBe('http://localhost/shell?other=%2Fhome#/all');

    window.history.replaceState({ key: 'latest' }, '', window.location.href);
    child.__JIESHU.sync = true;
    syncUrlToWindow(child);
    expect(window.history.state).toEqual({ key: 'latest' });
    expect(new URL(window.location.href).searchParams.get('app')).toBe('{detail}/item?q=a%20b#intro');
  });

  test('teardown cleanup preserves current host state after removal from the sandbox registry', () => {
    window.history.replaceState({ key: 'teardown' }, '', '/shell?destroying=%2Fold&keep=1#/all');
    mockGetJieshuById.mockReturnValue(null);
    clearInactiveAppUrl({ id: 'destroying', execFlag: true, sync: true, hrefFlag: false, activeFlag: false });

    expect(window.history.state).toEqual({ key: 'teardown' });
    expect(window.location.href).toBe('http://localhost/shell?keep=1#/all');
  });

  test('unchanged routes do not rewrite history or state', () => {
    const child = createRouteWindow('app', true, '/home');
    window.history.replaceState({ key: 'untouched' }, '', '/shell?app=%2Fhome#/all');
    const replace = vi.spyOn(window.history, 'replaceState');

    syncUrlToWindow(child);
    clearInactiveAppUrl();
    expect(replace).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ key: 'untouched' });
    child.__JIESHU.sync = false;
    window.history.replaceState({ key: 'disabled' }, '', '/shell?keep=1#/all');
    replace.mockClear();
    syncUrlToWindow(child);

    expect(replace).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ key: 'disabled' });
  });

  test('href pushes a separate empty-state entry without mutating the old host state', () => {
    const hostState = { idx: 7, key: 'host-route', position: 7, usr: { selected: 'a' } };
    window.history.replaceState(hostState, '', '/shell?keep=1#/all');
    const historyLength = window.history.length;

    pushUrlToWindow('app', 'https://child.test/detail?q=a b#intro');

    expect(window.history.length).toBe(historyLength + 1);
    expect(window.history.state).toBeNull();
    expect(hostState).toEqual({ idx: 7, key: 'host-route', position: 7, usr: { selected: 'a' } });
    expect(window.location.hash).toBe('#/all');
    expect(new URL(window.location.href).searchParams.get('app')).toBe('https://child.test/detail?q=a b#intro');
  });
});
