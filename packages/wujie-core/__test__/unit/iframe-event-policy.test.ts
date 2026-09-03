import Wujie from "../../src/sandbox";
import { isWindowEventAllowedByPolicy, patchIframeEvents } from "../../src/iframe";

interface TestFeaturePolicy {
  allowsFeature(feature: string): boolean;
  features(): ReadonlyArray<string>;
}

type TestPolicyDocument = Document & {
  featurePolicy?: TestFeaturePolicy;
  permissionsPolicy?: TestFeaturePolicy;
};

function createIframeWindow(): Window {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  if (!iframe.contentWindow) throw new Error("Expected iframe window");
  return iframe.contentWindow;
}

function installFeaturePolicy(targetWindow: Window, policy: TestFeaturePolicy): void {
  Object.defineProperty(targetWindow.document as TestPolicyDocument, "featurePolicy", {
    configurable: true,
    value: policy,
  });
}

function installSandbox(targetWindow: Window): void {
  const sandbox = Object.create(Wujie.prototype) as Wujie;
  sandbox.plugins = [];
  sandbox.iframeAddEventListeners = [];
  targetWindow.__WUJIE = sandbox;
}

describe("iframe window event permissions policy", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("keeps existing behavior for other events and browsers without policy inspection", () => {
    const iframeWindow = createIframeWindow();

    expect(isWindowEventAllowedByPolicy(iframeWindow, "pagehide")).toBe(true);
    expect(isWindowEventAllowedByPolicy(iframeWindow, "unload")).toBe(true);
  });

  test("keeps unload behavior when the browser does not recognize the policy feature", () => {
    const iframeWindow = createIframeWindow();
    const allowsFeature = jest.fn(() => false);
    installFeaturePolicy(iframeWindow, {
      allowsFeature,
      features: () => ["camera"],
    });

    expect(isWindowEventAllowedByPolicy(iframeWindow, "unload")).toBe(true);
    expect(allowsFeature).not.toHaveBeenCalled();
  });

  test("does not call the native unload registration when policy blocks it", () => {
    const iframeWindow = createIframeWindow();
    const allowsFeature = jest.fn(() => false);
    installFeaturePolicy(iframeWindow, {
      allowsFeature,
      features: () => ["unload"],
    });
    installSandbox(iframeWindow);
    patchIframeEvents(iframeWindow);
    const listener = jest.fn();

    iframeWindow.addEventListener("unload", listener);
    iframeWindow.dispatchEvent(new iframeWindow.Event("unload"));

    expect(allowsFeature).toHaveBeenCalledWith("unload");
    expect(listener).not.toHaveBeenCalled();
    expect(iframeWindow.__WUJIE_EVENTLISTENER__.size).toBe(1);

    iframeWindow.removeEventListener("unload", listener);
    expect(iframeWindow.__WUJIE_EVENTLISTENER__.size).toBe(0);
  });

  test("blocks onunload handler assignment but still permits clearing it", () => {
    const iframeWindow = createIframeWindow();
    installFeaturePolicy(iframeWindow, {
      allowsFeature: () => false,
      features: () => ["unload"],
    });
    installSandbox(iframeWindow);
    patchIframeEvents(iframeWindow);
    const listener = jest.fn();

    iframeWindow.onunload = listener;
    iframeWindow.dispatchEvent(new iframeWindow.Event("unload"));
    expect(listener).not.toHaveBeenCalled();
    expect(iframeWindow.onunload).toBeNull();

    expect(() => {
      iframeWindow.onunload = null;
    }).not.toThrow();
  });

  test("registers and removes unload normally when policy allows it", () => {
    const iframeWindow = createIframeWindow();
    installFeaturePolicy(iframeWindow, {
      allowsFeature: () => true,
      features: () => ["unload"],
    });
    installSandbox(iframeWindow);
    patchIframeEvents(iframeWindow);
    const listener = jest.fn();

    iframeWindow.addEventListener("unload", listener);
    iframeWindow.dispatchEvent(new iframeWindow.Event("unload"));
    iframeWindow.removeEventListener("unload", listener);
    iframeWindow.dispatchEvent(new iframeWindow.Event("unload"));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(iframeWindow.__WUJIE_EVENTLISTENER__.size).toBe(0);
  });

  test("keeps onunload assignment behavior when policy allows it", () => {
    const iframeWindow = createIframeWindow();
    installFeaturePolicy(iframeWindow, {
      allowsFeature: () => true,
      features: () => ["unload"],
    });
    installSandbox(iframeWindow);
    patchIframeEvents(iframeWindow);
    const listener = jest.fn();

    iframeWindow.onunload = listener;
    iframeWindow.dispatchEvent(new iframeWindow.Event("unload"));
    iframeWindow.onunload = null;
    iframeWindow.dispatchEvent(new iframeWindow.Event("unload"));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("keeps page lifecycle events on the child iframe", () => {
    const iframeWindow = createIframeWindow();
    installSandbox(iframeWindow);
    patchIframeEvents(iframeWindow);
    const listener = jest.fn();

    iframeWindow.addEventListener("pagehide", listener);
    window.dispatchEvent(new Event("pagehide"));
    expect(listener).not.toHaveBeenCalled();

    iframeWindow.dispatchEvent(new iframeWindow.Event("pagehide"));
    expect(listener).toHaveBeenCalledTimes(1);

    iframeWindow.removeEventListener("pagehide", listener);
    iframeWindow.dispatchEvent(new iframeWindow.Event("pagehide"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
