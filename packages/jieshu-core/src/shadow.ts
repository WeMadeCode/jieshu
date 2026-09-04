import {
  CONTAINER_OVERFLOW_DATA_FLAG,
  CONTAINER_POSITION_DATA_FLAG,
  LOADING_DATA_FLAG,
  JIESHU_APP_ID,
  JIESHU_IFRAME_CLASS,
  JIESHU_LOADING_STYLE,
  JIESHU_LOADING_SVG,
  JIESHU_SHADE_STYLE,
} from './constant';
import {
  getJieshuById,
  rawAppendChild,
  rawElementAppendChild,
  rawElementRemoveChild,
  relativeElementTagAttrMap,
} from './common';
import { getExternalStyleSheets } from './entry';
import { patchRenderEffect } from './effect';
import { patchElementEffect } from './iframe';
import { getCssLoader, getPresetLoaders } from './plugin';
import type Jieshu from './sandbox';
import type { StyleObject } from './template';
import { getAbsolutePath, getContainer, getCurUrl, isFunction, warn } from './utils';

const JIESHU_ELEMENT_NAME = 'jieshu-app';
const ROOT_SELECTOR_PATTERN = /:root/g;

type DisconnectAction = 'destroy' | 'unmount';
type PresetStylePosition = 'before' | 'after';
type PatchStyleElements = [HTMLStyleElement | null, HTMLStyleElement | null];

interface LoadedPresetStyle {
  src: string;
  content: string;
}

interface TemplateSections {
  head: HTMLHeadElement;
  body: HTMLBodyElement;
}

function isRenderContextLive(sandbox: Jieshu, iframeWindow: Window | null | undefined): boolean {
  return !sandbox.destroyed && sandbox.iframe?.contentWindow === iframeWindow && getJieshuById(sandbox.id) === sandbox;
}

declare global {
  interface ShadowRoot {
    head: HTMLHeadElement;
    body: HTMLBodyElement;
  }
}

function getElementSandbox(element: HTMLElement): Jieshu | null {
  const appId = element.getAttribute(JIESHU_APP_ID);
  return appId ? getJieshuById(appId) : null;
}

/** Decide how a detached application should release its runtime. */
export function getDisconnectAction(sandbox: Jieshu): DisconnectAction {
  const hasReusableMount = isFunction(sandbox.iframe?.contentWindow?.__JIESHU_MOUNT);
  return sandbox.alive || hasReusableMount ? 'unmount' : 'destroy';
}

function reportDisconnectFailure(action: DisconnectAction, reason: unknown): void {
  warn(`${action} error: ${String(reason)}`);
}

/**
 * A retained or lifecycle-enabled application can be unmounted and reused.
 * A rebuild-only application is destroyed immediately so its hidden iframe
 * cannot accumulate after the host element is detached.
 */
export function handleJieshuAppDisconnect(sandbox: Jieshu | null | undefined): void {
  if (!sandbox) return;
  const action = getDisconnectAction(sandbox);

  try {
    const completion = action === 'destroy' ? sandbox.destroy() : sandbox.unmount();
    completion.catch((reason: unknown) => reportDisconnectFailure(action, reason));
  } catch (reason: unknown) {
    reportDisconnectFailure(action, reason);
  }
}

/** Register the host element once and bridge its DOM lifecycle to a sandbox. */
export function defineJieshuWebComponent(): void {
  const registry = window.customElements;
  if (!registry || typeof registry.define !== 'function' || typeof registry.get !== 'function') return;
  if (registry.get(JIESHU_ELEMENT_NAME)) return;

  class JieshuAppElement extends HTMLElement {
    connectedCallback(): void {
      const sandbox = getElementSandbox(this);
      const iframeWindow = sandbox?.iframe?.contentWindow;
      if (!sandbox || !iframeWindow) return;

      if (this.shadowRoot) {
        sandbox.shadowRoot = this.shadowRoot;
        return;
      }

      const root = this.attachShadow({ mode: 'open' });
      patchElementEffect(root, iframeWindow);
      sandbox.shadowRoot = root;
    }

    disconnectedCallback(): void {
      const sandbox = getElementSandbox(this);
      if (!sandbox?.relocating) handleJieshuAppDisconnect(sandbox);
    }
  }

  registry.define(JIESHU_ELEMENT_NAME, JieshuAppElement);
}

export function createJieshuWebComponent(id: string): HTMLElement {
  const element = window.document.createElement(JIESHU_ELEMENT_NAME);
  element.setAttribute(JIESHU_APP_ID, id);
  element.classList.add(JIESHU_IFRAME_CLASS);
  return element;
}

function hasLoadingIndicator(container: HTMLElement): boolean {
  return Boolean(container.querySelector(`div[${LOADING_DATA_FLAG}]`));
}

/** Replace a host container's contents while allowing its loading overlay to survive. */
export function renderElementToContainer(
  element: Element | ChildNode,
  selectorOrElement: string | HTMLElement,
): HTMLElement {
  const container = getContainer(selectorOrElement);
  if (container.contains(element)) return container;

  if (!hasLoadingIndicator(container)) clearChild(container);
  rawElementAppendChild.call(container, element);
  return container;
}

async function loadPresetStyles(styles: readonly StyleObject[], sandbox: Jieshu): Promise<LoadedPresetStyle[]> {
  const results = getExternalStyleSheets(
    [...styles],
    sandbox.fetch,
    sandbox.lifecycles.loadError,
    sandbox.assetCacheScope,
  );
  return Promise.all(
    results.map(async ({ src, contentPromise }): Promise<LoadedPresetStyle> => ({
      src,
      content: await contentPromise,
    })),
  );
}

function createPresetStyleElement(
  ownerDocument: Document,
  style: LoadedPresetStyle,
  transform: (code: string, url: string, base: string) => string,
  baseUrl: string,
): HTMLStyleElement | null {
  if (!style.content) return null;

  const element = ownerDocument.createElement('style');
  element.type = 'text/css';
  element.appendChild(ownerDocument.createTextNode(transform(style.content, style.src, baseUrl)));
  return element;
}

function placePresetStyle(html: HTMLHtmlElement, style: HTMLStyleElement, position: PresetStylePosition): void {
  if (position === 'after') {
    rawAppendChild.call(html, style);
    return;
  }

  const anchor = html.querySelector('head') || html.querySelector('body') || html.firstChild;
  html.insertBefore(style, anchor);
}

async function injectPresetStyleGroup(
  html: HTMLHtmlElement,
  sandbox: Jieshu,
  styles: readonly StyleObject[],
  position: PresetStylePosition,
): Promise<void> {
  const loadedStyles = await loadPresetStyles(styles, sandbox);
  if (!isRenderContextLive(sandbox, sandbox.iframe?.contentWindow)) return;
  const ownerDocument = sandbox.iframe.contentDocument;
  if (!ownerDocument) return;

  const transform = getCssLoader({ plugins: sandbox.plugins, replace: sandbox.replace });
  const baseUrl = getCurUrl(sandbox.proxyLocation);
  loadedStyles.forEach((style) => {
    const element = createPresetStyleElement(ownerDocument, style, transform, baseUrl);
    if (element) placePresetStyle(html, element, position);
  });
}

/** Decorate a parsed template with plugin styles without coupling parsing to I/O. */
async function decorateTemplateWithPresetStyles(sandbox: Jieshu, html: HTMLHtmlElement): Promise<HTMLHtmlElement> {
  const before = getPresetLoaders('cssBeforeLoaders', sandbox.plugins);
  const after = getPresetLoaders('cssAfterLoaders', sandbox.plugins);

  await Promise.all([
    injectPresetStyleGroup(html, sandbox, before, 'before'),
    injectPresetStyleGroup(html, sandbox, after, 'after'),
  ]).catch((): void => undefined);
  return html;
}

function copyDocumentElementAttributes(template: string, target: HTMLHtmlElement): void {
  const parsed = new DOMParser().parseFromString(template, 'text/html');
  Array.from(parsed.documentElement.attributes).forEach(({ name, value }) => target.setAttribute(name, value));
}

function ensureTemplateSections(html: HTMLHtmlElement, ownerDocument: Document): TemplateSections {
  let head = html.querySelector('head');
  let body = html.querySelector('body');

  if (!head) {
    head = ownerDocument.createElement('head');
    html.insertBefore(head, body || html.firstChild);
  }
  if (!body) {
    body = ownerDocument.createElement('body');
    rawAppendChild.call(html, body);
  }
  return { head, body };
}

function refillSection(source: HTMLElement, reusable: HTMLElement): void {
  clearChild(reusable);
  while (source.firstChild) rawAppendChild.call(reusable, source.firstChild);
  source.parentNode?.replaceChild(reusable, source);
}

function reuseSandboxSections(sections: TemplateSections, sandbox: Jieshu): TemplateSections {
  const reusableHead = sandbox.head;
  const reusableBody = sandbox.body;
  if (!reusableHead || !reusableBody) return sections;

  refillSection(sections.head, reusableHead);
  refillSection(sections.body, reusableBody);
  return { head: reusableHead, body: reusableBody };
}

function resolveSourceSet(value: string, baseURI: string): string {
  const candidates: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    while (cursor < value.length && (value[cursor] === ',' || /\s/.test(value[cursor]))) cursor += 1;
    if (cursor >= value.length) break;
    const urlStart = cursor;
    const dataUrl = value.slice(cursor, cursor + 5).toLowerCase() === 'data:';
    while (cursor < value.length && !/\s/.test(value[cursor]) && (dataUrl || value[cursor] !== ',')) cursor += 1;
    const url = value.slice(urlStart, cursor);
    while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1;
    const descriptorStart = cursor;
    while (cursor < value.length && value[cursor] !== ',') cursor += 1;
    const descriptor = value.slice(descriptorStart, cursor).trim();
    candidates.push(`${dataUrl ? url : getAbsolutePath(url, baseURI)}${descriptor ? ` ${descriptor}` : ''}`);
  }
  return candidates.join(', ');
}

export function repairRelativeElementUrl(element: HTMLElement): void {
  const attributes = relativeElementTagAttrMap[element.tagName];
  if (!attributes) return;

  attributes.forEach(({ attribute, property = attribute, sourceSet }) => {
    if (!element.hasAttribute(attribute)) return;
    const rawValue = element.getAttribute(attribute) ?? '';
    const resolvedValue = sourceSet
      ? resolveSourceSet(rawValue, element.baseURI || '')
      : Reflect.get(element, property);
    if (typeof resolvedValue === 'string') {
      element.setAttribute(
        attribute,
        sourceSet ? resolvedValue : getAbsolutePath(resolvedValue, element.baseURI || ''),
      );
    }
  });
}

function patchTemplateTree(html: HTMLHtmlElement, iframeWindow: Window): void {
  const iterator = iframeWindow.document.createTreeWalker(html, NodeFilter.SHOW_ELEMENT, null, false);
  let element = iterator.currentNode as HTMLElement | null;
  while (element) {
    patchElementEffect(element, iframeWindow);
    repairRelativeElementUrl(element);
    element = iterator.nextNode() as HTMLElement | null;
  }
}

/** Parse, normalize and patch a template in the JavaScript sandbox's realm. */
function buildTemplateRoot(iframeWindow: Window, template: string): HTMLHtmlElement {
  const sandbox = iframeWindow.__JIESHU;
  const ownerDocument = iframeWindow.document;
  const html = ownerDocument.createElement('html');
  html.innerHTML = template;
  copyDocumentElementAttributes(template, html);

  let sections = ensureTemplateSections(html, ownerDocument);
  if (!sandbox.alive && sandbox.execFlag) sections = reuseSandboxSections(sections, sandbox);
  sandbox.head = sections.head;
  sandbox.body = sections.body;

  patchTemplateTree(html, iframeWindow);
  return html;
}

async function prepareTemplateRoot(iframeWindow: Window, template: string): Promise<HTMLHtmlElement> {
  const html = buildTemplateRoot(iframeWindow, template);
  return decorateTemplateWithPresetStyles(iframeWindow.__JIESHU, html);
}

function installDocumentParentFacade(html: HTMLHtmlElement, iframeDocument: Document): void {
  Object.defineProperty(html, 'parentNode', {
    enumerable: true,
    configurable: true,
    get: () => iframeDocument,
  });
}

function installShadowRootFacades(shadowRoot: ShadowRoot, iframeWindow: Window): void {
  const shadowHtml = shadowRoot.firstElementChild as HTMLHtmlElement | null;
  if (!shadowHtml) throw new Error('The application shadow root has no document element');

  installDocumentParentFacade(shadowHtml, iframeWindow.document);
  Object.defineProperty(shadowHtml, 'getBoundingClientRect', {
    enumerable: true,
    configurable: true,
    value: (): DOMRect => {
      const sourceHtml = iframeWindow.__JIESHU_RAW_DOCUMENT_QUERY_SELECTOR__.call(iframeWindow.document, 'html');
      if (!sourceHtml) throw new Error('The application iframe has no document element');
      return sourceHtml.getBoundingClientRect();
    },
  });
}

/** Render a normalized application document into its shadow root. */
export async function renderTemplateToShadowRoot(
  shadowRoot: ShadowRoot,
  iframeWindow: Window,
  template: string,
  canRender: () => boolean = () => true,
): Promise<void> {
  const sandbox = iframeWindow.__JIESHU;
  const html = await prepareTemplateRoot(iframeWindow, template);
  if (!canRender() || !sandbox || !isRenderContextLive(sandbox, iframeWindow) || sandbox.shadowRoot !== shadowRoot)
    return;
  rawAppendChild.call(shadowRoot, html);
  if (!canRender() || !isRenderContextLive(sandbox, iframeWindow)) {
    rawElementRemoveChild.call(shadowRoot, html);
    return;
  }

  const shade = document.createElement('div');
  shade.setAttribute('style', JIESHU_SHADE_STYLE);
  html.insertBefore(shade, html.firstChild);

  const { head, body } = ensureTemplateSections(html, iframeWindow.document);
  shadowRoot.head = head;
  shadowRoot.body = body;
  installShadowRootFacades(shadowRoot, iframeWindow);
  patchRenderEffect(shadowRoot, sandbox.id);
}

/** Remove all direct children through the captured native DOM method. */
export function clearChild(root: ShadowRoot | Node): void {
  while (root?.firstChild) rawElementRemoveChild.call(root, root.firstChild);
}

function rememberOverflow(container: HTMLElement, overflow: string): void {
  container.setAttribute(CONTAINER_OVERFLOW_DATA_FLAG, overflow === 'visible' ? '' : overflow);
}

function lockContainerLayout(container: HTMLElement, styles: CSSStyleDeclaration): void {
  if (styles.position === 'static') {
    container.setAttribute(CONTAINER_POSITION_DATA_FLAG, styles.position);
    rememberOverflow(container, styles.overflow);
    container.style.setProperty('position', 'relative');
    container.style.setProperty('overflow', 'hidden');
    return;
  }

  if (styles.position === 'relative' || styles.position === 'sticky') {
    rememberOverflow(container, styles.overflow);
    container.style.setProperty('overflow', 'hidden');
  }
}

function createLoadingIndicator(loading?: HTMLElement): HTMLDivElement {
  const indicator = document.createElement('div');
  indicator.setAttribute(LOADING_DATA_FLAG, '');
  indicator.setAttribute('style', JIESHU_LOADING_STYLE);
  if (loading) indicator.appendChild(loading);
  else indicator.innerHTML = JIESHU_LOADING_SVG;
  return indicator;
}

/** Clear a host container and display a stable loading overlay. */
export function addLoading(el: string | HTMLElement, loading?: HTMLElement): void {
  const container = getContainer(el);
  clearChild(container);

  let styles: CSSStyleDeclaration;
  try {
    styles = window.getComputedStyle(container);
  } catch {
    return;
  }

  lockContainerLayout(container, styles);
  rawElementAppendChild.call(container, createLoadingIndicator(loading));
}

/** Remove a loading overlay and restore layout properties changed by addLoading. */
export function removeLoading(container: HTMLElement): void {
  const position = container.getAttribute(CONTAINER_POSITION_DATA_FLAG);
  const overflow = container.getAttribute(CONTAINER_OVERFLOW_DATA_FLAG);

  if (position !== null) container.style.removeProperty('position');
  if (overflow !== null) {
    if (overflow) container.style.setProperty('overflow', overflow);
    else container.style.removeProperty('overflow');
  }

  container.removeAttribute(CONTAINER_POSITION_DATA_FLAG);
  container.removeAttribute(CONTAINER_OVERFLOW_DATA_FLAG);
  const indicator = container.querySelector(`div[${LOADING_DATA_FLAG}]`);
  if (indicator) rawElementRemoveChild.call(container, indicator);
}

function readableRules(styleSheet: CSSStyleSheet | null | undefined): readonly CSSRule[] {
  if (!styleSheet) return [];
  try {
    return Array.from(styleSheet.cssRules ?? []);
  } catch {
    // Accessing cssRules of a cross-origin stylesheet throws a SecurityError.
    return [];
  }
}

function collectPatchRules(styleSheets: readonly (CSSStyleSheet | null | undefined)[]): {
  rootRules: string[];
  fontRules: string[];
} {
  const rootRules: string[] = [];
  const fontRules: string[] = [];
  const fontFaceRule = typeof CSSRule === 'undefined' ? 5 : CSSRule.FONT_FACE_RULE;

  styleSheets.forEach((styleSheet) => {
    readableRules(styleSheet).forEach((rule) => {
      if (rule.cssText.includes(':root')) rootRules.push(rule.cssText.replace(ROOT_SELECTOR_PATTERN, ':host'));
      if (rule.type === fontFaceRule) fontRules.push(rule.cssText);
    });
  });
  return { rootRules, fontRules };
}

function rulesToStyleElement(rules: readonly string[]): HTMLStyleElement | null {
  if (!rules.length) return null;
  const element = window.document.createElement('style');
  element.textContent = rules.join('');
  return element;
}

/** Extract :root and @font-face rules for placement outside application stylesheets. */
export function getPatchStyleElements(
  rootStyleSheets: readonly (CSSStyleSheet | null | undefined)[],
): PatchStyleElements {
  const { rootRules, fontRules } = collectPatchRules(rootStyleSheets);
  return [rulesToStyleElement(rootRules), rulesToStyleElement(fontRules)];
}
