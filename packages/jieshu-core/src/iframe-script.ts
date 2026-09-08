import type { ScriptObject } from './template';
import type { ScriptObjectLoader } from './contracts';
import { getJieshuById, rawDocumentQuerySelector, rawAddEventListener, rawRemoveEventListener } from './common';
import { getJsLoader } from './plugin';
import { isSandboxExecutionAllowed, registerSandboxDynamicResource } from './sandbox-runtime';
import { JIESHU_TIPS_SCRIPT_ERROR_REQUESTED } from './constant';
import { error, execHooks, getCurUrl, getTagFromScript, setTagToScript } from './utils';

type ScriptInput = ScriptObject | ScriptObjectLoader;

interface NormalizedScriptInput {
  readonly source: ScriptInput;
  readonly src?: string;
  readonly module?: boolean;
  readonly content?: string;
  readonly crossorigin?: boolean;
  readonly crossoriginType?: 'anonymous' | 'use-credentials' | '';
  readonly async?: boolean;
  readonly attrs?: ScriptObjectLoader['attrs'];
  readonly callback?: ScriptObjectLoader['callback'];
  readonly onload?: () => void;
  readonly onerror?: () => void;
}

interface ScriptExecutionContext {
  readonly input: NormalizedScriptInput;
  readonly iframeWindow: Window;
  readonly owner: Window['__JIESHU'];
  readonly rawElement?: HTMLScriptElement;
  readonly scriptElement: HTMLScriptElement;
  readonly queueAdvancerElement: HTMLScriptElement;
  readonly container: HTMLHeadElement;
  readonly plugins: Window['__JIESHU']['plugins'];
  code: string;
}

export interface ScriptExecutionHandle {
  readonly element: HTMLScriptElement;
  readonly completion: Promise<ScriptExecutionOutcome>;
  cancel(): void;
}

// Explicitly async inline modules have no browser completion event and do not
// occupy the serial queue. Their handle acknowledges scheduling, not evaluation.
export type ScriptExecutionOutcome = 'load' | 'error' | 'cancelled' | 'scheduled';

const moduleEventPrefix = `__jieshu_module_${Math.random().toString(36).slice(2)}_`;
let moduleEventSequence = 0;

const observeInlineModule = (context: ScriptExecutionContext, onReady: () => void, onError: () => void) => {
  const marker = context.iframeWindow.document.createElement('script');
  const eventName = `${moduleEventPrefix}${moduleEventSequence++}`;
  marker.type = 'module';
  marker.async = false;
  marker.nonce = context.scriptElement.nonce;
  marker.setAttribute('data-jieshu-module-completion', eventName);
  marker.textContent = `window.dispatchEvent(new Event(${JSON.stringify(eventName)}));`;
  marker.onerror = onError;
  // Both scripts join the browser's ordered list. The marker follows module
  // graph readiness and the start of evaluation, including parse/runtime errors.
  // Like an external module's load event, it does not await top-level await.
  context.scriptElement.async = false;
  rawAddEventListener.call(context.iframeWindow, eventName, onReady, { once: true });
  return {
    marker,
    dispose: () => {
      rawRemoveEventListener.call(context.iframeWindow, eventName, onReady);
      marker.onerror = null;
      marker.parentNode?.removeChild(marker);
    },
  };
};

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
    callback: 'callback' in source ? source.callback : undefined,
    onload: source.onload,
    onerror: source.onerror,
  };
}

function createExecutionContext(
  source: ScriptInput,
  iframeWindow: Window,
  rawElement?: HTMLScriptElement,
): ScriptExecutionContext {
  const input = normalizeScriptInput(source);
  const scriptElement = iframeWindow.document.createElement('script');
  const queueAdvancerElement = iframeWindow.document.createElement('script');
  const owner = iframeWindow.__JIESHU;
  const { replace, plugins, proxyLocation } = owner;
  const jsLoader = getJsLoader({ plugins, replace });
  const container = rawDocumentQuerySelector.call(iframeWindow.document, 'head') as HTMLHeadElement;
  const { type } = input.attrs ?? {};
  const isImportMap = String(type ?? '').toLowerCase() === 'importmap';

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
    code: isImportMap
      ? (input.content ?? '')
      : jsLoader(input.content ?? '', input.src ?? '', getCurUrl(proxyLocation)),
  };
}

const isExecutionOwnerCurrent = (context: ScriptExecutionContext) => {
  const { owner } = context;
  return Boolean(
    context.iframeWindow.__JIESHU === owner &&
    isSandboxExecutionAllowed(owner) &&
    (!owner.id || getJieshuById(owner.id) === owner),
  );
};

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
}).bind(window.__JIESHU.proxy)(
  window.__JIESHU.proxy,
  window.__JIESHU.proxy,
  window.__JIESHU.proxy,
  window.__JIESHU.proxyLocation,
);`;
}

function exposeInlineScriptSource(scriptElement: HTMLScriptElement, src?: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(scriptElement, 'src');
  if (!descriptor?.configurable && descriptor) return;
  try {
    Object.defineProperty(scriptElement, 'src', { get: () => src || '' });
  } catch (cause: unknown) {
    console.warn(cause);
  }
}

const configureScriptElement = (context: ScriptExecutionContext) => {
  const { input, scriptElement } = context;
  const { type } = input.attrs ?? {};
  const isImportMap = String(type ?? '').toLowerCase() === 'importmap';
  applyForwardedAttributes(context);
  if (input.module) {
    scriptElement.type = 'module';
  }

  if (input.content) {
    if (scriptElement.type.toLowerCase() !== 'module' && !isImportMap) {
      context.code = wrapInlineCode(context.code);
    }
    exposeInlineScriptSource(scriptElement, input.src);
  } else {
    if (input.src) {
      scriptElement.setAttribute('src', input.src);
    }
    if (input.crossorigin) {
      scriptElement.setAttribute('crossorigin', String(input.crossoriginType));
    }
  }

  scriptElement.textContent = context.code || '';
};

function configureQueueAdvancer(context: ScriptExecutionContext): void {
  context.queueAdvancerElement.textContent =
    'if(window.__JIESHU && window.__JIESHU.execQueue && window.__JIESHU.execQueue.length){ window.__JIESHU.execQueue.shift()()}';
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
  execute = (source: ScriptInput, iframeWindow: Window, rawElement?: HTMLScriptElement) => {
    const context = createExecutionContext(source, iframeWindow, rawElement);
    let completed = false;
    let unregisterCancellation: (() => void) | undefined;
    let inlineModuleObserver: ReturnType<typeof observeInlineModule> | undefined;
    let resolveCompletion: (outcome: ScriptExecutionOutcome) => void;
    const completion = new Promise<ScriptExecutionOutcome>((resolve) => {
      resolveCompletion = resolve;
    });
    const handle: ScriptExecutionHandle = {
      element: context.scriptElement,
      completion,
      cancel: () => {
        if (completed) {
          return;
        }
        completed = true;
        unregisterCancellation?.();
        unregisterCancellation = undefined;
        inlineModuleObserver?.dispose();
        inlineModuleObserver = undefined;
        context.scriptElement.onload = null;
        context.scriptElement.onerror = null;
        context.scriptElement.parentNode?.removeChild(context.scriptElement);
        context.queueAdvancerElement.parentNode?.removeChild(context.queueAdvancerElement);
        unregisterDynamicScript(context);
        resolveCompletion('cancelled');
      },
    };

    const advanceQueue = () => {
      // Dynamic scripts own a reservation in effect.ts and settle it there,
      // including cancellation. Only startup scripts use the native advancer.
      if (!rawElement && !context.input.async && isExecutionOwnerCurrent(context)) {
        context.container.appendChild(context.queueAdvancerElement);
      }
    };
    const afterExecution = (outcome: Exclude<ScriptExecutionOutcome, 'cancelled'>) => {
      if (completed) {
        return;
      }
      completed = true;
      unregisterCancellation?.();
      unregisterCancellation = undefined;
      inlineModuleObserver?.dispose();
      inlineModuleObserver = undefined;
      try {
        if (isExecutionOwnerCurrent(context)) {
          if (outcome === 'load') {
            context.input.onload?.();
          } else if (outcome === 'error') {
            context.input.onerror?.();
          }
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
      handle.cancel();
      return handle;
    }
    configureQueueAdvancer(context);
    if (/^<!DOCTYPE html/i.test(context.code)) {
      error(JIESHU_TIPS_SCRIPT_ERROR_REQUESTED, source);
      afterExecution('error');
      return handle;
    }

    try {
      configureScriptElement(context);
      if (!isExecutionOwnerCurrent(context)) {
        handle.cancel();
        return handle;
      }

      const isInlineModule =
        context.scriptElement.type.toLowerCase() === 'module' && !context.scriptElement.hasAttribute('src');
      const isAsyncInlineModule = isInlineModule && context.input.async === true;
      if (isAsyncInlineModule) {
        context.scriptElement.async = true;
      }
      if (isInlineModule && !isAsyncInlineModule) {
        inlineModuleObserver = observeInlineModule(
          context,
          () => afterExecution('load'),
          () => afterExecution('error'),
        );
      }
      if (!isExecutionOwnerCurrent(context)) {
        handle.cancel();
        return handle;
      }
      registerDynamicScript(context);
      const waitsForNativeCompletion = Boolean(inlineModuleObserver) || context.scriptElement.hasAttribute('src');
      if (waitsForNativeCompletion) {
        if (!isInlineModule) {
          context.scriptElement.onload = () => afterExecution('load');
        }
        context.scriptElement.onerror = () => afterExecution('error');
        unregisterCancellation = registerSandboxDynamicResource(context.owner, () => handle.cancel());
      }

      context.container.appendChild(context.scriptElement);
      if (completed || !isExecutionOwnerCurrent(context)) {
        handle.cancel();
        return handle;
      }
      if (inlineModuleObserver) {
        context.container.appendChild(inlineModuleObserver.marker);
      }
      if (completed || !isExecutionOwnerCurrent(context)) {
        handle.cancel();
        return handle;
      }
      context.input.callback?.(iframeWindow);
      execHooks(context.plugins, 'appendOrInsertElementHook', context.scriptElement, iframeWindow, rawElement);
      if (!waitsForNativeCompletion) {
        afterExecution(isAsyncInlineModule ? 'scheduled' : 'load');
      }
    } catch (cause: unknown) {
      // A failed DOM insertion/callback must not leave a registered native
      // script behind when the caller never receives its cancellation handle.
      handle.cancel();
      throw cause;
    }
    return handle;
  };
}

const scriptExecutionPipeline = new IframeScriptExecutionPipeline();

export function insertScriptToIframe(
  scriptResult: ScriptInput,
  iframeWindow: Window,
  rawElement?: HTMLScriptElement,
): ScriptExecutionHandle {
  return scriptExecutionPipeline.execute(scriptResult, iframeWindow, rawElement);
}
