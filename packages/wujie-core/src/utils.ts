import {
  WUJIE_SCRIPT_ID,
  WUJIE_TIPS_NO_URL,
  WUJIE_APP_ID,
  WUJIE_TIPS_STOP_APP,
  WUJIE_TIPS_STOP_APP_DETAIL,
} from "./constant";
import type { WujiePlugin } from "./contracts";
import { anchorElementGenerator, getAbsolutePath } from "./url-utils";
import { isFunction } from "./function-binding";

export { resolveOptions as mergeOptions } from "./options";
export {
  anchorElementGenerator,
  defaultGetPublicPath,
  getAbsolutePath,
  getAnchorElementQueryMap,
  getCurUrl,
  getSyncUrl,
  isMatchSyncQueryById,
} from "./url-utils";
export {
  checkProxyFunction,
  getTargetValue,
  isBoundedFunction,
  isCallable,
  isConstructable,
  isFunction,
} from "./function-binding";

type WujieHookName =
  | "windowAddEventListenerHook"
  | "windowRemoveEventListenerHook"
  | "documentAddEventListenerHook"
  | "documentRemoveEventListenerHook"
  | "appendOrInsertElementHook"
  | "patchElementHook"
  | "windowPropertyOverride"
  | "documentPropertyOverride";

export function toArray<T>(array: T | T[]): T[] {
  return Array.isArray(array) ? array : [array];
}

export function isHijackingTag(tagName?: string) {
  return (
    tagName?.toUpperCase() === "LINK" ||
    tagName?.toUpperCase() === "STYLE" ||
    tagName?.toUpperCase() === "SCRIPT" ||
    tagName?.toUpperCase() === "IFRAME"
  );
}

export const wujieSupport = window.Proxy && window.CustomElementRegistry;

export function getDegradeIframe(id: string): HTMLIFrameElement {
  return window.document.querySelector<HTMLIFrameElement>(`iframe[${WUJIE_APP_ID}="${id}"]`)!;
}

export function setAttrsToElement(element: HTMLElement, attrs: Record<string, unknown>) {
  Object.keys(attrs).forEach((name) => {
    element.setAttribute(name, String(attrs[name]));
  });
}

export function appRouteParse(url: string): {
  urlElement: HTMLAnchorElement;
  appHostPath: string;
  appRoutePath: string;
} {
  if (!url) {
    error(WUJIE_TIPS_NO_URL);
    throw new Error();
  }
  const urlElement = anchorElementGenerator(url);
  const appHostPath = urlElement.protocol + "//" + urlElement.host;
  let appRoutePath = urlElement.pathname + urlElement.search + urlElement.hash;
  if (!appRoutePath.startsWith("/")) appRoutePath = "/" + appRoutePath; // hack ie
  return { urlElement, appHostPath, appRoutePath };
}

/**
 * 劫持元素原型对相对地址的赋值转绝对地址
 * @param iframeWindow
 */
export function fixElementCtrSrcOrHref(
  iframeWindow: Window,
  elementCtr:
    | typeof HTMLImageElement
    | typeof HTMLAnchorElement
    | typeof HTMLSourceElement
    | typeof HTMLLinkElement
    | typeof HTMLScriptElement
    | typeof HTMLMediaElement,
  attr: "src" | "href"
): void {
  // patch setAttribute
  const iframeElement = (iframeWindow as Window & { Element: typeof Element }).Element;
  const rawElementSetAttribute = iframeElement.prototype.setAttribute;
  elementCtr.prototype.setAttribute = function (name: string, value: string): void {
    let targetValue = value;
    if (name === attr) targetValue = getAbsolutePath(value, this.baseURI || "", true);
    rawElementSetAttribute.call(this, name, targetValue);
  };
  // patch href get and set
  const rawAnchorElementHrefDescriptor = Object.getOwnPropertyDescriptor(elementCtr.prototype, attr)!;
  const { enumerable, configurable } = rawAnchorElementHrefDescriptor;
  const get = rawAnchorElementHrefDescriptor.get!;
  const set = rawAnchorElementHrefDescriptor.set!;
  Object.defineProperty(elementCtr.prototype, attr, {
    enumerable,
    configurable,
    get: function () {
      return get.call(this);
    },
    set: function (href) {
      set.call(this, getAbsolutePath(href, this.baseURI, true));
    },
  });
  // TODO: innerHTML的处理
}

type IdleTask = () => unknown;
type IdleScheduler = (task: IdleTask) => number;
type WindowWithIdleScheduler = Window & { requestIdleCallback?: IdleScheduler };

const nativeIdleScheduler = (window as WindowWithIdleScheduler).requestIdleCallback;
export const requestIdleCallback: IdleScheduler = nativeIdleScheduler
  ? nativeIdleScheduler.bind(window)
  : (task) => window.setTimeout(task, 1);

export function getContainer(container: string | HTMLElement): HTMLElement {
  return typeof container === "string" ? (document.querySelector(container) as HTMLElement) : container;
}

export function warn(msg: unknown, data?: unknown): void {
  console?.warn(`[wujie warn]: ${String(msg)}`, data);
}

export function error(msg: unknown, data?: unknown): void {
  console?.error(`[wujie error]: ${String(msg)}`, data);
}

export function getInlineCode(match: string): string {
  const start = match.indexOf(">") + 1;
  const end = match.lastIndexOf("<");
  return match.substring(start, end);
}

/** [f1, f2, f3, f4] => f4(f3(f2(f1))) 函数柯里化 */
export function compose(
  fnList: Array<((code: string, ...args: Array<string>) => string) | undefined>
): (...args: Array<string>) => string {
  return function (code: string, ...args: Array<string>) {
    return fnList.reduce((newCode, fn) => (isFunction(fn) ? fn(newCode, ...args) : newCode), code || "");
  };
}

// 微任务
export function nextTick(cb: () => unknown): void {
  Promise.resolve().then(cb);
}

//执行钩子函数
export function execHooks(plugins: Array<WujiePlugin>, hookName: WujieHookName, ...args: Array<unknown>): void {
  try {
    if (plugins && plugins.length > 0) {
      plugins
        .map((plugin) => plugin[hookName])
        .filter((hook) => isFunction(hook))
        .forEach((hook) => (hook as (...hookArgs: Array<unknown>) => unknown)(...args));
    }
  } catch (e) {
    error(e);
  }
}

export function isScriptElement(element: HTMLElement): boolean {
  return element.tagName?.toUpperCase() === "SCRIPT";
}

let count = 1;
export function setTagToScript(element: HTMLScriptElement, tag?: string): void {
  if (isScriptElement(element)) {
    const scriptTag = tag || String(count++);
    element.setAttribute(WUJIE_SCRIPT_ID, scriptTag);
  }
}

export function getTagFromScript(element: HTMLScriptElement): string | null {
  if (isScriptElement(element)) {
    return element.getAttribute(WUJIE_SCRIPT_ID);
  }
  return null;
}

/**
 * 事件触发器
 */
export function eventTrigger(el: HTMLElement | Window | Document, eventName: string, detail?: unknown) {
  let event;
  if (typeof window.CustomEvent === "function") {
    event = new CustomEvent(eventName, { detail });
  } else {
    event = document.createEvent("CustomEvent");
    event.initCustomEvent(eventName, true, false, detail);
  }
  el.dispatchEvent(event);
}

export function stopMainAppRun() {
  warn(WUJIE_TIPS_STOP_APP_DETAIL);
  throw new Error(WUJIE_TIPS_STOP_APP);
}
