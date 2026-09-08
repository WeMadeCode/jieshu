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
  isFunction,
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

function patchCustomEvent(
  e: CustomEvent,
  elementGetter: () => HTMLScriptElement | HTMLLinkElement | null,
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
type ResourceEventName = 'load' | 'error';

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

/**
 * 劫持处理样式元素的属性
 * @internal 仅出于可测性导出，外部不应直接调用
 */
export function patchStylesheetElement(
  stylesheetElement: HTMLStyleElement & { _hasPatchStyle?: boolean },
  cssLoader: (code: string, url: string, base: string) => string,
  sandbox: Jieshu,
  curUrl: string,
) {
  if (stylesheetElement._hasPatchStyle) return;
  const innerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  const innerTextDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
  const textContentDesc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
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
          innerHTMLSetter.call(this, cssLoader(code, '', curUrl));
          nextTick(() => handleStylesheetElementPatch(this, sandbox));
        },
      },
    });
  }

  if (innerTextGetter && innerTextSetter) {
    Object.defineProperty(stylesheetElement, 'innerText', {
      get: function (this: HTMLStyleElement) {
        return innerTextGetter.call(this);
      },
      set: function (this: HTMLStyleElement, code: string) {
        innerTextSetter.call(this, cssLoader(code, '', curUrl));
        nextTick(() => handleStylesheetElementPatch(this, sandbox));
      },
    });
  }

  if (textContentGetter && textContentSetter) {
    Object.defineProperty(stylesheetElement, 'textContent', {
      get: function (this: HTMLStyleElement) {
        return textContentGetter.call(this);
      },
      set: function (this: HTMLStyleElement, code: string) {
        textContentSetter.call(this, cssLoader(code, '', curUrl));
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
            stylesheetElement.ownerDocument.createTextNode(cssLoader(node.textContent ?? '', '', curUrl)),
          );
          // 当appendChild之后，样式元素的sheet对象发生改变，要重新patch
          patchSheetInsertRule();
          return res;
        } else return rawAppendChild.call(stylesheetElement, node);
      },
    },
    insertAdjacentElement: {
      value: function (this: HTMLStyleElement, position: InsertPosition, element: Element) {
        if (element.nodeName === 'STYLE') {
          // 关联上游历史 issue #1059
          //
          // vite dev server 第一个 css 通过 head.appendChild 插入，后续每个 css 都走
          // lastInsertedStyle.insertAdjacentElement("afterend", style)，hot update 时
          // 直接 style.textContent = newContent。被 insertAdjacentElement 插入的 style
          // 必须获得与"第一个 style"完全一致的劫持能力，否则：
          //   1) 当前内容里的资源相对路径不会被 cssLoader 改写（@font-face 失效）；
          //   2) 后续 textContent / innerHTML / appendChild / sheet.insertRule
          //      绕过 jieshu，hot update 全部脱管；
          //   3) 链式 insertAdjacentElement 创建的下游 style 直接走原生实现。
          // 因此这里必须复用与 case "STYLE" 完全一致的处理流程：先用 cssLoader 改写
          // 当前内容，再 patchStylesheetElement 把劫持递归装到新 style 上。
          const stylesheetElement = element as HTMLStyleElement;
          const content = stylesheetElement.innerHTML;
          if (content) stylesheetElement.innerHTML = cssLoader(content, '', curUrl);
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
 *   3. 回调内通过 jieshuId 动态获取 sandbox，不捕获 sandbox/iframe，子应用销毁后闭包不再 pin 上下文。
 */
export function deferStyleSheetByHref(opts: {
  element: HTMLLinkElement;
  jieshuId: string;
  iframeWindow: Window;
  loadStyleSheet: (href: string, element: HTMLLinkElement) => void;
}): void {
  let element: HTMLLinkElement | null = opts.element;
  const { jieshuId, iframeWindow, loadStyleSheet } = opts;
  // 部分环境（jsdom / 老浏览器）可能不支持 MutationObserver，直接放弃延迟处理
  const MutationObserverCtor = (iframeWindow as Window & { MutationObserver?: typeof MutationObserver })
    .MutationObserver;
  if (typeof MutationObserverCtor !== 'function') return;

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let registration: Pick<MutationObserver, 'disconnect'>;
  let unregisterCancellation: (() => void) | undefined;
  const observer: MutationObserver = new MutationObserverCtor(() => {
    if (settled) return;
    const target = element;
    if (!target) return;
    const attrHref = target.getAttribute('href');
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
    const sandbox = getJieshuById(jieshuId);
    const observers = sandbox?.deferredStyleObservers;
    if (Array.isArray(observers)) {
      const index = observers.indexOf(registration);
      if (index !== -1) observers.splice(index, 1);
    }
    if (sandbox) action?.();
    element = null;
  }

  const sandbox = getJieshuById(jieshuId);
  // 子应用已不存在则无需监听
  if (!sandbox || !Array.isArray(sandbox.deferredStyleObservers)) return;
  if (!isDynamicEffectContextLive(sandbox, jieshuId)) {
    const target = element;
    element = null;
    if (target) nextTick(() => elementEventForwarder.dispatch(target, 'error'));
    return;
  }
  registration = { disconnect: () => finalize() };
  sandbox.deferredStyleObservers.push(registration);
  unregisterCancellation = registerSandboxDynamicResource(sandbox, (reason) => {
    const target = element;
    const liveSandbox = getJieshuById(jieshuId);
    finalize();
    if (reason === 'unmount' && target && liveSandbox) elementEventForwarder.dispatch(target, 'error');
  });
  observer.observe(element, { attributes: true, attributeFilter: ['href'] });
  // 超时兜底：长时间没等到 href，放弃监听并触发 error，让上游（如 tinymce）的失败回调收尾
  timer = setTimeout(() => {
    const target = element;
    const liveSandbox = getJieshuById(jieshuId);
    finalize();
    if (target && liveSandbox) elementEventForwarder.dispatch(target, 'error');
  }, DEFER_STYLE_HREF_TIMEOUT);
}

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
