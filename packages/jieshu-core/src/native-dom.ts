export interface NativeDomCapabilities {
  elementAppendChild: typeof HTMLElement.prototype.appendChild;
  elementRemoveChild: typeof HTMLElement.prototype.removeChild;
  elementContains: typeof HTMLElement.prototype.contains;
  headInsertBefore: typeof HTMLHeadElement.prototype.insertBefore;
  bodyInsertBefore: typeof HTMLBodyElement.prototype.insertBefore;
  styleInsertAdjacentElement: typeof HTMLStyleElement.prototype.insertAdjacentElement;
  addEventListener: typeof Node.prototype.addEventListener;
  removeEventListener: typeof Node.prototype.removeEventListener;
  windowAddEventListener: typeof window.addEventListener;
  windowRemoveEventListener: typeof window.removeEventListener;
  appendChild: typeof Node.prototype.appendChild;
  documentQuerySelector: typeof Document.prototype.querySelector;
}

function captureNativeDomCapabilities(): NativeDomCapabilities {
  return {
    elementAppendChild: HTMLElement.prototype.appendChild,
    elementRemoveChild: HTMLElement.prototype.removeChild,
    elementContains: HTMLElement.prototype.contains,
    headInsertBefore: HTMLHeadElement.prototype.insertBefore,
    bodyInsertBefore: HTMLBodyElement.prototype.insertBefore,
    styleInsertAdjacentElement: HTMLStyleElement.prototype.insertAdjacentElement,
    addEventListener: Node.prototype.addEventListener,
    removeEventListener: Node.prototype.removeEventListener,
    windowAddEventListener: window.addEventListener,
    windowRemoveEventListener: window.removeEventListener,
    appendChild: Node.prototype.appendChild,
    documentQuerySelector: window.__POWERED_BY_JIESHU__
      ? window.__JIESHU_RAW_DOCUMENT_QUERY_SELECTOR__
      : Document.prototype.querySelector,
  };
}

export const nativeDomCapabilities = captureNativeDomCapabilities();

export const rawElementAppendChild = nativeDomCapabilities.elementAppendChild;
export const rawElementRemoveChild = nativeDomCapabilities.elementRemoveChild;
export const rawElementContains = nativeDomCapabilities.elementContains;
export const rawHeadInsertBefore = nativeDomCapabilities.headInsertBefore;
export const rawBodyInsertBefore = nativeDomCapabilities.bodyInsertBefore;
export const rawInsertAdjacentElement = nativeDomCapabilities.styleInsertAdjacentElement;
export const rawAddEventListener = nativeDomCapabilities.addEventListener;
export const rawRemoveEventListener = nativeDomCapabilities.removeEventListener;
export const rawWindowAddEventListener = nativeDomCapabilities.windowAddEventListener;
export const rawWindowRemoveEventListener = nativeDomCapabilities.windowRemoveEventListener;
export const rawAppendChild = nativeDomCapabilities.appendChild;
export const rawDocumentQuerySelector = nativeDomCapabilities.documentQuerySelector;
