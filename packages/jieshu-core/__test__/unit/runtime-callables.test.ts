import type { JieshuPlugin } from '../../src/contracts';
import { execHooks, getTargetValue, isCallable } from '../../src/utils';

describe('runtime callable compatibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each([undefined, null, false, 1, 'function', {}, []])('ignores non-callable values (%s)', (value) => {
    expect(isCallable(value)).toBe(false);
  });

  test('keeps document.all outside callable dispatch', () => {
    // jsdom represents document.all as undefined; browsers may expose the
    // HTMLDDA exotic object, whose typeof is also undefined.
    const documentAll: unknown = Reflect.get(document, 'all');

    expect(typeof documentAll).toBe('undefined');
    expect(isCallable(documentAll)).toBe(false);
  });

  test('accepts functions from another realm and binds them to the requested target', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    try {
      const iframeWindow = iframe.contentWindow;
      if (!iframeWindow) {
        throw new Error('Expected an iframe window');
      }
      const constructor: unknown = Reflect.get(iframeWindow, 'Function');
      if (!isCallable(constructor)) {
        throw new TypeError('Expected the iframe Function constructor');
      }
      const callback: unknown = Reflect.construct(constructor, ['return this;']);
      expect(isCallable(callback)).toBe(true);
      const target = document.implementation.createHTMLDocument('foreign-callback');
      Reflect.set(target, 'readOwner', callback);
      const bound = getTargetValue(target, 'readOwner');

      if (!isCallable(bound)) {
        throw new TypeError('Expected a bound callback');
      }
      expect(bound()).toBe(target);
      expect(getTargetValue(target, 'readOwner')).toBe(bound);
    } finally {
      iframe.remove();
    }
  });

  test('reads a changing target property once and does not reuse a stale binding', () => {
    const target = document.implementation.createHTMLDocument('changing-callback');
    const callback = () => 'callback';
    let value: unknown = callback;
    const read = vi.fn(() => value);
    Object.defineProperty(target, 'callback', { get: read });

    expect(isCallable(getTargetValue(target, 'callback'))).toBe(true);
    value = null;
    expect(getTargetValue(target, 'callback')).toBeNull();
    value = callback;
    expect(isCallable(getTargetValue(target, 'callback'))).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
  });

  test('captures every hook before invocation and observes later changes on the next dispatch', () => {
    const events: string[] = [];
    const second: JieshuPlugin = { windowPropertyOverride: () => events.push('second') };
    const plugins: JieshuPlugin[] = [
      {
        windowPropertyOverride: () => {
          events.push('first');
          second.windowPropertyOverride = () => events.push('updated');
          plugins.push({ windowPropertyOverride: () => events.push('appended') });
        },
      },
      second,
    ];

    execHooks(plugins, 'windowPropertyOverride', window);
    expect(events).toEqual(['first', 'second']);

    events.length = 0;
    execHooks(plugins, 'windowPropertyOverride', window);
    expect(events).toEqual(['first', 'updated', 'appended']);
  });

  test('ignores absent and non-callable hooks while forwarding arguments to a callable hook', () => {
    const invalidPlugin: JieshuPlugin = {};
    Object.defineProperty(invalidPlugin, 'windowPropertyOverride', { value: 42 });
    const hook = vi.fn();

    execHooks([{}, invalidPlugin, { windowPropertyOverride: hook }], 'windowPropertyOverride', window);

    expect(hook).toHaveBeenCalledExactlyOnceWith(window);
  });

  test('reports a hook getter failure before invoking any collected hook', () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = vi.fn();
    const unread = vi.fn();
    const broken: JieshuPlugin = {};
    Object.defineProperty(broken, 'windowPropertyOverride', {
      get: () => {
        throw new Error('getter failed');
      },
    });

    expect(() =>
      execHooks(
        [{ windowPropertyOverride: hook }, broken, { windowPropertyOverride: unread }],
        'windowPropertyOverride',
      ),
    ).not.toThrow();

    expect(hook).not.toHaveBeenCalled();
    expect(unread).not.toHaveBeenCalled();
    expect(logs).toHaveBeenCalledTimes(1);
  });

  test('reports a hook failure and preserves the existing stop-on-error dispatch behavior', () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const later = vi.fn();
    const broken = () => {
      throw new Error('hook failed');
    };

    expect(() =>
      execHooks([{ windowPropertyOverride: broken }, { windowPropertyOverride: later }], 'windowPropertyOverride'),
    ).not.toThrow();

    expect(later).not.toHaveBeenCalled();
    expect(logs).toHaveBeenCalledTimes(1);
  });
});
