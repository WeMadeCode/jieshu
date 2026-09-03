import {
  appDocumentAddEventListenerEvents,
  appWindowAddEventListenerEvents,
  appWindowOnEvent,
  documentProxyProperties,
  rawAppendChild,
  rawDocumentQuerySelector,
} from "../../src/common";
import { nativeDomCapabilities } from "../../src/native-dom";
import { sandboxEventPolicy, shouldHandlePageHideTeardown } from "../../src/sandbox-policy";

describe("common compatibility layers", () => {
  test("event exports are aliases of the grouped sandbox policy", () => {
    expect(appDocumentAddEventListenerEvents).toBe(sandboxEventPolicy.document.iframeListeners);
    expect(appWindowOnEvent).toBe(sandboxEventPolicy.window.iframeProperties);
    expect(appWindowAddEventListenerEvents).toEqual(expect.arrayContaining(["pagehide", "pageshow"]));
    expect(appWindowOnEvent).toEqual(expect.arrayContaining(["onpagehide", "onpageshow"]));
    expect(documentProxyProperties.documentEvents).toContain("onvisibilitychange");
  });

  test("raw DOM exports come from one eager capability snapshot", () => {
    expect(rawAppendChild).toBe(nativeDomCapabilities.appendChild);
    expect(rawDocumentQuerySelector).toBe(nativeDomCapabilities.documentQuerySelector);

    const parent = document.createElement("div");
    const child = document.createElement("span");
    rawAppendChild.call(parent, child);
    expect(parent.firstChild).toBe(child);
  });

  test("pagehide teardown ignores documents preserved in the back-forward cache", () => {
    expect(shouldHandlePageHideTeardown({ persisted: true })).toBe(false);
    expect(shouldHandlePageHideTeardown({ persisted: false })).toBe(true);
  });
});
