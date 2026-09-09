import { patchInstanceofAcrossRealms } from '../../src/iframe';

const releases: Array<() => void> = [];

const createRealm = () => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const realm = iframe.contentWindow;
  if (!realm) {
    throw new Error('Expected an iframe Window');
  }
  return realm;
};

const patch = (targetWindow: Window, peerWindow: Window = window) => {
  const release = patchInstanceofAcrossRealms(targetWindow, peerWindow);
  releases.push(release);
  return release;
};

afterEach(() => {
  while (releases.length) {
    releases.pop()?.();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('instanceof patch state ownership', () => {
  test('a subclass keeps native instance semantics when its parent accepts a peer realm', () => {
    const targetWindow = createRealm();
    const peerWindow = createRealm();
    class ChildEvent extends targetWindow.Event {}
    const childEvent = new ChildEvent('child');
    const targetEvent = new targetWindow.Event('target');
    const peerEvent = new peerWindow.Event('peer');

    const release = patch(targetWindow, peerWindow);

    expect(peerEvent instanceof targetWindow.Event).toBe(true);
    expect(peerEvent instanceof ChildEvent).toBe(false);
    expect(targetEvent instanceof ChildEvent).toBe(false);
    expect(childEvent instanceof ChildEvent).toBe(true);
    expect(childEvent instanceof targetWindow.Event).toBe(true);

    release();

    expect(peerEvent instanceof targetWindow.Event).toBe(false);
    expect(childEvent instanceof ChildEvent).toBe(true);
  });

  test('repeated registrations survive one release and can be registered after every owner releases', () => {
    const targetWindow = createRealm();
    const peerWindow = createRealm();
    const peerEvent = new peerWindow.Event('peer');
    const targetEvent = new targetWindow.Event('target');
    const releaseFirst = patch(targetWindow, peerWindow);
    const firstHandler = targetWindow.Event[Symbol.hasInstance];
    const releaseSecond = patch(targetWindow, peerWindow);

    expect(targetWindow.Event[Symbol.hasInstance]).toBe(firstHandler);
    expect(peerEvent instanceof targetWindow.Event).toBe(true);

    releaseFirst();
    releaseFirst();

    expect(peerEvent instanceof targetWindow.Event).toBe(true);

    releaseSecond();
    releaseSecond();

    expect(peerEvent instanceof targetWindow.Event).toBe(false);
    expect(targetEvent instanceof targetWindow.Event).toBe(true);

    const releaseThird = patch(targetWindow, peerWindow);

    expect(peerEvent instanceof targetWindow.Event).toBe(true);

    // A previously released owner must not consume a later registration.
    releaseFirst();
    releaseSecond();

    expect(peerEvent instanceof targetWindow.Event).toBe(true);

    releaseThird();

    expect(peerEvent instanceof targetWindow.Event).toBe(false);
    expect(targetEvent instanceof targetWindow.Event).toBe(true);
  });

  test('one non-host constructor aliased in two windows retains both peer registrations', () => {
    const constructorWindow = createRealm();
    const firstTargetWindow = createRealm();
    const secondTargetWindow = createRealm();
    const firstPeerWindow = createRealm();
    const secondPeerWindow = createRealm();
    const sharedEventConstructor = constructorWindow.Event;
    const firstPeerEvent = new firstPeerWindow.Event('first');
    const secondPeerEvent = new secondPeerWindow.Event('second');
    const nativeEvent = new sharedEventConstructor('native');
    Object.defineProperty(firstTargetWindow, 'Event', { configurable: true, value: sharedEventConstructor });
    Object.defineProperty(secondTargetWindow, 'Event', { configurable: true, value: sharedEventConstructor });

    expect(sharedEventConstructor).not.toBe(window.Event);

    const releaseFirst = patch(firstTargetWindow, firstPeerWindow);
    const firstHandler = sharedEventConstructor[Symbol.hasInstance];
    const releaseSecond = patch(secondTargetWindow, secondPeerWindow);

    expect(firstTargetWindow.Event).toBe(sharedEventConstructor);
    expect(secondTargetWindow.Event).toBe(sharedEventConstructor);
    expect(sharedEventConstructor[Symbol.hasInstance]).toBe(firstHandler);
    expect(firstPeerEvent instanceof firstTargetWindow.Event).toBe(true);
    expect(secondPeerEvent instanceof firstTargetWindow.Event).toBe(true);
    expect(firstPeerEvent instanceof secondTargetWindow.Event).toBe(true);
    expect(secondPeerEvent instanceof secondTargetWindow.Event).toBe(true);

    releaseFirst();
    releaseFirst();

    expect(firstPeerEvent instanceof sharedEventConstructor).toBe(false);
    expect(secondPeerEvent instanceof sharedEventConstructor).toBe(true);

    releaseSecond();

    expect(firstPeerEvent instanceof sharedEventConstructor).toBe(false);
    expect(secondPeerEvent instanceof sharedEventConstructor).toBe(false);
    expect(nativeEvent instanceof sharedEventConstructor).toBe(true);
  });

  test('user replacement of Symbol.hasInstance survives later patches and releases', () => {
    const targetWindow = createRealm();
    const firstPeerWindow = createRealm();
    const secondPeerWindow = createRealm();
    const acceptedEvent = new firstPeerWindow.Event('accepted');
    const rejectedEvent = new secondPeerWindow.Event('rejected');
    const releaseFirst = patch(targetWindow, firstPeerWindow);
    const userHandler = (candidate: unknown) => candidate === acceptedEvent;
    Object.defineProperty(targetWindow.Event, Symbol.hasInstance, { configurable: true, value: userHandler });

    const releaseSecond = patch(targetWindow, secondPeerWindow);

    expect(targetWindow.Event[Symbol.hasInstance]).toBe(userHandler);
    expect(acceptedEvent instanceof targetWindow.Event).toBe(true);
    expect(rejectedEvent instanceof targetWindow.Event).toBe(false);

    releaseFirst();
    releaseSecond();

    expect(targetWindow.Event[Symbol.hasInstance]).toBe(userHandler);
    expect(acceptedEvent instanceof targetWindow.Event).toBe(true);
    expect(rejectedEvent instanceof targetWindow.Event).toBe(false);

    const releaseThird = patch(targetWindow, secondPeerWindow);

    expect(targetWindow.Event[Symbol.hasInstance]).toBe(userHandler);

    releaseThird();

    expect(targetWindow.Event[Symbol.hasInstance]).toBe(userHandler);
    expect(rejectedEvent instanceof targetWindow.Event).toBe(false);
  });

  test('a facade over an already patched host constructor keeps both owners independent', () => {
    const originalWindow = createRealm();
    const originalPeerWindow = createRealm();
    const targetWindow = createRealm();
    const facadePeerWindow = createRealm();
    const hostConstructor = originalWindow.Event;
    const nativeEvent = new hostConstructor('native');
    const originalPeerEvent = new originalPeerWindow.Event('original-peer');
    const facadePeerEvent = new facadePeerWindow.Event('facade-peer');
    const releaseOriginal = patch(originalWindow, originalPeerWindow);
    const hostHandler = Reflect.getOwnPropertyDescriptor(hostConstructor, Symbol.hasInstance);
    const alias = 'InstanceofStateHostEvent';
    const previousHostAlias = Reflect.getOwnPropertyDescriptor(window, alias);
    Object.defineProperty(window, alias, { configurable: true, value: hostConstructor });
    Object.defineProperty(targetWindow, alias, { configurable: true, value: hostConstructor });
    Object.defineProperty(facadePeerWindow, alias, { configurable: true, value: facadePeerWindow.Event });

    try {
      const releaseFacade = patch(targetWindow, facadePeerWindow);
      const facade: unknown = Reflect.get(targetWindow, alias);
      if (typeof facade !== 'function') {
        throw new Error('Expected a constructor facade');
      }

      expect(facade).not.toBe(hostConstructor);
      expect(Reflect.get(window, alias)).toBe(hostConstructor);
      expect(Reflect.getOwnPropertyDescriptor(hostConstructor, Symbol.hasInstance)).toEqual(hostHandler);
      expect(originalPeerEvent instanceof hostConstructor).toBe(true);
      expect(facadePeerEvent instanceof hostConstructor).toBe(false);
      expect(originalPeerEvent instanceof facade).toBe(false);
      expect(facadePeerEvent instanceof facade).toBe(true);
      expect(nativeEvent instanceof facade).toBe(true);

      releaseOriginal();

      expect(originalPeerEvent instanceof hostConstructor).toBe(false);
      expect(facadePeerEvent instanceof facade).toBe(true);
      expect(Reflect.getOwnPropertyDescriptor(hostConstructor, Symbol.hasInstance)).toEqual(hostHandler);

      releaseFacade();

      expect(facadePeerEvent instanceof facade).toBe(false);
      expect(nativeEvent instanceof facade).toBe(true);
      expect(nativeEvent instanceof hostConstructor).toBe(true);
      expect(Reflect.getOwnPropertyDescriptor(hostConstructor, Symbol.hasInstance)).toEqual(hostHandler);
    } finally {
      if (previousHostAlias) {
        Object.defineProperty(window, alias, previousHostAlias);
      } else {
        Reflect.deleteProperty(window, alias);
      }
    }
  });

  test('a non-extensible constructor with a configurable own Symbol.hasInstance can still accept peers', () => {
    const targetWindow = createRealm();
    const peerWindow = createRealm();
    const targetConstructor = targetWindow.Event;
    const targetEvent = new targetConstructor('target');
    const peerEvent = new peerWindow.Event('peer');
    Object.defineProperty(targetConstructor, Symbol.hasInstance, {
      configurable: true,
      value: Function.prototype[Symbol.hasInstance],
    });
    Object.preventExtensions(targetConstructor);

    expect(peerEvent instanceof targetConstructor).toBe(false);

    const release = patch(targetWindow, peerWindow);

    expect(peerEvent instanceof targetConstructor).toBe(true);
    expect(targetEvent instanceof targetConstructor).toBe(true);

    release();

    expect(peerEvent instanceof targetConstructor).toBe(false);
    expect(targetEvent instanceof targetConstructor).toBe(true);

    const releaseAgain = patch(targetWindow, peerWindow);

    expect(peerEvent instanceof targetConstructor).toBe(true);

    releaseAgain();

    expect(peerEvent instanceof targetConstructor).toBe(false);
  });

  test('a non-extensible constructor without an own Symbol.hasInstance is skipped safely', () => {
    const targetWindow = createRealm();
    const peerWindow = createRealm();
    const targetConstructor = targetWindow.Event;
    const targetEvent = new targetConstructor('target');
    const peerEvent = new peerWindow.Event('peer');
    expect(Reflect.getOwnPropertyDescriptor(targetConstructor, Symbol.hasInstance)).toBeUndefined();
    Object.preventExtensions(targetConstructor);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const release = patch(targetWindow, peerWindow);

    expect(peerEvent instanceof targetConstructor).toBe(false);
    expect(targetEvent instanceof targetConstructor).toBe(true);
    expect(Reflect.getOwnPropertyDescriptor(targetConstructor, Symbol.hasInstance)).toBeUndefined();
    expect(() => release()).not.toThrow();
    expect(() => release()).not.toThrow();
    expect(targetEvent instanceof targetConstructor).toBe(true);
  });

  test('a constructor Proxy that rejects extra symbol definitions preserves peer reference counts', () => {
    const targetWindow = createRealm();
    const peerWindow = createRealm();
    const targetEvent = new targetWindow.Event('target');
    const peerEvent = new peerWindow.Event('peer');
    const targetConstructor = new Proxy(targetWindow.Event, {
      defineProperty: (target, property, descriptor) => {
        if (typeof property === 'symbol' && property !== Symbol.hasInstance) {
          return false;
        }
        return Reflect.defineProperty(target, property, descriptor);
      },
    });
    Object.defineProperty(targetWindow, 'Event', { configurable: true, value: targetConstructor });

    const releaseFirst = patch(targetWindow, peerWindow);
    const firstHandler = targetConstructor[Symbol.hasInstance];
    const releaseSecond = patch(targetWindow, peerWindow);

    expect(targetConstructor[Symbol.hasInstance]).toBe(firstHandler);
    expect(peerEvent instanceof targetConstructor).toBe(true);
    expect(targetEvent instanceof targetConstructor).toBe(true);

    releaseFirst();
    releaseFirst();

    expect(peerEvent instanceof targetConstructor).toBe(true);

    releaseSecond();
    releaseSecond();

    expect(peerEvent instanceof targetConstructor).toBe(false);
    expect(targetEvent instanceof targetConstructor).toBe(true);
  });

  test('a constructor Proxy that rejects extra symbol reads preserves repeated registration and release', () => {
    const targetWindow = createRealm();
    const peerWindow = createRealm();
    const targetEvent = new targetWindow.Event('target');
    const peerEvent = new peerWindow.Event('peer');
    const targetConstructor = new Proxy(targetWindow.Event, {
      get: (target, property, receiver) => {
        if (typeof property === 'symbol' && property !== Symbol.hasInstance) {
          throw new Error('Symbol metadata is not readable');
        }
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor: (target, property) => {
        if (typeof property === 'symbol' && property !== Symbol.hasInstance) {
          throw new Error('Symbol metadata is not inspectable');
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    Object.defineProperty(targetWindow, 'Event', { configurable: true, value: targetConstructor });

    const releaseFirst = patch(targetWindow, peerWindow);
    const firstHandler = targetConstructor[Symbol.hasInstance];
    const releaseSecond = patch(targetWindow, peerWindow);

    expect(targetConstructor[Symbol.hasInstance]).toBe(firstHandler);
    expect(peerEvent instanceof targetConstructor).toBe(true);
    expect(targetEvent instanceof targetConstructor).toBe(true);

    releaseFirst();
    releaseFirst();

    expect(peerEvent instanceof targetConstructor).toBe(true);

    releaseSecond();
    releaseSecond();

    expect(peerEvent instanceof targetConstructor).toBe(false);
    expect(targetEvent instanceof targetConstructor).toBe(true);

    const releaseThird = patch(targetWindow, peerWindow);

    expect(targetConstructor[Symbol.hasInstance]).toBe(firstHandler);
    expect(peerEvent instanceof targetConstructor).toBe(true);

    releaseThird();

    expect(peerEvent instanceof targetConstructor).toBe(false);
  });
});
