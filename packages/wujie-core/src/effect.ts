import { getExternalStyleSheets, getExternalScripts } from "./entry";
import {
  getWujieById,
  rawAppendChild,
  rawElementContains,
  rawElementRemoveChild,
  rawHeadInsertBefore,
  rawBodyInsertBefore,
  rawInsertAdjacentElement,
  rawDocumentQuerySelector,
  rawAddEventListener,
  rawRemoveEventListener,
} from "./common";
import {
  isFunction,
  isHijackingTag,
  warn,
  nextTick,
  getCurUrl,
  getAbsolutePath,
  execHooks,
  isScriptElement,
  setTagToScript,
  getTagFromScript,
  setAttrsToElement,
} from "./utils";
import { insertScriptToIframe, patchElementEffect } from "./iframe";
import Wujie from "./sandbox";
import { getPatchStyleElements } from "./shadow";
import { getCssLoader, getEffectLoaders, isMatchUrl } from "./plugin";
import {
  WUJIE_SCRIPT_ID,
  WUJIE_DATA_FLAG,
  WUJIE_TIPS_REPEAT_RENDER,
  WUJIE_TIPS_NO_SCRIPT,
  WUJIE_APP_ID,
} from "./constant";
import { ScriptObject, parseTagAttributes } from "./template";
import { HandlerPipeline } from "./effect-pipeline";
import type { PipelineHandler } from "./effect-pipeline";
import { registerSandboxDynamicResource, scheduleSandboxDynamicScript } from "./sandbox-runtime";
import type { SandboxDynamicResourceCancellationReason } from "./sandbox-runtime";

function patchCustomEvent(
  e: CustomEvent,
  elementGetter: () => HTMLScriptElement | HTMLLinkElement | null
): CustomEvent {
  Object.defineProperties(e, {
    srcElement: {
      get: elementGetter,
    },
    target: {
      get: elementGetter,
    },
  });

  return e;
}

/**
 * 手动触发事件回调
 */
type ResourceElement = HTMLLinkElement | HTMLScriptElement;
type ResourceEventName = "load" | "error";

class ElementEventForwarder {
  dispatch(element: ResourceElement, event: ResourceEventName): void {
    const customEvent = new CustomEvent(event);
    const patchedEvent = patchCustomEvent(customEvent, () => element);
    const eventHandler = Reflect.get(element, `on${event}`);
    if (isFunction(eventHandler)) {
      Reflect.apply(eventHandler, element, [patchedEvent]);
    } else {
      element.dispatchEvent(patchedEvent);
    }
  }
}

const elementEventForwarder = new ElementEventForwarder();

/**
 * 样式元素的css变量处理，每个stylesheetElement单独节流
 */
type PatchedStyleElement = HTMLStyleElement & { _patcher?: ReturnType<typeof setTimeout> };
type RawDomInsertion = <T extends Node>(newChild: T, refChild?: Node | null) => T;

function handleStylesheetElementPatch(stylesheetElement: PatchedStyleElement, sandbox: Wujie) {
  if (!stylesheetElement.innerHTML || sandbox.degrade) return;
  const patcher = () => {
    stylesheetElement._patcher = undefined;
    if (sandbox.destroyed || !sandbox.shadowRoot) return;
    const [hostStyleSheetElement, fontStyleSheetElement] = getPatchStyleElements([stylesheetElement.sheet]);
    if (hostStyleSheetElement) {
      sandbox.shadowRoot.head.appendChild(hostStyleSheetElement);
    }
    if (fontStyleSheetElement) {
      sandbox.inject?.fontStyleSheetContainer?.appendChild(fontStyleSheetElement);
      fontStyleSheetElement.setAttribute(WUJIE_APP_ID, sandbox.id);
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

/**
 * 劫持处理样式元素的属性
 * @internal 仅出于可测性导出，外部不应直接调用
 */
export function patchStylesheetElement(
  stylesheetElement: HTMLStyleElement & { _hasPatchStyle?: boolean },
  cssLoader: (code: string, url: string, base: string) => string,
  sandbox: Wujie,
  curUrl: string
) {
  if (stylesheetElement._hasPatchStyle) return;
  const innerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  const innerTextDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText");
  const textContentDesc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
  const innerHTMLGetter = innerHTMLDesc?.get;
  const innerHTMLSetter = innerHTMLDesc?.set;
  const innerTextGetter = innerTextDesc?.get;
  const innerTextSetter = innerTextDesc?.set;
  const textContentGetter = textContentDesc?.get;
  const textContentSetter = textContentDesc?.set;
  const RawInsertRule = stylesheetElement.sheet?.insertRule;
  // 这个地方将cssRule加到innerHTML中去，防止子应用切换之后丢失
  function patchSheetInsertRule() {
    if (!RawInsertRule) return;
    stylesheetElement.sheet.insertRule = (rule: string, index?: number): number => {
      innerHTMLDesc ? (stylesheetElement.innerHTML += rule) : (stylesheetElement.innerText += rule);
      return RawInsertRule.call(stylesheetElement.sheet, rule, index);
    };
  }
  patchSheetInsertRule();

  if (innerHTMLGetter && innerHTMLSetter) {
    Object.defineProperties(stylesheetElement, {
      innerHTML: {
        get: function (this: HTMLStyleElement) {
          return innerHTMLGetter.call(this);
        },
        set: function (this: HTMLStyleElement, code: string) {
          innerHTMLSetter.call(this, cssLoader(code, "", curUrl));
          nextTick(() => handleStylesheetElementPatch(this, sandbox));
        },
      },
    });
  }

  if (innerTextGetter && innerTextSetter) {
    Object.defineProperty(stylesheetElement, "innerText", {
      get: function (this: HTMLStyleElement) {
        return innerTextGetter.call(this);
      },
      set: function (this: HTMLStyleElement, code: string) {
        innerTextSetter.call(this, cssLoader(code, "", curUrl));
        nextTick(() => handleStylesheetElementPatch(this, sandbox));
      },
    });
  }

  if (textContentGetter && textContentSetter) {
    Object.defineProperty(stylesheetElement, "textContent", {
      get: function (this: HTMLStyleElement) {
        return textContentGetter.call(this);
      },
      set: function (this: HTMLStyleElement, code: string) {
        textContentSetter.call(this, cssLoader(code, "", curUrl));
        nextTick(() => handleStylesheetElementPatch(this, sandbox));
      },
    });
  }

  Object.defineProperties(stylesheetElement, {
    appendChild: {
      value: function (node: Node): Node {
        nextTick(() => handleStylesheetElementPatch(this, sandbox));
        if (node.nodeType === Node.TEXT_NODE) {
          const res = rawAppendChild.call(
            stylesheetElement,
            stylesheetElement.ownerDocument.createTextNode(cssLoader(node.textContent ?? "", "", curUrl))
          );
          // 当appendChild之后，样式元素的sheet对象发生改变，要重新patch
          patchSheetInsertRule();
          return res;
        } else return rawAppendChild.call(stylesheetElement, node);
      },
    },
    insertAdjacentElement: {
      value: function (this: HTMLStyleElement, position: InsertPosition, element: Element) {
        if (element.nodeName === "STYLE") {
          // 关联 issue: https://github.com/Tencent/wujie/issues/1059
          //
          // vite dev server 第一个 css 通过 head.appendChild 插入，后续每个 css 都走
          // lastInsertedStyle.insertAdjacentElement("afterend", style)，hot update 时
          // 直接 style.textContent = newContent。被 insertAdjacentElement 插入的 style
          // 必须获得与"第一个 style"完全一致的劫持能力，否则：
          //   1) 当前内容里的资源相对路径不会被 cssLoader 改写（@font-face 失效）；
          //   2) 后续 textContent / innerHTML / appendChild / sheet.insertRule
          //      绕过 wujie，hot update 全部脱管；
          //   3) 链式 insertAdjacentElement 创建的下游 style 直接走原生实现。
          // 因此这里必须复用与 case "STYLE" 完全一致的处理流程：先用 cssLoader 改写
          // 当前内容，再 patchStylesheetElement 把劫持递归装到新 style 上。
          const stylesheetElement = element as HTMLStyleElement;
          const content = stylesheetElement.innerHTML;
          if (content) stylesheetElement.innerHTML = cssLoader(content, "", curUrl);
          const res = rawInsertAdjacentElement.call(this, position, element);
          sandbox.styleSheetElements.push(stylesheetElement);
          patchStylesheetElement(stylesheetElement, cssLoader, sandbox, curUrl);
          handleStylesheetElementPatch(stylesheetElement, sandbox);
          return res;
        } else return rawInsertAdjacentElement.call(this, position, element);
      },
    },
    _hasPatchStyle: { get: () => true },
  });
}

// href 延迟赋值的兜底超时（毫秒）：超过该时间仍未拿到 href，则放弃监听并触发 error，
// 防止「href 永不到达」时 observer 闭包长期钉住子应用上下文。沿用 tinymce maxLoadTime 量级。
const DEFER_STYLE_HREF_TIMEOUT = 5000;

/**
 * 处理「先 appendChild(link) 后 setAttribute('href')」的延迟 href 场景。
 *
 * 通过 MutationObserver 监听 href 属性赋值，命中后走传入的 loadStyleSheet 完成加载。
 * 生命周期管理（避免内存泄漏）：
 *   1. 命中 / 超时 / 子应用已销毁 时立即 disconnect 并从 sandbox 出队；
 *   2. observer 登记到 sandbox.deferredStyleObservers，destroy 阶段统一兜底 disconnect；
 *   3. 回调内通过 wujieId 动态获取 sandbox，不捕获 sandbox/iframe，子应用销毁后闭包不再 pin 上下文。
 */
export function deferStyleSheetByHref(opts: {
  element: HTMLLinkElement;
  wujieId: string;
  iframeWindow: Window;
  loadStyleSheet: (href: string, element: HTMLLinkElement) => void;
}): void {
  let element: HTMLLinkElement | null = opts.element;
  const { wujieId, iframeWindow, loadStyleSheet } = opts;
  // 部分环境（jsdom / 老浏览器）可能不支持 MutationObserver，直接放弃延迟处理
  const MutationObserverCtor = (iframeWindow as Window & { MutationObserver?: typeof MutationObserver })
    .MutationObserver;
  if (typeof MutationObserverCtor !== "function") return;

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let registration: Pick<MutationObserver, "disconnect">;
  let unregisterCancellation: (() => void) | undefined;
  const observer: MutationObserver = new MutationObserverCtor(() => {
    if (settled) return;
    const target = element;
    if (!target) return;
    const attrHref = target.getAttribute("href");
    if (!attrHref) return;
    const realHref = target.href || attrHref;
    finalize(() => loadStyleSheet(realHref, target));
  });

  // 统一收尾：disconnect + 出队 + 清理定时器，再执行收尾动作
  function finalize(action?: () => void) {
    if (settled) return;
    settled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    unregisterCancellation?.();
    unregisterCancellation = undefined;
    try {
      observer.disconnect();
    } catch (_) {
      /* noop */
    }
    // 动态获取 sandbox，子应用销毁后直接放手，闭包不再钉住上下文
    const sandbox = getWujieById(wujieId);
    const observers = sandbox?.deferredStyleObservers;
    if (Array.isArray(observers)) {
      const index = observers.indexOf(registration);
      if (index !== -1) observers.splice(index, 1);
    }
    if (sandbox) action?.();
    element = null;
  }

  const sandbox = getWujieById(wujieId);
  // 子应用已不存在则无需监听
  if (!sandbox || !Array.isArray(sandbox.deferredStyleObservers)) return;
  if (!isDynamicEffectContextLive(sandbox, wujieId)) {
    const target = element;
    element = null;
    if (target) nextTick(() => elementEventForwarder.dispatch(target, "error"));
    return;
  }
  registration = { disconnect: () => finalize() };
  sandbox.deferredStyleObservers.push(registration);
  unregisterCancellation = registerSandboxDynamicResource(sandbox, (reason) => {
    const target = element;
    const liveSandbox = getWujieById(wujieId);
    finalize();
    if (reason === "unmount" && target && liveSandbox) elementEventForwarder.dispatch(target, "error");
  });
  observer.observe(element, { attributes: true, attributeFilter: ["href"] });
  // 超时兜底：长时间没等到 href，放弃监听并触发 error，让上游（如 tinymce）的失败回调收尾
  timer = setTimeout(() => {
    const target = element;
    const liveSandbox = getWujieById(wujieId);
    finalize();
    if (target && liveSandbox) elementEventForwarder.dispatch(target, "error");
  }, DEFER_STYLE_HREF_TIMEOUT);
}

type HijackingTagName = "LINK" | "STYLE" | "SCRIPT" | "IFRAME";
type InsertionTarget = HTMLHeadElement | HTMLBodyElement;

interface InsertionContext {
  readonly target: InsertionTarget;
  element: HTMLElement | null;
  readonly refChild?: Node | null;
  readonly rawInsert: RawDomInsertion;
  readonly wujieId: string;
  readonly sandbox: Wujie;
  readonly iframeDocument: Document;
  readonly iframeWindow: Window;
  readonly curUrl: string;
}

/** Dynamic effects may continue while kept alive, but never after a normal inactive unmount. */
export function isDynamicEffectContextLive(sandbox: Wujie, wujieId: string): boolean {
  return (
    !sandbox.destroyed &&
    Boolean(sandbox.iframe) &&
    (sandbox.alive || sandbox.activeFlag) &&
    getWujieById(wujieId) === sandbox
  );
}

type TypedInsertionHandler<TElement extends HTMLElement> = (context: InsertionContext, element: TElement) => Node;

function insertNode<T extends Node>(context: InsertionContext, node: T): T {
  return context.rawInsert.call(context.target, node, context.refChild) as T;
}

function invokeInsertionHook(context: InsertionContext, element: HTMLElement): void {
  execHooks(context.sandbox.plugins, "appendOrInsertElementHook", element, context.iframeWindow);
}

function insertElementWithHook<T extends HTMLElement>(context: InsertionContext, element: T): T {
  const result = insertNode(context, element);
  invokeInsertionHook(context, element);
  return result;
}

function createInsertionHandler<TElement extends HTMLElement>(
  key: HijackingTagName,
  handle: TypedInsertionHandler<TElement>
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
    }
  );
}

class StylesheetResourceLoader {
  private linkElement: HTMLLinkElement | null;
  private placeholderElement: HTMLStyleElement | null = null;
  private unregisterCancellation?: () => void;
  private cancelled = false;

  constructor(private readonly context: InsertionContext, linkElement: HTMLLinkElement) {
    this.linkElement = linkElement;
  }

  load = (realHref: string, requestedElement: HTMLLinkElement): void => {
    const linkElement = this.linkElement;
    if (!linkElement || linkElement !== requestedElement) return;
    if (!this.isLive()) {
      this.release();
      nextTick(() => elementEventForwarder.dispatch(linkElement, "error"));
      return;
    }
    const { sandbox } = this.context;
    const { plugins, proxyLocation, fetch, lifecycles, replace, styleSheetElements } = sandbox;
    const attrHref = linkElement.getAttribute("href");
    const styleHref = attrHref ? getAbsolutePath(attrHref, (proxyLocation as Location).href) : realHref;
    if (!styleHref || isMatchUrl(styleHref, getEffectLoaders("cssExcludes", plugins))) return;

    const placeholderElement = this.context.iframeDocument.createElement("style");
    this.placeholderElement = placeholderElement;
    this.unregisterCancellation = registerSandboxDynamicResource(sandbox, (reason) => this.cancel(reason));
    setAttrsToElement(placeholderElement, parseTagAttributes(linkElement.outerHTML));
    placeholderElement.setAttribute("data-wujie-css-href", styleHref);
    insertNode(this.context, placeholderElement);

    getExternalStyleSheets(
      [{ src: styleHref, ignore: isMatchUrl(styleHref, getEffectLoaders("cssIgnores", plugins)) }],
      fetch,
      lifecycles.loadError,
      sandbox.assetCacheScope
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
            if (shouldNotify) elementEventForwarder.dispatch(linkElement, "error");
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
          elementEventForwarder.dispatch(linkElement, "load");
        },
        () => {
          placeholderElement.parentNode?.removeChild(placeholderElement);
          const shouldNotify = this.isLive();
          this.release();
          if (shouldNotify) elementEventForwarder.dispatch(linkElement, "error");
        }
      );
      releaseAfter(pendingLoad, () => this.release());
    });
  };

  private isLive(): boolean {
    const { sandbox, wujieId } = this.context;
    return !this.cancelled && isDynamicEffectContextLive(sandbox, wujieId);
  }

  private cancel(reason: SandboxDynamicResourceCancellationReason): void {
    const linkElement = this.linkElement;
    if (!linkElement) return;
    this.cancelled = true;
    this.placeholderElement?.parentNode?.removeChild(this.placeholderElement);
    const shouldNotify = reason === "unmount" && !this.context.sandbox.destroyed;
    this.release();
    if (shouldNotify) {
      elementEventForwarder.dispatch(linkElement, "error");
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

function toScriptCrossOrigin(value: string | null): "anonymous" | "use-credentials" | "" {
  return (value || "") as "anonymous" | "use-credentials" | "";
}

class DynamicScriptScheduler {
  private scriptElement: HTMLScriptElement | null;
  private executionQueue: Array<() => unknown> | null = null;
  private queuedTask?: () => unknown;
  private laneReservation?: () => unknown;
  private executionHandle?: ReturnType<typeof insertScriptToIframe>;
  private unregisterCancellation?: () => void;
  private completionStarted = false;

  constructor(private readonly context: InsertionContext, scriptElement: HTMLScriptElement) {
    this.scriptElement = scriptElement;
  }

  schedule(): void {
    const { sandbox } = this.context;
    const scriptElement = this.scriptElement;
    if (!scriptElement) return;
    if (!this.isLive()) {
      this.release();
      nextTick(() => elementEventForwarder.dispatch(scriptElement, "error"));
      return;
    }
    this.unregisterCancellation = registerSandboxDynamicResource(sandbox, (reason) => this.cancel(reason));
    const { src, text, type, crossOrigin } = scriptElement;
    const isModule = type.toLowerCase() === "module";
    setTagToScript(scriptElement);

    if (src && !isMatchUrl(src, getEffectLoaders("jsExcludes", sandbox.plugins))) {
      const scriptOptions: ScriptObject = {
        src,
        module: isModule,
        crossorigin: crossOrigin !== null,
        crossoriginType: toScriptCrossOrigin(crossOrigin),
        ignore: isMatchUrl(src, getEffectLoaders("jsIgnores", sandbox.plugins)),
        attrs: parseTagAttributes(scriptElement.outerHTML),
      };
      getExternalScripts(
        [scriptOptions],
        sandbox.fetch,
        sandbox.lifecycles.loadError,
        sandbox.fiber,
        sandbox.assetCacheScope
      ).forEach((scriptResult) => this.scheduleExternal(scriptResult));
      return;
    }

    this.enqueue(() => {
      const pendingElement = this.scriptElement;
      if (!pendingElement) return;
      if (!this.isLive()) {
        warn(WUJIE_TIPS_REPEAT_RENDER);
        this.cancelQueuedTask();
        return;
      }
      const iframeWindow = sandbox.iframe.contentWindow;
      if (!iframeWindow) {
        this.cancelQueuedTask();
        return;
      }
      const inlineScript: ScriptObject = {
        content: text,
        module: isModule,
        attrs: parseTagAttributes(pendingElement.outerHTML),
      };
      if (isModule) this.executeWithForwardedOutcome(inlineScript);
      else {
        try {
          insertScriptToIframe(inlineScript, iframeWindow, pendingElement);
        } finally {
          this.release();
        }
      }
    });
  }

  private scheduleExternal(scriptResult: ScriptObject & { contentPromise: Promise<string> }): void {
    scheduleSandboxDynamicScript(this.context.sandbox, scriptResult.contentPromise, {
      fulfilled: (content) => {
        if (!this.isLive()) {
          this.release();
          return warn(WUJIE_TIPS_REPEAT_RENDER);
        }
        this.enqueue(() => this.executeWithForwardedOutcome({ ...scriptResult, content }));
      },
      rejected: () => {
        const pendingElement = this.scriptElement;
        const shouldNotify = Boolean(pendingElement && this.isLive());
        this.release();
        if (pendingElement && shouldNotify) elementEventForwarder.dispatch(pendingElement, "error");
      },
      cancelled: (reason) => this.cancel(reason),
    });
  }

  private executeWithForwardedOutcome(scriptResult: ScriptObject): void {
    const { sandbox } = this.context;
    const pendingElement = this.scriptElement;
    if (!pendingElement) return;
    if (!this.isLive()) {
      warn(WUJIE_TIPS_REPEAT_RENDER);
      this.cancelQueuedTask();
      return;
    }
    const complete = (outcome: ResourceEventName) => {
      if (this.completionStarted) return;
      this.completionStarted = true;
      const completedElement = this.scriptElement;
      const shouldNotify = Boolean(completedElement && this.isLive());
      try {
        if (completedElement && shouldNotify) elementEventForwarder.dispatch(completedElement, outcome);
      } finally {
        // insertScriptToIframe advances execQueue immediately after this
        // callback. Leave our reservation in place across user event handlers
        // so reentrant script insertion cannot observe an empty lane.
        this.release(true);
      }
    };
    const iframeWindow = sandbox.iframe.contentWindow;
    if (!iframeWindow) {
      this.cancelQueuedTask();
      return;
    }
    try {
      const executionHandle = insertScriptToIframe(
        {
          ...scriptResult,
          onload: () => complete("load"),
          onerror: () => complete("error"),
        },
        iframeWindow,
        pendingElement
      );
      if (this.scriptElement) {
        this.executionHandle = executionHandle;
      }
    } catch (cause: unknown) {
      const failedElement = this.scriptElement;
      // Loader/DOM setup failed before insertScriptToIframe could publish a
      // completion handle. This task has already left execQueue, so explicitly
      // advance the lane and surface the failure through the original element.
      if (!failedElement) return;
      const shouldNotify = this.isLive();
      this.cancelQueuedTask();
      if (shouldNotify) elementEventForwarder.dispatch(failedElement, "error");
      warn(cause);
    }
  }

  private enqueue(task: () => unknown): void {
    const { sandbox } = this.context;
    const queue = sandbox.execQueue;
    if (!Array.isArray(queue) || !this.isLive()) {
      warn(WUJIE_TIPS_REPEAT_RENDER);
      this.release();
      return;
    }
    const queueWasEmpty = queue.length === 0;
    this.executionQueue = queue;
    const runIfLive = () => {
      if (!this.isLive()) {
        this.cancelQueuedTask();
        return;
      }
      task();
    };
    const queuedTask = () => {
      this.queuedTask = undefined;
      this.reserveExecutionLane(queue);
      return sandbox.fiber ? sandbox.requestIdleCallback(runIfLive, () => this.cancelQueuedTask()) : runIfLive();
    };
    this.queuedTask = queuedTask;
    queue.push(queuedTask);
    if (queueWasEmpty) queue.shift()?.();
  }

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
    const { sandbox, wujieId } = this.context;
    return isDynamicEffectContextLive(sandbox, wujieId);
  }

  private cancel(reason: SandboxDynamicResourceCancellationReason): void {
    const pendingElement = this.scriptElement;
    if (!pendingElement) return;
    const shouldNotify = reason === "unmount" && !this.context.sandbox.destroyed && !this.completionStarted;
    this.executionHandle?.cancel();
    this.release();
    if (shouldNotify) {
      elementEventForwarder.dispatch(pendingElement, "error");
    }
  }

  /** The current task has already been shifted, so cancellation must advance the remaining queue. */
  private cancelQueuedTask(): void {
    const queue = this.executionQueue ?? this.context.sandbox.execQueue;
    const ownsLane = Boolean(this.laneReservation);
    this.release();
    if (ownsLane && Array.isArray(queue)) queue.shift()?.();
  }

  private release(preserveExecutionLane = false): void {
    const queue = this.executionQueue ?? this.context.sandbox.execQueue;
    if (Array.isArray(queue)) {
      if (this.queuedTask) {
        const queuedIndex = queue.indexOf(this.queuedTask);
        if (queuedIndex !== -1) queue.splice(queuedIndex, 1);
      }
      if (this.laneReservation && !preserveExecutionLane) {
        const reservationIndex = queue.indexOf(this.laneReservation);
        if (reservationIndex !== -1) queue.splice(reservationIndex, 1);
      }
    }
    this.queuedTask = undefined;
    if (!preserveExecutionLane) this.laneReservation = undefined;
    this.unregisterCancellation?.();
    this.unregisterCancellation = undefined;
    this.executionHandle = undefined;
    this.scriptElement = null;
    this.context.element = null;
    this.executionQueue = null;
  }
}

const linkInsertionHandler = createInsertionHandler<HTMLLinkElement>("LINK", (context, linkElement) => {
  const { href, rel, type } = linkElement;
  const isStylesheet = rel === "stylesheet" || type === "text/css" || href.endsWith(".css");
  if (!isStylesheet) return insertElementWithHook(context, linkElement);

  const resourceLoader = new StylesheetResourceLoader(context, linkElement);
  if (href) {
    if (!isMatchUrl(href, getEffectLoaders("cssExcludes", context.sandbox.plugins))) {
      resourceLoader.load(href, linkElement);
    }
  } else {
    deferStyleSheetByHref({
      element: linkElement,
      wujieId: context.wujieId,
      iframeWindow: context.iframeWindow,
      loadStyleSheet: resourceLoader.load,
    });
  }

  return insertNode(context, context.iframeDocument.createComment(`dynamic link ${href} replaced by wujie`));
});

const styleInsertionHandler = createInsertionHandler<HTMLStyleElement>("STYLE", (context, stylesheetElement) => {
  const { sandbox } = context;
  sandbox.styleSheetElements.push(stylesheetElement);
  const cssLoader = getCssLoader({ plugins: sandbox.plugins, replace: sandbox.replace });
  const content = stylesheetElement.innerHTML;
  if (content) stylesheetElement.innerHTML = cssLoader(content, "", context.curUrl);
  const result = insertNode(context, stylesheetElement);
  patchStylesheetElement(stylesheetElement, cssLoader, sandbox, context.curUrl);
  handleStylesheetElementPatch(stylesheetElement, sandbox);
  invokeInsertionHook(context, stylesheetElement);
  return result;
});

const scriptInsertionHandler = createInsertionHandler<HTMLScriptElement>("SCRIPT", (context, scriptElement) => {
  new DynamicScriptScheduler(context, scriptElement).schedule();
  return insertNode(
    context,
    context.iframeDocument.createComment(`dynamic script ${scriptElement.src} replaced by wujie`)
  );
});

const iframeInsertionHandler = createInsertionHandler<HTMLIFrameElement>("IFRAME", (context, iframeElement) => {
  if (iframeElement.getAttribute(WUJIE_DATA_FLAG) === "") {
    const documentElement = rawDocumentQuerySelector.call(context.target.ownerDocument, "html");
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

function toHijackingTagName(tagName: string): HijackingTagName {
  return tagName.toUpperCase() as HijackingTagName;
}

function insertUnmanagedElement<T extends Node>(context: InsertionContext, element: T): T {
  const result = insertNode(context, element);
  patchElementEffect(element as unknown as HTMLElement, context.iframeWindow);
  execHooks(context.sandbox.plugins, "appendOrInsertElementHook", element, context.iframeWindow);
  return result;
}

function rewriteAppendOrInsertChild(opts: { rawDOMAppendOrInsertBefore: RawDomInsertion; wujieId: string }) {
  return function appendChildOrInsertBefore<T extends Node>(
    this: InsertionTarget,
    newChild: T,
    refChild?: Node | null
  ): T {
    const element = newChild as unknown as HTMLElement;
    const sandbox = getWujieById(opts.wujieId);
    // Patched head/body nodes can outlive their sandbox briefly. In that
    // window, preserve native DOM behavior instead of dereferencing a released
    // iframe through the stale patch closure.
    if (!sandbox?.iframe) {
      return opts.rawDOMAppendOrInsertBefore.call(this, newChild, refChild) as T;
    }
    const iframeDocument = sandbox.iframe.contentDocument;
    const iframeWindow = sandbox.iframe.contentWindow;
    if (!iframeDocument || !iframeWindow) {
      return opts.rawDOMAppendOrInsertBefore.call(this, newChild, refChild) as T;
    }
    const context: InsertionContext = {
      target: this,
      element,
      refChild,
      rawInsert: opts.rawDOMAppendOrInsertBefore,
      wujieId: opts.wujieId,
      sandbox,
      iframeDocument,
      iframeWindow,
      curUrl: getCurUrl(sandbox.proxyLocation),
    };

    if (!isHijackingTag(element.tagName) || !opts.wujieId) {
      return insertUnmanagedElement(context, newChild);
    }

    return insertionPipeline.dispatch(toHijackingTagName(element.tagName), context, (fallbackContext) =>
      insertUnmanagedElement(fallbackContext, newChild)
    ) as T;
  };
}

function findScriptElementFromIframe(rawElement: HTMLScriptElement, wujieId: string) {
  const wujieTag = getTagFromScript(rawElement);
  const sandbox = getWujieById(wujieId);
  if (!sandbox?.iframe) return { targetScript: null, rawHead: null };
  const { iframe } = sandbox;
  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) return { targetScript: null, rawHead: null };
  const rawHead = iframeWindow.__WUJIE_RAW_DOCUMENT_HEAD__;
  const targetScript = rawHead.querySelector(`script[${WUJIE_SCRIPT_ID}='${wujieTag}']`);
  if (targetScript === null) {
    warn(WUJIE_TIPS_NO_SCRIPT, `<script ${WUJIE_SCRIPT_ID}='${wujieTag}'/>`);
  }
  return { targetScript, rawHead };
}

function rewriteContains(opts: { rawElementContains: (other: Node | null) => boolean; wujieId: string }) {
  return function contains(other: Node | null) {
    const element = other as HTMLElement;
    const { rawElementContains, wujieId } = opts;
    if (element && isScriptElement(element)) {
      const { targetScript, rawHead } = findScriptElementFromIframe(element as HTMLScriptElement, wujieId);
      if (!rawHead) return rawElementContains(element);
      return targetScript !== null;
    }
    return rawElementContains(element);
  };
}

function rewriteRemoveChild(opts: { rawElementRemoveChild: <T extends Node>(child: T) => T; wujieId: string }) {
  return function removeChild(child: Node) {
    const element = child as HTMLElement;
    const { rawElementRemoveChild, wujieId } = opts;
    if (element && isScriptElement(element)) {
      const { targetScript, rawHead } = findScriptElementFromIframe(element as HTMLScriptElement, wujieId);
      if (!rawHead) return rawElementRemoveChild(element);
      if (targetScript !== null) {
        return rawHead.removeChild(targetScript);
      }
      return null;
    }
    return rawElementRemoveChild(element);
  };
}

/**
 * 记录head和body的事件，等重新渲染复用head和body时需要清空事件
 */
function captureOption(options?: boolean | AddEventListenerOptions): boolean {
  return typeof options === "boolean" ? options : Boolean(options?.capture);
}

function patchEventListener(element: HTMLHeadElement | HTMLBodyElement): void {
  const listenerMap: HTMLHeadElement["_cacheListeners"] = new Map();
  element._cacheListeners = listenerMap;

  element.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
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
    options?: boolean | AddEventListenerOptions
  ) => {
    const typeListeners = listenerMap.get(type);
    const capture = captureOption(options);
    const index = typeListeners?.findIndex(
      (entry) => entry.listener === listener && captureOption(entry.options) === capture
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
export function patchRenderEffect(render: ShadowRoot | Document, id: string, degrade: boolean): void {
  // 降级场景dom渲染在iframe中，iframe移动后事件自动销毁，不需要记录
  if (!degrade) {
    patchEventListener(render.head);
    patchEventListener(render.body as HTMLBodyElement);
  }

  render.head.appendChild = rewriteAppendOrInsertChild({
    rawDOMAppendOrInsertBefore: rawAppendChild,
    wujieId: id,
  }) as typeof rawAppendChild;
  render.head.insertBefore = rewriteAppendOrInsertChild({
    rawDOMAppendOrInsertBefore: rawHeadInsertBefore as unknown as RawDomInsertion,
    wujieId: id,
  }) as typeof rawHeadInsertBefore;
  render.head.removeChild = rewriteRemoveChild({
    rawElementRemoveChild: rawElementRemoveChild.bind(render.head),
    wujieId: id,
  }) as typeof rawElementRemoveChild;
  render.head.contains = rewriteContains({
    rawElementContains: rawElementContains.bind(render.head),
    wujieId: id,
  }) as typeof rawElementContains;
  render.contains = rewriteContains({
    rawElementContains: rawElementContains.bind(render),
    wujieId: id,
  }) as typeof rawElementContains;
  render.body.appendChild = rewriteAppendOrInsertChild({
    rawDOMAppendOrInsertBefore: rawAppendChild,
    wujieId: id,
  }) as typeof rawAppendChild;
  render.body.insertBefore = rewriteAppendOrInsertChild({
    rawDOMAppendOrInsertBefore: rawBodyInsertBefore as unknown as RawDomInsertion,
    wujieId: id,
  }) as typeof rawBodyInsertBefore;
}
