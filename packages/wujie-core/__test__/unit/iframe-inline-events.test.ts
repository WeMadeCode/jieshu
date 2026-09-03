import {
  compileInlineEvents,
  patchInlineEventSetAttribute,
  wrapInlineEventHandler,
} from '../../src/iframe-inline-events';
import { getWujieWindow } from '../../src/entry';
import { WUJIE_DATA_FLAG } from '../../src/constant';

function createIframeWindow(appId = 'inline-app'): { iframe: HTMLIFrameElement; iframeWindow: Window } {
  const iframe = document.createElement('iframe');
  iframe.setAttribute(WUJIE_DATA_FLAG, '');
  document.body.appendChild(iframe);
  const iframeWindow = iframe.contentWindow as Window;
  iframeWindow.__WUJIE = { id: appId } as unknown as Window['__WUJIE'];
  return { iframe, iframeWindow };
}

describe('iframe inline event compiler', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('recursively compiles handlers once while preserving ordinary attributes', () => {
    const { iframeWindow } = createIframeWindow();
    const root = iframeWindow.document.createElement('div');
    root.innerHTML = '<button onclick="run()"><span onmouseover="hover()"></span></button>';
    root.setAttribute('data-state', 'ready');

    compileInlineEvents(root, iframeWindow);
    const button = root.querySelector('button') as HTMLButtonElement;
    const span = root.querySelector('span') as HTMLSpanElement;
    const compiled = button.getAttribute('onclick') as string;

    expect(compiled).toBe(
      '{const __WUJIE_INLINE_SCOPE__=window.__getWujieWindow__("inline-app");if(__WUJIE_INLINE_SCOPE__){with(__WUJIE_INLINE_SCOPE__){ run() }}}',
    );
    expect(span.getAttribute('onmouseover')).toBe(
      '{const __WUJIE_INLINE_SCOPE__=window.__getWujieWindow__("inline-app");if(__WUJIE_INLINE_SCOPE__){with(__WUJIE_INLINE_SCOPE__){ hover() }}}',
    );
    expect(root.getAttribute('data-state')).toBe('ready');

    compileInlineEvents(root, iframeWindow);
    expect(button.getAttribute('onclick')).toBe(compiled);
  });

  it('compiles dynamically assigned event attributes through the patched setter', () => {
    const { iframeWindow } = createIframeWindow('dynamic-app');
    patchInlineEventSetAttribute(iframeWindow);
    const element = iframeWindow.document.createElement('button');

    element.setAttribute('onclick', 'submitForm()');
    element.setAttribute('aria-label', 'submit');

    expect(element.getAttribute('onclick')).toBe(
      '{const __WUJIE_INLINE_SCOPE__=window.__getWujieWindow__("dynamic-app");if(__WUJIE_INLINE_SCOPE__){with(__WUJIE_INLINE_SCOPE__){ submitForm() }}}',
    );
    expect(element.getAttribute('aria-label')).toBe('submit');
  });

  it('normalizes mixed-case and attribute-node event writes', () => {
    const { iframeWindow } = createIframeWindow('attribute-api-app');
    patchInlineEventSetAttribute(iframeWindow);
    const element = iframeWindow.document.createElement('button');
    const attribute = iframeWindow.document.createAttribute('ONFOCUS');
    attribute.value = 'focusChild()';

    element.setAttribute('ONCLICK', 'clickChild()');
    element.setAttributeNS(null, 'onmouseover', 'hoverChild()');
    element.setAttributeNode(attribute);

    expect(element.getAttribute('onclick')).toContain('window.__getWujieWindow__("attribute-api-app")');
    expect(element.getAttribute('onmouseover')).toContain('window.__getWujieWindow__("attribute-api-app")');
    expect(element.getAttribute('onfocus')).toContain('window.__getWujieWindow__("attribute-api-app")');
  });

  it('compiles handlers introduced by dynamic markup APIs', () => {
    const { iframeWindow } = createIframeWindow('markup-app');
    patchInlineEventSetAttribute(iframeWindow);
    const root = iframeWindow.document.createElement('section');

    root.innerHTML = '<button id="inner" onclick="fromInner()"></button>';
    root.insertAdjacentHTML('beforeend', '<button id="adjacent" ONCLICK="fromAdjacent()"></button>');
    const shadowHost = iframeWindow.document.createElement('div');
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<button id="shadow" onclick="fromShadow()"></button>';

    expect(root.querySelector('#inner')?.getAttribute('onclick')).toContain('window.__getWujieWindow__("markup-app")');
    expect(root.querySelector('#adjacent')?.getAttribute('onclick')).toContain(
      'window.__getWujieWindow__("markup-app")',
    );
    expect(shadowRoot.querySelector('#shadow')?.getAttribute('onclick')).toContain(
      'window.__getWujieWindow__("markup-app")',
    );
  });

  it('compiles handlers on nodes created by iframe-realm outerHTML', () => {
    const { iframeWindow } = createIframeWindow('outer-html-app');
    patchInlineEventSetAttribute(iframeWindow);
    const root = iframeWindow.document.createElement('section');
    const original = iframeWindow.document.createElement('div');
    root.appendChild(original);

    original.outerHTML = '<button id="replacement" onclick="fromOuter()"></button>';

    expect(root.querySelector('#replacement')?.getAttribute('onclick')).toContain(
      'window.__getWujieWindow__("outer-html-app")',
    );
  });

  it('executes a dynamic click in the child scope instead of the raw iframe global', () => {
    const { iframeWindow } = createIframeWindow('click-scope-app');
    const childHandler = vi.fn();
    const rawIframeHandler = vi.fn();
    const runtimeWindow = iframeWindow as Window & { runDynamicHandler?: () => void };
    runtimeWindow.runDynamicHandler = rawIframeHandler;
    iframeWindow.__getWujieWindow__ = () => ({ runDynamicHandler: childHandler }) as unknown as WindowProxy;
    patchInlineEventSetAttribute(iframeWindow);
    const root = iframeWindow.document.createElement('section');
    iframeWindow.document.body.appendChild(root);

    root.innerHTML = '<button onclick="runDynamicHandler()">run</button>';
    (root.firstElementChild as HTMLButtonElement).click();

    expect(childHandler).toHaveBeenCalledTimes(1);
    expect(rawIframeHandler).not.toHaveBeenCalled();
  });

  it('leaves an already compiled handler unchanged', () => {
    const compiled =
      '{const __WUJIE_INLINE_SCOPE__=window.__getWujieWindow__("app");if(__WUJIE_INLINE_SCOPE__){with(__WUJIE_INLINE_SCOPE__){ work() }}}';
    expect(wrapInlineEventHandler(compiled, 'app')).toBe(compiled);
  });

  it('serializes hostile app ids instead of interpolating executable source', () => {
    const appId = 'quoted"\\\n-id];hostEscape()//';
    const compiled = wrapInlineEventHandler('work()', appId);
    const getScope = vi.fn(() => null);
    const hostEscape = vi.fn();
    const execute = new Function('window', 'hostEscape', compiled) as (
      runtimeWindow: { __getWujieWindow__: (id: string) => null },
      escape: () => void,
    ) => void;

    execute({ __getWujieWindow__: getScope }, hostEscape);

    expect(getScope).toHaveBeenCalledWith(appId);
    expect(hostEscape).not.toHaveBeenCalled();
  });

  it('does not execute a stale handler when its child scope no longer exists', () => {
    const hostOnly = vi.fn();
    const compiled = wrapInlineEventHandler('hostOnly()', 'removed-app');
    const execute = new Function('window', 'hostOnly', compiled) as (
      runtimeWindow: { __getWujieWindow__: () => null },
      hostCallback: () => void,
    ) => void;

    execute({ __getWujieWindow__: () => null }, hostOnly);

    expect(hostOnly).not.toHaveBeenCalled();
  });

  it('claims missing identifiers inside a live child scope instead of falling through to the host', () => {
    const appId = 'selector["\\]-safe';
    const unrelatedIframe = document.createElement('iframe');
    unrelatedIframe.setAttribute('name', appId);
    document.body.appendChild(unrelatedIframe);
    const { iframe, iframeWindow } = createIframeWindow(appId);
    iframe.setAttribute('name', appId);
    iframeWindow.__WUJIE = { id: appId, degrade: true } as unknown as Window['__WUJIE'];
    const scope = getWujieWindow(appId);

    expect(scope).not.toBeNull();
    expect('hostOnly' in (scope as WindowProxy)).toBe(true);
    expect(Reflect.get(scope as WindowProxy, 'hostOnly')).toBeUndefined();
  });
});
