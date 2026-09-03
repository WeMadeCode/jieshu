/**
 * 单元测试：EventCleanupTracker 两类副作用的反向解绑与还原。
 *
 * patchDocumentEffect 会把子应用 document.addEventListener 中部分事件转发到主
 * window.document；patchWindowEffect 会把 window.onXXX 改写到主 window 上。
 * sandbox.destroy() 必须通过 tracker.cleanupAll() 反向解绑 listener 并还原
 * onXXX 原值，否则 iframeWindow 会被闭包钉住、主 window 残留 dangling handler。
 */

const mockWarnDestroy = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils')>();
  return { ...actual, warn: mockWarnDestroy };
});

import { EventCleanupTracker } from '../../src/tracker';

describe('EventCleanupTracker 主应用 window.document 上的 listener 反向解绑', () => {
  test('trackMainDocumentListener + cleanupAll 应能反向解绑主 document 上的 listener', () => {
    const tracker = new EventCleanupTracker();
    const handler = vi.fn();

    window.document.addEventListener('keydown', handler);
    tracker.trackMainDocumentListener({ type: 'keydown', callback: handler });

    window.document.dispatchEvent(new Event('keydown'));
    expect(handler).toHaveBeenCalledTimes(1);

    tracker.cleanupAll();

    handler.mockClear();
    window.document.dispatchEvent(new Event('keydown'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('untrackMainDocumentListener 后 cleanupAll 不应再次尝试解绑（防御 destroy 时重复解绑）', () => {
    const tracker = new EventCleanupTracker();
    const handler = vi.fn();
    const entry = { type: 'keydown', callback: handler };

    window.document.addEventListener('keydown', handler);
    tracker.trackMainDocumentListener(entry);
    // 用户主动 removeEventListener 后业务代码会调用 untrack
    window.document.removeEventListener('keydown', handler);
    tracker.untrackMainDocumentListener(entry);

    // cleanupAll 不应抛错且不影响结果
    expect(() => tracker.cleanupAll()).not.toThrow();
    handler.mockClear();
    window.document.dispatchEvent(new Event('keydown'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('cleanupAll 中 removeEventListener 抛错不应中断后续清理（防御性）', () => {
    const tracker = new EventCleanupTracker();
    const okHandler = vi.fn();
    window.document.addEventListener('keydown', okHandler);
    tracker.trackMainDocumentListener({ type: 'keydown', callback: okHandler });

    // 显式塞一个会抛错的 entry：removeEventListener 不会真的抛，但模拟未知异常环境
    const trackerAny: any = tracker;
    trackerAny.mainDocumentListeners.add({
      type: 'keydown',
      callback: null as any, // 会让 removeEventListener 抛错
    });

    expect(() => tracker.cleanupAll()).not.toThrow();
    okHandler.mockClear();
    window.document.dispatchEvent(new Event('keydown'));
    expect(okHandler).not.toHaveBeenCalled();
  });
});

describe('EventCleanupTracker 主应用 window.onXXX 污染还原', () => {
  let originalOnTestEvent: any;
  beforeEach(() => {
    originalOnTestEvent = (window as any).__leakProbeOnEvent;
  });
  afterEach(() => {
    (window as any).__leakProbeOnEvent = originalOnTestEvent;
  });

  test('setWindowOnEvent + cleanupAll 应还原主应用 window 上的属性', () => {
    const tracker = new EventCleanupTracker();
    const original = 'original-value';
    (window as any).__leakProbeOnEvent = original;

    tracker.setWindowOnEvent(window, '__leakProbeOnEvent', 'polluted-value');
    expect((window as any).__leakProbeOnEvent).toBe('polluted-value');

    tracker.cleanupAll();

    expect((window as any).__leakProbeOnEvent).toBe(original);
  });

  test('同一 tracker 反复覆盖时仍还原首次接管前的值', () => {
    const tracker = new EventCleanupTracker();
    const original = 'first-original';
    (window as any).__leakProbeOnEvent = original;

    tracker.setWindowOnEvent(window, '__leakProbeOnEvent', 'polluted-1');
    tracker.setWindowOnEvent(window, '__leakProbeOnEvent', 'polluted-2');

    tracker.cleanupAll();

    expect((window as any).__leakProbeOnEvent).toBe(original);
  });

  test('主 window 原本无该属性时，cleanupAll 应 delete 而非保留 polluted 值', () => {
    const tracker = new EventCleanupTracker();
    delete (window as any).__leakProbeOnEvent;

    tracker.setWindowOnEvent(window, '__leakProbeOnEvent', 'polluted');

    tracker.cleanupAll();

    expect('__leakProbeOnEvent' in window).toBe(false);
  });

  test('交错销毁多个 sandbox 时不得覆盖当前 owner 或复活旧 handler', () => {
    const first = new EventCleanupTracker();
    const second = new EventCleanupTracker();
    (window as any).__leakProbeOnEvent = 'host';

    first.setWindowOnEvent(window, '__leakProbeOnEvent', 'first');
    second.setWindowOnEvent(window, '__leakProbeOnEvent', 'second');

    first.cleanupAll();
    expect((window as any).__leakProbeOnEvent).toBe('second');

    second.cleanupAll();
    expect((window as any).__leakProbeOnEvent).toBe('host');
  });

  test('最近写入的 owner 销毁后恢复上一个 sandbox，再恢复主应用', () => {
    const first = new EventCleanupTracker();
    const second = new EventCleanupTracker();
    (window as any).__leakProbeOnEvent = 'host';

    first.setWindowOnEvent(window, '__leakProbeOnEvent', 'first');
    second.setWindowOnEvent(window, '__leakProbeOnEvent', 'second');
    second.cleanupAll();
    expect((window as any).__leakProbeOnEvent).toBe('first');

    first.cleanupAll();
    expect((window as any).__leakProbeOnEvent).toBe('host');
  });

  test('主应用在 sandbox 之后写入的值不得被 cleanup 回滚', () => {
    const tracker = new EventCleanupTracker();
    (window as any).__leakProbeOnEvent = 'host-before';

    tracker.setWindowOnEvent(window, '__leakProbeOnEvent', 'sandbox');
    (window as any).__leakProbeOnEvent = 'host-latest';
    tracker.cleanupAll();

    expect((window as any).__leakProbeOnEvent).toBe('host-latest');
  });
});
