import { patchDocumentEffect } from '../../src/iframe';
import { cleanupDocumentFixtures, createDocumentFixture } from './document-fixture';

afterEach(cleanupDocumentFixtures);

test('element event properties use the current shadow root and bind handlers to the child document', () => {
  const { childWindow, childDocument, root, sandbox } = createDocumentFixture();
  patchDocumentEffect(childWindow);
  const receivers: unknown[] = [];
  // 验证 onclick 转发后的动态 this。
  const handler = vi.fn(function (this: Document) {
    receivers.push(this);
  });
  childDocument.onclick = handler;
  expect(childDocument.onclick).toBe(root.onclick);
  root.dispatchEvent(new Event('click'));
  expect(receivers).toEqual([childDocument]);

  const replacement = document.createElement('article');
  sandbox.shadowRoot.replaceChildren(replacement);
  expect(childDocument.onclick).toBeNull();
  childDocument.onclick = handler;
  childDocument.onclick = null;
  replacement.dispatchEvent(new Event('click'));
  expect(handler).toHaveBeenCalledOnce();
});

test('keeps iframe-only event properties native', () => {
  const { childWindow, childDocument, root } = createDocumentFixture();
  const original = Object.getOwnPropertyDescriptor(childWindow.Document.prototype, 'onreadystatechange');
  patchDocumentEffect(childWindow);
  expect(Object.getOwnPropertyDescriptor(childWindow.Document.prototype, 'onreadystatechange')).toEqual(original);
  const handler = vi.fn();
  childDocument.onreadystatechange = handler;
  root.dispatchEvent(new Event('readystatechange'));
  expect(handler).not.toHaveBeenCalled();
  childDocument.dispatchEvent(new Event('readystatechange'));
  expect(handler).toHaveBeenCalledOnce();
});

test('reads the live proxy, preserves undefined values, and uses native fallbacks after release', () => {
  const { childWindow, childDocument, sandbox } = createDocumentFixture();
  const nativeReadyState = Object.getOwnPropertyDescriptor(childWindow.Document.prototype, 'readyState');
  const head = document.createElement('head');
  const body = document.createElement('body');
  Object.defineProperty(childDocument, 'head', { configurable: true, get: () => head });
  Object.defineProperty(childDocument, 'body', { configurable: true, value: body });
  sandbox.proxyDocument = { readyState: 'loading', head: undefined, body: undefined };
  patchDocumentEffect(childWindow);
  expect(childDocument.readyState).toBe('loading');
  expect(childDocument.head).toBeUndefined();
  expect(childDocument.body).toBeUndefined();

  sandbox.proxyDocument = { readyState: 'complete', head, body };
  expect(childDocument.readyState).toBe('complete');
  expect(childDocument.head).toBe(head);
  expect(childDocument.body).toBe(body);
  Reflect.deleteProperty(sandbox, 'proxyDocument');
  expect(childDocument.readyState).toBe(nativeReadyState?.get?.call(childDocument));
  expect(childDocument.head).toBe(head);
  expect(childDocument.body).toBe(body);
});

test('element event getters fall back after the shadow root is released', () => {
  const { childWindow, childDocument, sandbox } = createDocumentFixture();
  const nativeClick = Object.getOwnPropertyDescriptor(childWindow.Document.prototype, 'onclick');
  patchDocumentEffect(childWindow);
  Reflect.deleteProperty(sandbox, 'shadowRoot');
  expect(() => {
    childDocument.onclick = vi.fn();
  }).not.toThrow();
  expect(childDocument.onclick).toBe(nativeClick?.get?.call(childDocument));
});

test.each([null, undefined, 42, {}])(
  'non-function document event assignment %s removes only that property',
  (value) => {
    const { childWindow, childDocument } = createDocumentFixture();
    patchDocumentEffect(childWindow);
    const fullscreen = vi.fn();
    const visibility = vi.fn();
    childDocument.onfullscreenchange = fullscreen;
    childDocument.onvisibilitychange = visibility;
    Reflect.set(childDocument, 'onfullscreenchange', value);
    document.dispatchEvent(new Event('fullscreenchange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fullscreen).not.toHaveBeenCalled();
    expect(visibility).toHaveBeenCalledOnce();
  },
);

test('unpatchable prototype properties warn without blocking later properties or the plugin hook', () => {
  const { childWindow, childDocument, sandbox, plugin } = createDocumentFixture();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.defineProperty(childWindow.Document.prototype, 'URL', { configurable: false, value: 'native-url' });
  sandbox.proxyDocument = { readyState: 'complete', head: document.head, body: document.body };
  plugin.documentPropertyOverride.mockImplementation(() => {
    expect(childDocument.head).toBe(document.head);
    expect(childDocument.readyState).toBe('complete');
  });

  expect(() => patchDocumentEffect(childWindow)).not.toThrow();
  expect(childDocument.URL).toBe('native-url');
  expect(warn).toHaveBeenCalledOnce();
  expect(plugin.documentPropertyOverride).toHaveBeenCalledExactlyOnceWith(childWindow);
});

test('read-only event properties do not acquire setters', () => {
  const { childWindow, childDocument } = createDocumentFixture();
  Object.defineProperty(childWindow.Document.prototype, 'onclick', {
    configurable: true,
    enumerable: true,
    get: () => 'native-click',
    set: undefined,
  });
  const fullscreen = { configurable: true, enumerable: true, get: () => 'native-fullscreen', set: undefined };
  Object.defineProperty(childWindow.Document.prototype, 'onfullscreenchange', fullscreen);
  patchDocumentEffect(childWindow);
  expect(Object.getOwnPropertyDescriptor(childWindow.Document.prototype, 'onclick')?.set).toBeUndefined();
  expect(childDocument.onfullscreenchange).toBe('native-fullscreen');
  expect(Object.getOwnPropertyDescriptor(childWindow.Document.prototype, 'onfullscreenchange')?.set).toBeUndefined();
});
