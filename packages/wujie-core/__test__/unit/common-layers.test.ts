import {
  appDocumentAddEventListenerEvents,
  appWindowOnEvent,
  documentProxyProperties,
  rawAppendChild,
  rawDocumentQuerySelector,
} from "../../src/common";
import { nativeDomCapabilities } from "../../src/native-dom";
import { sandboxEventPolicy } from "../../src/sandbox-policy";

describe("common compatibility layers", () => {
  test("event exports are aliases of the grouped sandbox policy", () => {
    expect(appDocumentAddEventListenerEvents).toBe(sandboxEventPolicy.document.iframeListeners);
    expect(appWindowOnEvent).toBe(sandboxEventPolicy.window.iframeProperties);
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
});
