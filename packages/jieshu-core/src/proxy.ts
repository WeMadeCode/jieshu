import { patchElementEffect, renderIframeReplaceApp } from './iframe';
import { renderElementToContainer } from './shadow';
import { pushUrlToWindow } from './sync';
import { documentProxyProperties, rawDocumentQuerySelector } from './common';
import { JIESHU_TIPS_RELOAD_DISABLED, JIESHU_TIPS_GET_ELEMENT_BY_ID } from './constant';
import type Jieshu from './sandbox';
import {
  createDescriptorPipeline,
  createResolverPipeline,
  defineResolvedProperties,
  resolvedProperty,
  unresolved,
} from './proxy-resolver';
import type { PropertyDescriptorResolver, PropertyResolver } from './proxy-resolver';
import { getTargetValue, getDegradeIframe, isCallable, checkProxyFunction, warn, stopMainAppRun } from './utils';

interface DocumentResolverContext {
  iframe: HTMLIFrameElement;
  sandbox: Jieshu;
  shadowRoot: ShadowRoot;
  document: Document;
}

interface LocalProxyContext {
  iframe: HTMLIFrameElement | null;
  sandbox: Jieshu | null;
  location: Location | null;
}

interface LocationResolverContext {
  location: Location;
  urlElement: HTMLAnchorElement;
  mainHostPath: string;
  appHostPath: string;
}

type DocumentHandler = (context: DocumentResolverContext) => unknown;
type LocationHandler = (context: LocationResolverContext) => unknown;

function getOwnEntry<Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

const documentPropertyGroups = {
  shadowProperties: new Set(documentProxyProperties.ownerProperties.concat(documentProxyProperties.shadowProperties)),
  shadowMethods: new Set(documentProxyProperties.shadowMethods),
  documentProperties: new Set(documentProxyProperties.documentProperties),
  documentMethods: new Set(documentProxyProperties.documentMethods),
};

const locationConstantKeys = new Set(['host', 'hostname', 'protocol', 'port', 'origin']);
const localLocationConstantKeys = ['host', 'hostname', 'origin', 'port', 'protocol'];

function getChildLocationHref(locationHref: string, mainHostPath: string, appHostPath: string): string {
  return locationHref.replace(mainHostPath, appHostPath);
}

function resolveLocationHref(value: string, currentHref: string): string {
  try {
    return new URL(value, currentHref).href;
  } catch {
    return value;
  }
}

function callReceiverMethod(receiver: unknown, key: PropertyKey, args: unknown[]): unknown {
  if ((typeof receiver !== 'object' || receiver === null) && typeof receiver !== 'function') return undefined;
  const method = Reflect.get(receiver, key);
  return isCallable(method) ? Reflect.apply(method, receiver, args) : undefined;
}

function requireIframeWindow(iframe: HTMLIFrameElement): Window {
  const iframeWindow = iframe.contentWindow;
  if (!iframeWindow) throw new TypeError('Jieshu iframe window is unavailable');
  return iframeWindow;
}

function requireIframeDocument(iframe: HTMLIFrameElement): Document {
  const iframeDocument = iframe.contentDocument;
  if (!iframeDocument) throw new TypeError('Jieshu iframe document is unavailable');
  return iframeDocument;
}

function requireContainer(element: Element | null): HTMLElement {
  if (!element) throw new TypeError('Jieshu application container is unavailable');
  return element as HTMLElement;
}

function createPatchedNodeMethod(context: DocumentResolverContext, key: 'createElement' | 'createTextNode'): unknown {
  const iframeWindow = requireIframeWindow(context.iframe);
  const rawMethod =
    key === 'createElement'
      ? iframeWindow.__JIESHU_RAW_DOCUMENT_CREATE_ELEMENT__
      : iframeWindow.__JIESHU_RAW_DOCUMENT_CREATE_TEXT_NODE__;
  return new Proxy(context.document[key], {
    apply(_target, _receiver, args) {
      const element = Reflect.apply(rawMethod, requireIframeDocument(context.iframe), args) as Element | Text;
      patchElementEffect(element, requireIframeWindow(context.iframe));
      return element;
    },
  });
}

function createCollectionMethod(
  context: DocumentResolverContext,
  key: 'getElementsByTagName' | 'getElementsByClassName' | 'getElementsByName',
): unknown {
  return new Proxy(context.shadowRoot.querySelectorAll, {
    apply(querySelectorAll, receiver, args) {
      const iframeDocument = requireIframeDocument(context.iframe);
      if (receiver !== iframeDocument) return callReceiverMethod(receiver, key, args);
      let selector = args[0];
      if (key === 'getElementsByTagName' && selector === 'script') return iframeDocument.scripts;
      if (key === 'getElementsByClassName') selector = `.${selector}`;
      if (key === 'getElementsByName') selector = `[name="${selector}"]`;
      try {
        return Reflect.apply(querySelectorAll, context.shadowRoot, [selector]);
      } catch (_error) {
        return [];
      }
    },
  });
}

function createGetElementByIdMethod(context: DocumentResolverContext): unknown {
  return new Proxy(context.shadowRoot.querySelector, {
    apply(querySelector, receiver, args) {
      const iframeDocument = requireIframeDocument(context.iframe);
      if (receiver !== iframeDocument) return callReceiverMethod(receiver, 'getElementById', args);
      try {
        return (
          Reflect.apply(querySelector, context.shadowRoot, [`[id="${args[0]}"]`]) ||
          Reflect.apply(requireIframeWindow(context.iframe).__JIESHU_RAW_DOCUMENT_QUERY_SELECTOR__, iframeDocument, [
            `#${args[0]}`,
          ])
        );
      } catch (_error) {
        warn(JIESHU_TIPS_GET_ELEMENT_BY_ID);
        return null;
      }
    },
  });
}

function createQueryMethod(context: DocumentResolverContext, key: 'querySelector' | 'querySelectorAll'): unknown {
  const iframeWindow = requireIframeWindow(context.iframe);
  const rawMethod =
    key === 'querySelector'
      ? iframeWindow.__JIESHU_RAW_DOCUMENT_QUERY_SELECTOR__
      : iframeWindow.__JIESHU_RAW_DOCUMENT_QUERY_SELECTOR_ALL__;
  return new Proxy(context.shadowRoot[key], {
    apply(query, receiver, args) {
      const iframeDocument = requireIframeDocument(context.iframe);
      if (receiver !== iframeDocument) return callReceiverMethod(receiver, key, args);
      return (
        Reflect.apply(query, context.shadowRoot, args) ||
        (args[0] === 'base' ? null : Reflect.apply(rawMethod, iframeDocument, [args[0]]))
      );
    },
  });
}

const documentHandlers: Readonly<Record<string, DocumentHandler>> = {
  createElement: (context) => createPatchedNodeMethod(context, 'createElement'),
  createTextNode: (context) => createPatchedNodeMethod(context, 'createTextNode'),
  documentURI: (context) => (context.sandbox.proxyLocation as Location).href,
  URL: (context) => (context.sandbox.proxyLocation as Location).href,
  getElementsByTagName: (context) => createCollectionMethod(context, 'getElementsByTagName'),
  getElementsByClassName: (context) => createCollectionMethod(context, 'getElementsByClassName'),
  getElementsByName: (context) => createCollectionMethod(context, 'getElementsByName'),
  getElementById: createGetElementByIdMethod,
  querySelector: (context) => createQueryMethod(context, 'querySelector'),
  querySelectorAll: (context) => createQueryMethod(context, 'querySelectorAll'),
  documentElement: (context) => context.shadowRoot.firstElementChild,
  scrollingElement: (context) => context.shadowRoot.firstElementChild,
  forms: (context) => context.shadowRoot.querySelectorAll('form'),
  images: (context) => context.shadowRoot.querySelectorAll('img'),
  links: (context) => context.shadowRoot.querySelectorAll('a'),
};

const documentHandlerResolver: PropertyResolver<DocumentResolverContext> = (context, key) => {
  if (typeof key !== 'string') return unresolved();
  const handler = getOwnEntry(documentHandlers, key);
  return handler ? resolvedProperty(handler(context)) : unresolved();
};

const documentGroupResolver: PropertyResolver<DocumentResolverContext> = (context, key) => {
  const name = key.toString();
  if (documentPropertyGroups.shadowProperties.has(name)) {
    if (name === 'activeElement' && context.shadowRoot.activeElement === null) {
      return resolvedProperty(Reflect.get(context.shadowRoot, 'body'));
    }
    return resolvedProperty(Reflect.get(context.shadowRoot, key));
  }
  if (documentPropertyGroups.shadowMethods.has(name)) {
    return resolvedProperty(getTargetValue(context.shadowRoot, key) ?? getTargetValue(context.document, key));
  }
  if (documentPropertyGroups.documentProperties.has(name)) {
    return resolvedProperty(Reflect.get(context.document, key));
  }
  if (documentPropertyGroups.documentMethods.has(name)) {
    return resolvedProperty(getTargetValue(context.document, key));
  }
  return unresolved();
};

const resolveDocumentProperty = createResolverPipeline([documentHandlerResolver, documentGroupResolver]);

const locationHandlers: Readonly<Record<string, LocationHandler>> = {
  href: (context) => getChildLocationHref(context.location.href, context.mainHostPath, context.appHostPath),
  toString: (context: LocationResolverContext) => () =>
    getChildLocationHref(context.location.href, context.mainHostPath, context.appHostPath),
  reload: () => {
    warn(JIESHU_TIPS_RELOAD_DISABLED);
    return (): null => null;
  },
  replace: (context) =>
    new Proxy(context.location.replace, {
      apply(replace, _receiver, args) {
        const destination = args[0] as string | null | undefined;
        return Reflect.apply(replace, context.location, [
          destination?.replace(context.appHostPath, context.mainHostPath),
        ]);
      },
    }),
};

const locationHandlerResolver: PropertyResolver<LocationResolverContext> = (context, key) => {
  if (typeof key !== 'string') return unresolved();
  const handler = getOwnEntry(locationHandlers, key);
  return handler ? resolvedProperty(handler(context)) : unresolved();
};

const locationConstantResolver: PropertyResolver<LocationResolverContext> = (context, key) =>
  typeof key === 'string' && locationConstantKeys.has(key)
    ? resolvedProperty(Reflect.get(context.urlElement, key))
    : unresolved();

const locationFallbackResolver: PropertyResolver<LocationResolverContext> = (context, key) =>
  resolvedProperty(getTargetValue(context.location, key));

const resolveLocationProperty = createResolverPipeline([
  locationConstantResolver,
  locationHandlerResolver,
  locationFallbackResolver,
]);

type LocalDescriptorFactory = (context: LocalProxyContext) => PropertyDescriptor;

function requireIframe(context: LocalProxyContext): HTMLIFrameElement {
  if (!context.iframe) throw new TypeError('Jieshu proxy has been revoked');
  return context.iframe;
}

function requireSandbox(context: LocalProxyContext): Jieshu {
  if (!context.sandbox) throw new TypeError('Jieshu proxy has been revoked');
  return context.sandbox;
}

const localDocumentDescriptorFactories: { readonly [key: string]: LocalDescriptorFactory | undefined } = {
  createElement: (context) => ({
    get:
      () =>
      (...args: Parameters<Document['createElement']>) => {
        const iframe = requireIframe(context);
        const iframeWindow = requireIframeWindow(iframe);
        const element = Reflect.apply(
          iframeWindow.__JIESHU_RAW_DOCUMENT_CREATE_ELEMENT__,
          requireIframeDocument(iframe),
          args,
        );
        patchElementEffect(element, iframeWindow);
        return element;
      },
  }),
  createTextNode: (context) => ({
    get:
      () =>
      (...args: Parameters<Document['createTextNode']>) => {
        const iframe = requireIframe(context);
        const iframeWindow = requireIframeWindow(iframe);
        const element = Reflect.apply(
          iframeWindow.__JIESHU_RAW_DOCUMENT_CREATE_TEXT_NODE__,
          requireIframeDocument(iframe),
          args,
        );
        patchElementEffect(element, iframeWindow);
        return element;
      },
  }),
  documentURI: (context) => ({
    get: () => (context.sandbox?.proxyLocation as Location | undefined)?.href,
  }),
  URL: (context) => ({
    get: () => (context.sandbox?.proxyLocation as Location | undefined)?.href,
  }),
  getElementsByTagName: (context) => ({
    get: () => (qualifiedName: string) => {
      const iframe = requireIframe(context);
      if (qualifiedName === 'script') return requireIframeDocument(iframe).scripts;
      return requireSandbox(context).document.getElementsByTagName(qualifiedName);
    },
  }),
  getElementById: (context) => ({
    get: () => (elementId: string) => {
      const iframe = requireIframe(context);
      return (
        requireSandbox(context).document.getElementById(elementId) ||
        requireIframeWindow(iframe).__JIESHU_RAW_DOCUMENT_HEAD__.querySelector(`#${elementId}`)
      );
    },
  }),
};

const localForwardedDocumentKeys = new Set(
  documentProxyProperties.modifyProperties
    .filter((key) => !documentProxyProperties.modifyLocalProperties.includes(key))
    .concat(
      documentProxyProperties.ownerProperties,
      documentProxyProperties.shadowProperties,
      documentProxyProperties.shadowMethods,
      documentProxyProperties.documentProperties,
      documentProxyProperties.documentMethods,
    ),
);

const localSpecialDocumentDescriptorResolver: PropertyDescriptorResolver<LocalProxyContext> = (context, key) => {
  if (typeof key !== 'string') return undefined;
  return localDocumentDescriptorFactories[key]?.(context);
};

const localForwardedDocumentDescriptorResolver: PropertyDescriptorResolver<LocalProxyContext> = (context, key) => {
  if (typeof key !== 'string' || !localForwardedDocumentKeys.has(key)) return undefined;
  return {
    get: () => {
      const sandbox = context.sandbox;
      const value = sandbox?.document ? Reflect.get(sandbox.document, key) : undefined;
      return isCallable(value) && sandbox ? value.bind(sandbox.document) : value;
    },
  };
};

const resolveLocalDocumentDescriptor = createDescriptorPipeline([
  localSpecialDocumentDescriptorResolver,
  localForwardedDocumentDescriptorResolver,
]);

interface LocalLocationDescriptorContext {
  refs: LocalProxyContext;
  constantValues: Readonly<Record<string, unknown>>;
  mainHostPath: string;
  appHostPath: string;
  locationKeys: ReadonlySet<string>;
}

const localLocationSpecialDescriptorResolver: PropertyDescriptorResolver<LocalLocationDescriptorContext> = (
  context,
  key,
) => {
  if (typeof key !== 'string') return undefined;
  if (localLocationConstantKeys.includes(key)) {
    return {
      configurable: true,
      enumerable: true,
      writable: true,
      value: context.constantValues[key],
    };
  }
  if (key === 'href') {
    return {
      get: () => {
        const location = context.refs.location;
        return location ? getChildLocationHref(location.href, context.mainHostPath, context.appHostPath) : undefined;
      },
      set: (value: string): void => {
        locationHrefSet(requireIframe(context.refs), value, context.mainHostPath, context.appHostPath);
      },
    };
  }
  if (key === 'toString') {
    return {
      get: () => () => {
        const location = context.refs.location;
        if (!location) throw new TypeError('Jieshu proxy has been revoked');
        return getChildLocationHref(location.href, context.mainHostPath, context.appHostPath);
      },
    };
  }
  if (key === 'reload') {
    return {
      get: () => {
        warn(JIESHU_TIPS_RELOAD_DISABLED);
        return (): null => null;
      },
    };
  }
  return undefined;
};

const localLocationForwardedDescriptorResolver: PropertyDescriptorResolver<LocalLocationDescriptorContext> = (
  context,
  key,
) => {
  if (
    typeof key !== 'string' ||
    !context.locationKeys.has(key) ||
    localLocationConstantKeys.concat(['href', 'reload', 'toString']).includes(key)
  ) {
    return undefined;
  }
  return {
    get: () => {
      const location = context.refs.location;
      const value = location ? Reflect.get(location, key) : undefined;
      return isCallable(value) && location ? value.bind(location) : value;
    },
  };
};

const resolveLocalLocationDescriptor = createDescriptorPipeline([
  localLocationSpecialDescriptorResolver,
  localLocationForwardedDescriptorResolver,
]);

/**
 * location href 的set劫持操作
 */
function locationHrefSet(iframe: HTMLIFrameElement, value: string, mainHostPath: string, appHostPath: string): boolean {
  const iframeWindow = requireIframeWindow(iframe);
  const iframeDocument = requireIframeDocument(iframe);
  const { shadowRoot, id, degrade, document, degradeAttrs } = iframeWindow.__JIESHU;
  const currentHref = getChildLocationHref(iframeWindow.location.href, mainHostPath, appHostPath);
  const url = resolveLocationHref(value, currentHref);
  iframeWindow.__JIESHU.hrefFlag = true;
  if (degrade) {
    const iframeBody = requireContainer(rawDocumentQuerySelector.call(iframeDocument, 'body'));
    renderElementToContainer(document.documentElement, iframeBody);
    renderIframeReplaceApp(url, requireContainer(getDegradeIframe(id).parentElement), degradeAttrs);
  } else renderIframeReplaceApp(url, requireContainer(shadowRoot.host.parentElement), degradeAttrs);
  pushUrlToWindow(id, url);
  return true;
}

/**
 * 非降级情况下window、document、location代理
 */
export function proxyGenerator(
  iframe: HTMLIFrameElement,
  urlElement: HTMLAnchorElement,
  mainHostPath: string,
  appHostPath: string,
): {
  proxyWindow: Window;
  proxyDocument: object;
  proxyLocation: Location;
  proxyRevoke: () => void;
} {
  const iframeWindow = requireIframeWindow(iframe);
  const { proxy: proxyWindow, revoke: revokeWindow } = Proxy.revocable(iframeWindow, {
    get: (target: Window, p: PropertyKey): unknown => {
      // location进行劫持
      if (p === 'location') {
        return target.__JIESHU.proxyLocation;
      }
      // 判断自身
      if (p === 'self' || (p === 'window' && Object.getOwnPropertyDescriptor(window, 'window')?.get)) {
        return target.__JIESHU.proxy;
      }
      // 不要绑定this
      if (p === '__JIESHU_RAW_DOCUMENT_QUERY_SELECTOR__' || p === '__JIESHU_RAW_DOCUMENT_QUERY_SELECTOR_ALL__') {
        return target[p];
      }
      // https://262.ecma-international.org/8.0/#sec-proxy-object-internal-methods-and-internal-slots-get-p-receiver
      const descriptor = Object.getOwnPropertyDescriptor(target, p);
      if (descriptor?.configurable === false && descriptor?.writable === false) {
        return Reflect.get(target, p);
      }
      // 修正this指针指向
      return getTargetValue(target, p);
    },

    set: (target: Window, p: PropertyKey, value: unknown) => {
      checkProxyFunction(target, value);
      return Reflect.set(target, p, value);
    },

    has: (target: Window, p: PropertyKey) => p in target,
  });

  // proxy document
  const { proxy: proxyDocument, revoke: revokeDocument } = Proxy.revocable(
    {},
    {
      get: function (_fakeDocument, propKey): unknown {
        const sandbox = iframeWindow.__JIESHU;
        // iframe初始化完成后，webcomponent还未挂在上去，此时运行了主应用代码，必须中止
        if (!sandbox.shadowRoot) stopMainAppRun();
        const resolution = resolveDocumentProperty(
          { iframe, sandbox, shadowRoot: sandbox.shadowRoot, document: window.document },
          propKey,
        );
        return resolution.resolved ? resolution.value : undefined;
      },
    },
  );

  // proxy location
  const readProxyLocationProperty = (propKey: PropertyKey): unknown => {
    const context: LocationResolverContext = {
      location: iframeWindow.location,
      urlElement,
      mainHostPath,
      appHostPath,
    };
    const resolution = resolveLocationProperty(context, propKey);
    return resolution.resolved ? resolution.value : undefined;
  };
  const proxyLocationTarget: Record<PropertyKey, unknown> = {};
  const { proxy: proxyLocation, revoke: revokeLocation } = Proxy.revocable(proxyLocationTarget, {
    get: (_fakeLocation, propKey): unknown => readProxyLocationProperty(propKey),
    set: function (_fakeLocation, propKey, value: unknown) {
      // 如果是跳转链接的话重开一个iframe
      if (propKey === 'href') {
        return locationHrefSet(iframe, value as string, mainHostPath, appHostPath);
      }
      return Reflect.set(iframeWindow.location, propKey, value);
    },
    ownKeys: function () {
      return Object.keys(iframeWindow.location).filter((key) => key !== 'reload');
    },
    getOwnPropertyDescriptor: function (_target, key) {
      return { enumerable: true, configurable: true, value: Reflect.get(this, key) };
    },
  });
  // revoke 后引擎清空代理的 [[ProxyTarget]] / [[ProxyHandler]]，使捕获了 iframe / urlElement
  // 的 handler 闭包不可达，从而释放对 iframe 的强引用
  const proxyRevoke = () => {
    revokeWindow();
    revokeDocument();
    revokeLocation();
  };
  return { proxyWindow, proxyDocument, proxyLocation: proxyLocation as unknown as Location, proxyRevoke };
}

/**
 * 降级情况下document、location代理处理
 */
export function localGenerator(
  iframe: HTMLIFrameElement,
  urlElement: HTMLAnchorElement,
  mainHostPath: string,
  appHostPath: string,
): {
  proxyDocument: object;
  proxyLocation: Location;
  proxyRevoke: () => void;
} {
  const iframeWindow = requireIframeWindow(iframe);
  // 降级模式无法使用 Proxy.revocable，所有 descriptor 统一通过可清空的 refs 访问 DOM。
  // 对 iframe 的强引用，斩断「主应用 → 代理闭包 → iframe」的引用链。
  const refs: LocalProxyContext = {
    iframe,
    sandbox: iframeWindow.__JIESHU,
    location: iframeWindow.location,
  };

  const proxyDocument = {};
  const localDocumentKeys = Array.from(
    new Set(documentProxyProperties.modifyLocalProperties.concat(Array.from(localForwardedDocumentKeys))),
  );
  defineResolvedProperties(proxyDocument, localDocumentKeys, refs, resolveLocalDocumentDescriptor);

  const proxyLocation: Record<PropertyKey, unknown> = {};
  const locationKeys = new Set(Object.keys(iframeWindow.location));
  const constantValues: Record<string, unknown> = {};
  for (const key of localLocationConstantKeys) constantValues[key] = Reflect.get(urlElement, key);
  const locationDescriptorContext: LocalLocationDescriptorContext = {
    refs,
    constantValues,
    mainHostPath,
    appHostPath,
    locationKeys,
  };
  const localLocationKeys = Array.from(
    new Set(localLocationConstantKeys.concat(['href', 'reload', 'toString'], Array.from(locationKeys))),
  );
  defineResolvedProperties(proxyLocation, localLocationKeys, locationDescriptorContext, resolveLocalLocationDescriptor);

  // 置空捕获的 DOM 引用，斩断 getter 闭包对 iframe / location / sandbox 的强引用
  const proxyRevoke = () => {
    refs.iframe = null;
    refs.sandbox = null;
    refs.location = null;
  };
  return { proxyDocument, proxyLocation: proxyLocation as unknown as Location, proxyRevoke };
}
