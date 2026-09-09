import importHTML, {
  clearAssetsCache,
  getExternalScripts,
  getExternalStyleSheets,
  releaseAssetCacheScope,
} from '../../src/entry';

type Fetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type Kind = 'html' | 'script' | 'style';
const kinds: Kind[] = ['html', 'script', 'style'];

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const read = async (kind: Kind, fetch: Fetch, scope: object, prefix = 'https://context.test/') => {
  const url = `${prefix}entry.${kind}`;
  if (kind === 'html') {
    return (await importHTML({ url, opts: { fetch, fiber: false, cacheScope: scope } })).template;
  }
  if (kind === 'script') {
    return getExternalScripts([{ src: url }], fetch, undefined, false, scope)[0].contentPromise;
  }
  return getExternalStyleSheets([{ src: url }], fetch, undefined, scope)[0].contentPromise;
};

beforeEach(() => clearAssetsCache());

test.each(kinds)('%s releasing scope during fetch cannot publish its later result into the cache', async (kind) => {
  const oldScope = {};
  const fetch = vi
    .fn<Fetch>()
    .mockImplementationOnce(async () => {
      releaseAssetCacheScope(oldScope);
      return new Response('retired');
    })
    .mockImplementation(async () => new Response('current'));
  expect(await read(kind, fetch, oldScope)).toBe('retired');
  expect(await read(kind, fetch, {})).toBe('current');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each(kinds)(
  '%s completed cache is isolated by fetch and reusable when returning to an earlier context',
  async (kind) => {
    const first = vi.fn<Fetch>(async () => new Response('first'));
    const second = vi.fn<Fetch>(async () => new Response('second'));
    expect(await read(kind, first, {})).toBe('first');
    expect(await read(kind, second, {})).toBe('second');
    expect(await read(kind, first, {})).toBe('first');
    expect(await read(kind, second, {})).toBe('second');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  },
);

test.each(kinds)(
  '%s pending requests coalesce inside each context even when another context interleaves',
  async (kind) => {
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    const first = vi.fn<Fetch>(() => firstResponse.promise);
    const second = vi.fn<Fetch>(() => secondResponse.promise);
    const firstScope = {};
    const secondScope = {};
    const a = read(kind, first, firstScope);
    const b = read(kind, second, secondScope);
    const aAgain = read(kind, first, firstScope);
    const bAgain = read(kind, second, secondScope);
    firstResponse.resolve(new Response('first'));
    secondResponse.resolve(new Response('second'));
    expect(await Promise.all([a, b, aAgain, bAgain])).toEqual(['first', 'second', 'first', 'second']);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  },
);

test.each(kinds)('%s clear invalidates all fetch contexts at the matching prefix and retains others', async (kind) => {
  const first = vi.fn<Fetch>(async () => new Response('first'));
  const second = vi.fn<Fetch>(async () => new Response('second'));
  await read(kind, first, {});
  await read(kind, second, {});
  await read(kind, first, {}, 'https://retained.test/');
  await read(kind, second, {}, 'https://retained.test/');
  clearAssetsCache('https://context.test/');
  expect(await read(kind, first, {})).toBe('first');
  expect(await read(kind, second, {})).toBe('second');
  await read(kind, first, {}, 'https://retained.test/');
  await read(kind, second, {}, 'https://retained.test/');
  expect(first).toHaveBeenCalledTimes(3);
  expect(second).toHaveBeenCalledTimes(3);
  clearAssetsCache();
  await read(kind, first, {}, 'https://retained.test/');
  await read(kind, second, {}, 'https://retained.test/');
  expect(first).toHaveBeenCalledTimes(4);
  expect(second).toHaveBeenCalledTimes(4);
});

test.each(kinds)('%s explicit invalidation handles context changes inside the same fetch function', async (kind) => {
  let tenant = 'first';
  const fetch = vi.fn<Fetch>(async () => new Response(tenant));
  expect(await read(kind, fetch, {})).toBe('first');
  tenant = 'second';
  // Mutable authentication state is not observable from function identity.
  clearAssetsCache('https://context.test/');
  expect(await read(kind, fetch, {})).toBe('second');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each(kinds)('%s released pending scope cannot restore stale data or evict a newer context', async (kind) => {
  const stale = deferred<Response>();
  const first = vi
    .fn<Fetch>()
    .mockImplementationOnce(() => stale.promise)
    .mockImplementation(async () => new Response('fresh'));
  const peer = vi.fn<Fetch>(async () => new Response('peer'));
  const oldScope = {};
  const old = read(kind, first, oldScope).catch(() => 'failed');
  await read(kind, peer, {});
  releaseAssetCacheScope(oldScope);
  expect(await read(kind, first, {})).toBe('fresh');
  stale.reject(new Error('old request rejected'));
  await old;
  expect(await read(kind, peer, {})).toBe('peer');
  expect(await read(kind, first, {})).toBe('fresh');
  expect(first).toHaveBeenCalledTimes(2);
  expect(peer).toHaveBeenCalledTimes(1);
});

test.each(kinds)('%s clear during fetch cannot publish its later result into the cache', async (kind) => {
  const fetch = vi
    .fn<Fetch>()
    .mockImplementationOnce(async () => {
      clearAssetsCache();
      return new Response('retired');
    })
    .mockImplementation(async () => new Response('current'));
  expect(await read(kind, fetch, {})).toBe('retired');
  expect(await read(kind, fetch, {})).toBe('current');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('HTML, script and style caches retain separate results for the same URL and fetch', async () => {
  const source = 'https://context.test/shared';
  const scope = {};
  const fetch = vi
    .fn<Fetch>()
    .mockResolvedValueOnce(new Response('<main>document</main>'))
    .mockResolvedValueOnce(new Response('script-content'))
    .mockResolvedValueOnce(new Response('style-content'));
  const html = await importHTML({ url: source, opts: { fetch, cacheScope: scope } });
  const script = getExternalScripts([{ src: source }], fetch, undefined, false, scope)[0].contentPromise;
  const style = getExternalStyleSheets([{ src: source }], fetch, undefined, scope)[0].contentPromise;
  expect(html.template).toBe('<main>document</main>');
  expect(await script).toBe('script-content');
  expect(await style).toBe('style-content');
  releaseAssetCacheScope(scope);
  expect((await importHTML({ url: source, opts: { fetch, cacheScope: {} } })).template).toBe(html.template);
  expect(await getExternalScripts([{ src: source }], fetch, undefined, false, {})[0].contentPromise).toBe(
    'script-content',
  );
  expect(await getExternalStyleSheets([{ src: source }], fetch, undefined, {})[0].contentPromise).toBe('style-content');
  expect(fetch).toHaveBeenCalledTimes(3);
});
