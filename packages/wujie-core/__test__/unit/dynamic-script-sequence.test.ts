import { addSandboxCacheWithWujie, idToSandboxCacheMap } from "../../src/common";
import { clearAssetsCache } from "../../src/entry";
import { patchRenderEffect } from "../../src/effect";
import { cancelSandboxDynamicResources, cancelSandboxDynamicScripts } from "../../src/sandbox-runtime";
import type Wujie from "../../src/sandbox";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function scriptResponse(content: string): Response {
  return {
    status: 200,
    text: () => Promise.resolve(content),
  } as unknown as Response;
}

function createRenderRoot(): ShadowRoot {
  const root = document.createElement("div").attachShadow({ mode: "open" });
  const head = document.createElement("head");
  const body = document.createElement("body");
  root.append(head, body);
  root.head = head;
  root.body = body;
  return root;
}

function createSandbox(id: string, fetch: (input: RequestInfo) => Promise<Response>): Wujie {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const iframeWindow = iframe.contentWindow as Window;
  const sandbox = {
    id,
    iframe,
    destroyed: false,
    alive: false,
    activeFlag: true,
    plugins: [],
    fetch,
    lifecycles: {},
    fiber: false,
    assetCacheScope: {},
    execQueue: [],
    proxyLocation: {
      protocol: "https:",
      host: `${id}.example`,
      pathname: "/index.html",
    },
    replace: (code: string) => code,
    degrade: false,
    proxy: iframeWindow,
    styleSheetElements: [],
    dynamicScriptElements: [],
    deferredStyleObservers: [],
  } as unknown as Wujie;

  Reflect.set(iframeWindow, "__WUJIE", sandbox);
  addSandboxCacheWithWujie(id, sandbox);
  return sandbox;
}

function appendExternalScript(root: ShadowRoot, src: string, onload: () => void): void {
  const script = document.createElement("script");
  script.src = src;
  script.onload = onload;
  root.head.appendChild(script);
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("dynamic script sequencing", () => {
  beforeEach(() => {
    clearAssetsCache();
    idToSandboxCacheMap.clear();
    document.body.innerHTML = "";
  });

  test("a pending fetch in one app does not block another app", async () => {
    const pending = deferred<Response>();
    const firstRoot = createRenderRoot();
    const secondRoot = createRenderRoot();
    createSandbox("pending-app", () => pending.promise);
    createSandbox("ready-app", () => Promise.resolve(scriptResponse("/* ready */")));
    patchRenderEffect(firstRoot, "pending-app", false);
    patchRenderEffect(secondRoot, "ready-app", false);
    const firstLoaded = jest.fn();
    const secondLoaded = jest.fn();

    appendExternalScript(firstRoot, "https://assets.example/pending.js", firstLoaded);
    appendExternalScript(secondRoot, "https://assets.example/ready.js", secondLoaded);
    await flushPromises();

    expect(firstLoaded).not.toHaveBeenCalled();
    expect(secondLoaded).toHaveBeenCalledTimes(1);
  });

  test("a cancelled same-name generation cannot hold its replacement behind a stale request", async () => {
    const pending = deferred<Response>();
    const staleRoot = createRenderRoot();
    const staleSandbox = createSandbox("same-name", () => pending.promise);
    patchRenderEffect(staleRoot, "same-name", false);
    const staleLoaded = jest.fn();
    appendExternalScript(staleRoot, "https://assets.example/stale.js", staleLoaded);

    cancelSandboxDynamicScripts(staleSandbox);
    staleSandbox.destroyed = true;
    const replacementRoot = createRenderRoot();
    createSandbox("same-name", () => Promise.resolve(scriptResponse("/* replacement */")));
    patchRenderEffect(replacementRoot, "same-name", false);
    const replacementLoaded = jest.fn();
    appendExternalScript(replacementRoot, "https://assets.example/replacement.js", replacementLoaded);
    await flushPromises();

    expect(staleLoaded).not.toHaveBeenCalled();
    expect(replacementLoaded).toHaveBeenCalledTimes(1);

    pending.resolve(scriptResponse("/* stale */"));
    await flushPromises();
    expect(staleLoaded).not.toHaveBeenCalled();
  });

  test("external scripts from one sandbox still enqueue in insertion order", async () => {
    const firstResponse = deferred<Response>();
    const root = createRenderRoot();
    createSandbox("ordered-app", (input) =>
      String(input).endsWith("first.js")
        ? firstResponse.promise
        : Promise.resolve(scriptResponse("/* second */"))
    );
    patchRenderEffect(root, "ordered-app", false);
    const calls: string[] = [];

    appendExternalScript(root, "https://assets.example/first.js", () => calls.push("first"));
    appendExternalScript(root, "https://assets.example/second.js", () => calls.push("second"));
    await flushPromises();
    expect(calls).toEqual([]);

    firstResponse.resolve(scriptResponse("/* first */"));
    await flushPromises();
    expect(calls).toEqual(["first", "second"]);
  });

  test("a reusable unmount rejects a pending chunk and ignores its late response after remount", async () => {
    const pending = deferred<Response>();
    const root = createRenderRoot();
    const fetch = jest.fn(() => pending.promise);
    const sandbox = createSandbox("reusable-app", fetch);
    patchRenderEffect(root, "reusable-app", false);
    const loaded = jest.fn();
    const failed = jest.fn();
    const retryFailed = jest.fn();
    const script = document.createElement("script");
    script.src = "https://assets.example/chunk.js";
    script.onload = loaded;
    script.onerror = () => {
      failed();
      // Re-enter cancellation and synchronously retry like a chunk loader.
      // The retry sees inactive state and must not escape this generation.
      cancelSandboxDynamicResources(sandbox, "unmount");
      const retry = document.createElement("script");
      retry.src = "https://assets.example/retry.js";
      retry.onerror = retryFailed;
      root.head.appendChild(retry);
    };
    root.head.appendChild(script);

    sandbox.activeFlag = false;
    cancelSandboxDynamicResources(sandbox, "unmount");
    expect(failed).toHaveBeenCalledTimes(1);
    expect(loaded).not.toHaveBeenCalled();

    await flushPromises();
    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);

    sandbox.activeFlag = true;
    pending.resolve(scriptResponse("/* stale chunk */"));
    await flushPromises();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(loaded).not.toHaveBeenCalled();
  });

  test("unmount detaches a transformed module still waiting for native completion", async () => {
    const root = createRenderRoot();
    const sandbox = createSandbox("module-app", () => Promise.resolve(scriptResponse("export default 1")));
    patchRenderEffect(root, "module-app", false);
    const loaded = jest.fn();
    const failed = jest.fn();
    const script = document.createElement("script");
    script.type = "module";
    script.src = "https://assets.example/module.js";
    script.onload = loaded;
    script.onerror = failed;
    root.head.appendChild(script);
    await flushPromises();

    const injected = sandbox.dynamicScriptElements[0];
    expect(injected).toBeDefined();
    expect(injected.isConnected).toBe(true);
    expect(loaded).not.toHaveBeenCalled();

    sandbox.activeFlag = false;
    cancelSandboxDynamicResources(sandbox, "unmount");

    expect(injected.isConnected).toBe(false);
    expect(sandbox.dynamicScriptElements).toEqual([]);
    expect(failed).toHaveBeenCalledTimes(1);
    injected.dispatchEvent(new Event("load"));
    expect(loaded).not.toHaveBeenCalled();
  });

  test("an inline module uses native module completion and forwards its error", async () => {
    const root = createRenderRoot();
    const sandbox = createSandbox("inline-module-app", () => Promise.resolve(scriptResponse("/* next */")));
    patchRenderEffect(root, "inline-module-app", false);
    const loaded = jest.fn();
    const failed = jest.fn();
    const nextLoaded = jest.fn();
    const moduleScript = document.createElement("script");
    moduleScript.type = "module";
    moduleScript.textContent = "export default 1";
    moduleScript.onload = loaded;
    moduleScript.onerror = failed;

    root.head.appendChild(moduleScript);
    appendExternalScript(root, "https://assets.example/after-inline-module.js", nextLoaded);
    await flushPromises();

    const injectedModule = sandbox.dynamicScriptElements[0];
    expect(injectedModule).toBeDefined();
    expect(injectedModule.getAttribute("type")).toBe("module");
    expect(injectedModule.textContent).toContain("export default 1");
    expect(injectedModule.textContent).not.toContain(".bind(window.__WUJIE.proxy)");
    expect(loaded).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(nextLoaded).not.toHaveBeenCalled();

    injectedModule.dispatchEvent(new Event("error"));
    await flushPromises();

    expect(failed).toHaveBeenCalledTimes(1);
    expect(loaded).not.toHaveBeenCalled();
    expect(nextLoaded).toHaveBeenCalledTimes(1);
  });

  test.each(["load", "error"] as const)(
    "fiber keeps a following classic script behind inline module native %s",
    (outcome) => {
      const root = createRenderRoot();
      const sandbox = createSandbox("fiber-inline-module-app", () =>
        Promise.resolve(scriptResponse("/* unused */"))
      );
      const idleCallbacks: Array<() => unknown> = [];
      sandbox.fiber = true;
      sandbox.requestIdleCallback = (callback): number => {
        idleCallbacks.push(() => callback.call(sandbox));
        return idleCallbacks.length;
      };
      patchRenderEffect(root, "fiber-inline-module-app", false);
      const moduleScript = document.createElement("script");
      moduleScript.type = "module";
      moduleScript.textContent = "export const fiberModuleA = true";
      const classicScript = document.createElement("script");
      classicScript.textContent = "window.__fiberClassicB = true";

      root.head.appendChild(moduleScript);
      root.head.appendChild(classicScript);

      expect(idleCallbacks).toHaveLength(1);
      idleCallbacks.shift()?.();
      expect(sandbox.dynamicScriptElements).toHaveLength(1);
      expect(sandbox.dynamicScriptElements[0].getAttribute("type")).toBe("module");
      expect(idleCallbacks).toEqual([]);

      sandbox.dynamicScriptElements[0].dispatchEvent(new Event(outcome));

      expect(sandbox.dynamicScriptElements).toHaveLength(1);
      expect(idleCallbacks).toHaveLength(1);
      idleCallbacks.shift()?.();
      expect(sandbox.dynamicScriptElements).toHaveLength(2);
      expect(sandbox.dynamicScriptElements[1].textContent).toContain("window.__fiberClassicB = true");
    }
  );

  test("a native retry after an external script HTTP failure forwards error, never load", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const root = createRenderRoot();
    const sandbox = createSandbox("native-script-error", () =>
      Promise.resolve({
        status: 503,
        text: () => Promise.resolve("unavailable"),
      } as Response)
    );
    patchRenderEffect(root, "native-script-error", false);
    const loaded = jest.fn();
    const failed = jest.fn();
    const script = document.createElement("script");
    script.src = "https://assets.example/unavailable.js";
    script.onload = loaded;
    script.onerror = failed;

    root.head.appendChild(script);
    await flushPromises();

    const nativeRetry = sandbox.dynamicScriptElements[0];
    expect(nativeRetry).toBeDefined();
    expect(nativeRetry.src).toBe(script.src);
    expect(loaded).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();

    nativeRetry.dispatchEvent(new Event("error"));
    await flushPromises();

    expect(failed).toHaveBeenCalledTimes(1);
    expect(loaded).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  test("a throwing jsLoader reports error and advances an occupied execution lane", async () => {
    const root = createRenderRoot();
    const sandbox = createSandbox("dynamic-loader-error", () =>
      Promise.resolve(scriptResponse("window.__dynamic_loader_ran__ = true"))
    );
    sandbox.plugins = [
      {
        jsLoader: (): never => {
          throw new Error("transform failed");
        },
      },
    ];
    patchRenderEffect(root, "dynamic-loader-error", false);
    const failed = jest.fn();
    const next = jest.fn();
    const releaseDynamicTask = (): void => {
      sandbox.execQueue.shift()?.();
    };
    sandbox.execQueue.push(releaseDynamicTask);

    const script = document.createElement("script");
    script.src = "https://assets.example/loader-error.js";
    script.onerror = failed;
    root.head.appendChild(script);
    await flushPromises();
    sandbox.execQueue.push(next);

    expect(sandbox.execQueue).toHaveLength(3);
    sandbox.execQueue.shift()?.();
    await flushPromises();

    expect(failed).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(sandbox.execQueue).toHaveLength(0);
  });

  test("unmount resets native-pending and queued scripts before a remounted generation", async () => {
    const root = createRenderRoot();
    const sandbox = createSandbox("reset-dynamic-lane", () => Promise.resolve(scriptResponse("/* ready */")));
    patchRenderEffect(root, "reset-dynamic-lane", false);
    const pendingModule = document.createElement("script");
    pendingModule.type = "module";
    pendingModule.src = "https://assets.example/pending-module.js";
    const queuedLoaded = jest.fn();
    const remountedLoaded = jest.fn();

    root.head.appendChild(pendingModule);
    appendExternalScript(root, "https://assets.example/queued.js", queuedLoaded);
    await flushPromises();

    expect(sandbox.dynamicScriptElements).toHaveLength(1);
    expect(sandbox.execQueue).toHaveLength(2);
    expect(queuedLoaded).not.toHaveBeenCalled();

    sandbox.activeFlag = false;
    cancelSandboxDynamicResources(sandbox, "unmount");
    expect(sandbox.execQueue).toEqual([]);
    expect(sandbox.dynamicScriptElements).toEqual([]);

    sandbox.activeFlag = true;
    appendExternalScript(root, "https://assets.example/remounted.js", remountedLoaded);
    await flushPromises();

    expect(queuedLoaded).not.toHaveBeenCalled();
    expect(remountedLoaded).toHaveBeenCalledTimes(1);
  });

  test("a cssLoader that synchronously unmounts cannot resurrect its placeholder", async () => {
    const root = createRenderRoot();
    const sandbox = createSandbox("css-loader-unmount", () =>
      Promise.resolve(scriptResponse("body { color: rebeccapurple; }"))
    );
    const cssLoader = jest.fn((content: string) => {
      sandbox.activeFlag = false;
      cancelSandboxDynamicResources(sandbox, "unmount");
      return content;
    });
    sandbox.plugins = [{ cssLoader }];
    patchRenderEffect(root, "css-loader-unmount", false);
    const loaded = jest.fn();
    const failed = jest.fn();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://assets.example/synchronously-unmounted.css";
    link.onload = loaded;
    link.onerror = failed;

    root.head.appendChild(link);
    await flushPromises();

    expect(cssLoader).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(loaded).not.toHaveBeenCalled();
    expect(sandbox.styleSheetElements).toEqual([]);
    expect(root.head.querySelector("style[data-wujie-css-href]")).toBeNull();
  });

  test("a reusable unmount rejects both fetching and deferred dynamic styles", async () => {
    const pending = deferred<Response>();
    const fetch = jest.fn(() => pending.promise);
    const root = createRenderRoot();
    const sandbox = createSandbox("style-app", fetch);
    patchRenderEffect(root, "style-app", false);
    const fetchingFailed = jest.fn();
    const fetchingLoaded = jest.fn();
    const fetchingLink = document.createElement("link");
    fetchingLink.rel = "stylesheet";
    fetchingLink.href = "https://assets.example/theme.css";
    fetchingLink.onerror = fetchingFailed;
    fetchingLink.onload = fetchingLoaded;
    root.head.appendChild(fetchingLink);

    const deferredFailed = jest.fn();
    const deferredLink = document.createElement("link");
    deferredLink.rel = "stylesheet";
    deferredLink.onerror = deferredFailed;
    root.head.appendChild(deferredLink);

    sandbox.activeFlag = false;
    cancelSandboxDynamicResources(sandbox, "unmount");
    expect(fetchingFailed).toHaveBeenCalledTimes(1);
    expect(deferredFailed).toHaveBeenCalledTimes(1);

    sandbox.activeFlag = true;
    deferredLink.href = "https://assets.example/deferred.css";
    pending.resolve(scriptResponse("body { color: green; }"));
    await flushPromises();
    expect(fetchingLoaded).not.toHaveBeenCalled();
    expect(fetchingFailed).toHaveBeenCalledTimes(1);
    expect(deferredFailed).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
