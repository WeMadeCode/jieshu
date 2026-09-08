import Jieshu from '../../src/sandbox';
import { clearAssetsCache } from '../../src/entry';
import { patchRenderEffect } from '../../src/effect';
import { idToSandboxCacheMap, sandboxTeardownById } from '../../src/common';

type ResourceElement = HTMLScriptElement | HTMLLinkElement;
type ResourceEvent = 'load' | 'error';

const flush = async () => {
  for (let index = 0; index < 30; index += 1) {
    await Promise.resolve();
  }
};

describe('resource event forwarding', () => {
  const sandboxes: Jieshu[] = [];

  const setup = (outcome: ResourceEvent) => {
    const sandbox = new Jieshu({
      name: 'resource-events',
      url: 'http://localhost/child/',
      attrs: {},
      fiber: false,
      plugins: [],
      lifecycles: { loadError: () => {} },
    });
    sandboxes.push(sandbox);
    sandbox.activeFlag = true;
    sandbox.alive = false;
    sandbox.fetch = async (input) => {
      const stylesheet = String(input).endsWith('.css');
      return new Response(stylesheet ? 'body { color: red; }' : 'export const value = 1;', {
        status: stylesheet && outcome === 'error' ? 404 : 200,
      });
    };
    const iframeWindow = sandbox.iframe.contentWindow;
    if (!iframeWindow) {
      throw new Error('Expected a resource execution window');
    }
    iframeWindow.__JIESHU = sandbox;
    const host = document.createElement('main');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const head = document.createElement('head');
    const body = document.createElement('body');
    root.append(head, body);
    root.head = head;
    root.body = body;
    sandbox.el = host;
    sandbox.head = head;
    sandbox.body = body;
    sandbox.shadowRoot = root;
    patchRenderEffect(root, sandbox.id);
    return { sandbox, iframeWindow, root };
  };

  beforeEach(() => {
    clearAssetsCache();
    idToSandboxCacheMap.clear();
    sandboxTeardownById.clear();
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    for (const sandbox of sandboxes) {
      await sandbox.destroy();
    }
    sandboxes.length = 0;
    vi.restoreAllMocks();
  });

  for (const tag of ['script', 'link']) {
    for (const outcome of ['load', 'error'] satisfies ResourceEvent[]) {
      test.each(['host', 'iframe'])(
        `${tag} ${outcome} dispatches property and listener callbacks in %s`,
        async (realm) => {
          const { sandbox, iframeWindow, root } = setup(outcome);
          const resourceDocument = realm === 'host' ? document : iframeWindow.document;
          const resource: ResourceElement =
            tag === 'script' ? resourceDocument.createElement('script') : resourceDocument.createElement('link');
          if (resource.tagName === 'SCRIPT') {
            resource.setAttribute('type', 'module');
            resource.setAttribute('src', 'http://localhost/resource.js');
          } else {
            resource.setAttribute('rel', 'stylesheet');
            resource.setAttribute('href', 'http://localhost/resource.css');
          }
          const calls: string[] = [];
          const snapshots: Array<{ target: boolean; current: boolean; receiver: boolean; realm: boolean }> = [];
          const events: Event[] = [];
          const record = (label: string, event: Event, receiver: unknown) => {
            calls.push(label);
            events.push(event);
            const EventConstructor = resourceDocument.defaultView?.Event ?? Event;
            snapshots.push({
              target: event.target === resource && event.srcElement === resource,
              current: event.currentTarget === resource,
              receiver: receiver === resource,
              realm: event instanceof EventConstructor,
            });
          };
          // Dynamic this is part of the native EventTarget callback contract.
          resource.addEventListener(outcome, function (this: ResourceElement, event) {
            record('before', event, this);
          });
          Reflect.set(resource, `on${outcome}`, function (this: ResourceElement, event: Event) {
            record('property', event, this);
          });
          resource.addEventListener(outcome, function (this: ResourceElement, event) {
            record('after', event, this);
          });
          const once = vi.fn();
          const removed = vi.fn();
          resource.addEventListener(outcome, once, { once: true });
          resource.addEventListener(outcome, removed);
          resource.removeEventListener(outcome, removed);

          root.head.appendChild(resource);
          await flush();
          if (tag === 'script') {
            const injected = sandbox.dynamicScriptElements[0];
            if (!injected) {
              throw new Error('Expected the injected external module');
            }
            injected.dispatchEvent(new Event(outcome));
            injected.dispatchEvent(new Event(outcome));
            await flush();
          }

          expect(calls).toEqual(['before', 'property', 'after']);
          expect(snapshots).toEqual(
            Array.from({ length: 3 }, () => ({ target: true, current: true, receiver: true, realm: true })),
          );
          expect(new Set(events).size).toBe(1);
          expect(events[0]?.currentTarget).toBeNull();
          expect(once).toHaveBeenCalledTimes(1);
          expect(removed).not.toHaveBeenCalled();
          expect(sandbox.execQueue).toHaveLength(0);

          resource.dispatchEvent(new Event(outcome));
          expect(once).toHaveBeenCalledTimes(1);
          expect(removed).not.toHaveBeenCalled();
        },
      );
    }
  }

  test.each(['load', 'error'] satisfies ResourceEvent[])(
    'a throwing script %s property does not skip listeners or reentrant work',
    async (outcome) => {
      const { sandbox, iframeWindow, root } = setup(outcome);
      const reported: unknown[] = [];
      iframeWindow.addEventListener('error', (event) => {
        event.preventDefault();
        reported.push(event.error);
      });
      const failure = new Error('expected resource callback failure');
      const first = iframeWindow.document.createElement('script');
      first.src = 'http://localhost/first.js';
      first.type = 'module';
      Reflect.set(first, `on${outcome}`, () => {
        throw failure;
      });
      const calls: string[] = [];
      first.addEventListener(outcome, () => {
        calls.push('listener');
        const second = iframeWindow.document.createElement('script');
        second.src = 'http://localhost/second.js';
        second.type = 'module';
        second.onload = () => calls.push('second');
        root.head.appendChild(second);
      });
      root.head.appendChild(first);
      await flush();
      const injectedFirst = sandbox.dynamicScriptElements[0];
      if (!injectedFirst) {
        throw new Error('Expected the first injected module');
      }
      injectedFirst.dispatchEvent(new Event(outcome));
      await flush();
      expect(calls).toEqual(['listener']);
      const injectedSecond = sandbox.dynamicScriptElements[1];
      if (!injectedSecond) {
        throw new Error('Expected reentrant module insertion');
      }
      injectedSecond.dispatchEvent(new Event('load'));
      await flush();
      expect(calls).toEqual(['listener', 'second']);
      expect(reported).toEqual([failure]);
      expect(sandbox.execQueue).toHaveLength(0);
    },
  );
});
