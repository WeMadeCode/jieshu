import type WuJie from "./sandbox";
import { renderElementToContainer } from "./shadow";
import { syncUrlToWindow } from "./sync";
import {
  fixElementCtrSrcOrHref,
  isConstructable,
  anchorElementGenerator,
  isMatchSyncQueryById,
  isFunction,
  warn,
  execHooks,
  getAbsolutePath,
  setAttrsToElement,
} from "./utils";
import {
  documentProxyProperties,
  rawAddEventListener,
  rawRemoveEventListener,
  rawDocumentQuerySelector,
  mainDocumentAddEventListenerEvents,
  mainAndAppAddEventListenerEvents,
  appDocumentAddEventListenerEvents,
  appDocumentOnEvents,
  appWindowAddEventListenerEvents,
  appWindowOnEvent,
  windowProxyProperties,
  windowRegWhiteList,
  rawWindowAddEventListener,
  rawWindowRemoveEventListener,
} from "./common";
import type { appAddEventListenerOptions } from "./common";
import { WUJIE_DATA_FLAG } from "./constant";
import type { IframeAttributes } from "./contracts";
import { compileInlineEvents, patchInlineEventSetAttribute } from "./iframe-inline-events";

export { insertScriptToIframe } from "./iframe-script";

const extraInstanceofConstructorNames = new Set([
  "ClipboardEvent",
  "CSSStyleDeclaration",
  "DataTransfer",
  "DOMImplementation",
  "DOMMatrix",
  "DOMMatrixReadOnly",
  "DOMParser",
  "DOMPoint",
  "DOMPointReadOnly",
  "DOMQuad",
  "DOMRect",
  "DOMRectList",
  "DOMRectReadOnly",
  "DOMStringList",
  "DOMStringMap",
  "DOMTokenList",
  "HTMLCollection",
  "MediaList",
  "NamedNodeMap",
  "Range",
  "Selection",
  "StyleSheet",
  "StyleSheetList",
  "TextDecoder",
  "TextEncoder",
  "TimeRanges",
]);

interface CachedElementEventListener {
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
}

interface FeaturePolicyInspector {
  allowsFeature(feature: string): boolean;
  features?(): ReadonlyArray<string>;
}

type PolicyAwareDocument = Document & {
  featurePolicy?: FeaturePolicyInspector;
  permissionsPolicy?: FeaturePolicyInspector;
};

declare global {
  interface Window {
    // 是否存在无界
    __POWERED_BY_WUJIE__?: boolean;
    // 子应用公共加载路径
    __WUJIE_PUBLIC_PATH__: string;
    // 原生的querySelector
    __WUJIE_RAW_DOCUMENT_QUERY_SELECTOR__: typeof Document.prototype.querySelector;

    // iframe内原生的createElement
    __WUJIE_RAW_DOCUMENT_CREATE_ELEMENT__: typeof Document.prototype.createElement;

    // iframe内原生的createTextNode
    __WUJIE_RAW_DOCUMENT_CREATE_TEXT_NODE__: typeof Document.prototype.createTextNode;

    // iframe内原生的head
    __WUJIE_RAW_DOCUMENT_HEAD__: typeof Document.prototype.head;

    // 原生的querySelector
    __WUJIE_RAW_DOCUMENT_QUERY_SELECTOR_ALL__: typeof Document.prototype.querySelectorAll;
    // 原生的window对象
    __WUJIE_RAW_WINDOW__: Window;
    // 子应用沙盒实例
    __WUJIE: WuJie;
    // 子应用共享上下文
    __WUJIE_INJECT: WuJie["inject"];
    // 记录注册在主应用中的事件
    __WUJIE_EVENTLISTENER__: Set<{
      listener: EventListenerOrEventListenerObject;
      type: string;
      options?: boolean | AddEventListenerOptions;
    }>;
    // 子应用mount函数
    __WUJIE_MOUNT: () => void;
    // 子应用unmount函数
    __WUJIE_UNMOUNT: () => void | Promise<void>;
    // 获取子应用 window 的辅助函数（用于内联事件处理器），入参为子应用 appId
    __getWujieWindow__: (appId: string) => WindowProxy | null;
    // document type
    Document: typeof Document;
    // img type
    HTMLImageElement: typeof HTMLImageElement;
    // node type
    Node: typeof Node;
    // element type
    Element: typeof Element;
    // htmlElement typeof
    HTMLElement: typeof HTMLElement;
    // anchor type
    HTMLAnchorElement: typeof HTMLAnchorElement;
    // source type
    HTMLSourceElement: typeof HTMLSourceElement;
    // link type
    HTMLLinkElement: typeof HTMLLinkElement;
    // script type
    HTMLScriptElement: typeof HTMLScriptElement;
    // media type
    HTMLMediaElement: typeof HTMLMediaElement;
    EventTarget: typeof EventTarget;
    Event: typeof Event;
    ShadowRoot: typeof ShadowRoot;
    // 注入对象
    $wujie: WuJie["provide"];
  }
  interface HTMLHeadElement {
    _cacheListeners: Map<string, CachedElementEventListener[]>;
  }
  interface HTMLBodyElement {
    _cacheListeners: Map<string, CachedElementEventListener[]>;
  }
  interface Document {
    createTreeWalker(
      root: Node,
      whatToShow?: number,
      filter?: NodeFilter | null,
      entityReferenceExpansion?: boolean
    ): TreeWalker;
  }
}

/**
 * Chrome 将 unload 逐步改为受 Permissions Policy 控制。策略明确禁用时，
 * 原生 addEventListener 本身就是 no-op，但调用仍会向控制台打印 Violation。
 * 无法检查策略或浏览器尚未识别该 feature 时维持原行为。
 */
export function isWindowEventAllowedByPolicy(targetWindow: Window, type: string): boolean {
  if (type !== "unload") return true;

  try {
    const targetDocument = targetWindow.document as PolicyAwareDocument;
    const policy = targetDocument.permissionsPolicy ?? targetDocument.featurePolicy;
    if (!policy || typeof policy.allowsFeature !== "function") return true;

    const supportedFeatures = typeof policy.features === "function" ? policy.features() : undefined;
    if (supportedFeatures && !supportedFeatures.includes("unload")) return true;
    return policy.allowsFeature("unload");
  } catch (_) {
    // 跨域 targetWindow、旧浏览器或非标准实现不应改变既有监听行为。
    return true;
  }
}

function patchPolicyControlledUnloadProperty(iframeWindow: Window): void {
  const descriptor = Object.getOwnPropertyDescriptor(iframeWindow, "onunload");
  if (!descriptor?.configurable || !descriptor.get || !descriptor.set) return;

  const rawGet = descriptor.get;
  const rawSet = descriptor.set;
  try {
    Object.defineProperty(iframeWindow, "onunload", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: (): unknown => Reflect.apply(rawGet, iframeWindow, []),
      set: (handler: unknown): void => {
        // null/undefined 只移除已有 handler，不受 unload 注册策略限制。
        if (handler != null && !isWindowEventAllowedByPolicy(iframeWindow, "unload")) return;
        Reflect.apply(rawSet, iframeWindow, [handler]);
      },
    });
  } catch (_) {
    // 非标准 Window 实现无法覆盖属性时维持浏览器原行为。
  }
}

/**
 * 修改window对象的事件监听，只有路由事件采用iframe的事件
 */
export function patchIframeEvents(iframeWindow: Window): void {
  iframeWindow.__WUJIE_EVENTLISTENER__ = iframeWindow.__WUJIE_EVENTLISTENER__ || new Set();
  patchPolicyControlledUnloadProperty(iframeWindow);
  iframeWindow.addEventListener = function addEventListener<K extends keyof WindowEventMap>(
    type: K,
    listener: (this: Window, ev: WindowEventMap[K]) => unknown,
    options?: boolean | appAddEventListenerOptions
  ) {
    const eventListener = listener as EventListener;
    // 运行插件钩子函数
    execHooks(iframeWindow.__WUJIE.plugins, "windowAddEventListenerHook", iframeWindow, type, eventListener, options);
    // 保留完整注册记录，使显式 remove 和 sandbox destroy 仍会触发对称的清理钩子。
    iframeWindow.__WUJIE_EVENTLISTENER__.add({ type, listener: eventListener, options });
    if (
      appWindowAddEventListenerEvents.concat(iframeWindow.__WUJIE.iframeAddEventListeners ?? []).includes(type) ||
      (typeof options === "object" && options.targetWindow)
    ) {
      const targetWindow = typeof options === "object" && options.targetWindow ? options?.targetWindow : iframeWindow;
      if (!isWindowEventAllowedByPolicy(targetWindow, type)) return;
      return rawWindowAddEventListener.call(targetWindow, type, eventListener, options);
    }
    // 在子应用嵌套场景使用window.window获取真实window
    rawWindowAddEventListener.call(window.__WUJIE_RAW_WINDOW__ || window, type, eventListener, options);
  };

  iframeWindow.removeEventListener = function removeEventListener<K extends keyof WindowEventMap>(
    type: K,
    listener: (this: Window, ev: WindowEventMap[K]) => unknown,
    options?: boolean | appAddEventListenerOptions
  ) {
    const eventListener = listener as EventListener;
    // 运行插件钩子函数
    execHooks(
      iframeWindow.__WUJIE.plugins,
      "windowRemoveEventListenerHook",
      iframeWindow,
      type,
      eventListener,
      options
    );
    iframeWindow.__WUJIE_EVENTLISTENER__.forEach((o) => {
      // 这里严格一点，确保子应用销毁的时候都能销毁
      if (o.listener === eventListener && o.type === type && options == o.options) {
        iframeWindow.__WUJIE_EVENTLISTENER__.delete(o);
      }
    });
    if (
      appWindowAddEventListenerEvents.concat(iframeWindow.__WUJIE.iframeAddEventListeners ?? []).includes(type) ||
      (typeof options === "object" && options.targetWindow)
    ) {
      const targetWindow = typeof options === "object" && options.targetWindow ? options?.targetWindow : iframeWindow;
      return rawWindowRemoveEventListener.call(targetWindow, type, eventListener, options);
    }
    rawWindowRemoveEventListener.call(window.__WUJIE_RAW_WINDOW__ || window, type, eventListener, options);
  };
}

function patchIframeVariable(iframeWindow: Window, wujie: WuJie, appHostPath: string): void {
  iframeWindow.__WUJIE = wujie;
  iframeWindow.__WUJIE_PUBLIC_PATH__ = appHostPath + "/";
  iframeWindow.$wujie = wujie.provide;
  iframeWindow.__WUJIE_RAW_WINDOW__ = iframeWindow;
}

/**
 * 对iframe的history的pushState和replaceState进行修改
 * 将从location劫持后的数据修改回来，防止跨域错误
 * 同步路由到主应用
 * @param iframeWindow
 * @param appHostPath 子应用的 host path
 * @param mainHostPath 主应用的 host path
 */
function patchIframeHistory(iframeWindow: Window, appHostPath: string, mainHostPath: string): void {
  const history = iframeWindow.history;
  const rawHistoryPushState = history.pushState;
  const rawHistoryReplaceState = history.replaceState;
  history.pushState = function (data: unknown, title: string, url?: string): void {
    const baseUrl =
      mainHostPath + iframeWindow.location.pathname + iframeWindow.location.search + iframeWindow.location.hash;
    const ignoreFlag = url === undefined;
    const mainUrl = ignoreFlag ? undefined : getAbsolutePath(url.replace(appHostPath, ""), baseUrl);

    rawHistoryPushState.call(history, data, title, ignoreFlag ? undefined : mainUrl);
    if (ignoreFlag) return;
    updateBase(iframeWindow, appHostPath, mainHostPath);
    syncUrlToWindow(iframeWindow);
  };
  history.replaceState = function (data: unknown, title: string, url?: string): void {
    const baseUrl =
      mainHostPath + iframeWindow.location.pathname + iframeWindow.location.search + iframeWindow.location.hash;
    const ignoreFlag = url === undefined;
    const mainUrl = ignoreFlag ? undefined : getAbsolutePath(url.replace(appHostPath, ""), baseUrl);

    rawHistoryReplaceState.call(history, data, title, ignoreFlag ? undefined : mainUrl);
    if (ignoreFlag) return;
    updateBase(iframeWindow, appHostPath, mainHostPath);
    syncUrlToWindow(iframeWindow);
  };
}

/**
 * 动态的修改iframe的base地址
 * @param iframeWindow
 * @param appHostPath
 * @param mainHostPath
 */
function updateBase(iframeWindow: Window, appHostPath: string, mainHostPath: string) {
  const baseUrl = new URL(iframeWindow.location.href?.replace(mainHostPath, ""), appHostPath);
  const baseElement = rawDocumentQuerySelector.call(iframeWindow.document, "base");
  if (baseElement) baseElement.setAttribute("href", appHostPath + baseUrl.pathname);
}

/**
 * patch iframe window effect
 * @param iframeWindow
 */
// TODO 继续改进
export function patchWindowEffect(iframeWindow: Window): void {
  // 属性处理函数
  function processWindowProperty(key: string): boolean {
    const value = Reflect.get(iframeWindow, key);
    try {
      if (typeof value === "function" && !isConstructable(value)) {
        const parentValue = Reflect.get(window, key) as CallableFunction;
        Reflect.set(iframeWindow, key, parentValue.bind(window));
      } else {
        Reflect.set(iframeWindow, key, Reflect.get(window, key));
      }
      return true;
    } catch (e) {
      warn(e instanceof Error ? e.message : e);
      return false;
    }
  }
  Object.getOwnPropertyNames(iframeWindow).forEach((key) => {
    // 特殊处理
    if (key === "getSelection") {
      Object.defineProperty(iframeWindow, key, {
        get: () => {
          const sandbox = iframeWindow.__WUJIE;
          // 降级模式：可见 DOM 在渲染 iframe，getSelection 需读 sandbox.document
          if (sandbox?.degrade && sandbox.document) {
            return sandbox.document.getSelection.bind(sandbox.document);
          }
          return iframeWindow.document[key];
        },
      });
      return;
    }
    // 单独属性
    if (windowProxyProperties.includes(key)) {
      processWindowProperty(key);
      return;
    }
    // 正则匹配，可以一次处理多个
    windowRegWhiteList.some((reg) => {
      if (reg.test(key) && key in iframeWindow.parent) {
        return processWindowProperty(key);
      }
      return false;
    });
  });
  // onEvent set
  const windowOnEvents = Object.getOwnPropertyNames(window)
    .filter((p) => /^on/.test(p))
    .filter((e) => !appWindowOnEvent.concat(iframeWindow.__WUJIE.iframeOnEvents ?? []).includes(e));

  // 走主应用window
  windowOnEvents.forEach((e) => {
    const descriptor = Object.getOwnPropertyDescriptor(iframeWindow, e) || {
      enumerable: true,
      writable: true,
    };
    try {
      Object.defineProperty(iframeWindow, e, {
        enumerable: descriptor.enumerable,
        configurable: true,
        get: () => Reflect.get(window, e),
        set:
          descriptor.writable || descriptor.set
            ? (handler) => {
                // 首次写入时记录主 window 上 onXXX 的原始值；destroy 时通过 setter
                // 还原（accessor 不能用 defineProperty descriptor 直接还原内部 handler），
                // 防止主应用 window 被 dangling handler 长期污染。
                const tracker = iframeWindow.__WUJIE?.eventCleanupTracker;
                const installedValue = typeof handler === "function" ? handler.bind(iframeWindow) : handler;
                if (tracker) tracker.setWindowOnEvent(window, e, installedValue);
                else Reflect.set(window, e, installedValue);
              }
            : undefined,
      });
    } catch (e) {
      warn(e instanceof Error ? e.message : e);
    }
  });
  // 降级模式 DOM 在渲染 iframe，instanceof 需在 document 就绪后由 patchDegradeInstanceofAcrossRealms 处理
  if (!iframeWindow.__WUJIE.degrade) {
    patchInstanceofAcrossRealms(iframeWindow);
  } else {
    execHooks(iframeWindow.__WUJIE.plugins, "windowPropertyOverride", iframeWindow);
  }
}

type DomConstructor = CallableFunction & { prototype?: object };

interface InstanceofPatchState {
  readonly constructor: DomConstructor;
  readonly peers: Map<DomConstructor, number>;
}

const instanceofPatchStates = new WeakMap<DomConstructor, InstanceofPatchState>();
const degradeInstanceofReleases = new WeakMap<Window, () => void>();
const nativeHasInstance = Function.prototype[Symbol.hasInstance];

function matchesPatchedInstance(state: InstanceofPatchState, receiver: unknown, element: unknown): boolean {
  if (nativeHasInstance.call(receiver, element)) return true;
  // Symbol.hasInstance is inherited by user subclasses. Only the constructor
  // that owns this patch may broaden its realm; otherwise every peer Element
  // would incorrectly become an instance of every application subclass.
  if (receiver !== state.constructor) return false;
  for (const peer of state.peers.keys()) {
    if (nativeHasInstance.call(peer, element)) return true;
  }
  return false;
}

function createSharedConstructorFacade(original: DomConstructor): DomConstructor {
  let facade!: DomConstructor;
  let state!: InstanceofPatchState;
  const peers = new Map<DomConstructor, number>();
  const hasInstance = function (this: unknown, element: unknown): boolean {
    return matchesPatchedInstance(state, this, element);
  };
  facade = new Proxy(original, {
    get(target, property, receiver) {
      return property === Symbol.hasInstance ? hasInstance : Reflect.get(target, property, receiver);
    },
    construct(target, argumentsList, newTarget) {
      return Reflect.construct(target, argumentsList, newTarget === facade ? target : newTarget);
    },
  });
  state = { constructor: facade, peers };
  instanceofPatchStates.set(facade, state);
  return facade;
}

function isolateSharedConstructor(
  targetWindow: Window,
  name: string,
  targetConstructor: DomConstructor
): DomConstructor | undefined {
  let hostConstructor: unknown;
  try {
    hostConstructor = Reflect.get(window, name);
  } catch {
    return targetConstructor;
  }
  if (targetWindow === window || targetConstructor !== hostConstructor) return targetConstructor;

  const descriptor = Object.getOwnPropertyDescriptor(targetWindow, name);
  if (descriptor && !descriptor.configurable) return undefined;
  const facade = createSharedConstructorFacade(targetConstructor);
  try {
    Object.defineProperty(targetWindow, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
      writable: true,
      value: facade,
    });
    return facade;
  } catch (cause: unknown) {
    console.warn(cause);
    return undefined;
  }
}

function registerInstanceofPeer(targetConstructor: DomConstructor, peerConstructor: DomConstructor): () => void {
  let state = instanceofPatchStates.get(targetConstructor);
  if (!state) {
    const createdState: InstanceofPatchState = { constructor: targetConstructor, peers: new Map() };
    try {
      Object.defineProperty(targetConstructor, Symbol.hasInstance, {
        configurable: true,
        value: function (this: unknown, element: unknown): boolean {
          return matchesPatchedInstance(createdState, this, element);
        },
      });
      instanceofPatchStates.set(targetConstructor, createdState);
      state = createdState;
    } catch (cause: unknown) {
      console.warn(cause);
      return () => undefined;
    }
  }

  state.peers.set(peerConstructor, (state.peers.get(peerConstructor) ?? 0) + 1);
  const registeredState = state;
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const registrations = registeredState.peers.get(peerConstructor);
    if (registrations === undefined) return;
    if (registrations === 1) registeredState.peers.delete(peerConstructor);
    else registeredState.peers.set(peerConstructor, registrations - 1);
  };
}

function isDomConstructor(name: string, ctor: DomConstructor, peerWindow: Window): boolean {
  const prototype = ctor.prototype;
  if (!prototype) return false;
  const peerEventTarget = peerWindow.EventTarget as unknown as DomConstructor;
  const peerEvent = peerWindow.Event as unknown as DomConstructor;
  if (ctor === peerEventTarget || ctor === peerEvent) return true;
  if (prototype instanceof peerWindow.EventTarget || prototype instanceof peerWindow.Event) return true;
  if (/^(HTML|SVG|MathML).+Element$/.test(name)) return true;
  return extraInstanceofConstructorNames.has(name);
}

/**
 * 让 targetWindow 上的 DOM 构造函数 instanceof 同时认可 peerWindow realm 的对象。
 * 非降级：targetWindow=子应用 JS iframe，peerWindow=主应用 window（DOM 在 shadowRoot）。
 * 降级：在 patchDegradeInstanceofAcrossRealms 中对渲染 iframe 与执行 iframe 双向调用。
 */
export function patchInstanceofAcrossRealms(targetWindow: Window, peerWindow: Window = window): () => void {
  const releases: Array<() => void> = [];
  // DOM 构造函数之间存在继承链（HTMLIFrameElement -> HTMLElement -> Element -> Node ...）。
  // Each concrete constructor receives its own realm registration; inherited
  // Symbol.hasInstance behavior must not make one constructor claim a sibling.
  Object.getOwnPropertyNames(targetWindow).forEach((name) => {
    let targetConstructor: DomConstructor;
    let peerConstructor: DomConstructor;

    try {
      targetConstructor = Reflect.get(targetWindow, name) as DomConstructor;
      peerConstructor = Reflect.get(peerWindow, name) as DomConstructor;
    } catch (error) {
      return;
    }

    if (typeof targetConstructor !== "function" || typeof peerConstructor !== "function") return;
    if (targetConstructor === peerConstructor) return;
    if (!isDomConstructor(name, peerConstructor, peerWindow)) return;
    const isolatedConstructor = isolateSharedConstructor(targetWindow, name, targetConstructor);
    if (isolatedConstructor) releases.push(registerInstanceofPeer(isolatedConstructor, peerConstructor));
  });
  const wujie = (targetWindow as Window & { __WUJIE?: WuJie }).__WUJIE;
  if (wujie) {
    execHooks(wujie.plugins, "windowPropertyOverride", targetWindow);
  }
  return () => releases.forEach((release) => release());
}

/**
 * 降级模式：DOM 在渲染 iframe、JS 在执行 iframe，对两侧 window 双向 patch instanceof。
 * 需在 sandbox.document（渲染 document）就绪后调用，勿在 patchWindowEffect 阶段调用。
 */
export function patchDegradeInstanceofAcrossRealms(appWindow: Window, renderWindow: Window): void {
  if (!renderWindow || appWindow === renderWindow) return;
  degradeInstanceofReleases.get(appWindow)?.();
  const releaseRenderPatch = patchInstanceofAcrossRealms(renderWindow, appWindow);
  const releaseAppPatch = patchInstanceofAcrossRealms(appWindow, renderWindow);
  degradeInstanceofReleases.set(appWindow, () => {
    releaseRenderPatch();
    releaseAppPatch();
  });
}

/**
 * 记录节点的监听事件
 */
function listenerUsesCapture(options?: boolean | EventListenerOptions): boolean {
  return typeof options === "boolean" ? options : options?.capture === true;
}

/** @internal Exported for focused degradation-mode recovery tests. */
export function recordEventListeners(iframeWindow: Window): void {
  const sandbox = iframeWindow.__WUJIE;
  iframeWindow.Node.prototype.addEventListener = function (
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    // 添加事件缓存
    const elementListenerList = sandbox.elementEventCacheMap.get(this);
    const capture = listenerUsesCapture(options);
    if (elementListenerList) {
      if (
        !elementListenerList.find(
          (listener) =>
            listener.type === type && listener.handler === handler && listenerUsesCapture(listener.options) === capture
        )
      ) {
        elementListenerList.push({ type, handler, options });
      }
    } else sandbox.elementEventCacheMap.set(this, [{ type, handler, options }]);
    return rawAddEventListener.call(this, type, handler, options);
  };

  iframeWindow.Node.prototype.removeEventListener = function (
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void {
    // 清除缓存
    const elementListenerList = sandbox.elementEventCacheMap.get(this);
    if (elementListenerList) {
      const capture = listenerUsesCapture(options);
      const index = elementListenerList.findIndex(
        (listener) =>
          listener.type === type && listener.handler === handler && listenerUsesCapture(listener.options) === capture
      );
      if (index >= 0) elementListenerList.splice(index, 1);
    }
    if (!elementListenerList?.length) {
      sandbox.elementEventCacheMap.delete(this);
    }
    return rawRemoveEventListener.call(this, type, handler, options);
  };
}

/**
 * 恢复节点的监听事件
 */
export function recoverEventListeners(rootElement: Element | ChildNode, iframeWindow: Window) {
  const sandbox = iframeWindow.__WUJIE;
  const elementEventCacheMap: WeakMap<
    Node,
    Array<{
      type: string;
      handler: EventListenerOrEventListenerObject;
      options?: boolean | AddEventListenerOptions;
    }>
  > = new WeakMap();
  const ElementIterator = document.createTreeWalker(rootElement, NodeFilter.SHOW_ELEMENT, null, false);
  let nextElement = ElementIterator.currentNode;
  while (nextElement) {
    const elementListenerList = sandbox.elementEventCacheMap.get(nextElement);
    if (elementListenerList?.length) {
      elementEventCacheMap.set(nextElement, elementListenerList);
      elementListenerList.forEach((listener) => {
        nextElement.addEventListener(listener.type, listener.handler, listener.options);
      });
    }
    nextElement = ElementIterator.nextNode() as HTMLElement;
  }
  sandbox.elementEventCacheMap = elementEventCacheMap;
}

/**
 * 恢复根节点的监听事件
 */
export function recoverDocumentListeners(
  oldRootElement: Element | ChildNode,
  newRootElement: Element | ChildNode,
  iframeWindow: Window
) {
  const sandbox = iframeWindow.__WUJIE;
  const elementEventCacheMap: WeakMap<
    Node,
    Array<{
      type: string;
      handler: EventListenerOrEventListenerObject;
      options?: boolean | AddEventListenerOptions;
    }>
  > = new WeakMap();
  const elementListenerList = sandbox.elementEventCacheMap.get(oldRootElement);
  if (elementListenerList?.length) {
    elementEventCacheMap.set(newRootElement, elementListenerList);
    elementListenerList.forEach((listener) => {
      newRootElement.addEventListener(listener.type, listener.handler, listener.options);
    });
  }
  sandbox.elementEventCacheMap = elementEventCacheMap;
}

/**
 * 修复vue绑定事件e.timeStamp < attachedTimestamp 的情况
 */
export function patchEventTimeStamp(targetWindow: Window, iframeWindow: Window) {
  Object.defineProperty(targetWindow.Event.prototype, "timeStamp", {
    get: () => {
      return iframeWindow.document.createEvent("Event").timeStamp;
    },
  });
}

/**
 * patch document effect
 * @param iframeWindow
 */
// TODO 继续改进
export function patchDocumentEffect(iframeWindow: Window): void {
  const sandbox = iframeWindow.__WUJIE;

  /**
   * 处理 addEventListener和removeEventListener
   * 由于这个劫持导致 handler 的this发生改变，所以需要handler.bind(document)
   * 但是这样会导致removeEventListener无法正常工作，因为handler => handler.bind(document)
   * 这个地方保存callback = handler.bind(document) 方便removeEventListener
   */
  const handlerCallbackMap: WeakMap<EventListenerOrEventListenerObject, EventListenerOrEventListenerObject> =
    new WeakMap();
  const handlerRegistrationMap: WeakMap<EventListenerOrEventListenerObject, Set<string>> = new WeakMap();
  const listenerRegistrationKey = (type: string, options?: boolean | AddEventListenerOptions): string =>
    `${type}:${listenerUsesCapture(options) ? "capture" : "bubble"}`;
  iframeWindow.Document.prototype.addEventListener = function (
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (!handler) return;
    let callback = handlerCallbackMap.get(handler);
    let registrations = handlerRegistrationMap.get(handler);
    // 设置 handlerCallbackMap
    if (!callback) {
      callback = typeof handler === "function" ? handler.bind(this) : handler;
      handlerCallbackMap.set(handler, callback);
    }
    if (!registrations) {
      registrations = new Set();
      handlerRegistrationMap.set(handler, registrations);
    }
    registrations.add(listenerRegistrationKey(type, options));

    // 运行插件钩子函数
    execHooks(iframeWindow.__WUJIE.plugins, "documentAddEventListenerHook", iframeWindow, type, callback, options);
    if (appDocumentAddEventListenerEvents.includes(type)) {
      return rawAddEventListener.call(this, type, callback, options);
    }
    // 降级统一走 sandbox.document
    if (sandbox.degrade) return sandbox.document.addEventListener(type, callback, options);
    if (mainDocumentAddEventListenerEvents.includes(type)) {
      // 登记到清理跟踪器，destroy 时反向解绑，避免 handler 闭包永久钉住 iframeWindow
      sandbox.eventCleanupTracker?.trackMainDocumentListener({ type, callback, options });
      return window.document.addEventListener(type, callback, options);
    }
    if (mainAndAppAddEventListenerEvents.includes(type)) {
      sandbox.eventCleanupTracker?.trackMainDocumentListener({ type, callback, options });
      window.document.addEventListener(type, callback, options);
      sandbox.shadowRoot.addEventListener(type, callback, options);
      return;
    }
    sandbox.shadowRoot.addEventListener(type, callback, options);
  };
  iframeWindow.Document.prototype.removeEventListener = function (
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    const callback = handlerCallbackMap.get(handler);
    const registrations = handlerRegistrationMap.get(handler);
    if (callback) {
      registrations?.delete(listenerRegistrationKey(type, options));
      if (!registrations?.size) {
        handlerCallbackMap.delete(handler);
        handlerRegistrationMap.delete(handler);
      }

      // 运行插件钩子函数
      execHooks(iframeWindow.__WUJIE.plugins, "documentRemoveEventListenerHook", iframeWindow, type, callback, options);
      if (appDocumentAddEventListenerEvents.includes(type)) {
        return rawRemoveEventListener.call(this, type, callback, options);
      }
      if (sandbox.degrade) return sandbox.document.removeEventListener(type, callback, options);
      if (mainDocumentAddEventListenerEvents.includes(type)) {
        sandbox.eventCleanupTracker?.untrackMainDocumentListener({ type, callback, options });
        return window.document.removeEventListener(type, callback, options);
      }
      if (mainAndAppAddEventListenerEvents.includes(type)) {
        sandbox.eventCleanupTracker?.untrackMainDocumentListener({ type, callback, options });
        window.document.removeEventListener(type, callback, options);
        sandbox.shadowRoot.removeEventListener(type, callback, options);
        return;
      }
      sandbox.shadowRoot.removeEventListener(type, callback, options);
    }
  };
  // 处理onEvent
  const elementOnEvents = Object.keys(iframeWindow.HTMLElement.prototype).filter((ele) => /^on/.test(ele));
  const documentOnEvent = Object.keys(iframeWindow.Document.prototype)
    .filter((ele) => /^on/.test(ele))
    .filter((ele) => !appDocumentOnEvents.includes(ele));
  elementOnEvents
    .filter((e) => documentOnEvent.includes(e))
    .forEach((e) => {
      const descriptor = Object.getOwnPropertyDescriptor(iframeWindow.Document.prototype, e) || {
        enumerable: true,
        writable: true,
      };
      try {
        Object.defineProperty(iframeWindow.Document.prototype, e, {
          enumerable: descriptor.enumerable,
          configurable: true,
          get: () => {
            const target = sandbox.degrade ? sandbox.document : sandbox.shadowRoot?.firstElementChild;
            return target ? Reflect.get(target, e) : descriptor.get?.call(iframeWindow.document);
          },
          set:
            descriptor.writable || descriptor.set
              ? (handler) => {
                  const val = typeof handler === "function" ? handler.bind(iframeWindow.document) : handler;
                  const target = sandbox.degrade ? sandbox.document : sandbox.shadowRoot?.firstElementChild;
                  if (target) Reflect.set(target, e, val);
                }
              : undefined,
        });
      } catch (e) {
        warn(e instanceof Error ? e.message : e);
      }
    });
  // 处理属性get
  const {
    ownerProperties,
    modifyProperties,
    shadowProperties,
    shadowMethods,
    documentProperties,
    documentMethods,
    documentEvents,
  } = documentProxyProperties;
  modifyProperties.concat(shadowProperties, shadowMethods, documentProperties, documentMethods).forEach((propKey) => {
    const descriptor = Object.getOwnPropertyDescriptor(iframeWindow.Document.prototype, propKey) || {
      enumerable: true,
      writable: true,
    };
    try {
      Object.defineProperty(iframeWindow.Document.prototype, propKey, {
        enumerable: descriptor.enumerable,
        configurable: true,
        get: () => {
          const proxyDocument = sandbox.proxyDocument;
          if (proxyDocument && (typeof proxyDocument === "object" || typeof proxyDocument === "function")) {
            return Reflect.get(proxyDocument, propKey);
          }
          // Detached iframe implementations may read readyState/title from a
          // queued task after destroy has released the proxy. Fall back to the
          // captured native descriptor instead of touching released state.
          return descriptor.get?.call(iframeWindow.document);
        },
        set: undefined,
      });
    } catch (e) {
      warn(e instanceof Error ? e.message : e);
    }
  });
  // 处理 document 专属事件（onfullscreenchange / onpointerlockchange 等）。
  //
  // 这类事件浏览器只 dispatch 到主 document 上，子应用形如
  // `document.onfullscreenchange = handler` 的写法需要被转发到主 window.document。
  // 实现要点：
  //   1) 每个 propKey 只允许一个 active listener；setter 内部用同一份 bound 引用
  //      做 add / remove / track，避免出现 "存进 map 的 bound 与实际注册的 bound
  //      不是同一个" 而无法 remove；
  //   2) 接入 eventCleanupTracker，sandbox.destroy() 时反向解绑，否则 bound 闭包
  //      会持有 iframeWindow.document 永远挂在主 document 上；
  //   3) handler = null/非函数：仅解绑不重绑，与原生 onXXX = null 语义一致。
  const documentEventActiveListeners: Map<string, EventListenerOrEventListenerObject> = new Map();
  documentEvents.forEach((propKey) => {
    const descriptor = Object.getOwnPropertyDescriptor(iframeWindow.Document.prototype, propKey) || {
      enumerable: true,
      writable: true,
    };
    if (!(descriptor.writable || descriptor.set)) return;
    // documentEvents 形如 "onfullscreenchange"，对应事件名去掉前缀 "on"
    const eventType = propKey.slice(2);
    try {
      Object.defineProperty(iframeWindow.Document.prototype, propKey, {
        enumerable: descriptor.enumerable,
        configurable: true,
        get: () => {
          const targetDocument = sandbox.degrade ? sandbox.document : window.document;
          return targetDocument ? Reflect.get(targetDocument, propKey) : descriptor.get?.call(iframeWindow.document);
        },
        set: (handler) => {
          const targetDoc = (sandbox.degrade ? sandbox : window).document;
          if (!targetDoc) return;
          const previous = documentEventActiveListeners.get(propKey);
          if (previous) {
            targetDoc.removeEventListener(eventType, previous);
            sandbox.eventCleanupTracker?.untrackMainDocumentListener({ type: eventType, callback: previous });
            documentEventActiveListeners.delete(propKey);
          }
          if (typeof handler === "function") {
            const bound = handler.bind(iframeWindow.document);
            documentEventActiveListeners.set(propKey, bound);
            targetDoc.addEventListener(eventType, bound);
            sandbox.eventCleanupTracker?.trackMainDocumentListener({ type: eventType, callback: bound });
          }
          // handler 为 null/undefined/非函数：只解绑不重绑（与原生 onXXX = null 语义一致）
        },
      });
    } catch (e) {
      warn(e instanceof Error ? e.message : e);
    }
  });
  // process owner property
  ownerProperties.forEach((propKey) => {
    const nativeDescriptor = Object.getOwnPropertyDescriptor(iframeWindow.document, propKey);
    Object.defineProperty(iframeWindow.document, propKey, {
      enumerable: true,
      configurable: true,
      get: () => {
        const proxyDocument = sandbox.proxyDocument;
        if (proxyDocument && (typeof proxyDocument === "object" || typeof proxyDocument === "function")) {
          return Reflect.get(proxyDocument, propKey);
        }
        return nativeDescriptor?.get?.call(iframeWindow.document) ?? nativeDescriptor?.value;
      },
      set: undefined,
    });
  });
  // 运行插件钩子函数
  execHooks(iframeWindow.__WUJIE.plugins, "documentPropertyOverride", iframeWindow);
}

/**
 * patch Node effect
 * 1、处理 getRootNode
 * 2、处理 appendChild、insertBefore，当插入的节点为 svg 时，createElement 的 patch 会被去除，需要重新 patch
 * @param iframeWindow
 */
function patchNodeEffect(iframeWindow: Window): void {
  const rawGetRootNode = iframeWindow.Node.prototype.getRootNode;
  const rawAppendChild = iframeWindow.Node.prototype.appendChild;
  const rawInsertRule = iframeWindow.Node.prototype.insertBefore;
  const rawRemoveChild = iframeWindow.Node.prototype.removeChild;
  iframeWindow.Node.prototype.getRootNode = function (options?: GetRootNodeOptions): Node {
    const rootNode = rawGetRootNode.call(this, options);
    if (rootNode === iframeWindow.__WUJIE.shadowRoot) return iframeWindow.document;
    else return rootNode;
  };
  iframeWindow.Node.prototype.appendChild = function <T extends Node>(node: T): T {
    const res = rawAppendChild.call(this, node) as T;
    patchElementEffect(node, iframeWindow);
    return res;
  };
  iframeWindow.Node.prototype.insertBefore = function <T extends Node>(node: T, child: Node | null): T {
    const res = rawInsertRule.call(this, node, child) as T;
    patchElementEffect(node, iframeWindow);
    return res;
  };
  iframeWindow.Node.prototype.removeChild = function <T extends Node>(node: T): T {
    let res: T = node;
    try {
      res = rawRemoveChild.call(this, node) as T;
    } catch (e) {
      console.warn(
        `Failed to removeChild: ${node.nodeName.toLowerCase()} is not a child of ${this.nodeName.toLowerCase()}, try again with parentNode attribute. `
      );
      const parent = node.parentNode;
      if (node.isConnected && parent && isFunction(parent.removeChild)) {
        res = parent.removeChild(node) as T;
      }
    }
    patchElementEffect(node, iframeWindow);
    return res;
  };
}

/**
 * 修复资源元素的相对路径问题
 * @param iframeWindow
 */
function patchRelativeUrlEffect(iframeWindow: Window): void {
  fixElementCtrSrcOrHref(iframeWindow, iframeWindow.HTMLImageElement, "src");
  fixElementCtrSrcOrHref(iframeWindow, iframeWindow.HTMLAnchorElement, "href");
  fixElementCtrSrcOrHref(iframeWindow, iframeWindow.HTMLSourceElement, "src");
  fixElementCtrSrcOrHref(iframeWindow, iframeWindow.HTMLLinkElement, "href");
  fixElementCtrSrcOrHref(iframeWindow, iframeWindow.HTMLScriptElement, "src");
  fixElementCtrSrcOrHref(iframeWindow, iframeWindow.HTMLMediaElement, "src");
}

/**
 * 初始化 base 标签，供 document 内相对路径资源解析使用。
 * @param pathname 可选；降级渲染 iframe 的 location 为 about:blank，需传入 proxyLocation.pathname
 */
export function initBase(iframeWindow: Window, url: string, pathname?: string): void {
  const iframeDocument = iframeWindow.document;
  if (!iframeDocument.head || iframeDocument.head.querySelector("base")) return;
  const baseElement = iframeDocument.createElement("base");
  const iframeUrlElement = anchorElementGenerator(iframeWindow.location.href);
  const appUrlElement = anchorElementGenerator(url);
  const resolvedPathname = pathname ?? iframeUrlElement.pathname;
  baseElement.setAttribute("href", appUrlElement.protocol + "//" + appUrlElement.host + resolvedPathname);
  iframeDocument.head.insertBefore(baseElement, iframeDocument.head.firstChild);
}

/**
 * 初始化iframe的dom结构
 * @param iframeWindow
 * @param wujie
 * @param mainHostPath
 * @param appHostPath
 */
function initIframeDom(iframeWindow: Window, wujie: WuJie, mainHostPath: string, appHostPath: string): void {
  const iframeDocument = iframeWindow.document;
  const newDoc = window.document.implementation.createHTMLDocument("");
  const newDocumentElement = iframeDocument.importNode(newDoc.documentElement, true);
  iframeDocument.documentElement
    ? iframeDocument.replaceChild(newDocumentElement, iframeDocument.documentElement)
    : iframeDocument.appendChild(newDocumentElement);
  iframeWindow.__WUJIE_RAW_DOCUMENT_HEAD__ = iframeDocument.head;
  iframeWindow.__WUJIE_RAW_DOCUMENT_QUERY_SELECTOR__ = iframeWindow.Document.prototype.querySelector;
  iframeWindow.__WUJIE_RAW_DOCUMENT_QUERY_SELECTOR_ALL__ = iframeWindow.Document.prototype.querySelectorAll;
  iframeWindow.__WUJIE_RAW_DOCUMENT_CREATE_ELEMENT__ = iframeWindow.Document.prototype.createElement;
  iframeWindow.__WUJIE_RAW_DOCUMENT_CREATE_TEXT_NODE__ = iframeWindow.Document.prototype.createTextNode;
  initBase(iframeWindow, wujie.url);
  patchIframeHistory(iframeWindow, appHostPath, mainHostPath);
  patchIframeEvents(iframeWindow);
  if (wujie.degrade) recordEventListeners(iframeWindow);
  syncIframeUrlToWindow(iframeWindow);

  patchWindowEffect(iframeWindow);
  patchDocumentEffect(iframeWindow);
  patchNodeEffect(iframeWindow);
  patchRelativeUrlEffect(iframeWindow);
  patchInlineEventSetAttribute(iframeWindow);
}

/**
 * 防止运行主应用的js代码，给子应用带来很多副作用
 *
 * options.fallbackSrc 表示 iframe 是用 srcdoc 启动的（不发请求加载主应用 host）
 * 此时需要通过 document.open()/close() 在主应用上下文里把 iframe 的 URL
 * 由 about:srcdoc 改写成主应用 URL，否则 location.origin 不是主应用同源，
 * 子应用的 router/fetch 等都会出问题。
 *
 * 关键时序：srcdoc 是异步 navigation，appendChild 之后 iframe.contentWindow.document
 * 还是初始 about:blank，立刻 open() 会被随后到来的 srcdoc 文档替换掉。
 * 因此 srcdoc 分支必须等 iframe 的 load 事件触发（srcdoc 文档已就位）再做 trick。
 *
 * 如果 trick 在当前浏览器上失败（极少见），会兜底到 fallbackSrc 真实加载，
 * 此时由于不再走 srcdoc，需要切换到 stopIframeLoading 的"立即 stop"分支。
 */
interface IframeLoadingStopper {
  promise: Promise<void>;
  cancel: () => void;
}

function stopIframeLoading(iframe: HTMLIFrameElement, options: { fallbackSrc: string } | false): IframeLoadingStopper {
  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) {
    return { promise: Promise.resolve(), cancel: (): void => undefined };
  }
  let cancel = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // srcdoc 路径：等 srcdoc 文档就位（load 事件），然后做一次 document.open() trick
    if (options) {
      let done = false;
      let fallbackStopper: IframeLoadingStopper | undefined;
      let safetyTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        iframe.removeEventListener("load", runTrick);
        if (safetyTimer !== undefined) clearTimeout(safetyTimer);
      };
      const runTrick = () => {
        if (done) return;
        done = true;
        cleanup();
        let newDoc: Document;
        let previousHref: string;
        try {
          if (!iframe.isConnected || !iframeWindow.location) return finish();
          newDoc = iframeWindow.document;
          previousHref = iframeWindow.location.href;
        } catch {
          return finish();
        }
        newDoc.open();
        newDoc.close();
        // 按 HTML spec，document.open() 同步改写当前 document 的 URL，无需轮询
        if (iframeWindow.location.href !== previousHref) {
          finish();
          return;
        }
        // 极少数浏览器未按 spec 同步改 URL，兜底走 fallbackSrc 真实加载
        warn(`wujie: srcdoc + document.open() trick failed, fallback to load ${options.fallbackSrc} this time.`);
        // HTML spec 规定 srcdoc 优先级高于 src，必须先移除 srcdoc 才能让 src 生效
        iframe.removeAttribute("srcdoc");
        iframe.src = options.fallbackSrc;
        fallbackStopper = stopIframeLoading(iframe, false);
        fallbackStopper.promise.then(finish);
      };
      iframe.addEventListener("load", runTrick, { once: true });
      // 5s 安全网：load 理论上必定触发，加一层保险避免诡异挂死
      safetyTimer = setTimeout(runTrick, 5e3);
      cancel = () => {
        if (done && fallbackStopper) fallbackStopper.cancel();
        done = true;
        cleanup();
        finish();
      };
      return;
    }

    // fallback 真实加载路径：仍需轮询，赶在页面真正加载完成前 stop()
    const fallbackWindow: Window = iframeWindow;
    const oldDoc = fallbackWindow.document;
    const loopDeadline = Date.now() + 5e3;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    function loop() {
      pollTimer = setTimeout(() => {
        if (cancelled) return;
        let newDoc: Document | null;
        try {
          newDoc = fallbackWindow.document;
        } catch {
          newDoc = null;
        }
        if ((!newDoc || newDoc == oldDoc) && Date.now() < loopDeadline) {
          loop();
          return;
        }
        if (newDoc) fallbackWindow.stop ? fallbackWindow.stop() : newDoc.execCommand("Stop");
        finish();
      }, 1);
    }
    cancel = () => {
      cancelled = true;
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      finish();
    };
    loop();
  });
  return { promise, cancel: () => cancel() };
}

/**
 * 给子应用元素打上 baseURI / ownerDocument 补丁，让它在主应用 DOM 中也保留子应用
 * 的 location / document 语义。
 *
 * 闭包持有策略：用 WeakRef<Window> 间接持有 iframeWindow，proxyLocation / plugins
 * 都通过 `iframeWindow.__WUJIE` 动态访问。这样一来，当子应用 element 被业务移到
 * 主应用 DOM 下（portal / 弹窗 / 拖拽等），sandbox.destroy() 把
 * `iframeWindow.__WUJIE = null` 后，getter 会自动降级到主 document，element 不会
 * 把整个子应用上下文钉在内存中。
 *
 * WeakRef 是 ES2021 标准（Chrome 84+ / Node 14.6+）；旧环境降级为强引用以保兼容。
 */
export function patchElementEffect(
  element: (HTMLElement | Node | ShadowRoot) & { _hasPatch?: boolean },
  iframeWindow: Window
): void {
  if (element._hasPatch) return;
  type WeakRefConstructor = new <T extends object>(target: T) => { deref(): T | undefined };
  const WeakRefCtor = (globalThis as typeof globalThis & { WeakRef?: WeakRefConstructor }).WeakRef;
  const iframeWindowRef = WeakRefCtor ? new WeakRefCtor(iframeWindow) : { deref: () => iframeWindow };
  try {
    Object.defineProperties(element, {
      baseURI: {
        configurable: true,
        get: () => {
          const win = iframeWindowRef.deref();
          const proxyLocation = win?.__WUJIE?.proxyLocation as Location | undefined;
          if (!proxyLocation) return window.document.baseURI;
          return proxyLocation.protocol + "//" + proxyLocation.host + proxyLocation.pathname;
        },
        set: undefined,
      },
      ownerDocument: {
        configurable: true,
        get: () => {
          const win = iframeWindowRef.deref();
          // win.__WUJIE 被置 null（destroy 后）或 win 本身已 GC 时降级到主 document，
          // 防止 element 永久把 iframeWindow 钉在内存中。
          if (!win || !win.__WUJIE) return window.document;
          // 降级模式：节点已挂到渲染 iframe，ownerDocument 需与可见 DOM 一致，
          // 否则 wangEditor LO/RO（node.ownerDocument.defaultView instanceof）会失败。
          if (win.__WUJIE.degrade && win.__WUJIE.document) {
            return win.__WUJIE.document;
          }
          return win.document;
        },
      },
      _hasPatch: { get: () => true },
    });
  } catch (error) {
    console.warn(error);
  }
  execHooks(iframeWindow.__WUJIE.plugins, "patchElementHook", element, iframeWindow);
  // 编译内联事件处理器
  compileInlineEvents(element as Element, iframeWindow);
}

/**
 * 子应用前进后退，同步路由到主应用
 * @param iframeWindow
 */
export function syncIframeUrlToWindow(iframeWindow: Window): void {
  iframeWindow.addEventListener("hashchange", () => syncUrlToWindow(iframeWindow));
  iframeWindow.addEventListener("popstate", () => {
    syncUrlToWindow(iframeWindow);
  });
}

/**
 * 加载iframe替换子应用
 * @param src 地址
 * @param element
 * @param degradeAttrs
 */
export function renderIframeReplaceApp(src: string, element: HTMLElement, degradeAttrs: IframeAttributes = {}): void {
  const iframe = window.document.createElement("iframe");
  const defaultStyle = "height:100%;width:100%";
  const style = (degradeAttrs as { style?: unknown }).style;
  setAttrsToElement(iframe, { ...degradeAttrs, src, style: [defaultStyle, style].join(";") });
  renderElementToContainer(iframe, element);
}

// 沙箱 iframe 启动时的空白文档内容
// srcdoc 文档的 origin 由 spec 保证继承自 embedder（即主应用），
// 这样既不发网络请求，也保证主应用能访问 contentDocument。
const SANDBOX_EMPTY_SRCDOC = "<!DOCTYPE html><html><head></head><body></body></html>";

/**
 * js沙箱
 * 创建和主应用同源的iframe，路径携带了子路由的路由信息
 * iframe必须禁止加载html，防止进入主应用的路由逻辑
 *
 * 统一使用 srcdoc 加载空白文档：
 *   - 不发任何请求加载主应用 host 资源（解决 issue #54）
 *   - origin 继承自 embedder，主应用可以正常 patch contentDocument
 *   - 之后通过 document.open() 把 iframe 的 location 改写到主应用 URL，
 *     使 location.origin、history、router 等行为与主应用同源一致
 *
 * attrs.src 不再作为 iframe 的初始 src（HTML spec 规定 srcdoc 优先级高于 src，
 * 即便保留 src 浏览器也会忽略它）。它被重新解释为「srcdoc trick 失败时的兜底空白页 URL」，
 * 用户可指向自己提供的 `/empty` 静态文件或 Service Worker 端点；不传则兜底 mainHostPath。
 */
export function iframeGenerator(
  sandbox: WuJie,
  attrs: IframeAttributes,
  mainHostPath: string,
  appHostPath: string,
  appRoutePath: string
): HTMLIFrameElement {
  // 把用户传入的 src 拆出来作为 fallback 用，不再作为 iframe 的初始 src 直接挂载
  const { src: userFallbackSrc, ...restAttrs } = attrs as Record<string, unknown>;
  const fallbackSrc = typeof userFallbackSrc === "string" && userFallbackSrc ? userFallbackSrc : mainHostPath;

  const iframe = window.document.createElement("iframe");
  const attrsMerge = {
    style: "display: none",
    ...restAttrs,
    name: sandbox.id,
    [WUJIE_DATA_FLAG]: "",
    srcdoc: SANDBOX_EMPTY_SRCDOC,
  };
  setAttrsToElement(iframe, attrsMerge);
  window.document.body.appendChild(iframe);

  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) {
    iframe.remove();
    throw new Error(`Unable to create an execution window for app "${sandbox.id}".`);
  }
  // 变量需要提前注入，在入口函数通过变量防止死循环
  patchIframeVariable(iframeWindow, sandbox, appHostPath);
  const loadingStopper = stopIframeLoading(iframe, { fallbackSrc });
  sandbox.cancelIframeReady = loadingStopper.cancel;
  sandbox.iframeReady = loadingStopper.promise.then(() => {
    if (sandbox.destroyed || sandbox.iframe !== iframe) return;
    if (!iframeWindow.__WUJIE) {
      patchIframeVariable(iframeWindow, sandbox, appHostPath);
    }
    initIframeDom(iframeWindow, sandbox, mainHostPath, appHostPath);
    /**
     * 如果有同步优先同步，非同步从url读取
     */
    if (!isMatchSyncQueryById(iframeWindow.__WUJIE.id)) {
      iframeWindow.history.replaceState(null, "", mainHostPath + appRoutePath);
    }
  });
  return iframe;
}
