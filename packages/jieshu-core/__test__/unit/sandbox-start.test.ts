import Jieshu from '../../src/sandbox';

function createStartSandbox(): { sandbox: Jieshu; iframe: HTMLIFrameElement; iframeWindow: Window } {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const iframeWindow = iframe.contentWindow as Window;
  const sandbox = Object.create(Jieshu.prototype) as Jieshu;

  Object.assign(sandbox, {
    id: '',
    iframe,
    activeFlag: true,
    destroyed: false,
    execQueue: [],
    fiber: false,
    alive: false,
    plugins: [
      {
        jsBeforeLoaders: [{ content: 'void 0;', async: true }],
      },
    ],
    replace: (code: string): string => code,
    proxyLocation: iframeWindow.location,
    dynamicScriptElements: [],
    el: iframeWindow.document.body,
  });
  Reflect.set(sandbox, 'activationRevision', 1);
  iframeWindow.__JIESHU = sandbox;
  iframeWindow.__JIESHU_UNMOUNT = () => undefined;

  return { sandbox, iframe, iframeWindow };
}

describe('sandbox startup script lanes', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('serializes an async-marked inline preset without stalling startup', async () => {
    const { sandbox, iframeWindow } = createStartSandbox();
    const head = iframeWindow.document.head;
    const rawAppendChild = iframeWindow.Node.prototype.appendChild;
    vi.spyOn(head, 'appendChild').mockImplementation(function <NodeType extends Node>(
      this: HTMLHeadElement,
      node: NodeType,
    ): NodeType {
      const appended = Reflect.apply(rawAppendChild, this, [node]) as NodeType;
      if (node instanceof iframeWindow.HTMLScriptElement && node.textContent?.includes('execQueue.shift()()')) {
        sandbox.execQueue.shift()?.();
      }
      return appended;
    });
    vi.spyOn(sandbox, 'mount').mockImplementation(() => {
      sandbox.execQueue.shift()?.();
    });

    let settled = false;
    const start = sandbox
      .start(() => [])
      .then(() => {
        settled = true;
      });
    for (let iteration = 0; iteration < 5; iteration += 1) await Promise.resolve();

    expect(settled).toBe(true);
    await expect(start).resolves.toBeUndefined();
    expect(sandbox.execQueue).toHaveLength(0);
  });
});
