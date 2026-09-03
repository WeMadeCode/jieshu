import type { ScriptObject } from "./template";
import type { ScriptObjectLoader } from "./contracts";
import { getWujieById, rawDocumentQuerySelector } from "./common";
import { getJsLoader } from "./plugin";
import { registerSandboxDynamicResource } from "./sandbox-runtime";
import { WUJIE_TIPS_SCRIPT_ERROR_REQUESTED } from "./constant";
import { error, execHooks, getCurUrl, getTagFromScript, setTagToScript } from "./utils";

type ScriptInput = ScriptObject | ScriptObjectLoader;

interface NormalizedScriptInput {
  readonly source: ScriptInput;
  readonly src?: string;
  readonly module?: boolean;
  readonly content?: string;
  readonly crossorigin?: boolean;
  readonly crossoriginType?: "anonymous" | "use-credentials" | "";
  readonly async?: boolean;
  readonly attrs?: ScriptObjectLoader["attrs"];
  readonly callback?: ScriptObjectLoader["callback"];
  readonly onload?: () => void;
  readonly onerror?: () => void;
}

interface ScriptExecutionContext {
  readonly input: NormalizedScriptInput;
  readonly iframeWindow: Window;
  readonly owner: Window["__WUJIE"];
  readonly rawElement?: HTMLScriptElement;
  readonly scriptElement: HTMLScriptElement;
  readonly queueAdvancerElement: HTMLScriptElement;
  readonly container: HTMLHeadElement;
  readonly plugins: Window["__WUJIE"]["plugins"];
  code: string;
}

export interface ScriptExecutionHandle {
  readonly element: HTMLScriptElement;
  readonly completion: Promise<ScriptExecutionOutcome>;
  cancel(): void;
}

export type ScriptExecutionOutcome = "load" | "error" | "cancelled";

function normalizeScriptInput(source: ScriptInput): NormalizedScriptInput {
  return {
    source,
    src: source.src,
    module: source.module,
    content: source.content,
    crossorigin: source.crossorigin,
    crossoriginType: source.crossoriginType,
    async: source.async,
    attrs: source.attrs,
    callback: "callback" in source ? source.callback : undefined,
    onload: source.onload,
    onerror: source.onerror,
  };
}

function createExecutionContext(
  source: ScriptInput,
  iframeWindow: Window,
  rawElement?: HTMLScriptElement
): ScriptExecutionContext {
  const input = normalizeScriptInput(source);
  const scriptElement = iframeWindow.document.createElement("script");
  const queueAdvancerElement = iframeWindow.document.createElement("script");
  const owner = iframeWindow.__WUJIE;
  const { replace, plugins, proxyLocation } = owner;
  const jsLoader = getJsLoader({ plugins, replace });
  const container = rawDocumentQuerySelector.call(iframeWindow.document, "head") as HTMLHeadElement;
  const isImportMap = String(input.attrs?.type ?? "").toLowerCase() === "importmap";

  return {
    input,
    iframeWindow,
    owner,
    rawElement,
    scriptElement,
    queueAdvancerElement,
    container,
    plugins,
    // Import maps are JSON data, not JavaScript. A replace/jsLoader banner or
    // sourceURL suffix makes the browser reject the entire map.
    code: isImportMap ? input.content ?? "" : jsLoader(input.content ?? "", input.src ?? "", getCurUrl(proxyLocation)),
  };
}

function isExecutionOwnerCurrent(context: ScriptExecutionContext): boolean {
  const { owner } = context;
  return Boolean(
    context.iframeWindow.__WUJIE === owner &&
      !owner.destroyed &&
      owner.activeFlag !== false &&
      (!owner.id || getWujieById(owner.id) === owner)
  );
}

function applyForwardedAttributes(context: ScriptExecutionContext): void {
  const { attrs, source } = context.input;
  if (!attrs) return;
  const reservedKeys = new Set(Object.keys(source).map((key) => key.toLowerCase()));
  Object.keys(attrs)
    .filter((key) => !reservedKeys.has(key.toLowerCase()))
    .forEach((key) => context.scriptElement.setAttribute(key, String(attrs[key])));
}

function wrapInlineCode(code: string): string {
  return `(function(window, self, global, location) {
      ${code}
}).bind(window.__WUJIE.proxy)(
  window.__WUJIE.proxy,
  window.__WUJIE.proxy,
  window.__WUJIE.proxy,
  window.__WUJIE.proxyLocation,
);`;
}

function exposeInlineScriptSource(scriptElement: HTMLScriptElement, src?: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(scriptElement, "src");
  if (!descriptor?.configurable && descriptor) return;
  try {
    Object.defineProperty(scriptElement, "src", { get: () => src || "" });
  } catch (cause: unknown) {
    console.warn(cause);
  }
}

function configureScriptElement(context: ScriptExecutionContext): void {
  const { input, iframeWindow, scriptElement } = context;
  const isImportMap = String(input.attrs?.type ?? "").toLowerCase() === "importmap";
  applyForwardedAttributes(context);

  if (input.content) {
    if (!iframeWindow.__WUJIE.degrade && !input.module && !isImportMap) {
      context.code = wrapInlineCode(context.code);
    }
    exposeInlineScriptSource(scriptElement, input.src);
  } else {
    if (input.src) scriptElement.setAttribute("src", input.src);
    if (input.crossorigin) scriptElement.setAttribute("crossorigin", String(input.crossoriginType));
  }

  if (input.module) scriptElement.setAttribute("type", "module");
  scriptElement.textContent = context.code || "";
  context.queueAdvancerElement.textContent =
    "if(window.__WUJIE && window.__WUJIE.execQueue && window.__WUJIE.execQueue.length){ window.__WUJIE.execQueue.shift()()}";
}

function registerDynamicScript(context: ScriptExecutionContext): void {
  if (!context.rawElement) return;
  setTagToScript(context.scriptElement, getTagFromScript(context.rawElement) ?? undefined);
  const dynamicScripts = context.owner.dynamicScriptElements;
  if (Array.isArray(dynamicScripts)) dynamicScripts.push(context.scriptElement);
}

function unregisterDynamicScript(context: ScriptExecutionContext): void {
  const dynamicScripts = context.owner.dynamicScriptElements;
  if (!Array.isArray(dynamicScripts)) return;
  const index = dynamicScripts.indexOf(context.scriptElement);
  if (index !== -1) dynamicScripts.splice(index, 1);
}

class IframeScriptExecutionPipeline {
  execute(source: ScriptInput, iframeWindow: Window, rawElement?: HTMLScriptElement): ScriptExecutionHandle {
    const context = createExecutionContext(source, iframeWindow, rawElement);
    let completed = false;
    let unregisterCancellation: (() => void) | undefined;
    let resolveCompletion!: (outcome: ScriptExecutionOutcome) => void;
    const completion = new Promise<ScriptExecutionOutcome>((resolve) => {
      resolveCompletion = resolve;
    });
    const handle: ScriptExecutionHandle = {
      element: context.scriptElement,
      completion,
      cancel: (): void => {
        if (completed) return;
        completed = true;
        unregisterCancellation?.();
        unregisterCancellation = undefined;
        context.scriptElement.onload = null;
        context.scriptElement.onerror = null;
        context.scriptElement.parentNode?.removeChild(context.scriptElement);
        context.queueAdvancerElement.parentNode?.removeChild(context.queueAdvancerElement);
        unregisterDynamicScript(context);
        resolveCompletion("cancelled");
      },
    };

    const advanceQueue = (): void => {
      if (!context.input.async && isExecutionOwnerCurrent(context)) {
        context.container.appendChild(context.queueAdvancerElement);
      }
    };
    const afterExecution = (outcome: Exclude<ScriptExecutionOutcome, "cancelled">): void => {
      if (completed) return;
      completed = true;
      unregisterCancellation?.();
      unregisterCancellation = undefined;
      try {
        if (isExecutionOwnerCurrent(context)) {
          if (outcome === "load") context.input.onload?.();
          else context.input.onerror?.();
        }
      } finally {
        context.scriptElement.onload = null;
        context.scriptElement.onerror = null;
        resolveCompletion(outcome);
        advanceQueue();
      }
    };

    // replace/jsLoader is user code and can synchronously unmount or destroy
    // the owner while the execution context is being created. Never append a
    // script after that lifecycle generation has relinquished ownership.
    if (!isExecutionOwnerCurrent(context)) {
      completed = true;
      resolveCompletion("cancelled");
      return handle;
    }
    configureScriptElement(context);
    if (!isExecutionOwnerCurrent(context)) {
      completed = true;
      resolveCompletion("cancelled");
      return handle;
    }

    if (/^<!DOCTYPE html/i.test(context.code)) {
      error(WUJIE_TIPS_SCRIPT_ERROR_REQUESTED, source);
      afterExecution("error");
      return handle;
    }

    registerDynamicScript(context);
    const waitsForNativeCompletion = context.input.module || (!context.input.content && Boolean(context.input.src));
    if (waitsForNativeCompletion) {
      context.scriptElement.onload = () => afterExecution("load");
      context.scriptElement.onerror = () => afterExecution("error");
      unregisterCancellation = registerSandboxDynamicResource(context.owner, () => handle.cancel());
    }

    context.container.appendChild(context.scriptElement);
    context.input.callback?.(iframeWindow);
    execHooks(context.plugins, "appendOrInsertElementHook", context.scriptElement, iframeWindow, rawElement);
    if (!waitsForNativeCompletion) afterExecution("load");
    return handle;
  }
}

const scriptExecutionPipeline = new IframeScriptExecutionPipeline();

export function insertScriptToIframe(
  scriptResult: ScriptInput,
  iframeWindow: Window,
  rawElement?: HTMLScriptElement
): ScriptExecutionHandle {
  return scriptExecutionPipeline.execute(scriptResult, iframeWindow, rawElement);
}
