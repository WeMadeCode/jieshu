import { getExternalStyleSheets, getExternalScripts } from './entry';
import {
  getJieshuById,
  rawAppendChild,
  rawElementContains,
  rawElementRemoveChild,
  rawHeadInsertBefore,
  rawBodyInsertBefore,
  rawInsertAdjacentElement,
  rawDocumentQuerySelector,
  rawAddEventListener,
  rawRemoveEventListener,
} from './common';
import {
  warn,
  nextTick,
  getCurUrl,
  getAbsolutePath,
  execHooks,
  isScriptElement,
  setTagToScript,
  getTagFromScript,
  setAttrsToElement,
} from './utils';
import { insertScriptToIframe, patchElementEffect } from './iframe';
import Jieshu from './sandbox';
import { getPatchStyleElements } from './shadow';
import { getCssLoader, getEffectLoaders, isMatchUrl } from './plugin';
import {
  JIESHU_SCRIPT_ID,
  JIESHU_DATA_FLAG,
  JIESHU_TIPS_REPEAT_RENDER,
  JIESHU_TIPS_NO_SCRIPT,
  JIESHU_APP_ID,
} from './constant';
import { ScriptObject, parseTagAttributes } from './template';
import { HandlerPipeline } from './effect-pipeline';
import type { PipelineHandler } from './effect-pipeline';
import {
  isSandboxExecutionAllowed,
  registerSandboxDynamicResource,
  scheduleSandboxDynamicScript,
} from './sandbox-runtime';
import type { SandboxDynamicResourceCancellationReason } from './sandbox-runtime';
import type { ScriptExecutionOutcome } from './iframe-script';

/**
 * Dispatch on the original resource so property handlers and listeners share
 * native ordering, receiver, once/removal and exception-reporting semantics.
 */
type ResourceElement = HTMLLinkElement | HTMLScriptElement;
type ResourceEventName = 'load' | 'error';

class ElementEventForwarder {
  dispatch = (element: ResourceElement, event: ResourceEventName) => {
    const EventConstructor = element.ownerDocument.defaultView?.Event ?? Event;
    element.dispatchEvent(new EventConstructor(event));
  };
}

const elementEventForwarder = new ElementEventForwarder();

/**
 * 样式元素的css变量处理，每个stylesheetElement单独节流
 */
type PatchedStyleElement = HTMLStyleElement & { _patcher?: ReturnType<typeof setTimeout> };
type RawDomInsertion = typeof rawAppendChild | typeof rawHeadInsertBefore;

function handleStylesheetElementPatch(stylesheetElement: PatchedStyleElement, sandbox: Jieshu) {
  if (!stylesheetElement.innerHTML) return;
  const patcher = () => {
    stylesheetElement._patcher = undefined;
    if (sandbox.destroyed || !sandbox.shadowRoot) return;
    const [hostStyleSheetElement, fontStyleSheetElement] = getPatchStyleElements([stylesheetElement.sheet]);
    if (hostStyleSheetElement) {
      sandbox.shadowRoot.head.appendChild(hostStyleSheetElement);
    }
    if (fontStyleSheetElement) {
      sandbox.inject?.fontStyleSheetContainer?.appendChild(fontStyleSheetElement);
      fontStyleSheetElement.setAttribute(JIESHU_APP_ID, sandbox.id);
      if (Array.isArray(sandbox.fontStyleSheetElements)) {
        sandbox.fontStyleSheetElements.push(fontStyleSheetElement);
      }
    }
  };
  if (stylesheetElement._patcher) {
    clearTimeout(stylesheetElement._patcher);
  }
  stylesheetElement._patcher = setTimeout(patcher, 50);
}

type StylesheetCssLoader = (code: string, url: string, base: string) => string;

// Namespace and local name identify native style elements across iframe realms.
const isStylesheetElement = (element: Element): element is HTMLStyleElement => {
  return element.namespaceURI === 'http://www.w3.org/1999/xhtml' && element.localName === 'style';
};

class StylesheetElementPatcher {
  private readonly patchedSheets = new WeakSet<CSSStyleSheet>();
  private readonly rawTextSetter = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')?.set;

  constructor(
    private readonly element: HTMLStyleElement,
    private readonly cssLoader: StylesheetCssLoader,
    private readonly sandbox: Jieshu,
    private readonly curUrl: string,
  ) {}

  private schedulePatch = (element = this.element) => {
    nextTick(() => handleStylesheetElementPatch(element, this.sandbox));
  };

  private persistSheet = (sheet: CSSStyleSheet) => {
    const content = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
    const disabled = sheet.disabled;
    // Use the native setter: these rules have already passed through cssLoader.
    this.rawTextSetter?.call(this.element, content);
    if (this.element.sheet) {
      this.element.sheet.disabled = disabled;
    }
    this.patchSheet();
    this.schedulePatch();
  };

  patchSheet = () => {
    const sheet = this.element.sheet;
    if (!sheet || this.patchedSheets.has(sheet)) {
      return;
    }
    this.patchedSheets.add(sheet);
    const rawInsertRule = sheet.insertRule;
    const rawDeleteRule = sheet.deleteRule;
    sheet.insertRule = (rule: string, index?: number) => {
      const current = this.element.sheet ?? sheet;
      const insertedIndex = rawInsertRule.call(current, this.cssLoader(rule, '', this.curUrl), index);
      this.persistSheet(current);
      return insertedIndex;
    };
    sheet.deleteRule = (index: number) => {
      const current = this.element.sheet ?? sheet;
      rawDeleteRule.call(current, index);
      this.persistSheet(current);
    };
  };

  private patchTextProperty = (property: 'innerHTML' | 'innerText' | 'textContent', prototype: object) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    const getter = descriptor?.get;
    const setter = descriptor?.set;
    if (!getter || !setter) {
      return;
    }
    const patcher = this;
    Object.defineProperty(this.element, property, {
      // DOM accessors must use the receiver supplied by the property access.
      get: function (this: HTMLStyleElement) {
        return getter.call(this);
      },
      set: function (this: HTMLStyleElement, code: string) {
        setter.call(this, patcher.cssLoader(code, '', patcher.curUrl));
        patcher.patchSheet();
        patcher.schedulePatch(this);
      },
    });
  };

  private appendChild = (receiver: HTMLStyleElement, node: Node) => {
    this.schedulePatch(receiver);
    if (node.nodeType !== Node.TEXT_NODE) {
      return rawAppendChild.call(this.element, node);
    }
    const content = this.cssLoader(node.textContent ?? '', '', this.curUrl);
    const inserted = rawAppendChild.call(this.element, this.element.ownerDocument.createTextNode(content));
    this.patchSheet();
    return inserted;
  };

  private insertAdjacentElement = (receiver: HTMLStyleElement, position: InsertPosition, element: Element) => {
    if (!isStylesheetElement(element)) {
      return rawInsertAdjacentElement.call(receiver, position, element);
    }
    // Vite chains style insertions; each new style needs the same text and CSSOM patches.
    const content = element.innerHTML;
    if (content) {
      element.innerHTML = this.cssLoader(content, '', this.curUrl);
    }
    const inserted = rawInsertAdjacentElement.call(receiver, position, element);
    this.sandbox.styleSheetElements.push(element);
    patchStylesheetElement(element, this.cssLoader, this.sandbox, this.curUrl);
    handleStylesheetElementPatch(element, this.sandbox);
    return inserted;
  };

  install = () => {
    this.patchSheet();
    this.patchTextProperty('innerHTML', Element.prototype);
    this.patchTextProperty('innerText', HTMLElement.prototype);
    this.patchTextProperty('textContent', Node.prototype);
    const patcher = this;
    Object.defineProperties(this.element, {
      // Preserve the native methods' dynamic receiver when called through another element.
      appendChild: {
        value: function (this: HTMLStyleElement, node: Node) {
          return patcher.appendChild(this, node);
        },
      },
      insertAdjacentElement: {
        value: function (this: HTMLStyleElement, position: InsertPosition, element: Element) {
          return patcher.insertAdjacentElement(this, position, element);
        },
      },
      _hasPatchStyle: { get: () => true },
    });
  };
}

const stylesheetPatchers = new WeakMap<HTMLStyleElement, StylesheetElementPatcher>();

/** @internal Install CSS transforms and preserve dynamically inserted rules across remounts. */
export const patchStylesheetElement = (
  stylesheetElement: HTMLStyleElement & { _hasPatchStyle?: boolean },
  cssLoader: StylesheetCssLoader,
  sandbox: Jieshu,
  curUrl: string,
) => {
  const existing = stylesheetPatchers.get(stylesheetElement);
  if (existing) {
    existing.patchSheet();
    return;
  }
  if (stylesheetElement._hasPatchStyle) {
    return;
  }
  const patcher = new StylesheetElementPatcher(stylesheetElement, cssLoader, sandbox, curUrl);
  patcher.install();
  stylesheetPatchers.set(stylesheetElement, patcher);
};

// href 延迟赋值的兜底超时（毫秒）：超过该时间仍未拿到 href，则放弃监听并触发 error，
// 防止「href 永不到达」时 observer 闭包长期钉住子应用上下文。沿用 tinymce maxLoadTime 量级。
const DEFER_STYLE_HREF_TIMEOUT = 5000;

interface DeferredStyleSheetOptions {
  element: HTMLLinkElement;
  jieshuId: string;
  iframeWindow: Window & { MutationObserver?: typeof MutationObserver };
  loadStyleSheet: (href: string, element: HTMLLinkElement) => void;
}

class DeferredStyleSheetRequest {
  private element: HTMLLinkElement | null;
  private loadStyleSheet?: DeferredStyleSheetOptions['loadStyleSheet'];
  private readonly jieshuId: string;
  private readonly observer: MutationObserver;
  private settled = false;
  private timer?: ReturnType<typeof setTimeout>;
  private unregisterCancellation?: () => void;

  constructor(opts: DeferredStyleSheetOptions, Observer: typeof MutationObserver) {
    this.element = opts.element;
    this.loadStyleSheet = opts.loadStyleSheet;
    this.jieshuId = opts.jieshuId;
    this.observer = new Observer(this.handleHrefChange);
  }

  private removeRegistration = () => {
    const observers = getJieshuById(this.jieshuId)?.deferredStyleObservers;
    if (!Array.isArray(observers)) {
      return;
    }
    const index = observers.indexOf(this);
    if (index !== -1) {
      observers.splice(index, 1);
    }
  };

  private finish = () => {
    if (this.settled) {
      return;
    }
    this.settled = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.unregisterCancellation?.();
    this.unregisterCancellation = undefined;
    this.element = null;
    this.loadStyleSheet = undefined;
    try {
      this.observer.disconnect();
    } catch {
      // Cleanup must also retire the registration if a custom observer throws.
    }
    this.removeRegistration();
  };

  disconnect = () => {
    this.finish();
  };

  private handleHrefChange = () => {
    const target = this.element;
    if (!target) {
      return;
    }
    const href = target.getAttribute('href');
    if (!href) {
      return;
    }
    const realHref = target.href || href;
    const loadStyleSheet = this.loadStyleSheet;
    this.finish();
    if (getJieshuById(this.jieshuId)) {
      loadStyleSheet?.(realHref, target);
    }
  };

  private finishWithError = () => {
    const target = this.element;
    const sandbox = getJieshuById(this.jieshuId);
    this.finish();
    if (target && sandbox) {
      elementEventForwarder.dispatch(target, 'error');
    }
  };

  private cancel = (reason: SandboxDynamicResourceCancellationReason) => {
    if (reason === 'unmount') {
      this.finishWithError();
      return;
    }
    this.finish();
  };

  start = () => {
    const sandbox = getJieshuById(this.jieshuId);
    const target = this.element;
    if (!sandbox || !Array.isArray(sandbox.deferredStyleObservers)) {
      this.finish();
      return;
    }
    if (!target) {
      return;
    }
    if (!isDynamicEffectContextLive(sandbox, this.jieshuId)) {
      this.finish();
      nextTick(() => elementEventForwarder.dispatch(target, 'error'));
      return;
    }
    sandbox.deferredStyleObservers.push(this);
    this.unregisterCancellation = registerSandboxDynamicResource(sandbox, this.cancel);
    try {
      this.observer.observe(target, { attributes: true, attributeFilter: ['href'] });
      this.timer = setTimeout(this.finishWithError, DEFER_STYLE_HREF_TIMEOUT);
    } catch (cause: unknown) {
      this.finish();
      throw cause;
    }
  };
}

/** Wait for a link's href, retiring its observer on load, timeout or sandbox teardown. */
export const deferStyleSheetByHref = (opts: DeferredStyleSheetOptions) => {
  const Observer = opts.iframeWindow.MutationObserver;
  if (typeof Observer !== 'function') {
    return;
  }
  new DeferredStyleSheetRequest(opts, Observer).start();
};

type HijackingTagName = 'LINK' | 'STYLE' | 'SCRIPT' | 'IFRAME';
type InsertionTarget = HTMLHeadElement | HTMLBodyElement;

interface InsertionContext {
  readonly target: InsertionTarget;
  element: HTMLElement | null;
  readonly refChild?: Node | null;
  readonly rawInsert: RawDomInsertion;
  readonly jieshuId: string;
  readonly sandbox: Jieshu;
  readonly iframeDocument: Document;
  readonly iframeWindow: Window;
  readonly curUrl: string;
}

interface VirtualScriptParent {
  readonly parent: InsertionTarget;
  readonly placeholder: Comment;
}

/**
 * Dynamic scripts execute in the application iframe, while their visible
 * insertion point is represented by a comment. Keep the original script's
 * parent access compatible with native DOM so loaders can later clean it up
 * through `script.parentNode.removeChild(script)`.
 */
const virtualScriptParents = new WeakMap<HTMLScriptElement, VirtualScriptParent>();

function installVirtualScriptParent(
  scriptElement: HTMLScriptElement,
  parent: InsertionTarget,
  placeholder: Comment,
): void {
  virtualScriptParents.set(scriptElement, { parent, placeholder });
  try {
    Object.defineProperties(scriptElement, {
      parentNode: {
        configurable: true,
        get: () => virtualScriptParents.get(scriptElement)?.parent ?? null,
      },
      parentElement: {
        configurable: true,
        get: () => virtualScriptParents.get(scriptElement)?.parent ?? null,
      },
    });
  } catch (cause: unknown) {
    virtualScriptParents.delete(scriptElement);
    warn(cause);
  }
}

function releaseVirtualScriptParent(scriptElement: HTMLScriptElement): VirtualScriptParent | undefined {
  const relationship = virtualScriptParents.get(scriptElement);
  if (!relationship) return undefined;
  virtualScriptParents.delete(scriptElement);
  try {
    Reflect.deleteProperty(scriptElement, 'parentNode');
    Reflect.deleteProperty(scriptElement, 'parentElement');
  } catch (cause: unknown) {
    warn(cause);
  }
  return relationship;
}

/** Dynamic effects may continue while kept alive, but never after a normal inactive unmount. */
export const isDynamicEffectContextLive = (sandbox: Jieshu, jieshuId: string) => {
  return isSandboxExecutionAllowed(sandbox) && Boolean(sandbox.iframe) && getJieshuById(jieshuId) === sandbox;
};

type TypedInsertionHandler<TElement extends HTMLElement> = (context: InsertionContext, element: TElement) => Node;

const insertNode = <T extends Node>(context: InsertionContext, node: T) => {
  context.rawInsert.call(context.target, node, context.refChild ?? null);
  return node;
};

function invokeInsertionHook(context: InsertionContext, element: HTMLElement): void {
  execHooks(context.sandbox.plugins, 'appendOrInsertElementHook', element, context.iframeWindow);
}

function insertElementWithHook<T extends HTMLElement>(context: InsertionContext, element: T): T {
  const result = insertNode(context, element);
  invokeInsertionHook(context, element);
  return result;
}

function createInsertionHandler<TElement extends HTMLElement>(
  key: HijackingTagName,
  handle: TypedInsertionHandler<TElement>,
): PipelineHandler<HijackingTagName, InsertionContext, Node> {
  return {
    key,
    handle: (context) => {
      if (!context.element) throw new Error(`Released insertion context for ${key}`);
      return handle(context, context.element as TElement);
    },
  };
}

function releaseAfter<T>(promise: Promise<T>, release: () => void): Promise<T> {
  return promise.then(
    (value) => {
      release();
      return value;
    },
    (error: unknown) => {
      release();
      throw error;
    },
  );
}

class StylesheetResourceLoader {
  private linkElement: HTMLLinkElement | null;
  private placeholderElement: HTMLStyleElement | null = null;
  private unregisterCancellation?: () => void;
  private cancelled = false;

  constructor(
    private readonly context: InsertionContext,
    linkElement: HTMLLinkElement,
  ) {
    this.linkElement = linkElement;
  }

  load = (realHref: string, requestedElement: HTMLLinkElement): void => {
    const linkElement = this.linkElement;
    if (!linkElement || linkElement !== requestedElement) return;
    if (!this.isLive()) {
      this.release();
      nextTick(() => elementEventForwarder.dispatch(linkElement, 'error'));
      return;
    }
    const { sandbox } = this.context;
    const { plugins, proxyLocation, fetch, lifecycles, replace, styleSheetElements } = sandbox;
    const attrHref = linkElement.getAttribute('href');
    const styleHref = attrHref ? getAbsolutePath(attrHref, (proxyLocation as Location).href) : realHref;
    if (!styleHref || isMatchUrl(styleHref, getEffectLoaders('cssExcludes', plugins))) return;

    const placeholderElement = this.context.iframeDocument.createElement('style');
    this.placeholderElement = placeholderElement;
    this.unregisterCancellation = registerSandboxDynamicResource(sandbox, (reason) => this.cancel(reason));
    setAttrsToElement(placeholderElement, parseTagAttributes(linkElement.outerHTML));
    placeholderElement.setAttribute('data-jieshu-css-href', styleHref);
    insertNode(this.context, placeholderElement);

    getExternalStyleSheets(
      [{ src: styleHref, ignore: isMatchUrl(styleHref, getEffectLoaders('cssIgnores', plugins)) }],
      fetch,
      lifecycles.loadError,
      sandbox.assetCacheScope,
    ).forEach(({ src, ignore, contentPromise }) => {
      const pendingLoad = contentPromise.then(
        (content) => {
          if (!this.isLive()) {
            placeholderElement.parentNode?.removeChild(placeholderElement);
            return;
          }
          if (ignore && src) {
            placeholderElement.parentNode?.removeChild(placeholderElement);
            insertNode(this.context, linkElement);
            return;
          }

          const cssLoader = getCssLoader({ plugins, replace });
          let transformedContent: string;
          try {
            transformedContent = cssLoader(content, src, this.context.curUrl);
          } catch {
            placeholderElement.parentNode?.removeChild(placeholderElement);
            const shouldNotify = this.isLive();
            this.release();
            if (shouldNotify) elementEventForwarder.dispatch(linkElement, 'error');
            return;
          }
          // cssLoader is user code and may synchronously unmount the app. The
          // cancellation removes this placeholder and releases this loader;
          // never resurrect that obsolete lifecycle generation afterwards.
          if (!this.isLive()) {
            placeholderElement.parentNode?.removeChild(placeholderElement);
            return;
          }
          placeholderElement.innerHTML = transformedContent;
          styleSheetElements.push(placeholderElement);
          handleStylesheetElementPatch(placeholderElement, sandbox);
          this.release();
          elementEventForwarder.dispatch(linkElement, 'load');
        },
        () => {
          placeholderElement.parentNode?.removeChild(placeholderElement);
          const shouldNotify = this.isLive();
          this.release();
          if (shouldNotify) elementEventForwarder.dispatch(linkElement, 'error');
        },
      );
      releaseAfter(pendingLoad, () => this.release());
    });
  };

  private isLive(): boolean {
    const { sandbox, jieshuId } = this.context;
    return !this.cancelled && isDynamicEffectContextLive(sandbox, jieshuId);
  }

  private cancel(reason: SandboxDynamicResourceCancellationReason): void {
    const linkElement = this.linkElement;
    if (!linkElement) return;
    this.cancelled = true;
    this.placeholderElement?.parentNode?.removeChild(this.placeholderElement);
    const shouldNotify = reason === 'unmount' && !this.context.sandbox.destroyed;
    this.release();
    if (shouldNotify) {
      elementEventForwarder.dispatch(linkElement, 'error');
    }
  }

  private release(): void {
    this.unregisterCancellation?.();
    this.unregisterCancellation = undefined;
    this.linkElement = null;
    this.placeholderElement = null;
    this.context.element = null;
  }
}

function toScriptCrossOrigin(value: string | null): 'anonymous' | 'use-credentials' | '' {
  return (value || '') as 'anonymous' | 'use-credentials' | '';
}

class DynamicScriptScheduler {
  private scriptElement: HTMLScriptElement | null;
  private executionQueue: Array<() => unknown> | null = null;
  private queuedTask?: () => unknown;
  private laneReservation?: () => unknown;
  private executionHandle?: ReturnType<typeof insertScriptToIframe>;
  private unregisterCancellation?: () => void;
  private completionStarted = false;

  constructor(
    private readonly context: InsertionContext,
    scriptElement: HTMLScriptElement,
  ) {
    this.scriptElement = scriptElement;
  }

  schedule = () => {
    const { sandbox } = this.context;
    const scriptElement = this.scriptElement;
    if (!scriptElement) {
      return;
    }
    if (!this.isLive()) {
      this.release();
      nextTick(() => elementEventForwarder.dispatch(scriptElement, 'error'));
      return;
    }
    this.unregisterCancellation = registerSandboxDynamicResource(sandbox, (reason) => this.cancel(reason));
    const { src, text, type, crossOrigin } = scriptElement;
    const isModule = type.toLowerCase() === 'module';
    setTagToScript(scriptElement);

    if (src && !isMatchUrl(src, getEffectLoaders('jsExcludes', sandbox.plugins))) {
      const scriptOptions: ScriptObject = {
        src,
        module: isModule,
        crossorigin: crossOrigin !== null,
        crossoriginType: toScriptCrossOrigin(crossOrigin),
        ignore: isMatchUrl(src, getEffectLoaders('jsIgnores', sandbox.plugins)),
        attrs: parseTagAttributes(scriptElement.outerHTML),
      };
      getExternalScripts(
        [scriptOptions],
        sandbox.fetch,
        sandbox.lifecycles.loadError,
        sandbox.fiber,
        sandbox.assetCacheScope,
      ).forEach((scriptResult) => this.scheduleExternal(scriptResult));
      return;
    }

    this.enqueue(() => {
      const pendingElement = this.scriptElement;
      if (!pendingElement) {
        return;
      }
      if (!this.isLive()) {
        warn(JIESHU_TIPS_REPEAT_RENDER);
        this.finishQueuedTask();
        return;
      }
      const inlineScript: ScriptObject = {
        content: text,
        module: isModule,
        attrs: parseTagAttributes(pendingElement.outerHTML),
      };
      this.executeWithForwardedOutcome(inlineScript, false, isModule);
    });
  };

  private scheduleExternal(scriptResult: ScriptObject & { contentPromise: Promise<string> }): void {
    scheduleSandboxDynamicScript(this.context.sandbox, scriptResult.contentPromise, {
      fulfilled: (content) => {
        if (!this.isLive()) {
          this.release();
          warn(JIESHU_TIPS_REPEAT_RENDER);
          return;
        }
        this.enqueue(() => this.executeWithForwardedOutcome({ ...scriptResult, content }));
      },
      rejected: () => {
        const pendingElement = this.scriptElement;
        const shouldNotify = Boolean(pendingElement && this.isLive());
        this.release();
        if (pendingElement && shouldNotify) elementEventForwarder.dispatch(pendingElement, 'error');
      },
      cancelled: (reason) => this.cancel(reason),
    });
  }

  private executeWithForwardedOutcome = (
    scriptResult: ScriptObject,
    forwardLoad = true,
    forwardError = forwardLoad,
  ) => {
    const { sandbox } = this.context;
    const pendingElement = this.scriptElement;
    if (!pendingElement) {
      return;
    }
    if (!this.isLive()) {
      warn(JIESHU_TIPS_REPEAT_RENDER);
      this.finishQueuedTask();
      return;
    }
    const complete = (outcome: ScriptExecutionOutcome) => {
      if (this.completionStarted || !this.scriptElement) {
        return;
      }
      this.completionStarted = true;
      const completedElement = this.scriptElement;
      const shouldNotify = Boolean(completedElement && this.isLive());
      try {
        if (
          ((outcome === 'load' && forwardLoad) || (outcome === 'error' && forwardError)) &&
          completedElement &&
          shouldNotify
        ) {
          elementEventForwarder.dispatch(completedElement, outcome);
        }
      } finally {
        // Keep the lane occupied across reentrant event handlers, then settle
        // this reservation exactly once, independently of the iframe executor.
        this.finishQueuedTask();
      }
    };
    const iframeWindow = sandbox.iframe.contentWindow;
    if (!iframeWindow) {
      this.finishQueuedTask();
      return;
    }
    try {
      const executionHandle = insertScriptToIframe(
        {
          ...scriptResult,
          onload: () => complete('load'),
          onerror: () => complete('error'),
        },
        iframeWindow,
        pendingElement,
      );
      if (this.scriptElement) {
        this.executionHandle = executionHandle;
      }
      // Cancellation or suppressed callbacks still owe the lane a completion.
      // A normal callback already settled it synchronously; complete is idempotent.
      void executionHandle.completion.then(complete);
    } catch (cause: unknown) {
      // Loader/DOM setup failed before insertScriptToIframe could publish a
      // completion handle. This task has already left execQueue, so explicitly
      // advance the lane and surface the failure through the original element.
      complete('error');
      warn(cause);
    }
  };

  private enqueue = (task: () => unknown) => {
    const { sandbox } = this.context;
    const queue = sandbox.execQueue;
    if (!Array.isArray(queue) || !this.isLive()) {
      warn(JIESHU_TIPS_REPEAT_RENDER);
      this.release();
      return;
    }
    const queueWasEmpty = queue.length === 0;
    this.executionQueue = queue;
    const runIfLive = () => {
      if (!this.isLive()) {
        this.finishQueuedTask();
        return;
      }
      task();
    };
    const queuedTask = () => {
      this.queuedTask = undefined;
      this.reserveExecutionLane(queue);
      return sandbox.fiber ? sandbox.requestIdleCallback(runIfLive, () => this.finishQueuedTask()) : runIfLive();
    };
    this.queuedTask = queuedTask;
    queue.push(queuedTask);
    if (queueWasEmpty) {
      queue.shift()?.();
    }
  };

  /** Keep the lane occupied while the dequeued task waits for fiber/native completion. */
  private reserveExecutionLane(queue: Array<() => unknown>): void {
    const reservation = () => {
      if (this.laneReservation !== reservation) return;
      this.laneReservation = undefined;
      queue.shift()?.();
    };
    this.laneReservation = reservation;
    queue.unshift(reservation);
  }

  private isLive(): boolean {
    const { sandbox, jieshuId } = this.context;
    return isDynamicEffectContextLive(sandbox, jieshuId);
  }

  private cancel(reason: SandboxDynamicResourceCancellationReason): void {
    const pendingElement = this.scriptElement;
    if (!pendingElement) return;
    const shouldNotify = reason === 'unmount' && !this.context.sandbox.destroyed && !this.completionStarted;
    this.executionHandle?.cancel();
    this.release();
    if (shouldNotify) {
      elementEventForwarder.dispatch(pendingElement, 'error');
    }
  }

  /** Remove this reservation before starting the next task; repeated completion is harmless. */
  private finishQueuedTask = () => {
    const queue = this.executionQueue ?? this.context.sandbox.execQueue;
    const ownsLane = Boolean(this.laneReservation);
    this.release();
    if (ownsLane && Array.isArray(queue)) {
      queue.shift()?.();
    }
  };

  private release = () => {
    const queue = this.executionQueue ?? this.context.sandbox.execQueue;
    if (Array.isArray(queue)) {
      if (this.queuedTask) {
        const queuedIndex = queue.indexOf(this.queuedTask);
        if (queuedIndex !== -1) {
          queue.splice(queuedIndex, 1);
        }
      }
      if (this.laneReservation) {
        const reservationIndex = queue.indexOf(this.laneReservation);
        if (reservationIndex !== -1) {
          queue.splice(reservationIndex, 1);
        }
      }
    }
    this.queuedTask = undefined;
    this.laneReservation = undefined;
    this.unregisterCancellation?.();
    this.unregisterCancellation = undefined;
    this.executionHandle = undefined;
    this.scriptElement = null;
    this.context.element = null;
    this.executionQueue = null;
  };
}

const linkInsertionHandler = createInsertionHandler<HTMLLinkElement>('LINK', (context, linkElement) => {
  const { href, rel, type } = linkElement;
  const isStylesheet = rel === 'stylesheet' || type === 'text/css' || href.endsWith('.css');
  if (!isStylesheet) return insertElementWithHook(context, linkElement);

  const resourceLoader = new StylesheetResourceLoader(context, linkElement);
  if (href) {
    if (!isMatchUrl(href, getEffectLoaders('cssExcludes', context.sandbox.plugins))) {
      resourceLoader.load(href, linkElement);
    }
  } else {
    deferStyleSheetByHref({
      element: linkElement,
      jieshuId: context.jieshuId,
      iframeWindow: context.iframeWindow,
      loadStyleSheet: resourceLoader.load,
    });
  }

  return insertNode(context, context.iframeDocument.createComment(`dynamic link ${href} replaced by jieshu`));
});

const styleInsertionHandler = createInsertionHandler<HTMLStyleElement>('STYLE', (context, stylesheetElement) => {
  const { sandbox } = context;
  sandbox.styleSheetElements.push(stylesheetElement);
  const cssLoader = getCssLoader({ plugins: sandbox.plugins, replace: sandbox.replace });
  const content = stylesheetElement.innerHTML;
  if (content) stylesheetElement.innerHTML = cssLoader(content, '', context.curUrl);
  const result = insertNode(context, stylesheetElement);
  patchStylesheetElement(stylesheetElement, cssLoader, sandbox, context.curUrl);
  handleStylesheetElementPatch(stylesheetElement, sandbox);
  invokeInsertionHook(context, stylesheetElement);
  return result;
});

const scriptInsertionHandler = createInsertionHandler<HTMLScriptElement>('SCRIPT', (context, scriptElement) => {
  const placeholder = context.iframeDocument.createComment(`dynamic script ${scriptElement.src} replaced by jieshu`);
  insertNode(context, placeholder);
  installVirtualScriptParent(scriptElement, context.target, placeholder);
  new DynamicScriptScheduler(context, scriptElement).schedule();
  return scriptElement;
});

const iframeInsertionHandler = createInsertionHandler<HTMLIFrameElement>('IFRAME', (context, iframeElement) => {
  if (iframeElement.getAttribute(JIESHU_DATA_FLAG) === '') {
    const documentElement = rawDocumentQuerySelector.call(context.target.ownerDocument, 'html');
    return rawAppendChild.call(documentElement, iframeElement);
  }
  return insertElementWithHook(context, iframeElement);
});

const insertionPipeline = new HandlerPipeline<HijackingTagName, InsertionContext, Node>([
  linkInsertionHandler,
  styleInsertionHandler,
  scriptInsertionHandler,
  iframeInsertionHandler,
]);

const toHijackingTagName = (tagName: string) => {
  const normalized = tagName.toUpperCase();
  if (normalized === 'LINK' || normalized === 'STYLE' || normalized === 'SCRIPT' || normalized === 'IFRAME') {
    return normalized;
  }
  return null;
};

const insertUnmanagedElement = <T extends Node>(context: InsertionContext, element: T) => {
  const result = insertNode(context, element);
  patchElementEffect(element, context.iframeWindow);
  execHooks(context.sandbox.plugins, 'appendOrInsertElementHook', element, context.iframeWindow);
  return result;
};

// Node kind and namespace identify HTML elements across host and iframe realms.
const isHtmlElement = (node: Node): node is HTMLElement => {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    'namespaceURI' in node &&
    node.namespaceURI === 'http://www.w3.org/1999/xhtml'
  );
};

interface RenderEffectOwner {
  jieshuId: string;
  token: symbol;
}

// Ownership metadata in DOM patches retains only an opaque token, never the sandbox or its iframe.
// A live instance keeps its token across renders; a same-name replacement cannot inherit it.
const renderEffectOwnerTokens = new WeakMap<Jieshu, symbol>();

const captureRenderEffectOwner = (jieshuId: string) => {
  const sandbox = getJieshuById(jieshuId);
  const token = (sandbox && renderEffectOwnerTokens.get(sandbox)) || Symbol(jieshuId);
  if (sandbox) {
    renderEffectOwnerTokens.set(sandbox, token);
  }
  return { jieshuId, token };
};

const getRenderEffectSandbox = (owner: RenderEffectOwner) => {
  const sandbox = getJieshuById(owner.jieshuId);
  if (!sandbox || sandbox.destroyed || renderEffectOwnerTokens.get(sandbox) !== owner.token) {
    return null;
  }
  return sandbox;
};

const rewriteAppendOrInsertChild = <TInsertion extends RawDomInsertion>(opts: {
  rawDOMAppendOrInsertBefore: TInsertion;
  owner: RenderEffectOwner;
}) => {
  // An apply trap keeps native call/bind receiver semantics with an arrow callback.
  return new Proxy(opts.rawDOMAppendOrInsertBefore, {
    apply: (rawInsert, target: InsertionTarget, [newChild, refChild = null]: Parameters<RawDomInsertion>) => {
      const sandbox = getRenderEffectSandbox(opts.owner);
      // Stale patches keep native DOM behavior on their receiver, without
      // borrowing another instance's iframe, fetch, plugins or resource queues.
      if (!sandbox?.iframe) {
        return rawInsert.call(target, newChild, refChild);
      }
      const iframeDocument = sandbox.iframe.contentDocument;
      const iframeWindow = sandbox.iframe.contentWindow;
      if (!iframeDocument || !iframeWindow) {
        return rawInsert.call(target, newChild, refChild);
      }
      const element = isHtmlElement(newChild) ? newChild : null;
      const context: InsertionContext = {
        target,
        element,
        refChild,
        rawInsert,
        jieshuId: opts.owner.jieshuId,
        sandbox,
        iframeDocument,
        iframeWindow,
        curUrl: getCurUrl(sandbox.proxyLocation),
      };
      const tagName = element && toHijackingTagName(element.tagName);
      if (!tagName || !opts.owner.jieshuId) {
        return insertUnmanagedElement(context, newChild);
      }

      return insertionPipeline.dispatch(tagName, context, (fallbackContext) =>
        insertUnmanagedElement(fallbackContext, newChild),
      );
    },
  });
};

const findScriptElementFromIframe = (rawElement: HTMLScriptElement, owner: RenderEffectOwner) => {
  const jieshuTag = getTagFromScript(rawElement);
  const sandbox = getRenderEffectSandbox(owner);
  if (!sandbox?.iframe) {
    return { targetScript: null, rawHead: null };
  }
  const { iframe } = sandbox;
  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) {
    return { targetScript: null, rawHead: null };
  }
  const rawHead = iframeWindow.__JIESHU_RAW_DOCUMENT_HEAD__;
  if (!rawHead) {
    return { targetScript: null, rawHead: null };
  }
  const targetScript = rawHead.querySelector(`script[${JIESHU_SCRIPT_ID}='${jieshuTag}']`);
  if (targetScript === null) {
    warn(JIESHU_TIPS_NO_SCRIPT, `<script ${JIESHU_SCRIPT_ID}='${jieshuTag}'/>`);
  }
  return { targetScript, rawHead };
};

const rewriteContains = (opts: { rawElementContains: (other: Node | null) => boolean; owner: RenderEffectOwner }) => {
  return (other: Node | null) => {
    const element = other as HTMLElement;
    const { rawElementContains, owner } = opts;
    if (element && isScriptElement(element)) {
      const relationship = virtualScriptParents.get(element as HTMLScriptElement);
      if (relationship && rawElementContains(relationship.parent)) {
        return true;
      }
      const { targetScript, rawHead } = findScriptElementFromIframe(element as HTMLScriptElement, owner);
      if (!rawHead) {
        return rawElementContains(element);
      }
      return targetScript !== null;
    }
    return rawElementContains(element);
  };
};

const rewriteRemoveChild = (opts: {
  rawElementRemoveChild: <T extends Node>(child: T) => T;
  owner: RenderEffectOwner;
}) => {
  // The receiver must match the original script's virtual parent before removal.
  return function removeChild(this: InsertionTarget, child: Node) {
    const element = child as HTMLElement;
    const { rawElementRemoveChild, owner } = opts;
    if (element && isScriptElement(element)) {
      const relationship = virtualScriptParents.get(element as HTMLScriptElement);
      if (relationship && relationship.parent !== this) {
        return rawElementRemoveChild(element);
      }
      const { targetScript, rawHead } = findScriptElementFromIframe(element as HTMLScriptElement, owner);
      if (!rawHead && !relationship) {
        return rawElementRemoveChild(element);
      }
      if (targetScript !== null && rawHead) {
        rawHead.removeChild(targetScript);
      }
      if (relationship) {
        releaseVirtualScriptParent(element as HTMLScriptElement);
        if (relationship.placeholder.parentNode === relationship.parent) {
          rawElementRemoveChild.call(relationship.parent, relationship.placeholder);
        }
        return element;
      }
      return null;
    }
    return rawElementRemoveChild(element);
  };
};

/**
 * 记录head和body的事件，等重新渲染复用head和body时需要清空事件
 */
function captureOption(options?: boolean | AddEventListenerOptions): boolean {
  return typeof options === 'boolean' ? options : Boolean(options?.capture);
}

function patchEventListener(element: HTMLHeadElement | HTMLBodyElement): void {
  const listenerMap: HTMLHeadElement['_cacheListeners'] = new Map();
  element._cacheListeners = listenerMap;

  element.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    const listeners = listenerMap.get(type) || [];
    const capture = captureOption(options);
    if (!listeners.some((entry) => entry.listener === listener && captureOption(entry.options) === capture)) {
      listenerMap.set(type, [...listeners, { listener, options }]);
    }
    return rawAddEventListener.call(element, type, listener, options);
  };

  element.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    const typeListeners = listenerMap.get(type);
    const capture = captureOption(options);
    const index = typeListeners?.findIndex(
      (entry) => entry.listener === listener && captureOption(entry.options) === capture,
    );
    if (typeListeners?.length && index !== undefined && index !== -1) {
      typeListeners.splice(index, 1);
      if (!typeListeners.length) listenerMap.delete(type);
    }
    return rawRemoveEventListener.call(element, type, listener, options);
  };
}

/**
 * 清空head和body的绑定的事件
 */
export function removeEventListener(element: HTMLHeadElement | HTMLBodyElement): void {
  const listenerMap = element._cacheListeners;
  if (!listenerMap) return;
  listenerMap.forEach((listeners, type) => {
    listeners.forEach(({ listener, options }) => rawRemoveEventListener.call(element, type, listener, options));
  });
  listenerMap.clear();
}

/**
 * patch head and body in render
 * intercept appendChild and insertBefore
 */
export const patchRenderEffect = (render: ShadowRoot, id: string) => {
  const owner = captureRenderEffectOwner(id);
  patchEventListener(render.head);
  patchEventListener(render.body);

  render.head.appendChild = rewriteAppendOrInsertChild({
    rawDOMAppendOrInsertBefore: rawAppendChild,
    owner,
  });
  render.head.insertBefore = rewriteAppendOrInsertChild({
    rawDOMAppendOrInsertBefore: rawHeadInsertBefore,
    owner,
  });
  render.head.removeChild = rewriteRemoveChild({
    rawElementRemoveChild: rawElementRemoveChild.bind(render.head),
    owner,
  }) as typeof rawElementRemoveChild;
  render.head.contains = rewriteContains({
    rawElementContains: rawElementContains.bind(render.head),
    owner,
  }) as typeof rawElementContains;
  render.contains = rewriteContains({
    rawElementContains: rawElementContains.bind(render),
    owner,
  }) as typeof rawElementContains;
  render.body.appendChild = rewriteAppendOrInsertChild({
    rawDOMAppendOrInsertBefore: rawAppendChild,
    owner,
  });
  render.body.insertBefore = rewriteAppendOrInsertChild({
    rawDOMAppendOrInsertBefore: rawBodyInsertBefore,
    owner,
  });
  render.body.removeChild = rewriteRemoveChild({
    rawElementRemoveChild: rawElementRemoveChild.bind(render.body),
    owner,
  }) as typeof rawElementRemoveChild;
  render.body.contains = rewriteContains({
    rawElementContains: rawElementContains.bind(render.body),
    owner,
  }) as typeof rawElementContains;
};
