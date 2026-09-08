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

describe('独立 core 副本共享 window.onXXX 覆盖历史', () => {
  const trackers: EventCleanupTracker[] = [];
  const targets: Window[] = [];
  let first: EventCleanupTracker;
  let second: EventCleanupTracker;
  let sameCopy: EventCleanupTracker;

  beforeEach(async () => {
    vi.resetModules();
    const firstCore = await import('../../src/tracker');
    vi.resetModules();
    const secondCore = await import('../../src/tracker');
    expect(firstCore.EventCleanupTracker).not.toBe(secondCore.EventCleanupTracker);
    first = new firstCore.EventCleanupTracker();
    second = new secondCore.EventCleanupTracker();
    sameCopy = new firstCore.EventCleanupTracker();
    trackers.push(first, second, sameCopy);
    targets.push(window);
  });

  afterEach(() => {
    for (const tracker of trackers) {
      for (const target of targets) {
        tracker.cleanupWindowOnEventOverrides(target);
      }
    }
    trackers.length = 0;
    targets.length = 0;
    window.onresize = null;
    window.ononline = null;
    document.body.innerHTML = '';
  });

  test.each(['first', 'second'])('先清理 %s 副本时最终恢复主应用处理器', (order) => {
    const host = vi.fn();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    window.onresize = host;
    first.setWindowOnEvent(window, 'onresize', firstHandler);
    second.setWindowOnEvent(window, 'onresize', secondHandler);

    const [earlier, later] = order === 'first' ? [first, second] : [second, first];
    earlier.cleanupAll();
    expect(window.onresize).toBe(order === 'first' ? secondHandler : firstHandler);

    later.cleanupAll();
    expect(window.onresize).toBe(host);
  });

  test.each(['first', 'second'])('重复写入与重新接管后先清理 %s 副本，不恢复旧处理器', (order) => {
    const host = vi.fn();
    const firstHandler = vi.fn();
    const latestFirstHandler = vi.fn();
    const secondHandler = vi.fn();
    window.onresize = host;
    first.setWindowOnEvent(window, 'onresize', firstHandler);
    first.setWindowOnEvent(window, 'onresize', vi.fn());
    second.setWindowOnEvent(window, 'onresize', secondHandler);
    first.setWindowOnEvent(window, 'onresize', latestFirstHandler);

    const [earlier, later] = order === 'first' ? [first, second] : [second, first];
    earlier.cleanupAll();
    expect(window.onresize).toBe(order === 'first' ? secondHandler : latestFirstHandler);
    later.cleanupAll();
    expect(window.onresize).toBe(host);
  });

  test.each(['first', 'second'])('主应用在两个副本写入之间更新，先清理 %s 时保留更新', (order) => {
    const latestHost = vi.fn();
    window.onresize = vi.fn();
    first.setWindowOnEvent(window, 'onresize', vi.fn());
    window.onresize = latestHost;
    second.setWindowOnEvent(window, 'onresize', vi.fn());

    const [earlier, later] = order === 'first' ? [first, second] : [second, first];
    earlier.cleanupAll();
    later.cleanupAll();
    expect(window.onresize).toBe(latestHost);
  });

  test('主应用更新后原副本再次接管，保留最新主应用基线', () => {
    const latestHost = vi.fn();
    window.onresize = vi.fn();
    first.setWindowOnEvent(window, 'onresize', vi.fn());
    second.setWindowOnEvent(window, 'onresize', vi.fn());
    window.onresize = latestHost;
    first.setWindowOnEvent(window, 'onresize', vi.fn());

    second.cleanupAll();
    first.cleanupAll();
    expect(window.onresize).toBe(latestHost);
  });

  test('主应用最后改写多个属性，清理两个副本不回滚主应用更新', () => {
    const resizeHost = vi.fn();
    const onlineHost = vi.fn();
    for (const key of ['onresize', 'ononline']) {
      first.setWindowOnEvent(window, key, vi.fn());
      second.setWindowOnEvent(window, key, vi.fn());
    }
    window.onresize = resizeHost;
    window.ononline = onlineHost;
    first.cleanupAll();
    second.cleanupAll();
    expect(window.onresize).toBe(resizeHost);
    expect(window.ononline).toBe(onlineHost);
  });

  test('不同目标 window 的恢复历史保持独立', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const childWindow = iframe.contentWindow;
    if (!childWindow) {
      throw new Error('Expected an iframe window');
    }
    targets.push(childWindow);
    const host = vi.fn();
    const childHost = vi.fn();
    window.onresize = host;
    childWindow.onresize = childHost;
    first.setWindowOnEvent(window, 'onresize', vi.fn());
    first.setWindowOnEvent(childWindow, 'onresize', vi.fn());
    second.setWindowOnEvent(window, 'onresize', vi.fn());
    second.setWindowOnEvent(childWindow, 'onresize', vi.fn());

    first.cleanupWindowOnEventOverrides(window);
    second.cleanupWindowOnEventOverrides(childWindow);
    second.cleanupWindowOnEventOverrides(window);
    expect(window.onresize).toBe(host);
    expect(childWindow.onresize).not.toBe(childHost);
    first.cleanupWindowOnEventOverrides(childWindow);
    expect(childWindow.onresize).toBe(childHost);
  });

  test('setter 归一化写入值后仍能恢复主应用处理器', () => {
    const key = '__normalizedOnEvent';
    const host = vi.fn();
    let current: unknown = host;
    Object.defineProperty(window, key, {
      configurable: true,
      get: () => current,
      set: (value: unknown) => {
        current = typeof value === 'function' ? value : null;
      },
    });
    try {
      first.setWindowOnEvent(window, key, 7);
      expect(Reflect.get(window, key)).toBeNull();
      second.setWindowOnEvent(window, key, vi.fn());
      first.cleanupAll();
      second.cleanupAll();
      expect(Reflect.get(window, key)).toBe(host);
    } finally {
      Reflect.deleteProperty(window, key);
    }
  });

  test('同一 core 内主应用中途改写也必须保留新的基线', () => {
    const latestHost = vi.fn();
    window.onresize = vi.fn();
    first.setWindowOnEvent(window, 'onresize', vi.fn());
    window.onresize = latestHost;
    sameCopy.setWindowOnEvent(window, 'onresize', vi.fn());
    first.cleanupAll();
    sameCopy.cleanupAll();
    expect(window.onresize).toBe(latestHost);
  });

  test.each([false, true])('主应用删除自有属性后，即使读取值未变也不能复活旧属性（再次写入：%s）', (writeAgain) => {
    const key = '__deletedOnEvent';
    Reflect.set(window, key, 'host');
    try {
      first.setWindowOnEvent(window, key, undefined);
      Reflect.deleteProperty(window, key);
      if (writeAgain) {
        second.setWindowOnEvent(window, key, vi.fn());
      }
      first.cleanupAll();
      second.cleanupAll();
      expect(Reflect.getOwnPropertyDescriptor(window, key)).toBeUndefined();
    } finally {
      Reflect.deleteProperty(window, key);
    }
  });

  test('只读属性写入失败不撤销旧 owner，也不遗留空注册表', () => {
    const key = '__readonlyOnEvent';
    const host = vi.fn();
    const symbols = Object.getOwnPropertySymbols(window);
    Object.defineProperty(window, key, { configurable: true, writable: false, value: host });
    try {
      first.setWindowOnEvent(window, key, vi.fn());
      expect(Reflect.get(window, key)).toBe(host);
      expect(Object.getOwnPropertySymbols(window)).toEqual(symbols);

      Object.defineProperty(window, key, { writable: true });
      first.setWindowOnEvent(window, key, vi.fn());
      Object.defineProperty(window, key, { writable: false });
      second.setWindowOnEvent(window, key, vi.fn());
      Object.defineProperty(window, key, { writable: true });
      first.cleanupAll();
      second.cleanupAll();
      expect(Reflect.get(window, key)).toBe(host);
      expect(Object.getOwnPropertySymbols(window)).toEqual(symbols);
    } finally {
      Reflect.deleteProperty(window, key);
    }
  });

  test('setter 抛错时保持旧恢复链并撤回新建的空注册表', () => {
    const key = '__throwingOnEvent';
    const host = vi.fn();
    const symbols = Object.getOwnPropertySymbols(window);
    let current: unknown = host;
    let fail = true;
    Object.defineProperty(window, key, {
      configurable: true,
      get: () => current,
      set: (value: unknown) => {
        if (fail) {
          throw new Error('Write failed');
        }
        current = value;
      },
    });
    try {
      expect(() => first.setWindowOnEvent(window, key, vi.fn())).toThrow('Write failed');
      expect(Object.getOwnPropertySymbols(window)).toEqual(symbols);
      fail = false;
      first.setWindowOnEvent(window, key, vi.fn());
      fail = true;
      expect(() => second.setWindowOnEvent(window, key, vi.fn())).toThrow('Write failed');
      fail = false;
      first.cleanupAll();
      second.cleanupAll();
      expect(Reflect.get(window, key)).toBe(host);
      expect(Object.getOwnPropertySymbols(window)).toEqual(symbols);
    } finally {
      fail = false;
      Reflect.deleteProperty(window, key);
    }
  });

  test('主应用将处理器设为只读后，恢复失败不能继续删除该属性', () => {
    const key = '__protectedOnEvent';
    const handler = vi.fn();
    try {
      first.setWindowOnEvent(window, key, handler);
      Object.defineProperty(window, key, { writable: false });
      first.cleanupAll();
      expect(Reflect.getOwnPropertyDescriptor(window, key)).toMatchObject({ value: handler, writable: false });
    } finally {
      Reflect.deleteProperty(window, key);
    }
  });

  test('全部清理后重新安装可恢复新的主应用处理器', () => {
    const oldHost = vi.fn();
    const newHost = vi.fn();
    window.onresize = oldHost;
    first.setWindowOnEvent(window, 'onresize', vi.fn());
    second.setWindowOnEvent(window, 'onresize', vi.fn());
    first.cleanupAll();
    second.cleanupAll();
    expect(window.onresize).toBe(oldHost);

    window.onresize = newHost;
    second.setWindowOnEvent(window, 'onresize', vi.fn());
    first.setWindowOnEvent(window, 'onresize', vi.fn());
    second.cleanupAll();
    first.cleanupAll();
    expect(window.onresize).toBe(newHost);
  });
});
