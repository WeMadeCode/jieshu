import Jieshu from '../../src/sandbox';
import * as utils from '../../src/utils';

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

const flushMicrotasks = async () => {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await Promise.resolve();
  }
};

const createLifecycleHarness = (fiber: boolean) => {
  const { sandbox, iframeWindow } = createStartSandbox();
  const events: string[] = [];
  const idleTasks: Array<() => unknown> = [];
  sandbox.fiber = fiber;
  sandbox.plugins = [];
  vi.spyOn(utils, 'requestIdleCallback').mockImplementation((task) => idleTasks.push(task));
  vi.spyOn(utils, 'eventTrigger').mockImplementation((target, eventName) => {
    events.push(`${target === iframeWindow.document ? 'document' : 'window'}:${eventName}`);
  });
  vi.spyOn(sandbox, 'mount').mockImplementation(() => {
    events.push('mount');
    sandbox.execQueue.shift()?.();
  });
  const rawAppendChild = iframeWindow.Node.prototype.appendChild;
  vi.spyOn(iframeWindow.document.head, 'appendChild').mockImplementation(function <NodeType extends Node>(
    this: HTMLHeadElement,
    node: NodeType,
  ) {
    Reflect.apply(rawAppendChild, this, [node]);
    if (node instanceof iframeWindow.HTMLScriptElement) {
      const label = node.getAttribute('data-test-script');
      if (label) {
        events.push(label);
      }
      // jsdom does not execute the injected inline queue-advancer script.
      if (node.textContent?.includes('execQueue.shift()()')) {
        sandbox.execQueue.shift()?.();
      }
    }
    return node;
  });
  const runNextIdle = async () => {
    const task = idleTasks.shift();
    expect(task).toBeDefined();
    task?.();
    await flushMicrotasks();
  };
  const drainIdle = async () => {
    await flushMicrotasks();
    while (idleTasks.length) {
      await runNextIdle();
    }
  };
  return { sandbox, iframeWindow, events, idleTasks, runNextIdle, drainIdle };
};

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

  it('uses the next fiber slot for load after ordered scripts when there are no initial async scripts', async () => {
    const { sandbox, events, idleTasks, runNextIdle } = createLifecycleHarness(true);
    sandbox.plugins = [
      {
        jsBeforeLoaders: [{ content: 'void 0;', attrs: { 'data-test-script': 'before' } }],
        jsAfterLoaders: [{ content: 'void 0;', attrs: { 'data-test-script': 'after' } }],
      },
    ];
    const start = sandbox.start(() => [
      { src: '', contentPromise: Promise.resolve('void 0;'), attrs: { 'data-test-script': 'sync' } },
      { src: '', defer: true, contentPromise: Promise.resolve('void 0;'), attrs: { 'data-test-script': 'defer' } },
    ]);
    await flushMicrotasks();
    for (let step = 0; step < 6; step += 1) {
      await runNextIdle();
    }
    expect(events).toEqual([
      'before',
      'sync',
      'defer',
      'mount',
      'document:DOMContentLoaded',
      'window:DOMContentLoaded',
      'after',
    ]);

    await runNextIdle();

    expect(events.slice(-2)).toEqual(['document:readystatechange', 'window:load']);
    await expect(start).resolves.toBeUndefined();
    expect(idleTasks).toHaveLength(0);
    expect(sandbox.execQueue).toHaveLength(0);
  });

  it.each([false, true])(
    'waits for an async download and native completion before load with fiber=%s',
    async (fiber) => {
      const { sandbox, iframeWindow, events, drainIdle } = createLifecycleHarness(fiber);
      let resolveContent: (content: string) => void = () => {
        throw new Error('The download has not been initialized');
      };
      const contentPromise = new Promise<string>((resolve) => {
        resolveContent = resolve;
      });
      let settled = false;
      const start = sandbox
        .start(() => [{ src: 'https://child.example/async.js', async: true, contentPromise }])
        .then(() => {
          settled = true;
        });
      await drainIdle();

      expect(events).toEqual(['mount', 'document:DOMContentLoaded', 'window:DOMContentLoaded']);
      expect(settled).toBe(false);
      expect(iframeWindow.document.querySelector('script[src]')).toBeNull();

      // Empty fetched content selects the native src fallback; start must also
      // wait for that script's real completion signal, not only its download.
      resolveContent('');
      await drainIdle();
      const injected = iframeWindow.document.querySelector('script[src]');
      expect(injected).not.toBeNull();
      expect(events).not.toContain('window:load');
      expect(settled).toBe(false);

      injected?.dispatchEvent(new iframeWindow.Event('load'));
      await drainIdle();

      expect(events).toEqual([
        'mount',
        'document:DOMContentLoaded',
        'window:DOMContentLoaded',
        'document:readystatechange',
        'window:load',
      ]);
      await expect(start).resolves.toBeUndefined();
      expect(settled).toBe(true);
      expect(sandbox.execQueue).toHaveLength(0);
    },
  );

  it('keeps the non-fiber microtask checkpoint so DOMContentLoaded can deactivate before load', async () => {
    const { sandbox, iframeWindow, events } = createLifecycleHarness(false);
    vi.spyOn(utils, 'eventTrigger').mockImplementation((target, eventName) => {
      events.push(`${target === iframeWindow.document ? 'document' : 'window'}:${eventName}`);
      if (target === iframeWindow.document && eventName === 'DOMContentLoaded') {
        queueMicrotask(() => {
          sandbox.activeFlag = false;
        });
      }
    });

    await expect(sandbox.start(() => [])).resolves.toBeUndefined();

    expect(events).toEqual(['mount', 'document:DOMContentLoaded', 'window:DOMContentLoaded']);
    expect(sandbox.activeFlag).toBe(false);
    expect(sandbox.execQueue).toHaveLength(0);
  });
});
