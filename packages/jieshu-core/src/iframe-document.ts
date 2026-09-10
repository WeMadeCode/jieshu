import type Jieshu from './sandbox';
import type { DocumentListenerEntry } from './tracker';
import {
  documentProxyProperties,
  rawAddEventListener,
  rawRemoveEventListener,
  mainDocumentAddEventListenerEvents,
  mainAndAppAddEventListenerEvents,
  appDocumentAddEventListenerEvents,
  appDocumentOnEvents,
} from './common';
import { execHooks, warn } from './utils';

const listenerRegistrationKey = (type: string, options?: boolean | EventListenerOptions) => {
  const capture = typeof options === 'boolean' ? options : options?.capture === true;
  return `${type}:${capture ? 'capture' : 'bubble'}`;
};

const addDocumentListener = (sandbox: Jieshu, receiver: Document, entry: DocumentListenerEntry) => {
  const { type, callback, options } = entry;
  if (appDocumentAddEventListenerEvents.includes(type)) {
    rawAddEventListener.call(receiver, type, callback, options);
    return;
  }
  if (mainDocumentAddEventListenerEvents.includes(type)) {
    sandbox.eventCleanupTracker?.trackMainDocumentListener(entry);
    window.document.addEventListener(type, callback, options);
    return;
  }
  if (mainAndAppAddEventListenerEvents.includes(type)) {
    sandbox.eventCleanupTracker?.trackMainDocumentListener(entry);
    window.document.addEventListener(type, callback, options);
  }
  sandbox.shadowRoot.addEventListener(type, callback, options);
};

const removeDocumentListener = (sandbox: Jieshu, receiver: Document, entry: DocumentListenerEntry) => {
  const { type, callback, options } = entry;
  if (appDocumentAddEventListenerEvents.includes(type)) {
    rawRemoveEventListener.call(receiver, type, callback, options);
    return;
  }
  if (mainDocumentAddEventListenerEvents.includes(type)) {
    sandbox.eventCleanupTracker?.untrackMainDocumentListener(entry);
    window.document.removeEventListener(type, callback, options);
    return;
  }
  if (mainAndAppAddEventListenerEvents.includes(type)) {
    sandbox.eventCleanupTracker?.untrackMainDocumentListener(entry);
    window.document.removeEventListener(type, callback, options);
  }
  sandbox.shadowRoot.removeEventListener(type, callback, options);
};

const patchDocumentListeners = (iframeWindow: Window, sandbox: Jieshu) => {
  // 保留绑定后的引用，并按事件类型和 capture 分别登记，供移除和销毁时使用。
  const callbacks = new WeakMap<EventListenerOrEventListenerObject, EventListenerOrEventListenerObject>();
  const registrations = new WeakMap<EventListenerOrEventListenerObject, Set<string>>();
  // 原型方法需要接收实际调用的 document，不能改成捕获外层 this 的箭头函数。
  iframeWindow.Document.prototype.addEventListener = function (
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (!handler) {
      return;
    }
    let callback = callbacks.get(handler);
    if (!callback) {
      callback = typeof handler === 'function' ? handler.bind(this) : handler;
      callbacks.set(handler, callback);
    }
    let keys = registrations.get(handler);
    if (!keys) {
      keys = new Set();
      registrations.set(handler, keys);
    }
    keys.add(listenerRegistrationKey(type, options));
    execHooks(iframeWindow.__JIESHU.plugins, 'documentAddEventListenerHook', iframeWindow, type, callback, options);
    addDocumentListener(sandbox, this, { type, callback, options });
  };
  iframeWindow.Document.prototype.removeEventListener = function (
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    const callback = callbacks.get(handler);
    if (!callback) {
      return;
    }
    const keys = registrations.get(handler);
    keys?.delete(listenerRegistrationKey(type, options));
    if (!keys?.size) {
      callbacks.delete(handler);
      registrations.delete(handler);
    }
    execHooks(iframeWindow.__JIESHU.plugins, 'documentRemoveEventListenerHook', iframeWindow, type, callback, options);
    removeDocumentListener(sandbox, this, { type, callback, options });
  };
};

const getDocumentDescriptor = (iframeWindow: Window, key: string) => {
  const descriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(iframeWindow.Document.prototype, key) ?? {
    enumerable: true,
    writable: true,
  };
  return descriptor;
};

const defineDocumentProperty = (iframeWindow: Window, key: string, descriptor: PropertyDescriptor) => {
  try {
    Object.defineProperty(iframeWindow.Document.prototype, key, descriptor);
  } catch (cause: unknown) {
    warn(cause instanceof Error ? cause.message : cause);
  }
};

const patchElementEventProperty = (iframeWindow: Window, sandbox: Jieshu, key: string) => {
  const descriptor = getDocumentDescriptor(iframeWindow, key);
  defineDocumentProperty(iframeWindow, key, {
    enumerable: descriptor.enumerable,
    configurable: true,
    get: () => {
      const target = sandbox.shadowRoot?.firstElementChild;
      return target ? Reflect.get(target, key) : descriptor.get?.call(iframeWindow.document);
    },
    set:
      descriptor.writable || descriptor.set
        ? (handler: unknown) => {
            const value = typeof handler === 'function' ? handler.bind(iframeWindow.document) : handler;
            const target = sandbox.shadowRoot?.firstElementChild;
            if (target) {
              Reflect.set(target, key, value);
            }
          }
        : undefined,
  });
};

const patchElementEventProperties = (iframeWindow: Window, sandbox: Jieshu) => {
  const elementEvents = Object.keys(iframeWindow.HTMLElement.prototype).filter((key) => /^on/.test(key));
  const documentEvents = Object.keys(iframeWindow.Document.prototype)
    .filter((key) => /^on/.test(key))
    .filter((key) => !appDocumentOnEvents.includes(key));
  elementEvents
    .filter((key) => documentEvents.includes(key))
    .forEach((key) => patchElementEventProperty(iframeWindow, sandbox, key));
};

const getLiveProxyDocument = (sandbox: Jieshu) => {
  const proxyDocument = sandbox.proxyDocument;
  if (proxyDocument && (typeof proxyDocument === 'object' || typeof proxyDocument === 'function')) {
    return proxyDocument;
  }
  return undefined;
};

const patchDocumentProxyProperties = (iframeWindow: Window, sandbox: Jieshu) => {
  const { modifyProperties, shadowProperties, shadowMethods, documentProperties, documentMethods } =
    documentProxyProperties;
  const keys = modifyProperties.concat(shadowProperties, shadowMethods, documentProperties, documentMethods);
  keys.forEach((key) => {
    const descriptor = getDocumentDescriptor(iframeWindow, key);
    defineDocumentProperty(iframeWindow, key, {
      enumerable: descriptor.enumerable,
      configurable: true,
      get: () => {
        const proxyDocument = getLiveProxyDocument(sandbox);
        if (proxyDocument) {
          return Reflect.get(proxyDocument, key);
        }
        // 销毁后的排队任务仍可能读取 readyState 等属性，此时回退到原生 getter。
        return descriptor.get?.call(iframeWindow.document);
      },
      set: undefined,
    });
  });
};

const createDocumentEventSetter = (iframeWindow: Window, sandbox: Jieshu, eventType: string) => {
  let previous: EventListener | undefined;
  return (handler: unknown) => {
    const target = window.document;
    if (previous) {
      target.removeEventListener(eventType, previous);
      sandbox.eventCleanupTracker?.untrackMainDocumentListener({ type: eventType, callback: previous });
      previous = undefined;
    }
    if (typeof handler === 'function') {
      const bound = handler.bind(iframeWindow.document);
      previous = bound;
      target.addEventListener(eventType, bound);
      sandbox.eventCleanupTracker?.trackMainDocumentListener({ type: eventType, callback: bound });
    }
  };
};

const patchDocumentEventProperties = (iframeWindow: Window, sandbox: Jieshu) => {
  // document 专属事件转发到主 document；每个属性只保留一个 listener。
  // setter 替换和 destroy 清理使用相同的绑定引用，非函数赋值仅移除旧监听。
  documentProxyProperties.documentEvents.forEach((key) => {
    const descriptor = getDocumentDescriptor(iframeWindow, key);
    if (!(descriptor.writable || descriptor.set)) {
      return;
    }
    defineDocumentProperty(iframeWindow, key, {
      enumerable: descriptor.enumerable,
      configurable: true,
      get: () => Reflect.get(window.document, key),
      set: createDocumentEventSetter(iframeWindow, sandbox, key.slice(2)),
    });
  });
};

const patchDocumentOwnerProperties = (iframeWindow: Window, sandbox: Jieshu) => {
  documentProxyProperties.ownerProperties.forEach((key) => {
    const nativeDescriptor = Object.getOwnPropertyDescriptor(iframeWindow.document, key);
    Object.defineProperty(iframeWindow.document, key, {
      enumerable: true,
      configurable: true,
      get: () => {
        const proxyDocument = getLiveProxyDocument(sandbox);
        if (proxyDocument) {
          return Reflect.get(proxyDocument, key);
        }
        return nativeDescriptor?.get?.call(iframeWindow.document) ?? nativeDescriptor?.value;
      },
      set: undefined,
    });
  });
};

/** 安装子应用 document 的事件转发和属性代理，最后通知插件。 */
export const patchDocumentEffect = (iframeWindow: Window) => {
  const sandbox = iframeWindow.__JIESHU;
  patchDocumentListeners(iframeWindow, sandbox);
  patchElementEventProperties(iframeWindow, sandbox);
  patchDocumentProxyProperties(iframeWindow, sandbox);
  patchDocumentEventProperties(iframeWindow, sandbox);
  patchDocumentOwnerProperties(iframeWindow, sandbox);
  execHooks(iframeWindow.__JIESHU.plugins, 'documentPropertyOverride', iframeWindow);
};
