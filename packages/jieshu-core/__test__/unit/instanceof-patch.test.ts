export {};

import * as iframeModule from '../../src/iframe';

interface RealmWindow extends Window {
  readonly DataTransfer: typeof DataTransfer;
  readonly DOMParser: typeof DOMParser;
  readonly HTMLDivElement: typeof HTMLDivElement;
  readonly MouseEvent: typeof MouseEvent;
}

function createIframeWindow(): RealmWindow {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) throw new Error('iframe window is unavailable');
  return iframeWindow as RealmWindow;
}

describe('patchInstanceofAcrossRealms', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('让主应用 realm 的元素和事件通过子应用构造函数的 instanceof 判断', () => {
    const iframeWindow = createIframeWindow();
    const { patchInstanceofAcrossRealms } = iframeModule;

    expect(typeof patchInstanceofAcrossRealms).toBe('function');

    const mainElement = document.createElement('div');
    const mainMouseEvent = new MouseEvent('click');

    expect(mainElement instanceof iframeWindow.HTMLDivElement).toBe(false);
    expect(mainMouseEvent instanceof iframeWindow.MouseEvent).toBe(false);

    patchInstanceofAcrossRealms(iframeWindow);

    expect(mainElement instanceof iframeWindow.HTMLDivElement).toBe(true);
    expect(mainElement instanceof iframeWindow.HTMLElement).toBe(true);
    expect(mainMouseEvent instanceof iframeWindow.MouseEvent).toBe(true);
    expect(mainMouseEvent instanceof iframeWindow.Event).toBe(true);

    if (typeof window.DataTransfer === 'function') {
      const mainDataTransfer = new window.DataTransfer();
      expect(mainDataTransfer instanceof iframeWindow.DataTransfer).toBe(true);
    }
  });

  test('保留子应用 realm 原有 instanceof 判断', () => {
    const iframeWindow = createIframeWindow();
    const { patchInstanceofAcrossRealms } = iframeModule;
    const childElement = iframeWindow.document.createElement('div');
    const childMouseEvent = new iframeWindow.MouseEvent('click');

    patchInstanceofAcrossRealms(iframeWindow);

    expect(childElement instanceof iframeWindow.HTMLDivElement).toBe(true);
    expect(childMouseEvent instanceof iframeWindow.MouseEvent).toBe(true);
  });

  test('重复 patch 时应保持幂等，避免 hasInstance 闭包堆叠', () => {
    const iframeWindow = createIframeWindow();
    const { patchInstanceofAcrossRealms } = iframeModule;

    patchInstanceofAcrossRealms(iframeWindow);
    const patchedHasInstance = iframeWindow.HTMLDivElement[Symbol.hasInstance];

    patchInstanceofAcrossRealms(iframeWindow);

    expect(iframeWindow.HTMLDivElement[Symbol.hasInstance]).toBe(patchedHasInstance);
  });

  test('共享的 host 构造器按 realm 隔离并可接纳多个 peer realm', () => {
    const appWindow = createIframeWindow();
    const firstRenderWindow = createIframeWindow();
    const secondRenderWindow = createIframeWindow();
    const hostDOMParser = window.DOMParser;
    const hostHasInstance = Object.getOwnPropertyDescriptor(hostDOMParser, Symbol.hasInstance);
    Object.defineProperty(appWindow, 'DOMParser', {
      configurable: true,
      get: () => hostDOMParser,
    });

    iframeModule.patchInstanceofAcrossRealms(appWindow, firstRenderWindow);
    const isolatedConstructor = appWindow.DOMParser;
    const firstParser = new firstRenderWindow.DOMParser();

    expect(isolatedConstructor).not.toBe(hostDOMParser);
    expect(firstParser instanceof isolatedConstructor).toBe(true);

    iframeModule.patchInstanceofAcrossRealms(appWindow, secondRenderWindow);
    const secondParser = new secondRenderWindow.DOMParser();

    expect(appWindow.DOMParser).toBe(isolatedConstructor);
    expect(secondParser instanceof isolatedConstructor).toBe(true);
    expect(window.DOMParser).toBe(hostDOMParser);
    expect(Object.getOwnPropertyDescriptor(hostDOMParser, Symbol.hasInstance)).toEqual(hostHasInstance);
  });
});
