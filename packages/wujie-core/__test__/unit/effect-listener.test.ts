import {
  isDynamicEffectContextLive,
  patchRenderEffect,
  removeEventListener as clearElementEventListeners,
} from '../../src/effect';
import { addSandboxCacheWithWujie, idToSandboxCacheMap } from '../../src/common';
import type Wujie from '../../src/sandbox';

function createRenderRoot(): ShadowRoot {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const head = document.createElement('head');
  const body = document.createElement('body');
  root.append(head, body);
  root.head = head;
  root.body = body;
  return root;
}

describe('render element listener cleanup', () => {
  beforeEach(() => idToSandboxCacheMap.clear());

  it('removes capture listeners with their original options and clears retained references', () => {
    const root = createRenderRoot();
    const listener = jest.fn();
    patchRenderEffect(root, 'listener-test', false);

    root.head.addEventListener('click', listener, { capture: true });
    root.head.dispatchEvent(new Event('click'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(root.head._cacheListeners.get('click')).toHaveLength(1);

    clearElementEventListeners(root.head);
    root.head.dispatchEvent(new Event('click'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(root.head._cacheListeners.size).toBe(0);
  });

  it('tracks native listener identity by listener and capture flag', () => {
    const root = createRenderRoot();
    const listener = jest.fn();
    patchRenderEffect(root, 'listener-identity', false);

    root.body.addEventListener('focus', listener, false);
    root.body.addEventListener('focus', listener, { capture: false, once: true });
    root.body.addEventListener('focus', listener, true);

    expect(root.body._cacheListeners.get('focus')).toHaveLength(2);
    clearElementEventListeners(root.body);
    expect(root.body._cacheListeners.size).toBe(0);
  });

  it('falls back to native insertion after the owning sandbox is gone', () => {
    const root = createRenderRoot();
    const element = document.createElement('meta');
    const script = document.createElement('script');
    patchRenderEffect(root, 'released-sandbox', false);

    expect(root.head.appendChild(element)).toBe(element);
    expect(element.parentNode).toBe(root.head);
    expect(root.head.appendChild(script)).toBe(script);
    expect(root.head.contains(script)).toBe(true);
    expect(root.head.removeChild(script)).toBe(script);
  });

  it('blocks late dynamic effects for inactive rebuild apps but keeps alive apps running', () => {
    const sandbox = {
      id: 'dynamic-effect-state',
      iframe: document.createElement('iframe'),
      destroyed: false,
      alive: false,
      activeFlag: false,
    } as unknown as Wujie;
    addSandboxCacheWithWujie(sandbox.id, sandbox);

    expect(isDynamicEffectContextLive(sandbox, sandbox.id)).toBe(false);
    sandbox.activeFlag = true;
    expect(isDynamicEffectContextLive(sandbox, sandbox.id)).toBe(true);
    sandbox.activeFlag = false;
    sandbox.alive = true;
    expect(isDynamicEffectContextLive(sandbox, sandbox.id)).toBe(true);
    sandbox.destroyed = true;
    expect(isDynamicEffectContextLive(sandbox, sandbox.id)).toBe(false);
  });
});
