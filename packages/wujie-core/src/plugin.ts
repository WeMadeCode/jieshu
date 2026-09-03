import type { ScriptObjectLoader, WujiePlugin } from './contracts';
import type { StyleObject } from './template';
import { getAbsolutePath } from './utils';

type CodeInput = string | null | undefined;
type CodeLoader = (code: CodeInput, url: string, base: string) => string;
type PluginCodeLoader = NonNullable<WujiePlugin['cssLoader']>;
type CodeReplacer = (code: string) => string;
type UrlMatcher = string | RegExp;
type CssPresetLoaderType = 'cssBeforeLoaders' | 'cssAfterLoaders';
type ScriptPresetLoaderType = 'jsBeforeLoaders' | 'jsAfterLoaders';
type PresetLoaderType = CssPresetLoaderType | ScriptPresetLoaderType;
type EffectLoaderType = 'jsExcludes' | 'cssExcludes' | 'jsIgnores' | 'cssIgnores';

interface PresetLoaderMap {
  cssBeforeLoaders: StyleObject[];
  cssAfterLoaders: StyleObject[];
  jsBeforeLoaders: ScriptObjectLoader[];
  jsAfterLoaders: ScriptObjectLoader[];
}

interface LoaderOptions {
  plugins: readonly WujiePlugin[];
  replace?: CodeReplacer;
}

function runLoaderPipeline(
  code: string,
  url: string,
  base: string,
  loaders: ReadonlyArray<PluginCodeLoader | undefined>,
): string {
  return loaders.reduce((result, loader) => (typeof loader === 'function' ? loader(result, url, base) : result), code);
}

function createCodeLoader(loaderName: 'cssLoader' | 'jsLoader', options: LoaderOptions): CodeLoader {
  const { plugins, replace } = options;
  return (code: CodeInput, url: string = '', base: string): string => {
    const normalizedCode = code || '';
    const initialCode = replace ? replace(normalizedCode) : normalizedCode;
    return runLoaderPipeline(
      initialCode,
      url,
      base,
      plugins.map((currentPlugin) => currentPlugin[loaderName]),
    );
  };
}

export function getCssLoader(options: LoaderOptions): CodeLoader {
  return createCodeLoader('cssLoader', options);
}

export function getJsLoader(options: LoaderOptions): CodeLoader {
  return createCodeLoader('jsLoader', options);
}

export function getPresetLoaders<Type extends PresetLoaderType>(
  loaderType: Type,
  plugins: readonly WujiePlugin[],
): PresetLoaderMap[Type] {
  const loaders: Array<StyleObject | ScriptObjectLoader> = [];

  plugins.forEach((currentPlugin) => {
    const configuredLoaders = currentPlugin[loaderType];
    if (configuredLoaders?.length) loaders.push(...configuredLoaders);
  });

  // Historical CSS precedence: earlier plugins must be inserted last so their
  // before-loader styles win the cascade. Other preset groups retain order.
  const orderedLoaders = loaderType === 'cssBeforeLoaders' ? loaders.reverse() : loaders;
  return orderedLoaders as PresetLoaderMap[Type];
}

export function getEffectLoaders(loaderType: EffectLoaderType, plugins: readonly WujiePlugin[]): UrlMatcher[] {
  const matchers: UrlMatcher[] = [];
  plugins.forEach((currentPlugin) => {
    const configuredMatchers = currentPlugin[loaderType];
    if (configuredMatchers?.length) matchers.push(...configuredMatchers);
  });
  return matchers;
}

function matchesRegExp(url: string, matcher: RegExp): boolean {
  const originalLastIndex = matcher.lastIndex;
  matcher.lastIndex = 0;
  try {
    return matcher.test(url);
  } finally {
    // `g` and `y` expressions mutate lastIndex. Restoring it makes this pure
    // matcher deterministic without altering RegExp objects owned by callers.
    matcher.lastIndex = originalLastIndex;
  }
}

export function isMatchUrl(url: string, effectLoaders: readonly UrlMatcher[]): boolean {
  return effectLoaders.some((matcher) => (typeof matcher === 'string' ? url === matcher : matchesRegExp(url, matcher)));
}

/** Convert relative URLs inside CSS url(...) expressions to absolute URLs. */
function cssRelativePathResolve(code: string, src: string, base: string): string {
  const baseUrl = src ? getAbsolutePath(src, base) : base;
  const cssUrlPattern = /url\((['"]?)((?:[^()]+|\((?:[^()]+|\([^()]*\))*\))*)(\1)\)/g;

  return code.replace(cssUrlPattern, (original: string, quote: string, url: string): string =>
    url.startsWith('data:') ? original : `url(${quote}${getAbsolutePath(url, baseUrl)}${quote})`,
  );
}

const defaultPlugin: WujiePlugin = {
  cssLoader: cssRelativePathResolve,
  // Disable cross-document view transitions in child applications by default.
  cssBeforeLoaders: [{ content: 'html {view-transition-name: none;}' }],
};

export function getPlugins(plugins: readonly WujiePlugin[] | undefined): WujiePlugin[] {
  return Array.isArray(plugins) ? [defaultPlugin, ...plugins] : [defaultPlugin];
}

export default defaultPlugin;
