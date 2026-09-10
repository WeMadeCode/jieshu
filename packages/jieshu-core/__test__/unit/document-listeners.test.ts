import { patchDocumentEffect } from '../../src/iframe';
import { cleanupDocumentFixtures, createDocumentFixture } from './document-fixture';

afterEach(cleanupDocumentFixtures);

test.each([
  { type: 'DOMContentLoaded', child: 1, main: 0, shadow: 0 },
  { type: 'keydown', child: 0, main: 1, shadow: 0 },
  { type: 'gotpointercapture', child: 0, main: 1, shadow: 1 },
  { type: 'click', child: 0, main: 0, shadow: 1 },
])('routes $type to the expected documents and removes the same bound callback', (route) => {
  const { childWindow, childDocument, sandbox, plugin } = createDocumentFixture();
  patchDocumentEffect(childWindow);
  const receivers: unknown[] = [];
  // 验证回调使用注册时的 document 作为动态 this。
  const handler = vi.fn(function (this: Document) {
    receivers.push(this);
  });
  const options = { capture: true };
  childDocument.addEventListener(route.type, handler, options);
  expect(plugin.documentAddEventListenerHook).toHaveBeenCalledExactlyOnceWith(
    childWindow,
    route.type,
    expect.any(Function),
    options,
  );

  const targets = [childDocument, document, sandbox.shadowRoot];
  const counts = [route.child, route.main, route.shadow];
  for (const [index, target] of targets.entries()) {
    handler.mockClear();
    target.dispatchEvent(new Event(route.type));
    expect(handler).toHaveBeenCalledTimes(counts[index]);
  }
  expect(receivers.every((receiver) => receiver === childDocument)).toBe(true);

  childDocument.removeEventListener(route.type, handler, options);
  expect(plugin.documentRemoveEventListenerHook.mock.calls[0]).toEqual(
    plugin.documentAddEventListenerHook.mock.calls[0],
  );
  handler.mockClear();
  for (const target of targets) {
    target.dispatchEvent(new Event(route.type));
  }
  expect(handler).not.toHaveBeenCalled();
});

test('preserves listener object identity and handleEvent receiver', () => {
  const { childWindow, childDocument, plugin } = createDocumentFixture();
  patchDocumentEffect(childWindow);
  const receivers: unknown[] = [];
  const handler = {
    // handleEvent 的 this 必须保持为 listener 对象。
    handleEvent: vi.fn(function (this: EventListenerObject) {
      receivers.push(this);
    }),
  };
  childDocument.addEventListener('keydown', handler);
  document.dispatchEvent(new Event('keydown'));
  expect(receivers).toEqual([handler]);
  expect(plugin.documentAddEventListenerHook).toHaveBeenCalledExactlyOnceWith(
    childWindow,
    'keydown',
    handler,
    undefined,
  );
  childDocument.removeEventListener('keydown', handler);
  document.dispatchEvent(new Event('keydown'));
  expect(handler.handleEvent).toHaveBeenCalledOnce();
});

test('keeps other types and capture registrations when one registration is removed', () => {
  const { childWindow, childDocument } = createDocumentFixture();
  patchDocumentEffect(childWindow);
  const handler = vi.fn();
  childDocument.addEventListener('keydown', handler);
  childDocument.addEventListener('keyup', handler);
  childDocument.addEventListener('keydown', handler, { capture: true });
  childDocument.removeEventListener('keydown', handler, false);
  document.dispatchEvent(new Event('keydown'));
  document.dispatchEvent(new Event('keyup'));
  expect(handler).toHaveBeenCalledTimes(2);

  childDocument.removeEventListener('keydown', handler, true);
  childDocument.removeEventListener('keyup', handler, { capture: false });
  handler.mockClear();
  document.dispatchEvent(new Event('keydown'));
  document.dispatchEvent(new Event('keyup'));
  expect(handler).not.toHaveBeenCalled();
});

test('ignores null and unknown handlers without invoking plugin hooks', () => {
  const { childWindow, childDocument, plugin } = createDocumentFixture();
  patchDocumentEffect(childWindow);
  // 运行时需要容忍 null，尽管当前 Document 类型声明要求非空 listener。
  Reflect.apply(childDocument.addEventListener, childDocument, ['keydown', null]);
  Reflect.apply(childDocument.removeEventListener, childDocument, ['keydown', null]);
  childDocument.removeEventListener('keydown', vi.fn());
  expect(plugin.documentAddEventListenerHook).not.toHaveBeenCalled();
  expect(plugin.documentRemoveEventListenerHook).not.toHaveBeenCalled();
});

test('cleanup of one child preserves another child and host listeners', () => {
  const first = createDocumentFixture();
  const second = createDocumentFixture();
  patchDocumentEffect(first.childWindow);
  patchDocumentEffect(second.childWindow);
  const firstHandler = vi.fn();
  const secondHandler = vi.fn();
  const hostHandler = vi.fn();
  document.addEventListener('keydown', hostHandler);
  try {
    first.childDocument.addEventListener('keydown', firstHandler);
    second.childDocument.addEventListener('keydown', secondHandler);
    first.sandbox.eventCleanupTracker.cleanupAll();
    document.dispatchEvent(new Event('keydown'));
    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledOnce();
    expect(hostHandler).toHaveBeenCalledOnce();
  } finally {
    document.removeEventListener('keydown', hostHandler);
  }
});
