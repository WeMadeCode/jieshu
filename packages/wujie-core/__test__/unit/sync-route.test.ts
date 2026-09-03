const mockGetWujieById = jest.fn();

jest.mock('../../src/common', () => ({
  getWujieById: mockGetWujieById,
  rawDocumentQuerySelector: jest.fn(),
}));

jest.mock('../../src/iframe', () => ({
  patchEventTimeStamp: jest.fn(),
  renderIframeReplaceApp: jest.fn(),
}));

jest.mock('../../src/shadow', () => ({
  initRenderIframeAndContainer: jest.fn(),
  renderElementToContainer: jest.fn(),
}));

jest.mock('../../src/utils', () => ({
  appRouteParse: (url: string) => {
    const parsed = new URL(url, 'https://fallback.test');
    return {
      urlElement: globalThis.document.createElement('a'),
      appHostPath: parsed.origin,
      appRoutePath: parsed.pathname + parsed.search + parsed.hash,
    };
  },
  getDegradeIframe: jest.fn(),
}));

const { clearInactiveAppUrl, processAppForHrefJump, pushUrlToWindow, syncUrlToIframe, syncUrlToWindow } =
  require('../../src/sync') as typeof import('../../src/sync');

describe('sync route orchestration', () => {
  beforeEach(() => {
    mockGetWujieById.mockReset();
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
      __WUJIE: {
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
      __WUJIE: { id: 'app', sync: false },
    } as unknown as Window;

    syncUrlToWindow(iframeWindow);

    expect(window.location.href).toBe('http://localhost/shell?keep=1#/all');
  });

  test('clearInactiveAppUrl 仅清除已执行且失活的同步应用', () => {
    window.history.replaceState(null, '', '/shell?inactive=%2Fold&active=%2Fhome#/all');
    mockGetWujieById.mockImplementation((id: string) =>
      id === 'inactive'
        ? { execFlag: true, sync: true, hrefFlag: false, activeFlag: false }
        : { execFlag: true, sync: true, hrefFlag: false, activeFlag: true },
    );

    clearInactiveAppUrl();

    expect(window.location.href).toBe('http://localhost/shell?active=%2Fhome#/all');
  });

  test('clearInactiveAppUrl 可清除已经先从注册表移除的销毁中应用', () => {
    window.history.replaceState(null, '', '/shell?destroying=%2Fold&keep=1#/all');
    mockGetWujieById.mockReturnValue(null);

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
    const replaceState = jest.fn();
    const iframeWindow = {
      location: { pathname: '/old', search: '', hash: '' },
      history: { replaceState },
      __WUJIE: {
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

  test('processAppForHrefJump 遇到已脱离 document 的 iframe 时安全跳过', () => {
    window.history.replaceState(null, '', '/shell?app=https%3A%2F%2Fchild.test%2Fnext#/all');
    mockGetWujieById.mockReturnValue({
      id: 'app',
      iframe: { contentDocument: null },
    });
    processAppForHrefJump();

    expect(() => window.dispatchEvent(new PopStateEvent('popstate'))).not.toThrow();
  });
});
