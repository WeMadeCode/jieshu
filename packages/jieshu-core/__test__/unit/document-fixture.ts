import { EventCleanupTracker } from '../../src/tracker';
import type { EventListenerHook } from '../../src/contracts';

const fixtures: Array<{ iframe: HTMLIFrameElement; tracker: EventCleanupTracker }> = [];

export const createDocumentFixture = () => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const childWindow = iframe.contentWindow;
  if (!childWindow) {
    throw new Error('Document patch tests require a child window');
  }
  const childDocument = childWindow.document;
  const host = document.createElement('section');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  const root = document.createElement('main');
  shadowRoot.appendChild(root);
  const plugin = {
    documentAddEventListenerHook: vi.fn<EventListenerHook>(),
    documentRemoveEventListenerHook: vi.fn<EventListenerHook>(),
    documentPropertyOverride: vi.fn<(iframeWindow: Window) => void>(),
  };
  const sandbox = {
    plugins: [plugin],
    shadowRoot,
    proxyDocument: {},
    eventCleanupTracker: new EventCleanupTracker(),
  };
  Reflect.set(childWindow, '__JIESHU', sandbox);
  fixtures.push({ iframe, tracker: sandbox.eventCleanupTracker });
  return { childWindow, childDocument, sandbox, root, plugin };
};

export const cleanupDocumentFixtures = () => {
  for (const { iframe, tracker } of fixtures.splice(0)) {
    tracker.cleanupAll();
    iframe.remove();
  }
  vi.restoreAllMocks();
};
