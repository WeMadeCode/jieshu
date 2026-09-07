import {
  assertJieshuSupport,
  checkProxyFunction,
  defaultGetPublicPath,
  getAbsolutePath,
  getTargetValue,
  isBoundedFunction,
  isCallable,
  isConstructable,
} from '../../src/utils';

type CallableWithMetadata = CallableFunction & { metadata?: string };

describe('utils compatibility layers', () => {
  test('accepts runtimes with Proxy and Custom Elements', () => {
    expect(() => assertJieshuSupport()).not.toThrow();
  });

  test('rejects runtimes without Proxy instead of changing the rendering model', async () => {
    const nativeProxy = window.Proxy;
    Object.defineProperty(window, 'Proxy', { configurable: true, value: undefined });
    vi.resetModules();

    try {
      const unsupportedUtils = await import('../../src/utils');
      expect(unsupportedUtils.jieshuSupport).toBe(false);
      expect(() => unsupportedUtils.assertJieshuSupport()).toThrow(
        '当前浏览器不支持界枢，运行时需要 Proxy 和 Custom Elements',
      );
    } finally {
      Object.defineProperty(window, 'Proxy', { configurable: true, value: nativeProxy });
      vi.resetModules();
    }
  });

  test('rejects runtimes without a complete Custom Elements registry', async () => {
    const nativeDefine = window.customElements.define;
    Object.defineProperty(window.customElements, 'define', { configurable: true, value: undefined });
    vi.resetModules();

    try {
      const unsupportedUtils = await import('../../src/utils');
      expect(unsupportedUtils.jieshuSupport).toBe(false);
      expect(() => unsupportedUtils.assertJieshuSupport()).toThrow(
        '当前浏览器不支持界枢，运行时需要 Proxy 和 Custom Elements',
      );
    } finally {
      Object.defineProperty(window.customElements, 'define', { configurable: true, value: nativeDefine });
      vi.resetModules();
    }
  });

  test('getTargetValue caches one bound callable per target and copies metadata', () => {
    const target = document.implementation.createHTMLDocument('binding-target');
    const method: CallableWithMetadata = function (this: Document) {
      return this;
    };
    method.metadata = 'kept';
    Reflect.set(target, 'readOwner', method);

    const first = getTargetValue(target, 'readOwner');
    const second = getTargetValue(target, 'readOwner');
    const otherTarget = document.implementation.createHTMLDocument('other-binding-target');
    Reflect.set(otherTarget, 'readOwner', method);
    const other = getTargetValue(otherTarget, 'readOwner');

    expect(first).toBe(second);
    expect(other).not.toBe(first);
    if (!isCallable(first) || !isCallable(other)) {
      throw new TypeError('Expected bound callable values');
    }
    expect(first()).toBe(target);
    expect(other()).toBe(otherTarget);
    expect(Reflect.get(first, 'metadata')).toBe('kept');
    expect(Object.getOwnPropertyDescriptor(first, 'prototype')).toMatchObject({
      value: method.prototype,
      enumerable: false,
      writable: true,
    });
  });

  test('getTargetValue throws when callable metadata cannot be copied', () => {
    const target = document.implementation.createHTMLDocument('readonly-metadata-target');
    const callback = () => 'callback';
    Object.defineProperty(callback, 'name', { enumerable: true });
    Reflect.set(target, 'callback', callback);

    expect(() => getTargetValue(target, 'callback')).toThrow(TypeError);
  });

  test('checkProxyFunction preserves explicitly assigned callback identity', () => {
    const target = document.implementation.createHTMLDocument('callback-target');
    const callback = () => 'callback';
    Reflect.set(target, 'callback', callback);
    checkProxyFunction(target, callback);

    expect(getTargetValue(target, 'callback')).toBe(callback);
  });

  test.each([undefined, null, false, () => true])(
    'bound function detection ignores a shadowed hasOwnProperty (%s)',
    (hasOwnProperty) => {
      const callback = (() => 'callback').bind(null);
      Object.defineProperty(callback, 'hasOwnProperty', { value: hasOwnProperty });
      const target = document.implementation.createHTMLDocument('bound-callback-target');
      Reflect.set(target, 'callback', callback);

      expect(isBoundedFunction(callback)).toBe(true);
      expect(isBoundedFunction(callback)).toBe(true);
      expect(getTargetValue(target, 'callback')).toBe(callback);
    },
  );

  test('bound function detection supports a null prototype chain', () => {
    const callback = (() => 'callback').bind(null);
    Object.setPrototypeOf(callback, null);

    expect(isBoundedFunction(callback)).toBe(true);
  });

  test('bound function detection distinguishes own and inherited prototype properties', () => {
    const ownPrototype = (() => 'own').bind(null);
    Object.defineProperty(ownPrototype, 'prototype', { value: undefined });
    const inheritedPrototype = (() => 'inherited').bind(null);
    Object.setPrototypeOf(inheritedPrototype, { prototype: {} });

    expect(isBoundedFunction(ownPrototype)).toBe(false);
    expect(isBoundedFunction(ownPrototype)).toBe(false);
    expect(isBoundedFunction(inheritedPrototype)).toBe(true);
    expect(isBoundedFunction(() => 'ordinary')).toBe(false);
  });

  test('constructors stay unbound while URL helpers retain edge behavior', () => {
    class Widget {}
    const target = document.implementation.createHTMLDocument('constructor-target');
    Reflect.set(target, 'Widget', Widget);

    const constructor = getTargetValue(target, 'Widget');
    if (!isCallable(constructor)) {
      throw new TypeError('Expected the constructor to pass callable detection');
    }
    expect(isConstructable(constructor)).toBe(true);
    expect(constructor).toBe(Widget);
    expect(getAbsolutePath('#section', 'https://example.test/base', true)).toBe('#section');
    expect(getAbsolutePath('../asset.js', 'https://example.test/app/page')).toBe('https://example.test/asset.js');
    expect(defaultGetPublicPath('https://example.test/app/index.html')).toBe('https://example.test/app/');
  });
});
