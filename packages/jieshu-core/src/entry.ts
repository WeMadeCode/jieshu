import processTpl, { genLinkReplaceSymbol, getInlineStyleReplaceSymbol } from './template';
import type { ScriptAttributes, ScriptObject, StyleObject } from './template';
import { requestIdleCallback, error } from './utils';
import {
  JIESHU_TIPS_NO_FETCH,
  JIESHU_TIPS_SCRIPT_ERROR_REQUESTED,
  JIESHU_TIPS_CSS_ERROR_REQUESTED,
  JIESHU_TIPS_HTML_ERROR_REQUESTED,
  JIESHU_DATA_FLAG,
} from './constant';
import { getCssLoader, getEffectLoaders, isMatchUrl } from './plugin';
import type Jieshu from './sandbox';
import type { LoadErrorHandler, JieshuPlugin } from './contracts';

type FetchFunction = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type AssetKind = 'style' | 'script';
type CacheRecord<Value> = Record<string, Promise<Value> | null>;
type CacheScope = object;
type CacheStatus = 'pending' | 'fulfilled' | 'rejected';
const STYLE_SOURCE_INDEX: unique symbol = Symbol('jieshu.style-source-index');

export type ScriptResultList = Array<ScriptObject & { contentPromise: Promise<string> }>;

interface IndexedStyleObject extends StyleObject {
  [STYLE_SOURCE_INDEX]?: number;
}

interface StyleResult {
  src: string;
  contentPromise: Promise<string>;
  ignore?: boolean;
  attrs?: ScriptAttributes;
  fallback?: string;
  [STYLE_SOURCE_INDEX]?: number;
}

export type StyleResultList = StyleResult[];

interface HtmlParseResult {
  template: string;
  assetPublicPath: string;
  getExternalScripts(): ScriptResultList;
  getExternalStyleSheets(): StyleResultList;
}

/** Cacheable entry structure with no caller-specific fetch or lifecycle closures. */
interface ParsedHtmlDocument {
  template: string;
  assetPublicPath: string;
  scripts: ScriptObject[];
  styles: IndexedStyleObject[];
}

interface ImportEntryOptions {
  fetch?: FetchFunction;
  fiber?: boolean;
  plugins?: JieshuPlugin[];
  loadError?: LoadErrorHandler;
  /** One sandbox generation. A newer generation must not inherit old pending I/O. */
  cacheScope?: CacheScope;
}

interface ImportHtmlParameters {
  url: string;
  html?: string;
  opts: ImportEntryOptions;
}

/**
 * Promise-aware cache with in-flight request coalescing. A rejection evicts
 * only the promise that failed, so a newer request cannot be deleted by an
 * older request settling late.
 */
class AssetCache<Value> {
  private readonly metadata = new WeakMap<Promise<Value>, { scope?: CacheScope; status: CacheStatus }>();
  private readonly unscopedReservations = new Map<string, object>();
  private readonly scopedReservations = new Map<CacheScope, Map<string, object>>();

  constructor(private readonly records: CacheRecord<Value>) {}

  reserve(key: string, scope?: CacheScope): () => boolean {
    let reservations = scope ? this.scopedReservations.get(scope) : this.unscopedReservations;
    if (!reservations) {
      reservations = new Map<string, object>();
      if (scope) this.scopedReservations.set(scope, reservations);
    }
    const reservation = reservations.get(key) ?? {};
    reservations.set(key, reservation);
    return () =>
      reservations?.get(key) === reservation &&
      (scope ? this.scopedReservations.get(scope) === reservations : reservations === this.unscopedReservations);
  }

  getOrCreate(key: string, load: () => Promise<Value>, scope?: CacheScope): Promise<Value> {
    const cached = this.records[key];
    if (cached) {
      const cachedMetadata = this.metadata.get(cached);
      // Settled data is reusable across sandboxes. Pending work is reusable
      // only inside the sandbox generation that started it; otherwise a stale
      // custom fetch could block a replacement forever.
      if (!scope || !cachedMetadata || cachedMetadata.scope === scope || cachedMetadata.status === 'fulfilled') {
        return cached;
      }
    }

    let request: Promise<Value>;
    const metadata: { scope?: CacheScope; status: CacheStatus } = { scope, status: 'pending' };
    try {
      const source = load();
      request = source.then(
        (value): Value => {
          metadata.status = 'fulfilled';
          return value;
        },
        (reason: unknown): never => {
          metadata.status = 'rejected';
          if (this.records[key] === request) delete this.records[key];
          throw reason;
        },
      );
    } catch (reason: unknown) {
      delete this.records[key];
      return Promise.reject(reason);
    }
    this.metadata.set(request, metadata);
    this.records[key] = request;
    return request;
  }

  clear(prefixes?: readonly string[]): void {
    Object.keys(this.records).forEach((key) => {
      if (!prefixes || prefixes.some((prefix) => key.startsWith(prefix))) delete this.records[key];
    });
    const clearReservations = (reservations: Map<string, object>): void => {
      Array.from(reservations.keys()).forEach((key) => {
        if (!prefixes || prefixes.some((prefix) => key.startsWith(prefix))) reservations.delete(key);
      });
    };
    clearReservations(this.unscopedReservations);
    this.scopedReservations.forEach((reservations, scope) => {
      clearReservations(reservations);
      if (!reservations.size) this.scopedReservations.delete(scope);
    });
  }

  invalidateScope(scope: CacheScope): void {
    Object.keys(this.records).forEach((key) => {
      const request = this.records[key];
      const metadata = request ? this.metadata.get(request) : undefined;
      if (metadata?.scope === scope && metadata.status === 'pending') delete this.records[key];
    });
    this.scopedReservations.delete(scope);
  }
}

// These records remain exported for backwards compatibility with existing
// deep imports. AssetCache owns their runtime policy but does not hide them.
export const styleCache: CacheRecord<string> = {};
export const scriptCache: CacheRecord<string> = {};
export const embedHTMLCache: CacheRecord<ParsedHtmlDocument> = {};

const styleAssets = new AssetCache(styleCache);
const scriptAssets = new AssetCache(scriptCache);
const htmlDocuments = new AssetCache(embedHTMLCache);

export function clearAssetsCache(host?: string | string[]): void {
  // Keep accepting a legacy runtime `null` even though the public type only
  // exposes the clearer undefined form.
  const prefixes = host == null ? undefined : Array.isArray(host) ? host : [host];
  styleAssets.clear(prefixes);
  scriptAssets.clear(prefixes);
  htmlDocuments.clear(prefixes);
}

/** Invalidate only pending work owned by a sandbox activation generation. */
export function releaseAssetCacheScope(scope: CacheScope): void {
  styleAssets.invalidateScope(scope);
  scriptAssets.invalidateScope(scope);
  htmlDocuments.invalidateScope(scope);
}

if (!window.fetch) {
  error(JIESHU_TIPS_NO_FETCH);
  throw new Error(JIESHU_TIPS_NO_FETCH);
}
const defaultFetch: FetchFunction = window.fetch.bind(window);

function currentApplicationUrl(proxyLocation: Location): string {
  return `${proxyLocation.protocol}//${proxyLocation.host}${proxyLocation.pathname}`;
}

function applyHtmlLoaders(code: string, plugins: readonly JieshuPlugin[]): string {
  return plugins.reduce(
    (result, plugin) => (typeof plugin.htmlLoader === 'function' ? plugin.htmlLoader(result) : result),
    code,
  );
}

const STYLE_ATTRIBUTE_NAMES = ['media', 'nonce', 'title', 'type', 'blocking', 'disabled'] as const;

function styleAttribute(attributes: ScriptAttributes | undefined, expectedName: string): string | boolean | undefined {
  if (!attributes) return undefined;
  const name = Object.keys(attributes).find((attributeName) => attributeName.toLowerCase() === expectedName);
  return name ? attributes[name] : undefined;
}

function hasStyleAttribute(attributes: ScriptAttributes | undefined, name: string): boolean {
  const value = styleAttribute(attributes, name);
  return value !== undefined && value !== false;
}

function escapeAttributeValue(value: string): string {
  let escaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '&') escaped += '&amp;';
    else if (character === '"') escaped += '&quot;';
    else if (character === '<') escaped += '&lt;';
    else if (character === '>') escaped += '&gt;';
    else escaped += character;
  }
  return escaped;
}

function serializeStyleAttributes(attributes: ScriptAttributes | undefined): string {
  return STYLE_ATTRIBUTE_NAMES.reduce((serialized, name) => {
    const value = styleAttribute(attributes, name);
    if (value === undefined || value === false) return serialized;
    return serialized + (value === true ? ` ${name}` : ` ${name}="${escapeAttributeValue(value)}"`);
  }, '');
}

function serializeNativeStyleLink(source: string, attributes: ScriptAttributes | undefined): string {
  return `<link href="${escapeAttributeValue(source)}" rel="stylesheet"${serializeStyleAttributes(attributes)}>`;
}

function serializeEmbeddedStyle(attributes: ScriptAttributes | undefined, content: string): string {
  return `<style${serializeStyleAttributes(attributes)}>${content}</style>`;
}

export async function processCssLoader(
  sandbox: Jieshu,
  template: string,
  getExternalStyleSheets: () => StyleResultList,
): Promise<string> {
  const applicationUrl = currentApplicationUrl(sandbox.proxyLocation);
  const loadCss = getCssLoader({ plugins: sandbox.plugins });
  const replace = sandbox.replace;
  const processedStyles = getExternalStyleSheets().map((styleResult) => {
    const { src, ignore, attrs, contentPromise } = styleResult;
    const processedStyle: StyleResult = {
      src,
      ignore,
      attrs,
      fallback: styleResult.fallback,
      contentPromise: contentPromise.then((content) => loadCss(content, src, applicationUrl)),
    };
    processedStyle[STYLE_SOURCE_INDEX] = styleResult[STYLE_SOURCE_INDEX];
    return processedStyle;
  });
  const embeddedTemplate = await embedStyleSheets(template, processedStyles);
  return replace ? replace(embeddedTemplate) : embeddedTemplate;
}

interface StyleReplacement {
  marker: string;
  content: string;
}

async function createStyleReplacement(
  styleResult: StyleResultList[number],
  index: number,
): Promise<StyleReplacement | null> {
  const sourceIndex = styleResult[STYLE_SOURCE_INDEX] ?? index;
  const nativeLink = styleResult.fallback ?? serializeNativeStyleLink(styleResult.src, styleResult.attrs);
  // A link stylesheet's disabled state cannot be represented by a style
  // content attribute: HTMLStyleElement.disabled is a sheet-backed IDL
  // property. Keep the native link so later `disabled = false` still works.
  if (styleResult.src && hasStyleAttribute(styleResult.attrs, 'disabled')) {
    return {
      marker: genLinkReplaceSymbol(styleResult.src),
      content: nativeLink,
    };
  }
  let content: string;
  try {
    content = await styleResult.contentPromise;
  } catch (cause: unknown) {
    // A stylesheet request failure must not turn the original link into a
    // successfully loaded empty style. Restoring the link lets the browser
    // apply its native loading/error semantics while the rejected cache entry
    // remains available for a later framework retry.
    if (styleResult.src) {
      return {
        marker: genLinkReplaceSymbol(styleResult.src),
        content: nativeLink,
      };
    }
    throw cause;
  }
  if (styleResult.src) {
    return {
      marker: genLinkReplaceSymbol(styleResult.src),
      content: styleResult.ignore
        ? nativeLink
        : serializeEmbeddedStyle(styleResult.attrs, `/* ${styleResult.src} */${content}`),
    };
  }
  return content
    ? {
        marker: getInlineStyleReplaceSymbol(sourceIndex),
        content: serializeEmbeddedStyle(styleResult.attrs, `/* inline-style-${sourceIndex} */${content}`),
      }
    : null;
}

/** Resolve all CSS first, then apply replacements in source order. */
async function embedStyleSheets(template: string, styles: StyleResultList): Promise<string> {
  const replacements = await Promise.all(styles.map(createStyleReplacement));
  return replacements.reduce(
    (result, replacement) => (replacement ? result.replace(replacement.marker, replacement.content) : result),
    template,
  );
}

function extractInlineCode(markup: string): string {
  const contentStart = markup.indexOf('>') + 1;
  const contentEnd = markup.lastIndexOf('<');
  return contentStart > 0 && contentEnd >= contentStart ? markup.slice(contentStart, contentEnd) : '';
}

function assetErrorMessage(kind: AssetKind): string {
  return kind === 'style' ? JIESHU_TIPS_CSS_ERROR_REQUESTED : JIESHU_TIPS_SCRIPT_ERROR_REQUESTED;
}

function normalizeFailure(cause: unknown, fallbackMessage: string): Error {
  return cause instanceof Error ? cause : new Error(fallbackMessage);
}

function reportAssetFailure(kind: AssetKind, source: string, cause: unknown, loadError?: LoadErrorHandler): Error {
  const message = assetErrorMessage(kind);
  const failure = normalizeFailure(cause, message);
  error(message, { src: source, cause });
  loadError?.(source, failure);
  return failure;
}

async function requestAssetText(
  source: string,
  fetch: FetchFunction,
  kind: AssetKind,
  loadError?: LoadErrorHandler,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(source);
  } catch (cause: unknown) {
    throw reportAssetFailure(kind, source, cause, loadError);
  }

  if (response.status >= 400) {
    throw reportAssetFailure(kind, source, new Error(assetErrorMessage(kind)), loadError);
  }

  try {
    return await response.text();
  } catch (cause: unknown) {
    throw reportAssetFailure(kind, source, cause, loadError);
  }
}

function fetchAssetText(
  source: string,
  cache: AssetCache<string>,
  fetch: FetchFunction,
  kind: AssetKind,
  loadError?: LoadErrorHandler,
  cacheScope?: CacheScope,
): Promise<string> {
  const request = cache.getOrCreate(source, () => requestAssetText(source, fetch, kind, loadError), cacheScope);
  // Script injection uses an empty result as an explicit signal to retain the
  // original src and fall back to native loading. Stylesheet consumers need the
  // rejection itself: static HTML restores its original link, while dynamic
  // links dispatch error instead of reporting a successful empty stylesheet.
  return kind === 'script' ? request.catch(() => '') : request;
}

export function getExternalStyleSheets(
  styles: StyleObject[],
  fetch: FetchFunction = defaultFetch,
  loadError?: LoadErrorHandler,
  cacheScope?: CacheScope,
): StyleResultList {
  return styles.map((style) => {
    const { src, content, ignore, attrs, fallback } = style;
    const keepNativeDisabledLink = Boolean(src && hasStyleAttribute(attrs, 'disabled'));
    const result: StyleResult =
      content !== undefined
        ? { src: '', attrs, contentPromise: Promise.resolve(content) }
        : src?.startsWith('<')
          ? { src: '', attrs, contentPromise: Promise.resolve(extractInlineCode(src)) }
          : !src
            ? { src: '', ignore, attrs, contentPromise: Promise.resolve('') }
            : {
                src,
                ignore,
                attrs,
                fallback,
                contentPromise:
                  ignore || keepNativeDisabledLink
                    ? Promise.resolve('')
                    : fetchAssetText(src, styleAssets, fetch, 'style', loadError, cacheScope),
              };
    result[STYLE_SOURCE_INDEX] = (style as IndexedStyleObject)[STYLE_SOURCE_INDEX];
    return result;
  });
}

function scheduleScriptRequest(load: () => Promise<string>, fiber: boolean): Promise<string> {
  if (!fiber) return load();
  return new Promise<string>((resolve, reject) => {
    requestIdleCallback(() => {
      load().then(resolve, reject);
    });
  });
}

function scriptContentPromise(
  script: ScriptObject,
  fetch: FetchFunction,
  loadError: LoadErrorHandler | undefined,
  fiber: boolean,
  cacheScope?: CacheScope,
): Promise<string> {
  const { src, async, defer, module, ignore } = script;
  if ((module && src) || ignore) return Promise.resolve('');
  if (!src) return Promise.resolve(script.content ?? '');
  const isCurrentReservation = scriptAssets.reserve(src, cacheScope);
  const load = () =>
    isCurrentReservation()
      ? fetchAssetText(src, scriptAssets, fetch, 'script', loadError, cacheScope)
      : Promise.resolve('');
  return async || defer ? scheduleScriptRequest(load, fiber) : load();
}

export function getExternalScripts(
  scripts: ScriptObject[],
  fetch: FetchFunction = defaultFetch,
  loadError: LoadErrorHandler | undefined,
  fiber: boolean,
  cacheScope?: CacheScope,
): ScriptResultList {
  return scripts.map((script) => {
    const normalizedScript = script.module && !script.async ? { ...script, defer: true } : { ...script };
    return {
      ...normalizedScript,
      contentPromise: scriptContentPromise(normalizedScript, fetch, loadError, fiber, cacheScope),
    };
  });
}

function resolveAssetPublicPath(entry: string): string {
  try {
    const { origin, pathname } = new URL(entry, window.location.href);
    const pathSegments = pathname.split('/');
    pathSegments.pop();
    return `${origin}${pathSegments.join('/')}/`;
  } catch (cause: unknown) {
    console.warn(cause);
    return '';
  }
}

function reportHtmlFailure(url: string, cause: unknown, loadError?: LoadErrorHandler): Error {
  const failure = normalizeFailure(cause, JIESHU_TIPS_HTML_ERROR_REQUESTED);
  error(JIESHU_TIPS_HTML_ERROR_REQUESTED, { url, cause });
  loadError?.(url, failure);
  return failure;
}

async function fetchHtml(url: string, fetch: FetchFunction, loadError?: LoadErrorHandler): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause: unknown) {
    throw reportHtmlFailure(url, cause, loadError);
  }

  if (response.status >= 400) {
    throw reportHtmlFailure(url, new Error(JIESHU_TIPS_HTML_ERROR_REQUESTED), loadError);
  }

  try {
    return await response.text();
  } catch (cause: unknown) {
    throw reportHtmlFailure(url, cause, loadError);
  }
}

function includeAsset(source: string | undefined, exclusions: readonly (string | RegExp)[]): boolean {
  return !source || !isMatchUrl(source, exclusions);
}

function ignoreAsset(source: string | undefined, ignores: readonly (string | RegExp)[]): boolean {
  return Boolean(source && isMatchUrl(source, ignores));
}

async function parseHtmlDocument(
  url: string,
  suppliedHtml: string | undefined,
  fetch: FetchFunction,
  plugins: readonly JieshuPlugin[],
  loadError: LoadErrorHandler | undefined,
): Promise<ParsedHtmlDocument> {
  // Preserve the public convention that an empty `html` string means
  // "request the entry document" rather than "use an empty document".
  const html = suppliedHtml ? suppliedHtml : await fetchHtml(url, fetch, loadError);
  const assetPublicPath = resolveAssetPublicPath(url);
  const parsed = processTpl(applyHtmlLoaders(html, plugins), assetPublicPath);
  const indexedStyles: IndexedStyleObject[] = parsed.styles.map((style, sourceIndex) => {
    const indexedStyle: IndexedStyleObject = { ...style };
    indexedStyle[STYLE_SOURCE_INDEX] = sourceIndex;
    return indexedStyle;
  });

  return {
    template: parsed.template,
    assetPublicPath,
    scripts: parsed.scripts,
    styles: indexedStyles,
  };
}

function bindHtmlDocument(
  document: ParsedHtmlDocument,
  fetch: FetchFunction,
  plugins: readonly JieshuPlugin[],
  loadError: LoadErrorHandler | undefined,
  fiber: boolean,
  cacheScope?: CacheScope,
): HtmlParseResult {
  const jsExclusions = getEffectLoaders('jsExcludes', plugins);
  const cssExclusions = getEffectLoaders('cssExcludes', plugins);
  const jsIgnores = getEffectLoaders('jsIgnores', plugins);
  const cssIgnores = getEffectLoaders('cssIgnores', plugins);

  return {
    template: document.template,
    assetPublicPath: document.assetPublicPath,
    getExternalScripts: () =>
      getExternalScripts(
        document.scripts
          .filter((script) => includeAsset(script.src, jsExclusions))
          .map((script) => ({ ...script, ignore: ignoreAsset(script.src, jsIgnores) })),
        fetch,
        loadError,
        fiber,
        cacheScope,
      ),
    getExternalStyleSheets: () =>
      getExternalStyleSheets(
        document.styles
          .filter((style) => includeAsset(style.src, cssExclusions))
          .map((style) => {
            const filteredStyle: IndexedStyleObject = {
              ...style,
              ignore: ignoreAsset(style.src, cssIgnores),
            };
            filteredStyle[STYLE_SOURCE_INDEX] = style[STYLE_SOURCE_INDEX];
            return filteredStyle;
          }),
        fetch,
        loadError,
        cacheScope,
      ),
  };
}

export default function importHTML({ url, html, opts }: ImportHtmlParameters): Promise<HtmlParseResult> {
  const fetch = opts.fetch ?? defaultFetch;
  const fiber = opts.fiber ?? true;
  const plugins = opts.plugins ?? [];
  const parse = () => parseHtmlDocument(url, html, fetch, plugins, opts.loadError);
  const parsedDocument =
    Boolean(html) || plugins.some((plugin) => typeof plugin.htmlLoader === 'function')
      ? parse()
      : htmlDocuments.getOrCreate(url, parse, opts.cacheScope);

  // Only static parse data is cached. Lazy resource getters are rebound on
  // every call so a fulfilled entry document never retains an older sandbox's
  // fetch, lifecycle hooks, or pending-request scope.
  return parsedDocument.then((document) =>
    bindHtmlDocument(document, fetch, plugins, opts.loadError, fiber, opts.cacheScope),
  );
}

interface InlineSandboxState {
  degrade?: boolean;
  proxy?: WindowProxy;
}

interface InlineRuntimeWindow {
  __JIESHU?: InlineSandboxState;
  __getJieshuWindow__?: (appId: string) => WindowProxy | null;
}

export function getJieshuWindow(appId: string): WindowProxy | null {
  try {
    const iframe = queryJieshuIframe(appId);
    if (!iframe) {
      console.warn(`[jieshu] Cannot find iframe for app ${appId}`);
      return null;
    }

    const contentWindow = iframe.contentWindow;
    if (!contentWindow) {
      console.warn(`[jieshu] Cannot get contentWindow for app ${appId}`);
      return null;
    }

    const runtimeWindow = contentWindow as unknown as InlineRuntimeWindow;
    const targetWindow = runtimeWindow.__JIESHU?.degrade ? contentWindow : runtimeWindow.__JIESHU?.proxy;
    if (!targetWindow) return null;
    return withInlineEventUnscopables(targetWindow as WindowProxy);
  } catch (cause: unknown) {
    console.warn('[jieshu] Failed to get jieshu window:', cause);
    return null;
  }
}

const INLINE_EVENT_UNSCOPABLES: Record<string, boolean> = { event: true };

function withInlineEventUnscopables(proxyWindow: WindowProxy): WindowProxy {
  return new Proxy(proxyWindow, {
    get(target, property) {
      return property === Symbol.unscopables ? INLINE_EVENT_UNSCOPABLES : Reflect.get(target, property);
    },
    has(_target, property) {
      // Prevent unresolved child identifiers from falling through to the
      // render/host global through the outer scope of the `with` statement.
      return property !== Symbol.unscopables;
    },
  }) as WindowProxy;
}

function queryJieshuIframe(appId: string): HTMLIFrameElement | null {
  let currentWindow: Window = window;
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      const iframe = Array.from(currentWindow.document?.getElementsByTagName('iframe') ?? []).find(
        (candidate) => candidate.hasAttribute(JIESHU_DATA_FLAG) && candidate.getAttribute('name') === appId,
      );
      if (iframe) return iframe;
    } catch {
      break;
    }
    if (!currentWindow.parent || currentWindow.parent === currentWindow) break;
    currentWindow = currentWindow.parent;
  }
  return null;
}

export function initInlineEventHelper(): void {
  const runtimeWindow = window as unknown as InlineRuntimeWindow;
  if (!runtimeWindow.__getJieshuWindow__) runtimeWindow.__getJieshuWindow__ = getJieshuWindow;
}
