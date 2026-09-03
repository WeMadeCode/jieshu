import type Wujie from "../../src/sandbox";
import { recordEventListeners, recoverEventListeners } from "../../src/iframe";

interface TrackedRealm {
  iframeWindow: Window;
  nativeRemoveEventListener: typeof Node.prototype.removeEventListener;
  sandbox: Wujie;
}

function createTrackedRealm(): TrackedRealm {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) throw new Error("iframe window is unavailable");

  const nativeRemoveEventListener = iframeWindow.Node.prototype.removeEventListener;
  const sandbox = {
    elementEventCacheMap: new WeakMap(),
  } as unknown as Wujie;
  iframeWindow.__WUJIE = sandbox;
  recordEventListeners(iframeWindow);
  return { iframeWindow, nativeRemoveEventListener, sandbox };
}

function dispatchClick(element: Element): void {
  const event = element.ownerDocument.createEvent("Event");
  event.initEvent("click", true, true);
  element.dispatchEvent(event);
}

describe("degradation-mode element listener recovery", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("restores the same callback registered for both capture phases", () => {
    const { iframeWindow, nativeRemoveEventListener, sandbox } = createTrackedRealm();
    const element = iframeWindow.document.createElement("button");
    const listener = jest.fn();

    element.addEventListener("click", listener, false);
    element.addEventListener("click", listener, true);
    expect(sandbox.elementEventCacheMap.get(element)).toHaveLength(2);

    Reflect.apply(nativeRemoveEventListener, element, ["click", listener, false]);
    Reflect.apply(nativeRemoveEventListener, element, ["click", listener, true]);
    recoverEventListeners(element, iframeWindow);
    dispatchClick(element);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("removing an unknown listener preserves cached listeners for recovery", () => {
    const { iframeWindow, nativeRemoveEventListener, sandbox } = createTrackedRealm();
    const element = iframeWindow.document.createElement("button");
    const retainedListener = jest.fn();
    const unknownListener = jest.fn();

    element.addEventListener("click", retainedListener, { capture: false, passive: true });
    element.removeEventListener("click", unknownListener, { capture: false });
    expect(sandbox.elementEventCacheMap.get(element)).toEqual([
      expect.objectContaining({ handler: retainedListener }),
    ]);

    Reflect.apply(nativeRemoveEventListener, element, ["click", retainedListener, false]);
    recoverEventListeners(element, iframeWindow);
    dispatchClick(element);

    expect(retainedListener).toHaveBeenCalledTimes(1);
  });
});
