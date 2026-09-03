const WUJIE_INLINE_EVENT_PREFIX = '{const __WUJIE_INLINE_SCOPE__=window.__getWujieWindow__(';
const LEGACY_INLINE_EVENT_PREFIX = 'with(window.__getWujieWindow__(';
const patchedWindows = new WeakSet<object>();

function isInlineEventAttribute(name: string): boolean {
  if (name.length <= 2) return false;
  const first = name.charCodeAt(0);
  const second = name.charCodeAt(1);
  return (first === 79 || first === 111) && (second === 78 || second === 110);
}

function compileAttributeValue(name: string, value: string, iframeWindow: Window): string {
  if (!isInlineEventAttribute(name)) return value;
  const appId = iframeWindow.__WUJIE?.id;
  return appId ? wrapInlineEventHandler(value, appId) : value;
}

/** Compile an inline handler so it resolves globals from the child app realm. */
export function wrapInlineEventHandler(handler: string, appId: string): string {
  if (handler.startsWith(WUJIE_INLINE_EVENT_PREFIX) || handler.startsWith(LEGACY_INLINE_EVENT_PREFIX)) return handler;
  return `${WUJIE_INLINE_EVENT_PREFIX}${JSON.stringify(
    appId,
  )});if(__WUJIE_INLINE_SCOPE__){with(__WUJIE_INLINE_SCOPE__){ ${handler} }}}`;
}

/** Compile existing inline handlers on an element subtree. */
export function compileInlineEvents(element: Element, iframeWindow: Window): void {
  if (element.nodeType !== Node.ELEMENT_NODE) return;
  const appId = iframeWindow.__WUJIE?.id;
  if (!appId) return;

  Array.from(element.attributes).forEach((attribute) => {
    if (!isInlineEventAttribute(attribute.name)) return;
    const compiledHandler = wrapInlineEventHandler(attribute.value, appId);
    if (compiledHandler !== attribute.value) element.setAttribute(attribute.name, compiledHandler);
  });

  Array.from(element.children).forEach((child) => compileInlineEvents(child, iframeWindow));
}

function patchMarkupSetter(iframeWindow: Window, prototype: object, property: 'innerHTML' | 'outerHTML'): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
  if (!descriptor?.get || !descriptor.set || descriptor.configurable === false) return;
  const rawGet = descriptor.get;
  const rawSet = descriptor.set;
  Object.defineProperty(prototype, property, {
    ...descriptor,
    get: function (): string {
      return Reflect.apply(rawGet, this, []) as string;
    },
    set: function (this: Element | ShadowRoot, markup: string): void {
      const parent = property === 'outerHTML' && this instanceof iframeWindow.Element ? this.parentElement : null;
      Reflect.apply(rawSet, this, [markup]);
      const root = parent ?? this;
      if (root instanceof iframeWindow.Element) compileInlineEvents(root, iframeWindow);
      else Array.from(root.children).forEach((child) => compileInlineEvents(child, iframeWindow));
    },
  });
}

/** Compile inline handlers assigned after the initial DOM patch. */
export function patchInlineEventSetAttribute(iframeWindow: Window): void {
  if (patchedWindows.has(iframeWindow)) return;
  patchedWindows.add(iframeWindow);

  const rawSetAttribute = iframeWindow.Element.prototype.setAttribute;
  const rawSetAttributeNS = iframeWindow.Element.prototype.setAttributeNS;
  const rawSetAttributeNode = iframeWindow.Element.prototype.setAttributeNode;
  const rawSetAttributeNodeNS = iframeWindow.Element.prototype.setAttributeNodeNS;
  const rawInsertAdjacentHTML = iframeWindow.Element.prototype.insertAdjacentHTML;

  iframeWindow.Element.prototype.setAttribute = function (name: string, value: string): void {
    const normalizedValue = String(value);
    rawSetAttribute.call(this, name, compileAttributeValue(name, normalizedValue, iframeWindow));
  };

  iframeWindow.Element.prototype.setAttributeNS = function (
    namespace: string | null,
    qualifiedName: string,
    value: string,
  ): void {
    const normalizedValue = String(value);
    const compiledValue = namespace
      ? normalizedValue
      : compileAttributeValue(qualifiedName, normalizedValue, iframeWindow);
    rawSetAttributeNS.call(this, namespace, qualifiedName, compiledValue);
  };

  iframeWindow.Element.prototype.setAttributeNode = function (attribute: Attr): Attr | null {
    if (!attribute.namespaceURI && isInlineEventAttribute(attribute.name)) {
      attribute.value = compileAttributeValue(attribute.name, attribute.value, iframeWindow);
    }
    return rawSetAttributeNode.call(this, attribute);
  };

  iframeWindow.Element.prototype.setAttributeNodeNS = function (attribute: Attr): Attr | null {
    if (!attribute.namespaceURI && isInlineEventAttribute(attribute.name)) {
      attribute.value = compileAttributeValue(attribute.name, attribute.value, iframeWindow);
    }
    return rawSetAttributeNodeNS.call(this, attribute);
  };

  iframeWindow.Element.prototype.insertAdjacentHTML = function (position: InsertPosition, text: string): void {
    const parent = position === 'beforebegin' || position === 'afterend' ? this.parentElement : null;
    rawInsertAdjacentHTML.call(this, position, text);
    compileInlineEvents(parent ?? this, iframeWindow);
  };

  patchMarkupSetter(iframeWindow, iframeWindow.Element.prototype, 'innerHTML');
  patchMarkupSetter(iframeWindow, iframeWindow.Element.prototype, 'outerHTML');
  patchMarkupSetter(iframeWindow, iframeWindow.ShadowRoot.prototype, 'innerHTML');
}
