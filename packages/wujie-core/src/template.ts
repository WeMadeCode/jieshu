export type ScriptAttributes = Record<string, string | boolean>;

export interface ScriptBaseObject {
  src?: string;
  async?: boolean;
  defer?: boolean;
  module?: boolean;
  crossorigin?: boolean;
  crossoriginType?: 'anonymous' | 'use-credentials' | '';
  attrs?: ScriptAttributes;
}

export type ScriptObject = ScriptBaseObject & {
  content?: string;
  ignore?: boolean;
  onload?: () => void;
  onerror?: () => void;
};

export interface StyleObject {
  src?: string;
  content?: string;
  ignore?: boolean;
  /** Attributes that remain meaningful when a stylesheet is embedded as a style element. */
  attrs?: ScriptAttributes;
  /** Original static link markup with a resolved href, retained for native fallback semantics. */
  fallback?: string;
}

export interface TemplateResult {
  template: string;
  scripts: ScriptObject[];
  styles: StyleObject[];
  entry: string | ScriptObject | undefined;
}

type PostProcessTemplate = (result: TemplateResult) => TemplateResult;
type TargetTagName = 'link' | 'style' | 'script';

interface ParsedOpeningTag {
  name: string;
  raw: string;
  end: number;
  selfClosing: boolean;
  attributes: ScriptAttributes;
}

interface ParsedClosingTag {
  name: string;
  end: number;
}

interface TextToken {
  kind: 'text';
  raw: string;
}

interface LinkToken {
  kind: 'link';
  raw: string;
  attributes: ScriptAttributes;
}

interface BlockToken {
  kind: 'style' | 'script';
  raw: string;
  content: string;
  attributes: ScriptAttributes;
}

type TemplateToken = TextToken | LinkToken | BlockToken;

const JAVASCRIPT_TYPES = new Set([
  'text/javascript',
  'module',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  'importmap',
]);
const RCDATA_TAGS = new Set(['textarea', 'title']);
const RAW_TEXT_TAGS = new Set(['iframe', 'noembed', 'noframes', 'noscript', 'xmp']);
const STYLE_ATTRIBUTE_NAMES = ['media', 'nonce', 'title', 'type', 'blocking', 'disabled'] as const;

type ForeignNamespace = 'svg' | 'math';

interface ElementContext {
  name: string;
  namespace: 'html' | ForeignNamespace;
  htmlIntegrationPoint: boolean;
}

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\n' || character === '\r' || character === '\t' || character === '\f';
}

function isAsciiAlpha(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function asciiLowerCharacter(character: string): string {
  const code = character.charCodeAt(0);
  return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : character;
}

/** HTML tag matching folds only ASCII letters and therefore never changes source offsets. */
function toAsciiLowerCase(value: string): string {
  let normalized = '';
  for (let index = 0; index < value.length; index += 1) normalized += asciiLowerCharacter(value[index]);
  return normalized;
}

function startsWithAsciiCaseInsensitive(source: string, expected: string, start: number): boolean {
  if (start + expected.length > source.length) return false;
  for (let offset = 0; offset < expected.length; offset += 1) {
    if (asciiLowerCharacter(source[start + offset]) !== asciiLowerCharacter(expected[offset])) return false;
  }
  return true;
}

function decodeAttributeEntities(value: string): string {
  if (!value.includes('&')) return value;
  const decoder = Document.prototype.createElement.call(document, 'div') as HTMLDivElement;
  // Character references have different legacy-semicolon rules in RCDATA and
  // attribute states. Parse a real quoted attribute so ambiguous ampersands
  // such as `&notit=1` remain byte-for-byte compatible with browser markup.
  const quotedValue = value.replace(/"/g, '&quot;');
  decoder.innerHTML = `<span data-wujie-value="${quotedValue}"></span>`;
  return decoder.firstElementChild?.getAttribute('data-wujie-value') ?? value;
}

function findTagEnd(source: string, start: number): number {
  let quote: "'" | '"' | null = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return -1;
}

function readOpeningTag(source: string, start: number): ParsedOpeningTag | null {
  if (source[start] !== '<') return null;

  let cursor = start + 1;
  const firstCharacter = source[cursor];
  if (!isAsciiAlpha(firstCharacter)) return null;

  const nameStart = cursor;
  while (cursor < source.length) {
    const character = source[cursor];
    if (isWhitespace(character) || character === '>' || character === '/') break;
    cursor += 1;
  }
  if (cursor === nameStart) return null;

  const end = findTagEnd(source, cursor);
  if (end < 0) return null;
  const raw = source.slice(start, end);
  return {
    name: toAsciiLowerCase(source.slice(nameStart, cursor)),
    raw,
    end,
    selfClosing: isSelfClosingTag(raw),
    attributes: parseTagAttributes(raw),
  };
}

function readClosingTag(source: string, start: number): ParsedClosingTag | null {
  if (source[start] !== '<' || source[start + 1] !== '/') return null;

  let cursor = start + 2;
  if (!isAsciiAlpha(source[cursor])) return null;
  const nameStart = cursor;
  while (cursor < source.length) {
    const character = source[cursor];
    if (isWhitespace(character) || character === '>' || character === '/') break;
    cursor += 1;
  }
  if (cursor === nameStart) return null;

  const end = findTagEnd(source, cursor);
  return end < 0 ? null : { name: toAsciiLowerCase(source.slice(nameStart, cursor)), end };
}

function isSelfClosingTag(raw: string): boolean {
  let cursor = raw.length - 2;
  while (cursor >= 0 && isWhitespace(raw[cursor])) cursor -= 1;
  return raw[cursor] === '/';
}

/**
 * Parse quoted, unquoted and boolean HTML attributes without normalizing their
 * spelling or decoding entities. Later duplicates keep the historical
 * last-write-wins behavior.
 */
export function parseTagAttributes(tagOuterHTML: string): ScriptAttributes {
  const tagEnd = findTagEnd(tagOuterHTML, 0);
  if (tagOuterHTML[0] !== '<' || tagEnd < 0) return {};

  let cursor = 1;
  if (tagOuterHTML[cursor] === '/') cursor += 1;
  while (cursor < tagEnd && !isWhitespace(tagOuterHTML[cursor]) && tagOuterHTML[cursor] !== '>') cursor += 1;

  const attributes: ScriptAttributes = {};
  while (cursor < tagEnd - 1) {
    while (cursor < tagEnd - 1 && isWhitespace(tagOuterHTML[cursor])) cursor += 1;
    if (tagOuterHTML[cursor] === '>' || (tagOuterHTML[cursor] === '/' && tagOuterHTML[cursor + 1] === '>')) break;

    const nameStart = cursor;
    while (cursor < tagEnd - 1) {
      const character = tagOuterHTML[cursor];
      if (
        isWhitespace(character) ||
        character === '=' ||
        character === '>' ||
        (character === '/' && tagOuterHTML[cursor + 1] === '>')
      ) {
        break;
      }
      cursor += 1;
    }
    const name = tagOuterHTML.slice(nameStart, cursor);
    if (!name) {
      cursor += 1;
      continue;
    }

    while (cursor < tagEnd - 1 && isWhitespace(tagOuterHTML[cursor])) cursor += 1;
    if (tagOuterHTML[cursor] !== '=') {
      attributes[name] = true;
      continue;
    }

    cursor += 1;
    while (cursor < tagEnd - 1 && isWhitespace(tagOuterHTML[cursor])) cursor += 1;
    const quote = tagOuterHTML[cursor];
    if (quote === "'" || quote === '"') {
      cursor += 1;
      const valueStart = cursor;
      while (cursor < tagEnd - 1 && tagOuterHTML[cursor] !== quote) cursor += 1;
      attributes[name] = decodeAttributeEntities(tagOuterHTML.slice(valueStart, cursor));
      if (tagOuterHTML[cursor] === quote) cursor += 1;
    } else {
      const valueStart = cursor;
      while (
        cursor < tagEnd - 1 &&
        !isWhitespace(tagOuterHTML[cursor]) &&
        tagOuterHTML[cursor] !== '>' &&
        !(tagOuterHTML[cursor] === '/' && tagOuterHTML[cursor + 1] === '>')
      ) {
        cursor += 1;
      }
      attributes[name] = decodeAttributeEntities(tagOuterHTML.slice(valueStart, cursor));
    }
  }
  return attributes;
}

function isTagBoundary(character: string | undefined): boolean {
  return character === undefined || character === '>' || character === '/' || isWhitespace(character);
}

function findClosingTag(
  source: string,
  name: string,
  start: number,
): {
  start: number;
  end: number;
} | null {
  const prefix = `</${name}`;
  let closeStart = source.indexOf('<', start);
  while (closeStart >= 0) {
    if (
      startsWithAsciiCaseInsensitive(source, prefix, closeStart) &&
      isTagBoundary(source[closeStart + prefix.length])
    ) {
      const closeEnd = findTagEnd(source, closeStart + prefix.length);
      if (closeEnd >= 0) return { start: closeStart, end: closeEnd };
      return null;
    }
    closeStart = source.indexOf('<', closeStart + 1);
  }
  return null;
}

interface CommentConsumption {
  end: number;
  terminated: boolean;
}

function consumeComment(source: string, start: number): CommentConsumption {
  let cursor = start + 4;
  if (source[cursor] === '>') return { end: cursor + 1, terminated: true };
  if (source[cursor] === '-' && source[cursor + 1] === '>') return { end: cursor + 2, terminated: true };

  while (cursor < source.length) {
    if (source[cursor] === '-' && source[cursor + 1] === '-') {
      if (source[cursor + 2] === '>') return { end: cursor + 3, terminated: true };
      if (source[cursor + 2] === '!' && source[cursor + 3] === '>') {
        return { end: cursor + 4, terminated: true };
      }
    }
    cursor += 1;
  }
  return { end: source.length, terminated: false };
}

function consumeUntilGreaterThan(source: string, start: number): number {
  const end = source.indexOf('>', start);
  return end < 0 ? source.length : end + 1;
}

function consumeMarkupDeclaration(source: string, start: number, inForeignContext: boolean): number {
  if (inForeignContext && source.startsWith('<![CDATA[', start)) {
    const end = source.indexOf(']]>', start + 9);
    return end < 0 ? source.length : end + 3;
  }
  if (startsWithAsciiCaseInsensitive(source, '<!doctype', start)) {
    const end = findTagEnd(source, start + 9);
    return end < 0 ? source.length : end;
  }
  // In an HTML context, CDATA-like input and unknown declarations enter the
  // bogus-comment state, which ends at the next greater-than character.
  return consumeUntilGreaterThan(source, start + 2);
}

const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function currentNamespace(stack: readonly ElementContext[]): 'html' | ForeignNamespace {
  return stack[stack.length - 1]?.namespace ?? 'html';
}

function isHtmlIntegrationPoint(context: ElementContext): boolean {
  return context.htmlIntegrationPoint;
}

function namespaceForOpeningTag(
  openingTag: ParsedOpeningTag,
  stack: readonly ElementContext[],
): 'html' | ForeignNamespace {
  const parent = stack[stack.length - 1];
  const parentNamespace = parent?.namespace ?? 'html';
  const contentNamespace = parent && isHtmlIntegrationPoint(parent) ? 'html' : parentNamespace;
  if (contentNamespace === 'html') {
    if (openingTag.name === 'svg') return 'svg';
    if (openingTag.name === 'math') return 'math';
    return 'html';
  }
  return contentNamespace;
}

function openElementContext(
  stack: ElementContext[],
  openingTag: ParsedOpeningTag,
  namespace: 'html' | ForeignNamespace,
): void {
  if (openingTag.selfClosing || (namespace === 'html' && HTML_VOID_TAGS.has(openingTag.name))) return;
  stack.push({
    name: openingTag.name,
    namespace,
    htmlIntegrationPoint: namespace === 'svg' && ['foreignobject', 'desc', 'title'].includes(openingTag.name),
  });
}

function closeElementContext(stack: ElementContext[], name: string): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].name === name) {
      stack.splice(index);
      return;
    }
  }
}

/**
 * A template subtree is parsed HTML but remains inert until explicitly cloned.
 * Track nested templates while skipping text-state elements so a literal
 * `</template>` inside script/RCDATA cannot close the outer inert subtree.
 */
function findTemplateEnd(source: string, start: number): number {
  let depth = 1;
  let cursor = start;
  const stack: ElementContext[] = [{ name: 'template', namespace: 'html', htmlIntegrationPoint: false }];
  while (cursor < source.length) {
    const tagStart = source.indexOf('<', cursor);
    if (tagStart < 0) return source.length;
    if (source.startsWith('<!--', tagStart)) {
      cursor = consumeComment(source, tagStart).end;
      continue;
    }
    if (source.startsWith('<!', tagStart)) {
      cursor = consumeMarkupDeclaration(source, tagStart, currentNamespace(stack) !== 'html');
      continue;
    }
    if (source.startsWith('<?', tagStart)) {
      cursor = consumeUntilGreaterThan(source, tagStart + 2);
      continue;
    }

    if (source.startsWith('</', tagStart)) {
      const closingTag = readClosingTag(source, tagStart);
      if (!closingTag) {
        cursor = consumeUntilGreaterThan(source, tagStart + 2);
        continue;
      }
      if (closingTag.name === 'template') {
        depth -= 1;
        if (depth === 0) return closingTag.end;
      }
      closeElementContext(stack, closingTag.name);
      cursor = closingTag.end;
      continue;
    }

    if (!isAsciiAlpha(source[tagStart + 1])) {
      cursor = tagStart + 1;
      continue;
    }
    const openingTag = readOpeningTag(source, tagStart);
    if (!openingTag) {
      return source.length;
    }
    const namespace = namespaceForOpeningTag(openingTag, stack);
    if (namespace === 'html' && openingTag.name === 'template') {
      depth += 1;
      openElementContext(stack, openingTag, namespace);
      cursor = openingTag.end;
      continue;
    }
    if (namespace === 'html' && openingTag.name === 'plaintext') return source.length;
    if (
      openingTag.name === 'script' ||
      openingTag.name === 'style' ||
      (namespace === 'html' && (RCDATA_TAGS.has(openingTag.name) || RAW_TEXT_TAGS.has(openingTag.name)))
    ) {
      cursor = findClosingTag(source, openingTag.name, openingTag.end)?.end ?? source.length;
      continue;
    }
    openElementContext(stack, openingTag, namespace);
    cursor = openingTag.end;
  }
  return source.length;
}

function findOpaqueContextEnd(
  source: string,
  openingTag: ParsedOpeningTag,
  namespace: 'html' | ForeignNamespace,
): number | undefined {
  if (namespace !== 'html') return undefined;
  if (openingTag.name === 'template') return findTemplateEnd(source, openingTag.end);
  if (openingTag.name === 'plaintext') return source.length;
  if (!RCDATA_TAGS.has(openingTag.name) && !RAW_TEXT_TAGS.has(openingTag.name)) return undefined;
  return findClosingTag(source, openingTag.name, openingTag.end)?.end ?? source.length;
}

function tokenizeTemplate(template: string): TemplateToken[] {
  const source = template;
  const tokens: TemplateToken[] = [];
  const stack: ElementContext[] = [];
  let cursor = 0;
  let textStart = 0;

  const pushText = (end: number): void => {
    if (end > textStart) tokens.push({ kind: 'text', raw: source.slice(textStart, end) });
  };

  while (cursor < source.length) {
    const tagStart = source.indexOf('<', cursor);
    if (tagStart < 0) break;
    if (source.startsWith('<!--', tagStart)) {
      const comment = consumeComment(source, tagStart);
      if (!comment.terminated) {
        // Preserve malformed trailing markup, but never scan tags inside an
        // unterminated comment as executable resources.
        break;
      }
      pushText(tagStart);
      cursor = comment.end;
      textStart = cursor;
      continue;
    }
    if (source.startsWith('<!', tagStart)) {
      cursor = consumeMarkupDeclaration(source, tagStart, currentNamespace(stack) !== 'html');
      continue;
    }
    if (source.startsWith('<?', tagStart)) {
      cursor = consumeUntilGreaterThan(source, tagStart + 2);
      continue;
    }
    if (source.startsWith('</', tagStart)) {
      const closingTag = readClosingTag(source, tagStart);
      if (closingTag) {
        closeElementContext(stack, closingTag.name);
        cursor = closingTag.end;
      } else {
        cursor = consumeUntilGreaterThan(source, tagStart + 2);
      }
      continue;
    }
    if (!isAsciiAlpha(source[tagStart + 1])) {
      cursor = tagStart + 1;
      continue;
    }
    const openingTag = readOpeningTag(source, tagStart);
    if (!openingTag) {
      break;
    }
    const namespace = namespaceForOpeningTag(openingTag, stack);
    const opaqueContextEnd = findOpaqueContextEnd(source, openingTag, namespace);
    if (opaqueContextEnd !== undefined) {
      cursor = opaqueContextEnd;
      continue;
    }
    if (!(['link', 'style', 'script'] as TargetTagName[]).includes(openingTag.name as TargetTagName)) {
      openElementContext(stack, openingTag, namespace);
      cursor = openingTag.end;
      continue;
    }

    pushText(tagStart);
    if (openingTag.name === 'link') {
      tokens.push({ kind: 'link', raw: openingTag.raw, attributes: openingTag.attributes });
      openElementContext(stack, openingTag, namespace);
      cursor = openingTag.end;
      textStart = cursor;
      continue;
    }

    const blockName = openingTag.name as 'style' | 'script';
    const closingTag = findClosingTag(source, blockName, openingTag.end);
    if (!closingTag) {
      // An unterminated block is left byte-for-byte intact.
      tokens.push({ kind: 'text', raw: source.slice(tagStart) });
      return tokens;
    }

    tokens.push({
      kind: blockName,
      raw: source.slice(tagStart, closingTag.end),
      content: source.slice(openingTag.end, closingTag.start),
      attributes: openingTag.attributes,
    });
    cursor = closingTag.end;
    textStart = cursor;
  }

  pushText(source.length);
  return tokens;
}

function findAttribute(attributes: ScriptAttributes, expectedName: string): string | boolean | undefined {
  const matchedName = Object.keys(attributes).find((name) => toAsciiLowerCase(name) === expectedName);
  return matchedName ? attributes[matchedName] : undefined;
}

function hasAttribute(attributes: ScriptAttributes, name: string): boolean {
  return findAttribute(attributes, name) !== undefined;
}

function stringAttribute(attributes: ScriptAttributes, name: string): string | undefined {
  const value = findAttribute(attributes, name);
  return typeof value === 'string' ? value : undefined;
}

function collectStyleAttributes(attributes: ScriptAttributes): ScriptAttributes | undefined {
  const styleAttributes: ScriptAttributes = {};
  STYLE_ATTRIBUTE_NAMES.forEach((name) => {
    const value = findAttribute(attributes, name);
    if (value !== undefined) styleAttributes[name] = value;
  });
  return Object.keys(styleAttributes).length ? styleAttributes : undefined;
}

function isSerializableAttributeName(name: string): boolean {
  if (!name) return false;
  for (let index = 0; index < name.length; index += 1) {
    const character = name[index];
    if (
      isWhitespace(character) ||
      character === '\0' ||
      character === '"' ||
      character === "'" ||
      character === '>' ||
      character === '<' ||
      character === '/' ||
      character === '='
    ) {
      return false;
    }
  }
  return true;
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

function serializeResolvedLink(attributes: ScriptAttributes, resolvedHref: string): string {
  let serializedAttributes = '';
  let wroteHref = false;
  Object.keys(attributes).forEach((name) => {
    if (!isSerializableAttributeName(name)) return;
    const isHref = toAsciiLowerCase(name) === 'href';
    const value = isHref ? resolvedHref : attributes[name];
    if (isHref) wroteHref = true;
    if (value === false) return;
    serializedAttributes += value === true ? ` ${name}` : ` ${name}="${escapeAttributeValue(value)}"`;
  });
  if (!wroteHref) serializedAttributes += ` href="${escapeAttributeValue(resolvedHref)}"`;
  return `<link${serializedAttributes}>`;
}

function hasRel(attributes: ScriptAttributes, relation: string): boolean {
  return (stringAttribute(attributes, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean).includes(relation);
}

function resolveAssetUrl(url: string, baseURI: string): string {
  if (url.startsWith('//') || url.startsWith('http://') || url.startsWith('https://')) return url;
  return new URL(url, baseURI).toString();
}

function isValidJavaScriptType(type: string | undefined): boolean {
  return !type || JAVASCRIPT_TYPES.has(type.trim().toLowerCase());
}

function supportsModuleScripts(): boolean {
  return 'noModule' in window.document.createElement('script');
}

function crossOriginType(attributes: ScriptAttributes): 'anonymous' | 'use-credentials' | '' {
  const value = stringAttribute(attributes, 'crossorigin')?.toLowerCase();
  return value === 'anonymous' || value === 'use-credentials' ? value : '';
}

export const genLinkReplaceSymbol = (linkHref: string, preloadOrPrefetch = false): string =>
  `<!-- ${preloadOrPrefetch ? 'prefetch/preload/modulepreload' : ''} link ${linkHref} replaced by wujie -->`;
export const getInlineStyleReplaceSymbol = (index: number): string =>
  `<!-- inline-style-${index} replaced by wujie -->`;
export const genScriptReplaceSymbol = (scriptSrc: string, type = ''): string =>
  `<!-- ${type} script ${scriptSrc} replaced by wujie -->`;
export const inlineScriptReplaceSymbol = '<!-- inline scripts replaced by wujie -->';
export const genIgnoreAssetReplaceSymbol = (url: string): string =>
  `<!-- ignore asset ${url || 'file'} replaced by wujie -->`;
export const genModuleScriptReplaceSymbol = (scriptSrc: string, moduleSupport: boolean): string =>
  `<!-- ${moduleSupport ? 'nomodule' : 'module'} script ${scriptSrc} ignored by wujie -->`;

class TemplateCompiler {
  private readonly scripts: ScriptObject[] = [];
  private readonly styles: StyleObject[] = [];
  private explicitEntry: string | undefined;

  constructor(
    private readonly baseURI: string,
    private readonly moduleSupport: boolean,
  ) {}

  compile(tokens: TemplateToken[]): TemplateResult {
    const template = tokens.map((token) => this.compileToken(token)).join('');
    return {
      template,
      scripts: this.scripts,
      styles: this.styles,
      entry: this.explicitEntry ?? this.scripts[this.scripts.length - 1],
    };
  }

  private compileToken(token: TemplateToken): string {
    if (token.kind === 'text') return token.raw;
    if (token.kind === 'link') return this.compileLink(token);
    if (token.kind === 'style') return this.compileStyle(token);
    return this.compileScript(token);
  }

  private compileLink(token: LinkToken): string {
    const href = stringAttribute(token.attributes, 'href');
    if (href && hasRel(token.attributes, 'stylesheet')) {
      const resolvedHref = resolveAssetUrl(href, this.baseURI);
      if (hasAttribute(token.attributes, 'ignore')) return genIgnoreAssetReplaceSymbol(resolvedHref);
      const styleAttributes = collectStyleAttributes(token.attributes);
      const style: StyleObject = {
        src: resolvedHref,
        fallback: serializeResolvedLink(token.attributes, resolvedHref),
      };
      if (styleAttributes) style.attrs = styleAttributes;
      this.styles.push(style);
      return genLinkReplaceSymbol(resolvedHref);
    }

    const isPreload = ['preload', 'prefetch', 'modulepreload'].some((relation) => hasRel(token.attributes, relation));
    if (href && isPreload && stringAttribute(token.attributes, 'as')?.toLowerCase() !== 'font') {
      return genLinkReplaceSymbol(href, true);
    }
    return token.raw;
  }

  private compileStyle(token: BlockToken): string {
    if (hasAttribute(token.attributes, 'ignore')) return genIgnoreAssetReplaceSymbol('style file');
    const style: StyleObject = { src: '', content: token.content };
    const styleAttributes = collectStyleAttributes(token.attributes);
    if (styleAttributes) style.attrs = styleAttributes;
    const index = this.styles.push(style) - 1;
    return getInlineStyleReplaceSymbol(index);
  }

  private compileScript(token: BlockToken): string {
    const scriptType = stringAttribute(token.attributes, 'type');
    if (!isValidJavaScriptType(scriptType)) return token.raw;

    const normalizedScriptType = scriptType?.trim().toLowerCase();
    const isModule = normalizedScriptType === 'module';
    const isIgnored = hasAttribute(token.attributes, 'ignore');
    const shouldSkipForModuleSupport =
      (this.moduleSupport && hasAttribute(token.attributes, 'nomodule')) || (!this.moduleSupport && isModule);
    const sourceAttribute = stringAttribute(token.attributes, 'src');
    const source = sourceAttribute ? resolveAssetUrl(sourceAttribute, this.baseURI) : undefined;

    if (source && hasAttribute(token.attributes, 'entry')) {
      if (this.explicitEntry) throw new SyntaxError('You should not set multiply entry script!');
      this.explicitEntry = source;
    }

    if (isIgnored) return genIgnoreAssetReplaceSymbol(source ?? 'js file');
    if (shouldSkipForModuleSupport) return genModuleScriptReplaceSymbol(source ?? 'js file', this.moduleSupport);

    const crossorigin = hasAttribute(token.attributes, 'crossorigin');
    // Execution distinguishes import maps by the canonical lower-case key and
    // value. Preserve every original attribute while supplying that contract
    // for case-insensitive HTML spellings.
    const scriptAttributes =
      normalizedScriptType === 'importmap' ? { ...token.attributes, type: 'importmap' } : token.attributes;
    const baseScript: ScriptBaseObject = {
      module: isModule,
      crossorigin,
      crossoriginType: crossOriginType(token.attributes),
      attrs: scriptAttributes,
    };

    if (source) {
      const async = hasAttribute(token.attributes, 'async');
      const defer = hasAttribute(token.attributes, 'defer');
      this.scripts.push(async || defer ? { ...baseScript, src: source, async, defer } : { ...baseScript, src: source });
      return genScriptReplaceSymbol(source, async ? 'async' : defer ? 'defer' : '');
    }

    const isPureCommentBlock = token.content
      .split(/[\r\n]+/)
      .every((line) => !line.trim() || line.trim().startsWith('//'));
    if (token.content && !isPureCommentBlock) this.scripts.push({ ...baseScript, src: '', content: token.content });
    return inlineScriptReplaceSymbol;
  }
}

export default function processTpl(
  template: string,
  baseURI: string,
  postProcessTemplate?: PostProcessTemplate,
): TemplateResult {
  const result = new TemplateCompiler(baseURI, supportsModuleScripts()).compile(tokenizeTemplate(template));
  return typeof postProcessTemplate === 'function' ? postProcessTemplate(result) : result;
}
