/**
 * 准集成测试：用 jsdom 真 iframe 走 patchDocumentEffect / patchWindowEffect 全链路，
 * 验证 sandbox 销毁能彻底反向解绑主应用 window / document 上的副作用。
 *
 * 选择 jsdom 而非 Playwright：这两个 patch 的逻辑均为 DOM 标准 API，jsdom 已能复现，
 * 跑得更快；Playwright 端到端基准另行覆盖。
 */

const mockWarnE2E = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils')>();
  return { ...actual, warn: mockWarnE2E };
});

import { patchDocumentEffect, patchWindowEffect } from '../../src/iframe';
import { EventCleanupTracker } from '../../src/tracker';

function createSandboxStub(id: string) {
  return {
    id,
    degrade: false,
    plugins: [],
    shadowRoot: document.createElement('div'),
    proxyDocument: {},
    iframeOnEvents: [],
    eventCleanupTracker: new EventCleanupTracker(),
  };
}

describe('E2E: patchDocumentEffect 端到端反向解绑', () => {
  let iframe: HTMLIFrameElement;
  let iframeWindow: any;
  let sandbox: any;

  beforeEach(() => {
    document.body.innerHTML = '';
    iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    iframeWindow = iframe.contentWindow;
    sandbox = createSandboxStub('e2e-doc');
    iframeWindow.__JIESHU = sandbox;
  });

  afterEach(() => {
    iframe.remove();
  });

  test("子应用 document.addEventListener('keydown', fn) 被转发到主 document，destroy 后反向解绑", () => {
    patchDocumentEffect(iframeWindow);

    const handler = vi.fn();
    iframeWindow.document.addEventListener('keydown', handler);

    window.document.dispatchEvent(new Event('keydown'));
    expect(handler).toHaveBeenCalledTimes(1);

    // 模拟 destroy 阶段调用
    sandbox.eventCleanupTracker.cleanupAll();

    handler.mockClear();
    window.document.dispatchEvent(new Event('keydown'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('子应用主动 removeEventListener 后再 cleanupAll 不应抛错', () => {
    patchDocumentEffect(iframeWindow);

    const handler = vi.fn();
    iframeWindow.document.addEventListener('keydown', handler);
    iframeWindow.document.removeEventListener('keydown', handler);

    expect(() => sandbox.eventCleanupTracker.cleanupAll()).not.toThrow();
    handler.mockClear();
    window.document.dispatchEvent(new Event('keydown'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('同一 document listener 的 capture 与 bubble 注册可分别移除', () => {
    patchDocumentEffect(iframeWindow);
    const handler = vi.fn();

    iframeWindow.document.addEventListener('keydown', handler, false);
    iframeWindow.document.addEventListener('keydown', handler, true);
    window.document.dispatchEvent(new Event('keydown'));
    expect(handler).toHaveBeenCalledTimes(2);

    handler.mockClear();
    iframeWindow.document.removeEventListener('keydown', handler, false);
    window.document.dispatchEvent(new Event('keydown'));
    expect(handler).toHaveBeenCalledTimes(1);

    handler.mockClear();
    iframeWindow.document.removeEventListener('keydown', handler, true);
    window.document.dispatchEvent(new Event('keydown'));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('E2E: patchWindowEffect 端到端 onXXX 还原', () => {
  let iframe: HTMLIFrameElement;
  let iframeWindow: any;
  let sandbox: any;
  let originalOnResize: any;

  beforeEach(() => {
    document.body.innerHTML = '';
    iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    iframeWindow = iframe.contentWindow;
    sandbox = createSandboxStub('e2e-win');
    iframeWindow.__JIESHU = sandbox;
    originalOnResize = (window as any).onresize;
  });

  afterEach(() => {
    iframe.remove();
    (window as any).onresize = originalOnResize;
  });

  test('子应用 window.onresize = fn 写入主 window，destroy 后不再触发 handler', () => {
    patchWindowEffect(iframeWindow);

    const handler = vi.fn();
    iframeWindow.onresize = handler;

    // Vitest 的 jsdom 环境会把全局事件方法绑定到内部 window；直接调用
    // onresize 可验证与浏览器一致的 onXXX 属性代理，而不依赖该绑定细节。
    window.onresize?.(new UIEvent('resize'));
    expect(handler).toHaveBeenCalledTimes(1);

    sandbox.eventCleanupTracker.cleanupAll();

    // 销毁后再触发，handler 不应再被调用（dangling handler 已清除）
    handler.mockClear();
    window.onresize?.(new UIEvent('resize'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('多子应用交错销毁时保留最新 onresize owner 且不复活旧 iframe handler', () => {
    const secondIframe = document.createElement('iframe');
    document.body.appendChild(secondIframe);
    const secondWindow = secondIframe.contentWindow as Window;
    const secondSandbox = createSandboxStub('e2e-win-second');
    Reflect.set(secondWindow, '__JIESHU', secondSandbox);
    patchWindowEffect(iframeWindow);
    patchWindowEffect(secondWindow);
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    iframeWindow.onresize = firstHandler;
    secondWindow.onresize = secondHandler;
    sandbox.eventCleanupTracker.cleanupAll();
    window.onresize?.(new UIEvent('resize'));

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);

    secondSandbox.eventCleanupTracker.cleanupAll();
    secondHandler.mockClear();
    window.onresize?.(new UIEvent('resize'));
    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).not.toHaveBeenCalled();
    secondIframe.remove();
  });
});
