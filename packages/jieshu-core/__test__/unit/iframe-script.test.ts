import { insertScriptToIframe } from '../../src/iframe';
import { JIESHU_SCRIPT_ID } from '../../src/constant';
import { cancelSandboxDynamicResources } from '../../src/sandbox-runtime';
import type Jieshu from '../../src/sandbox';

interface ScriptTestSandbox {
  replace: (code: string) => string;
  plugins: Window['__JIESHU']['plugins'];
  proxyLocation: Location;
  degrade: boolean;
  proxy: Window;
  execQueue: Array<() => unknown>;
  dynamicScriptElements: HTMLScriptElement[];
  activeFlag: boolean;
  destroyed: boolean;
}

function createScriptEnvironment(degrade = false): {
  iframe: HTMLIFrameElement;
  iframeWindow: Window;
  sandbox: ScriptTestSandbox;
} {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const iframeWindow = iframe.contentWindow as Window;
  const sandbox: ScriptTestSandbox = {
    replace: (code) => code,
    plugins: [],
    proxyLocation: iframeWindow.location,
    degrade,
    proxy: iframeWindow,
    execQueue: [],
    dynamicScriptElements: [],
    activeFlag: true,
    destroyed: false,
  };
  iframeWindow.__JIESHU = sandbox as unknown as Window['__JIESHU'];
  return { iframe, iframeWindow, sandbox };
}

describe('iframe script execution pipeline', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('configures inline scripts, runs callbacks, and advances the serial queue', () => {
    const { iframeWindow } = createScriptEnvironment();
    const callback = vi.fn();
    const onload = vi.fn();

    insertScriptToIframe(
      {
        content: 'window.inlineExecuted = true;',
        src: 'https://child.example/inline.js',
        attrs: { nonce: 'abc' },
        callback,
        onload,
      },
      iframeWindow,
    );

    const scripts = iframeWindow.document.head.querySelectorAll('script');
    expect(scripts).toHaveLength(2);
    expect(scripts[0].textContent).toContain('.bind(window.__JIESHU.proxy)');
    expect(scripts[0].getAttribute('nonce')).toBe('abc');
    expect(scripts[0].src).toBe('https://child.example/inline.js');
    expect(scripts[1].textContent).toContain('execQueue.shift()()');
    expect(callback).toHaveBeenCalledWith(iframeWindow);
    expect(onload).toHaveBeenCalledTimes(1);
  });

  it('waits for an external script event before advancing and tracks dynamic scripts', () => {
    const { iframeWindow, sandbox } = createScriptEnvironment();
    const rawElement = iframeWindow.document.createElement('script');
    rawElement.setAttribute(JIESHU_SCRIPT_ID, 'dynamic-7');
    const onload = vi.fn();

    insertScriptToIframe(
      { src: 'https://cdn.example/chunk.js', crossorigin: true, crossoriginType: 'anonymous', onload },
      iframeWindow,
      rawElement,
    );

    const inserted = iframeWindow.document.head.querySelector('script') as HTMLScriptElement;
    expect(iframeWindow.document.head.querySelectorAll('script')).toHaveLength(1);
    expect(inserted.getAttribute(JIESHU_SCRIPT_ID)).toBe('dynamic-7');
    expect(inserted.getAttribute('crossorigin')).toBe('anonymous');
    expect(sandbox.dynamicScriptElements).toEqual([inserted]);

    inserted.dispatchEvent(new Event('load'));
    expect(onload).toHaveBeenCalledTimes(1);
    expect(iframeWindow.document.head.querySelectorAll('script')).toHaveLength(2);
    expect(inserted.onload).toBeNull();
    expect(inserted.onerror).toBeNull();
    inserted.dispatchEvent(new Event('error'));
    expect(onload).toHaveBeenCalledTimes(1);
  });

  it('reports a native error separately and still advances the serial queue', async () => {
    const { iframeWindow, sandbox } = createScriptEnvironment();
    const onload = vi.fn();
    const onerror = vi.fn();
    const next = vi.fn();
    sandbox.execQueue.push(next);

    const handle = insertScriptToIframe({ src: 'https://cdn.example/missing.js', onload, onerror }, iframeWindow);
    handle.element.dispatchEvent(new Event('error'));

    await expect(handle.completion).resolves.toBe('error');
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(onload).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(handle.element.onload).toBeNull();
    expect(handle.element.onerror).toBeNull();
  });

  it('cancels a pending native script without advancing or retaining its node', () => {
    const { iframeWindow, sandbox } = createScriptEnvironment();
    const rawElement = iframeWindow.document.createElement('script');
    const onload = vi.fn();
    const handle = insertScriptToIframe({ src: 'https://cdn.example/pending.js', onload }, iframeWindow, rawElement);
    const inserted = handle.element;

    expect(inserted.isConnected).toBe(true);
    expect(sandbox.dynamicScriptElements).toEqual([inserted]);
    handle.cancel();

    expect(inserted.isConnected).toBe(false);
    expect(inserted.onload).toBeNull();
    expect(inserted.onerror).toBeNull();
    expect(sandbox.dynamicScriptElements).toEqual([]);
    inserted.dispatchEvent(new Event('load'));
    expect(onload).not.toHaveBeenCalled();
    expect(iframeWindow.document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('registers a pending static native script for sandbox teardown', () => {
    const { iframeWindow, sandbox } = createScriptEnvironment();
    const onload = vi.fn();
    const handle = insertScriptToIframe({ src: 'https://cdn.example/static-pending.js', onload }, iframeWindow);

    expect(handle.element.isConnected).toBe(true);
    cancelSandboxDynamicResources(sandbox as unknown as Jieshu, 'unmount');

    expect(handle.element.isConnected).toBe(false);
    handle.element.dispatchEvent(new Event('load'));
    expect(onload).not.toHaveBeenCalled();
  });

  it('keeps transformed module code cancellable until its native load event', () => {
    const { iframeWindow, sandbox } = createScriptEnvironment();
    const rawElement = iframeWindow.document.createElement('script');
    const onload = vi.fn();
    const handle = insertScriptToIframe(
      { content: 'export default 1', module: true, onload },
      iframeWindow,
      rawElement,
    );

    expect(handle.element.getAttribute('type')).toBe('module');
    expect(onload).not.toHaveBeenCalled();
    expect(sandbox.dynamicScriptElements).toEqual([handle.element]);

    handle.cancel();
    handle.element.dispatchEvent(new Event('load'));
    expect(onload).not.toHaveBeenCalled();
    expect(handle.element.isConnected).toBe(false);
    expect(sandbox.dynamicScriptElements).toEqual([]);
  });

  it('ignores a native script event delivered after its sandbox was destroyed', () => {
    const { iframeWindow } = createScriptEnvironment();
    const onload = vi.fn();

    insertScriptToIframe({ src: 'https://cdn.example/late.js', onload }, iframeWindow);
    const inserted = iframeWindow.document.head.querySelector('script') as HTMLScriptElement;
    const sandbox = iframeWindow.__JIESHU;
    sandbox.destroyed = true;
    Reflect.set(iframeWindow, '__JIESHU', null);

    inserted.dispatchEvent(new Event('load'));

    expect(onload).not.toHaveBeenCalled();
    expect(iframeWindow.document.head.querySelectorAll('script')).toHaveLength(1);
    expect(inserted.onload).toBeNull();
    expect(inserted.onerror).toBeNull();
  });

  it('reports an HTML response and advances without inserting the invalid script', () => {
    const { iframeWindow } = createScriptEnvironment(true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const callback = vi.fn();

    insertScriptToIframe({ content: '<!DOCTYPE html><title>not javascript</title>', callback }, iframeWindow);

    expect(consoleError).toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    const scripts = iframeWindow.document.head.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].textContent).toContain('execQueue.shift()');
  });

  it('accepts an external preset with no fetched content when js loaders inspect the code', () => {
    const { iframeWindow, sandbox } = createScriptEnvironment();
    sandbox.plugins = [{ jsLoader: (code: string) => code.trim() }];

    expect(() => insertScriptToIframe({ src: 'https://cdn.example/preset.js' }, iframeWindow)).not.toThrow();
    expect(iframeWindow.document.head.querySelector('script')?.getAttribute('src')).toBe(
      'https://cdn.example/preset.js',
    );
  });

  it('keeps mixed-case import-map JSON byte-for-byte outside transforms and classic wrapping', () => {
    const { iframeWindow, sandbox } = createScriptEnvironment();
    const replace = vi.fn((code: string) => `/* replaced */${code}`);
    const jsLoader = vi.fn((code: string) => `${code};`);
    sandbox.replace = replace;
    sandbox.plugins = [{ jsLoader }];
    const importMap = '{"imports":{"pkg":"https://cdn.example/pkg.js"}}';

    insertScriptToIframe({ content: importMap, attrs: { type: 'ImportMap' } }, iframeWindow);

    const inserted = iframeWindow.document.head.querySelector('script') as HTMLScriptElement;
    expect(inserted.getAttribute('type')).toBe('ImportMap');
    expect(inserted.textContent).toBe(importMap);
    expect(inserted.textContent).not.toContain('.bind(window.__JIESHU.proxy)');
    expect(replace).not.toHaveBeenCalled();
    expect(jsLoader).not.toHaveBeenCalled();
  });

  it('does not inject a script when its loader synchronously invalidates the owner', async () => {
    const { iframeWindow, sandbox } = createScriptEnvironment();
    const callback = vi.fn();
    sandbox.plugins = [
      {
        jsLoader: (code: string) => {
          sandbox.activeFlag = false;
          sandbox.destroyed = true;
          return code;
        },
      },
    ];

    const handle = insertScriptToIframe({ content: 'window.staleCodeExecuted = true;', callback }, iframeWindow);
    await expect(handle.completion).resolves.toBe('cancelled');

    expect(handle.element.isConnected).toBe(false);
    expect(iframeWindow.document.head.querySelectorAll('script')).toHaveLength(0);
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not forward mixed-case reserved source attributes onto transformed inline scripts', () => {
    const { iframeWindow } = createScriptEnvironment();

    insertScriptToIframe(
      {
        src: 'https://cdn.example/app.js',
        content: 'window.transformed = true;',
        attrs: { SRC: 'https://cdn.example/bypass.js', nonce: 'safe' },
      },
      iframeWindow,
    );

    const inserted = iframeWindow.document.head.querySelector('script') as HTMLScriptElement;
    expect(inserted.getAttribute('src')).toBeNull();
    expect(inserted.getAttribute('nonce')).toBe('safe');
    expect(inserted.textContent).toContain('window.transformed = true;');
  });
});
