import type { MockInstance } from 'vitest';
import importHTML, { clearAssetsCache, getExternalScripts, getExternalStyleSheets } from '../../src/entry';
import {
  JIESHU_TIPS_CSS_ERROR_REQUESTED,
  JIESHU_TIPS_HTML_ERROR_REQUESTED,
  JIESHU_TIPS_SCRIPT_ERROR_REQUESTED,
} from '../../src/constant';
import type { LoadErrorHandler } from '../../src/contracts';

type RequestKind = 'html' | 'style' | 'script';
type Fetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

const source = 'https://child.example/request-errors/resource';
const requestKinds: Array<{ kind: RequestKind; message: string; field: 'url' | 'src' }> = [
  { kind: 'html', message: JIESHU_TIPS_HTML_ERROR_REQUESTED, field: 'url' },
  { kind: 'style', message: JIESHU_TIPS_CSS_ERROR_REQUESTED, field: 'src' },
  { kind: 'script', message: JIESHU_TIPS_SCRIPT_ERROR_REQUESTED, field: 'src' },
];

const request = (kind: RequestKind, fetch: Fetch, loadError?: LoadErrorHandler) => {
  if (kind === 'html') {
    return importHTML({ url: source, opts: { fetch, loadError } });
  }
  if (kind === 'style') {
    return getExternalStyleSheets([{ src: source }], fetch, loadError)[0].contentPromise;
  }
  return getExternalScripts([{ src: source }], fetch, loadError, false)[0].contentPromise;
};

const expectFailure = async (kind: RequestKind, result: ReturnType<typeof request>, failure: unknown) => {
  if (kind === 'script') {
    // Failed script text retains the existing native-src fallback convention.
    await expect(result).resolves.toBe('');
  } else {
    await expect(result).rejects.toBe(failure);
  }
};

describe.each(requestKinds)('$kind request failure boundaries', ({ kind, message, field }) => {
  let errorSpy: MockInstance<Console['error']>;

  beforeEach(() => {
    clearAssetsCache();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('reports a synchronous fetch exception with the original error and resource field', async () => {
    const failure = new Error('fetch threw before returning a promise');
    const loadError = vi.fn<LoadErrorHandler>();
    const fetch = vi.fn<Fetch>(() => {
      throw failure;
    });

    const result = request(kind, fetch, loadError);
    expect(fetch).toHaveBeenCalledWith(source);
    expect(loadError).toHaveBeenCalledExactlyOnceWith(source, failure);
    await expectFailure(kind, result, failure);
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(`[jieshu error]: ${message}`, {
      [field]: source,
      cause: failure,
    });
  });

  test('normalizes a rejected body value while retaining the original logged cause', async () => {
    const cause = 'body rejected with a string';
    const response = new Response('unused');
    vi.spyOn(response, 'text').mockRejectedValue(cause);
    const loadError = vi.fn<LoadErrorHandler>();
    const fetch = vi.fn<Fetch>(() => Promise.resolve(response));
    const result = request(kind, fetch, loadError);

    if (kind === 'script') {
      await expect(result).resolves.toBe('');
    } else {
      await expect(result).rejects.toThrow(message);
    }
    expect(loadError).toHaveBeenCalledExactlyOnceWith(source, expect.any(Error));
    const failure = loadError.mock.calls[0][1];
    expect(failure.message).toBe(message);
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(`[jieshu error]: ${message}`, {
      [field]: source,
      cause,
    });
  });

  test('leaves a throwing status getter outside load-error reporting', async () => {
    const failure = new Error('status getter failed');
    const response = new Response('unused');
    Object.defineProperty(response, 'status', {
      get: () => {
        throw failure;
      },
    });
    const readBody = vi.spyOn(response, 'text');
    const loadError = vi.fn<LoadErrorHandler>();
    const fetch = vi.fn<Fetch>(() => Promise.resolve(response));

    await expectFailure(kind, request(kind, fetch, loadError), failure);
    expect(readBody).not.toHaveBeenCalled();
    expect(loadError).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('reports a throwing text getter through the body failure boundary', async () => {
    const failure = new Error('text getter failed');
    const response = new Response('unused');
    Object.defineProperty(response, 'text', {
      get: () => {
        throw failure;
      },
    });
    const loadError = vi.fn<LoadErrorHandler>();
    const fetch = vi.fn<Fetch>(() => Promise.resolve(response));

    await expectFailure(kind, request(kind, fetch, loadError), failure);
    expect(loadError).toHaveBeenCalledExactlyOnceWith(source, failure);
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(`[jieshu error]: ${message}`, {
      [field]: source,
      cause: failure,
    });
  });

  test.each(['network', 'HTTP', 'body'])(
    'does not report a throwing loadError twice after %s failure',
    async (stage) => {
      const cause = new Error('request failed');
      const callbackFailure = new Error('loadError threw');
      const response = new Response('unused', { status: stage === 'HTTP' ? 503 : 200 });
      const readBody = vi.spyOn(response, 'text').mockRejectedValue(cause);
      const fetch = vi.fn<Fetch>(() => (stage === 'network' ? Promise.reject(cause) : Promise.resolve(response)));
      const loadError = vi.fn<LoadErrorHandler>(() => {
        throw callbackFailure;
      });

      await expectFailure(kind, request(kind, fetch, loadError), callbackFailure);
      expect(loadError).toHaveBeenCalledExactlyOnceWith(source, stage === 'HTTP' ? expect.any(Error) : cause);
      expect(errorSpy).toHaveBeenCalledExactlyOnceWith(`[jieshu error]: ${message}`, {
        [field]: source,
        cause: stage === 'HTTP' ? expect.any(Error) : cause,
      });
      if (stage === 'HTTP') {
        expect(loadError.mock.calls[0][1].message).toBe(message);
      }
      expect(readBody).toHaveBeenCalledTimes(stage === 'body' ? 1 : 0);
    },
  );

  test('preserves a throwing logger without invoking loadError or reporting again', async () => {
    const cause = new Error('request failed');
    const loggerFailure = new Error('logger threw');
    errorSpy.mockImplementation(() => {
      throw loggerFailure;
    });
    const loadError = vi.fn<LoadErrorHandler>();
    const fetch = vi.fn<Fetch>(() => Promise.reject(cause));

    await expectFailure(kind, request(kind, fetch, loadError), loggerFailure);
    expect(loadError).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith(`[jieshu error]: ${message}`, {
      [field]: source,
      cause,
    });
  });

  test('reads the successful body with its response receiver at the first fetch continuation', async () => {
    const body = '<main>ready</main>';
    const response = new Response(body);
    // Response.text relies on its dynamic receiver; an unbound helper call is invalid.
    const readBody = vi.spyOn(response, 'text').mockImplementation(function (this: Response) {
      expect(this).toBe(response);
      return Promise.resolve(body);
    });
    const loadError = vi.fn<LoadErrorHandler>();
    const fetch = vi.fn<Fetch>(() => Promise.resolve(response));

    const result = request(kind, fetch, loadError);
    expect(readBody).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(readBody).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toEqual(kind === 'html' ? expect.objectContaining({ template: body }) : body);
    expect(loadError).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
