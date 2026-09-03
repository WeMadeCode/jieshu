import type Wujie from "../../src/sandbox";
import { localGenerator, proxyGenerator } from "../../src/proxy";

function createIframe(src?: string): { iframe: HTMLIFrameElement; iframeWindow: Window } {
  const iframe = document.createElement("iframe");
  if (src) iframe.src = src;
  document.body.appendChild(iframe);
  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow || !iframe.contentDocument) throw new Error("iframe document is unavailable");

  iframeWindow.__WUJIE_RAW_DOCUMENT_QUERY_SELECTOR__ = iframeWindow.Document.prototype.querySelector;
  iframeWindow.__WUJIE_RAW_DOCUMENT_QUERY_SELECTOR_ALL__ = iframeWindow.Document.prototype.querySelectorAll;
  iframeWindow.__WUJIE_RAW_DOCUMENT_CREATE_ELEMENT__ = iframeWindow.Document.prototype.createElement;
  iframeWindow.__WUJIE_RAW_DOCUMENT_CREATE_TEXT_NODE__ = iframeWindow.Document.prototype.createTextNode;
  iframeWindow.__WUJIE_RAW_DOCUMENT_HEAD__ = iframeWindow.document.head;
  return { iframe, iframeWindow };
}

function createSandbox(document: Document, shadowRoot: ShadowRoot): Wujie {
  return {
    id: "child-app",
    shadowRoot,
    document,
    degrade: false,
    degradeAttrs: {},
    hrefFlag: false,
    proxyLocation: { href: "https://child.example/initial" },
  } as unknown as Wujie;
}

describe("proxy generators", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("proxyGenerator routes document and location properties through their resolvers", () => {
    const { iframe, iframeWindow } = createIframe();
    iframeWindow.document.body.innerHTML = '<div class="iframe-only"></div>';
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = '<html><body><div class="shadow-only"></div><form></form></body></html>';
    const sandbox = createSandbox(iframeWindow.document, shadowRoot);
    iframeWindow.__WUJIE = sandbox;

    const urlElement = document.createElement("a");
    urlElement.href = "https://child.example:9443/entry";
    const generated = proxyGenerator(iframe, urlElement, iframeWindow.location.href, "https://child.example:9443/");
    sandbox.proxy = generated.proxyWindow;
    sandbox.proxyLocation = generated.proxyLocation;

    const proxyDocument = generated.proxyDocument as Document;
    expect(proxyDocument.URL).toBe("https://child.example:9443/");
    expect(proxyDocument.querySelector.call(iframeWindow.document, ".shadow-only")).not.toBeNull();
    expect(proxyDocument.querySelector.call(iframeWindow.document, ".iframe-only")).not.toBeNull();
    expect(proxyDocument.forms).toHaveLength(1);

    const proxyLocation = generated.proxyLocation as Location;
    expect(proxyLocation.host).toBe("child.example:9443");
    expect(proxyLocation.origin).toBe("https://child.example:9443");
    expect(proxyLocation.href).toBe("https://child.example:9443/");
    expect(proxyLocation.toString()).toBe(proxyLocation.href);
    expect(String(proxyLocation)).toBe(proxyLocation.href);
  });

  test.each([
    ["next", "https://child.example:9443/catalog/item/next"],
    ["?q=1", "https://child.example:9443/catalog/item/index.html?q=1"],
  ])("proxy location href resolves %s from the current child route", (destination, expectedHref) => {
    const { iframe, iframeWindow } = createIframe("/catalog/item/index.html?old=1#section");

    const container = document.createElement("div");
    const host = document.createElement("div");
    container.appendChild(host);
    document.body.appendChild(container);
    const shadowRoot = host.attachShadow({ mode: "open" });
    const sandbox = createSandbox(iframeWindow.document, shadowRoot);
    iframeWindow.__WUJIE = sandbox;

    const urlElement = document.createElement("a");
    urlElement.href = "https://child.example:9443/catalog/item/index.html?old=1#section";
    const generated = proxyGenerator(iframe, urlElement, window.location.origin, "https://child.example:9443");
    sandbox.proxy = generated.proxyWindow;
    sandbox.proxyLocation = generated.proxyLocation;

    generated.proxyLocation.href = destination;

    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(expectedHref);
  });

  test("proxyGenerator revokes all three native proxies", () => {
    const { iframe, iframeWindow } = createIframe();
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = "<html><body></body></html>";
    const sandbox = createSandbox(iframeWindow.document, shadowRoot);
    iframeWindow.__WUJIE = sandbox;
    const generated = proxyGenerator(
      iframe,
      document.createElement("a"),
      iframeWindow.location.href,
      "https://child.example/"
    );
    sandbox.proxy = generated.proxyWindow;
    sandbox.proxyLocation = generated.proxyLocation;

    generated.proxyRevoke();

    expect(() => Reflect.get(generated.proxyWindow, "location")).toThrow(TypeError);
    expect(() => Reflect.get(generated.proxyDocument, "URL")).toThrow(TypeError);
    expect(() => Reflect.get(generated.proxyLocation, "href")).toThrow(TypeError);
  });

  test("localGenerator descriptors release dynamic DOM references on revoke", () => {
    const { iframe, iframeWindow } = createIframe();
    const renderDocument = document.implementation.createHTMLDocument("child");
    renderDocument.body.innerHTML = '<div id="from-render-document"></div>';
    const host = document.createElement("div");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const sandbox = createSandbox(renderDocument, shadowRoot);
    iframeWindow.__WUJIE = sandbox;
    const urlElement = document.createElement("a");
    urlElement.href = "https://child.example:9443/entry";
    const generated = localGenerator(iframe, urlElement, iframeWindow.location.href, "https://child.example:9443/");
    sandbox.proxyLocation = generated.proxyLocation;

    const proxyDocument = generated.proxyDocument as Document;
    const proxyLocation = generated.proxyLocation as Location;
    expect(proxyDocument.getElementById("from-render-document")).not.toBeNull();
    expect(proxyDocument.URL).toBe("https://child.example:9443/");
    expect(proxyLocation.host).toBe("child.example:9443");
    expect(proxyLocation.origin).toBe("https://child.example:9443");
    expect(proxyLocation.href).toBe("https://child.example:9443/");
    expect(proxyLocation.toString()).toBe(proxyLocation.href);
    expect(String(proxyLocation)).toBe(proxyLocation.href);

    generated.proxyRevoke();

    expect(proxyDocument.URL).toBeUndefined();
    expect(proxyDocument.readyState).toBeUndefined();
    expect(proxyLocation.href).toBeUndefined();
    expect(proxyLocation.host).toBe("child.example:9443");
    expect(proxyLocation.origin).toBe("https://child.example:9443");
    expect(() => proxyDocument.getElementById("from-render-document")).toThrow(TypeError);
  });
});
