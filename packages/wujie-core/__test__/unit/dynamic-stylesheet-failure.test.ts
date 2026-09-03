import { addSandboxCacheWithWujie, idToSandboxCacheMap } from '../../src/common';
import { clearAssetsCache, styleCache } from '../../src/entry';
import { patchRenderEffect } from '../../src/effect';
import type { LoadErrorHandler } from '../../src/contracts';
import type Wujie from '../../src/sandbox';

function response(body: string, status = 200): Response {
  return { status, text: () => Promise.resolve(body) } as unknown as Response;
}

function createRenderRoot(): ShadowRoot {
  const root = document.createElement('div').attachShadow({ mode: 'open' });
  const head = document.createElement('head');
  const body = document.createElement('body');
  root.append(head, body);
  root.head = head;
  root.body = body;
  return root;
}

function createSandbox(
  id: string,
  fetch: (input: RequestInfo) => Promise<Response>,
  loadError: LoadErrorHandler,
): Wujie {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const sandbox = {
    id,
    iframe,
    destroyed: false,
    alive: false,
    activeFlag: true,
    plugins: [],
    fetch,
    lifecycles: { loadError },
    fiber: false,
    assetCacheScope: {},
    execQueue: [],
    proxyLocation: {
      href: 'https://child.example/index.html',
      protocol: 'https:',
      host: 'child.example',
      pathname: '/index.html',
    },
    replace: (code: string) => code,
    // Skip the unrelated asynchronous CSS-rule compatibility patch.
    degrade: true,
    styleSheetElements: [],
    deferredStyleObservers: [],
  } as unknown as Wujie;

  Reflect.set(iframe.contentWindow as Window, '__WUJIE', sandbox);
  addSandboxCacheWithWujie(id, sandbox);
  return sandbox;
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe('dynamic stylesheet failures', () => {
  beforeEach(() => {
    clearAssetsCache();
    idToSandboxCacheMap.clear();
    document.body.innerHTML = '';
  });

  test('dispatches error instead of load and leaves a failed request retryable', async () => {
    const id = 'dynamic-style-failure';
    const source = 'https://assets.example/theme.css';
    let attempt = 0;
    const fetch = vi.fn((_input: RequestInfo): Promise<Response> => {
      attempt += 1;
      return Promise.resolve(attempt === 1 ? response('unavailable', 503) : response('body { color: green; }'));
    });
    const loadError = vi.fn((_url: string, _failure: Error): void => undefined);
    const sandbox = createSandbox(id, fetch, loadError);
    const root = createRenderRoot();
    patchRenderEffect(root, id, false);

    const failedLink = document.createElement('link');
    const failedLoad = vi.fn();
    const failedError = vi.fn();
    failedLink.rel = 'stylesheet';
    failedLink.href = source;
    failedLink.onload = failedLoad;
    failedLink.onerror = failedError;
    root.head.appendChild(failedLink);
    await flushPromises();

    expect(failedLoad).not.toHaveBeenCalled();
    expect(failedError).toHaveBeenCalledTimes(1);
    expect(loadError).toHaveBeenCalledWith(source, expect.any(Error));
    expect(styleCache[source]).toBeUndefined();
    expect(root.head.querySelector('style[data-wujie-css-href]')).toBeNull();

    const retryLink = document.createElement('link');
    const retryLoad = vi.fn();
    const retryError = vi.fn();
    retryLink.rel = 'stylesheet';
    retryLink.href = source;
    retryLink.onload = retryLoad;
    retryLink.onerror = retryError;
    root.head.appendChild(retryLink);
    await flushPromises();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(retryLoad).toHaveBeenCalledTimes(1);
    expect(retryError).not.toHaveBeenCalled();
    expect(sandbox.styleSheetElements).toHaveLength(1);
    expect(root.head.querySelector('style[data-wujie-css-href]')?.textContent).toContain('color: green');
  });

  test('dispatches error and removes the placeholder when cssLoader throws', async () => {
    const id = 'dynamic-style-loader-failure';
    const source = 'https://assets.example/loader-failure.css';
    const fetch = vi.fn((_input: RequestInfo): Promise<Response> =>
      Promise.resolve(response('body { color: green; }')),
    );
    const sandbox = createSandbox(id, fetch, () => undefined);
    sandbox.plugins = [
      {
        cssLoader: (): never => {
          throw new Error('transform failed');
        },
      },
    ];
    const root = createRenderRoot();
    patchRenderEffect(root, id, false);

    const link = document.createElement('link');
    const load = vi.fn();
    const error = vi.fn();
    link.rel = 'stylesheet';
    link.href = source;
    link.onload = load;
    link.onerror = error;
    root.head.appendChild(link);
    await flushPromises();

    expect(load).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(root.head.querySelector('style[data-wujie-css-href]')).toBeNull();
    expect(sandbox.styleSheetElements).toHaveLength(0);
  });
});
