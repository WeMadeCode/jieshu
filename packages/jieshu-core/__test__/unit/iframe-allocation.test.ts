import { patchElementEffect, patchInstanceofAcrossRealms } from '../../src/iframe';

const createRealm = (id: string) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const childWindow = iframe.contentWindow;
  if (!childWindow) {
    throw new Error('Expected a child Window');
  }
  const plugin = { patchElementHook: vi.fn() };
  const sandbox = {
    id,
    plugins: [plugin],
    proxyLocation: { protocol: 'https:', host: `${id}.example`, pathname: '/before/' },
  };
  Reflect.set(childWindow, '__JIESHU', sandbox);
  return { iframe, childWindow, sandbox, plugin };
};

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'UnrelatedLazyInterface');
  Reflect.deleteProperty(window, 'RevokedPeerInterface');
  Reflect.deleteProperty(window, 'CustomPeerTarget');
  document.body.replaceChildren();
});

describe('iframe initialization and node allocation', () => {
  test('does not initialize unrelated child globals while registering DOM peers', () => {
    const { childWindow } = createRealm('lazy');
    const readChildGlobal = vi.fn(() => class UnrelatedLazyInterface {});
    Object.defineProperty(window, 'UnrelatedLazyInterface', {
      configurable: true,
      value: class UnrelatedLazyInterface {},
    });
    Object.defineProperty(childWindow, 'UnrelatedLazyInterface', { configurable: true, get: readChildGlobal });

    const release = patchInstanceofAcrossRealms(childWindow);

    expect(readChildGlobal).not.toHaveBeenCalled();
    const hostElement = document.createElement('div');
    expect(hostElement instanceof childWindow.HTMLElement).toBe(true);
    release();
    expect(hostElement instanceof childWindow.HTMLElement).toBe(false);
  });

  test('skips a peer whose prototype inspection throws and still registers later DOM peers', () => {
    const { childWindow } = createRealm('revoked-peer');
    const { proxy, revoke } = Proxy.revocable(class RevokedPeerInterface {}, {});
    revoke();
    Object.defineProperty(window, 'RevokedPeerInterface', { configurable: true, value: proxy });
    const readChildGlobal = vi.fn(() => 1);
    Object.defineProperty(childWindow, 'RevokedPeerInterface', { configurable: true, get: readChildGlobal });
    class HostTarget extends EventTarget {}
    class ChildTarget extends childWindow.EventTarget {}
    Object.defineProperty(window, 'CustomPeerTarget', { configurable: true, value: HostTarget });
    Object.defineProperty(childWindow, 'CustomPeerTarget', { configurable: true, value: ChildTarget });

    const release = patchInstanceofAcrossRealms(childWindow);

    expect(readChildGlobal).not.toHaveBeenCalled();
    const hostTarget = new HostTarget();
    expect(hostTarget instanceof ChildTarget).toBe(true);
    expect(document.createElement('div') instanceof childWindow.HTMLElement).toBe(true);
    release();
    expect(hostTarget instanceof ChildTarget).toBe(false);
  });

  test('discovers custom EventTarget constructors added after an earlier patch', () => {
    const { childWindow } = createRealm('custom');
    const releaseFirst = patchInstanceofAcrossRealms(childWindow);
    class HostTarget extends EventTarget {}
    class ChildTarget extends childWindow.EventTarget {}
    Object.defineProperty(window, 'CustomPeerTarget', { configurable: true, value: HostTarget });
    Object.defineProperty(childWindow, 'CustomPeerTarget', { configurable: true, value: ChildTarget });

    const releaseSecond = patchInstanceofAcrossRealms(childWindow);
    const hostTarget = new HostTarget();
    expect(hostTarget instanceof ChildTarget).toBe(true);
    expect(new ChildTarget() instanceof ChildTarget).toBe(true);
    releaseSecond();
    expect(hostTarget instanceof ChildTarget).toBe(false);
    // Releasing the second registration must not remove the first DOM peer.
    expect(document.createElement('div') instanceof childWindow.HTMLElement).toBe(true);
    releaseFirst();
  });

  for (const weakRefAvailable of [true, false]) {
    test(`nodes retain live realm ownership and fall back after destroy (WeakRef=${weakRefAvailable})`, () => {
      if (!weakRefAvailable) {
        vi.stubGlobal('WeakRef', undefined);
      }
      const first = createRealm('first');
      const second = createRealm('second');
      const nodes = Array.from({ length: 3 }, () => document.createElement('div'));
      for (const node of nodes) {
        patchElementEffect(node, first.childWindow);
        document.body.appendChild(node);
      }
      const peerNode = document.createElement('div');
      patchElementEffect(peerNode, second.childWindow);
      expect(first.plugin.patchElementHook).toHaveBeenCalledTimes(3);
      patchElementEffect(nodes[0], first.childWindow);
      expect(first.plugin.patchElementHook).toHaveBeenCalledTimes(3);

      first.sandbox.proxyLocation.pathname = '/after/';
      for (const node of nodes) {
        expect(node.baseURI).toBe('https://first.example/after/');
        expect(node.ownerDocument).toBe(first.childWindow.document);
      }
      expect(peerNode.baseURI).toBe('https://second.example/before/');
      expect(peerNode.ownerDocument).toBe(second.childWindow.document);

      Reflect.set(first.childWindow, '__JIESHU', null);
      first.iframe.remove();
      for (const node of nodes) {
        expect(node.baseURI).toBe(document.baseURI);
        expect(node.ownerDocument).toBe(document);
      }
      expect(peerNode.ownerDocument).toBe(second.childWindow.document);
    });
  }
});
