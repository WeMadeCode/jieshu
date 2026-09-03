import importHTML, {
  clearAssetsCache,
  embedHTMLCache,
  getExternalScripts,
  getExternalStyleSheets,
  processCssLoader,
  releaseAssetCacheScope,
  scriptCache,
  styleCache,
} from '../../src/entry';
import { genLinkReplaceSymbol } from '../../src/template';
import type Jieshu from '../../src/sandbox';
import type { JieshuPlugin } from '../../src/contracts';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function response(body: string, status = 200): Response {
  return { status, text: () => Promise.resolve(body) } as unknown as Response;
}

const stylesheetFailureCases: Array<[string, () => Promise<Response>]> = [
  ['network', () => Promise.reject(new Error('offline'))],
  ['HTTP', () => Promise.resolve(response('unavailable', 503))],
  [
    'response-body',
    () =>
      Promise.resolve({
        status: 200,
        text: () => Promise.reject(new Error('body read failed')),
      } as unknown as Response),
  ],
];

describe('entry asset pipeline', () => {
  beforeEach(() => {
    clearAssetsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('accepts omitted plugins and applies HTML loaders from left to right without caching them', async () => {
    const calls: string[] = [];
    const plugins: JieshuPlugin[] = [
      {
        htmlLoader(code) {
          calls.push('first');
          return code.replace('seed', 'first');
        },
      },
      {
        htmlLoader(code) {
          calls.push('second');
          return code.replace('first', 'second');
        },
      },
    ];

    const withoutPlugins = await importHTML({
      url: 'https://child.example/no-plugins/index.html',
      html: '<main>plain</main>',
      opts: {},
    });
    expect(withoutPlugins.template).toBe('<main>plain</main>');

    const parameters = {
      url: 'https://child.example/loaders/index.html',
      html: '<main>seed</main>',
      opts: { plugins },
    };
    expect((await importHTML(parameters)).template).toBe('<main>second</main>');
    expect((await importHTML(parameters)).template).toBe('<main>second</main>');
    expect(calls).toEqual(['first', 'second', 'first', 'second']);
  });

  test('coalesces concurrent script requests and evicts a failed request before retry', async () => {
    const pending = deferred<Response>();
    const sharedFetch = vi.fn((_input: RequestInfo): Promise<Response> => pending.promise);
    const source = 'https://assets.example/shared.js';

    const first = getExternalScripts([{ src: source }], sharedFetch, undefined, false)[0].contentPromise;
    const second = getExternalScripts([{ src: source }], sharedFetch, undefined, false)[0].contentPromise;
    expect(sharedFetch).toHaveBeenCalledTimes(1);
    pending.resolve(response('shared'));
    await expect(Promise.all([first, second])).resolves.toEqual(['shared', 'shared']);

    clearAssetsCache();
    let attempt = 0;
    const loadError = vi.fn((_url: string, _failure: Error): void => undefined);
    const retryFetch = vi.fn((_input: RequestInfo): Promise<Response> => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(response('recovered'));
    });

    await expect(getExternalScripts([{ src: source }], retryFetch, loadError, false)[0].contentPromise).resolves.toBe(
      '',
    );
    expect(scriptCache[source]).toBeUndefined();
    await expect(getExternalScripts([{ src: source }], retryFetch, loadError, false)[0].contentPromise).resolves.toBe(
      'recovered',
    );
    expect(retryFetch).toHaveBeenCalledTimes(2);
    expect(loadError).toHaveBeenCalledTimes(1);
  });

  test('reports an HTTP script failure once and leaves it retryable', async () => {
    const source = 'https://assets.example/server-error.js';
    const loadError = vi.fn((_url: string, _failure: Error): void => undefined);
    const fetch = vi.fn((_input: RequestInfo): Promise<Response> => Promise.resolve(response('failure', 503)));

    await expect(getExternalScripts([{ src: source }], fetch, loadError, false)[0].contentPromise).resolves.toBe('');

    expect(loadError).toHaveBeenCalledTimes(1);
    expect(loadError).toHaveBeenCalledWith(source, expect.any(Error));
    expect(scriptCache[source]).toBeUndefined();
  });

  test.each(stylesheetFailureCases)(
    'keeps a %s stylesheet failure rejected and retryable',
    async (failureKind, fail) => {
      const source = `https://assets.example/${failureKind}.css`;
      const loadError = vi.fn((_url: string, _failure: Error): void => undefined);
      const failedFetch = vi.fn((_input: RequestInfo): Promise<Response> => fail());

      await expect(
        getExternalStyleSheets([{ src: source }], failedFetch, loadError)[0].contentPromise,
      ).rejects.toThrow();

      expect(styleCache[source]).toBeUndefined();
      expect(loadError).toHaveBeenCalledWith(source, expect.any(Error));
      const retryFetch = vi.fn((_input: RequestInfo): Promise<Response> =>
        Promise.resolve(response('body { color: green; }')),
      );
      await expect(getExternalStyleSheets([{ src: source }], retryFetch)[0].contentPromise).resolves.toBe(
        'body { color: green; }',
      );
      expect(retryFetch).toHaveBeenCalledTimes(1);
    },
  );

  test('restores a static stylesheet link when framework loading fails', async () => {
    const entryUrl = 'https://child.example/css-fallback/index.html';
    const source = 'https://child.example/css-fallback/theme.css';
    const originalLink =
      '<link media="print" crossorigin="anonymous" rel="stylesheet" href="./theme.css" integrity="sha256-demo">';
    const fetch = vi.fn((_input: RequestInfo): Promise<Response> => Promise.resolve(response('unavailable', 503)));
    const parsed = await importHTML({
      url: entryUrl,
      html: originalLink,
      opts: { fetch },
    });
    const sandbox = {
      proxyLocation: new URL(entryUrl),
      plugins: [],
    } as unknown as Jieshu;

    await expect(processCssLoader(sandbox, parsed.template, parsed.getExternalStyleSheets)).resolves.toBe(
      '<link media="print" crossorigin="anonymous" rel="stylesheet" href="https://child.example/css-fallback/theme.css" integrity="sha256-demo">',
    );
    expect(styleCache[source]).toBeUndefined();
  });

  test('forwards applicable link and inline-style attributes into successful embedded styles', async () => {
    const entryUrl = 'https://child.example/css-attributes/index.html';
    const fetch = vi.fn((_input: RequestInfo): Promise<Response> =>
      Promise.resolve(response('.external { color: green; }')),
    );
    const parsed = await importHTML({
      url: entryUrl,
      html: [
        '<link rel=stylesheet href=./theme.css media=print nonce="external-nonce" title="external-title">',
        '<style media=screen nonce="inline-nonce" title="inline-title">.inline { color: blue; }</style>',
      ].join(''),
      opts: { fetch },
    });
    const sandbox = {
      proxyLocation: new URL(entryUrl),
      plugins: [],
    } as unknown as Jieshu;

    const output = await processCssLoader(sandbox, parsed.template, parsed.getExternalStyleSheets);
    expect(output).toContain(
      '<style media="print" nonce="external-nonce" title="external-title">/* https://child.example/css-attributes/theme.css */.external { color: green; }</style>',
    );
    expect(output).toContain(
      '<style media="screen" nonce="inline-nonce" title="inline-title">/* inline-style-1 */.inline { color: blue; }</style>',
    );
  });

  test('keeps a disabled stylesheet as a native link with a resolved child URL', async () => {
    const entryUrl = 'https://child.example/disabled/index.html';
    const fetch = vi.fn((_input: RequestInfo): Promise<Response> =>
      Promise.resolve(response('.disabled { color: red; }')),
    );
    const parsed = await importHTML({
      url: entryUrl,
      html: '<link disabled media=print nonce="nonce-value" title="theme" rel=stylesheet href=./theme.css>',
      opts: { fetch },
    });
    const sandbox = {
      proxyLocation: new URL(entryUrl),
      plugins: [],
    } as unknown as Jieshu;

    const output = await processCssLoader(sandbox, parsed.template, parsed.getExternalStyleSheets);
    const holder = document.createElement('div');
    holder.innerHTML = output;
    const link = holder.querySelector('link');

    expect(fetch).not.toHaveBeenCalled();
    expect(link?.getAttribute('href')).toBe('https://child.example/disabled/theme.css');
    expect(link?.getAttribute('media')).toBe('print');
    expect(link?.getAttribute('title')).toBe('theme');
    expect(link?.hasAttribute('disabled')).toBe(true);
    expect(link?.matches('link[rel~="stylesheet"][disabled]')).toBe(true);
  });

  test('restores a plugin-ignored stylesheet with its resolved href and original attributes', async () => {
    const entryUrl = 'https://child.example/css-ignore/index.html';
    const fetch = vi.fn((_input: RequestInfo): Promise<Response> =>
      Promise.resolve(response('.ignored { color: red; }')),
    );
    const parsed = await importHTML({
      url: entryUrl,
      html: '<link media=print data-owner=child rel=stylesheet href="./ignored.css">',
      opts: { fetch, plugins: [{ cssIgnores: [/ignored\.css$/] }] },
    });
    const sandbox = {
      proxyLocation: new URL(entryUrl),
      plugins: [],
    } as unknown as Jieshu;

    const output = await processCssLoader(sandbox, parsed.template, parsed.getExternalStyleSheets);
    const holder = document.createElement('div');
    holder.innerHTML = output;
    const link = holder.querySelector('link');

    expect(fetch).not.toHaveBeenCalled();
    expect(link?.getAttribute('href')).toBe('https://child.example/css-ignore/ignored.css');
    expect(link?.getAttribute('media')).toBe('print');
    expect(link?.getAttribute('data-owner')).toBe('child');
  });

  test('coalesces HTML requests, evicts network failures and retries', async () => {
    const url = 'https://child.example/cache/index.html';
    const pending = deferred<Response>();
    const fetch = vi.fn((_input: RequestInfo): Promise<Response> => pending.promise);
    const parameters = { url, opts: { fetch } };
    const first = importHTML(parameters);
    const second = importHTML(parameters);
    expect(fetch).toHaveBeenCalledTimes(1);
    pending.resolve(response('<main>cached</main>'));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    clearAssetsCache();
    let attempt = 0;
    const retryFetch = vi.fn((_input: RequestInfo): Promise<Response> => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(response('<main>recovered</main>'));
    });
    const retryParameters = { url, opts: { fetch: retryFetch } };
    await expect(importHTML(retryParameters)).rejects.toThrow('offline');
    expect(embedHTMLCache[url]).toBeUndefined();
    await expect(importHTML(retryParameters)).resolves.toMatchObject({ template: '<main>recovered</main>' });
    expect(retryFetch).toHaveBeenCalledTimes(2);
  });

  test('evicts an HTTP-failed HTML document before retrying the same URL', async () => {
    const url = 'https://child.example/http-retry/index.html';
    const loadError = vi.fn((_url: string, _failure: Error): void => undefined);
    let attempt = 0;
    const fetch = vi.fn((_input: RequestInfo): Promise<Response> => {
      attempt += 1;
      return Promise.resolve(
        attempt === 1 ? response('temporarily unavailable', 503) : response('<main>recovered</main>'),
      );
    });
    const parameters = { url, opts: { fetch, loadError } };

    await expect(importHTML(parameters)).rejects.toThrow();
    expect(embedHTMLCache[url]).toBeUndefined();
    await expect(importHTML(parameters)).resolves.toMatchObject({ template: '<main>recovered</main>' });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loadError).toHaveBeenCalledTimes(1);
    expect(loadError).toHaveBeenCalledWith(url, expect.any(Error));
  });

  test('a newer cache scope bypasses pending HTML, CSS and script requests', async () => {
    const htmlUrl = 'https://child.example/generation/index.html';
    const scriptUrl = 'https://child.example/generation/app.js';
    const styleUrl = 'https://child.example/generation/app.css';
    const staleHtml = deferred<Response>();
    const firstHtml = importHTML({
      url: htmlUrl,
      opts: { fetch: () => staleHtml.promise, cacheScope: {} },
    });

    const currentHtml = await importHTML({
      url: htmlUrl,
      opts: {
        fetch: () => Promise.resolve(response('<main>current</main>')),
        cacheScope: {},
      },
    });
    expect(currentHtml.template).toBe('<main>current</main>');

    const staleScript = deferred<Response>();
    const staleStyle = deferred<Response>();
    const oldScope = {};
    const currentScope = {};
    const oldScript = getExternalScripts([{ src: scriptUrl }], () => staleScript.promise, undefined, false, oldScope)[0]
      .contentPromise;
    const oldStyle = getExternalStyleSheets([{ src: styleUrl }], () => staleStyle.promise, undefined, oldScope)[0]
      .contentPromise;

    await expect(
      getExternalScripts(
        [{ src: scriptUrl }],
        () => Promise.resolve(response('current-script')),
        undefined,
        false,
        currentScope,
      )[0].contentPromise,
    ).resolves.toBe('current-script');
    await expect(
      getExternalStyleSheets(
        [{ src: styleUrl }],
        () => Promise.resolve(response('current-style')),
        undefined,
        currentScope,
      )[0].contentPromise,
    ).resolves.toBe('current-style');

    staleHtml.resolve(response('<main>stale</main>'));
    staleScript.resolve(response('stale-script'));
    staleStyle.resolve(response('stale-style'));
    await expect(firstHtml).resolves.toMatchObject({ template: '<main>stale</main>' });
    await expect(Promise.all([oldScript, oldStyle])).resolves.toEqual(['stale-script', 'stale-style']);
  });

  test('a retired fiber reservation cannot start after a newer scope owns the same URL', async () => {
    vi.useFakeTimers();
    const source = 'https://child.example/generation/lazy.js';
    const currentResponse = deferred<Response>();
    const staleFetch = vi.fn(() => Promise.resolve(response('stale')));
    const currentFetch = vi.fn(() => currentResponse.promise);
    const staleScope = {};
    const staleContent = getExternalScripts([{ src: source, async: true }], staleFetch, undefined, true, staleScope)[0]
      .contentPromise;
    const currentContent = getExternalScripts([{ src: source, async: true }], currentFetch, undefined, false, {})[0]
      .contentPromise;

    expect(currentFetch).toHaveBeenCalledTimes(1);
    expect(staleFetch).not.toHaveBeenCalled();
    releaseAssetCacheScope(staleScope);
    vi.runOnlyPendingTimers();
    await expect(staleContent).resolves.toBe('');
    expect(staleFetch).not.toHaveBeenCalled();

    currentResponse.resolve(response('current'));
    await expect(currentContent).resolves.toBe('current');
    const laterFetch = vi.fn(() => Promise.resolve(response('later')));
    await expect(
      getExternalScripts([{ src: source }], laterFetch, undefined, false, {})[0].contentPromise,
    ).resolves.toBe('current');
    expect(laterFetch).not.toHaveBeenCalled();
  });

  test('two live sandbox scopes may fiber-load the same URL with independent fetchers', async () => {
    vi.useFakeTimers();
    const source = 'https://child.example/shared/live.js';
    const firstFetch = vi.fn(() => Promise.resolve(response('first')));
    const secondFetch = vi.fn(() => Promise.resolve(response('second')));
    const first = getExternalScripts([{ src: source, async: true }], firstFetch, undefined, true, {})[0].contentPromise;
    const second = getExternalScripts([{ src: source, defer: true }], secondFetch, undefined, true, {})[0]
      .contentPromise;

    vi.runOnlyPendingTimers();

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  test('retiring a cache scope prevents its queued fiber request from starting I/O', async () => {
    vi.useFakeTimers();
    const scope = {};
    const fetch = vi.fn(() => Promise.resolve(response('retired')));
    const content = getExternalScripts(
      [{ src: 'https://child.example/generation/retired.js', defer: true }],
      fetch,
      undefined,
      true,
      scope,
    )[0].contentPromise;

    releaseAssetCacheScope(scope);
    vi.runOnlyPendingTimers();

    await expect(content).resolves.toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a fulfilled HTML cache cannot retain an older scope's pending asset getter", async () => {
    const url = 'https://child.example/scoped-document/index.html';
    const scriptUrl = 'https://child.example/scoped-document/app.js';
    const staleScript = deferred<Response>();
    const oldFetch = vi.fn((input: RequestInfo): Promise<Response> =>
      String(input) === url ? Promise.resolve(response('<script src="./app.js"></script>')) : staleScript.promise,
    );
    const oldDocument = await importHTML({ url, opts: { fetch: oldFetch, cacheScope: {} } });
    const oldAsset = oldDocument.getExternalScripts()[0].contentPromise;

    const currentFetch = vi.fn((input: RequestInfo): Promise<Response> =>
      Promise.resolve(response(String(input) === url ? '<script src="./app.js"></script>' : 'current-script')),
    );
    const currentDocument = await importHTML({ url, opts: { fetch: currentFetch, cacheScope: {} } });
    await expect(currentDocument.getExternalScripts()[0].contentPromise).resolves.toBe('current-script');
    expect(currentFetch).toHaveBeenCalledWith(scriptUrl);
    expect(currentFetch).toHaveBeenCalledTimes(1);

    staleScript.resolve(response('stale-script'));
    await expect(oldAsset).resolves.toBe('stale-script');
  });

  test('applies excludes and ignores deterministically for reusable global regular expressions', async () => {
    const fetch = vi.fn((_input: RequestInfo): Promise<Response> => Promise.resolve(response('asset')));
    const plugins: JieshuPlugin[] = [
      {
        jsExcludes: [/excluded\.js/g],
        jsIgnores: [/ignored\.js/g],
        cssExcludes: [/excluded\.css/g],
        cssIgnores: [/ignored\.css/g],
      },
    ];
    const parsed = await importHTML({
      url: 'https://child.example/filters/index.html',
      html: [
        '<link rel=stylesheet href=./excluded.css>',
        '<link rel=stylesheet href=./ignored.css>',
        '<link rel=stylesheet href=./loaded.css>',
        '<script src=./excluded.js></script>',
        '<script src=./ignored.js></script>',
        '<script src=./loaded.js></script>',
      ].join(''),
      opts: { fetch, plugins },
    });

    for (let iteration = 0; iteration < 2; iteration += 1) {
      const scripts = parsed.getExternalScripts();
      const styles = parsed.getExternalStyleSheets();
      expect(scripts.map(({ src }) => src)).toEqual([
        'https://child.example/filters/ignored.js',
        'https://child.example/filters/loaded.js',
      ]);
      expect(scripts[0].ignore).toBe(true);
      expect(styles.map(({ src }) => src)).toEqual([
        'https://child.example/filters/ignored.css',
        'https://child.example/filters/loaded.css',
      ]);
      expect(styles[0].ignore).toBe(true);
      await Promise.all([
        ...scripts.map(({ contentPromise }) => contentPromise),
        ...styles.map(({ contentPromise }) => contentPromise),
      ]);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('embeds CSS in source order even when requests settle in reverse order', async () => {
    const source = 'https://assets.example/theme.css';
    const first = deferred<string>();
    const second = deferred<string>();
    const sandbox = {
      proxyLocation: { protocol: 'https:', host: 'child.example', pathname: '/app/' },
      plugins: [{ cssLoader: (code: string) => `${code}-first` }, { cssLoader: (code: string) => `${code}-second` }],
    } as unknown as Jieshu;
    const marker = genLinkReplaceSymbol(source);
    const processing = processCssLoader(sandbox, `${marker}${marker}`, () => [
      { src: source, contentPromise: first.promise },
      { src: source, contentPromise: second.promise },
    ]);

    second.resolve('B');
    first.resolve('A');

    await expect(processing).resolves.toBe(
      `<style>/* ${source} */A-first-second</style><style>/* ${source} */B-first-second</style>`,
    );
  });

  test('retains the original inline-style marker after an earlier stylesheet is excluded', async () => {
    const parsed = await importHTML({
      url: 'https://child.example/style-index/index.html',
      html: '<link rel=stylesheet href=./excluded.css><style>.inline { color: green; }</style>',
      opts: { plugins: [{ cssExcludes: [/excluded\.css$/] }] },
    });
    const sandbox = {
      proxyLocation: { protocol: 'https:', host: 'child.example', pathname: '/style-index/' },
      plugins: [],
    } as unknown as Jieshu;

    await expect(processCssLoader(sandbox, parsed.template, parsed.getExternalStyleSheets)).resolves.toContain(
      '<style>/* inline-style-1 */.inline { color: green; }</style>',
    );
  });

  test('clears every cache for a legacy runtime null', () => {
    styleCache['https://assets.example/a.css'] = Promise.resolve('a');
    scriptCache['https://assets.example/a.js'] = Promise.resolve('a');
    const clearWithNull = clearAssetsCache as unknown as (host: null) => void;
    clearWithNull(null);
    expect(Object.keys(styleCache)).toHaveLength(0);
    expect(Object.keys(scriptCache)).toHaveLength(0);
  });
});
