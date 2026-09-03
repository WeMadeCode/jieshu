import defaultPlugin, {
  getCssLoader,
  getEffectLoaders,
  getJsLoader,
  getPlugins,
  getPresetLoaders,
  isMatchUrl,
} from '../../src/plugin';

describe('test getEffectLoaders', () => {
  test('plugins is undefined, should return empty array', () => {
    expect(getEffectLoaders('jsExcludes', [])).toEqual([]);
    expect(getEffectLoaders('cssExcludes', [])).toEqual([]);
  });

  test('sourceType is "jsExcludes", should return jsExcludes', () => {
    const jsExcludes = ['https://www.foo/a.js', /b\.js/];
    const plugins = [
      {
        jsExcludes,
      },
    ];
    expect(getEffectLoaders('jsExcludes', plugins)).toEqual(jsExcludes);
  });

  test('sourceType is "cssExcludes", should return cssExcludes', () => {
    const cssExcludes = ['https://www.foo/a.css', /b\.css/];
    const plugins = [
      {
        cssExcludes,
      },
    ];
    expect(getEffectLoaders('cssExcludes', plugins)).toEqual(cssExcludes);
  });
});

describe('test isMatchUrl', () => {
  test('url is not exclude, should return false', () => {
    expect(isMatchUrl('https://www.foo/a.js', ['https://www.foo/b.js'])).toBe(false);
  });
  test('url is exclude, should return true', () => {
    expect(isMatchUrl('https://www.foo/a.js', ['https://www.foo/a.js'])).toBe(true);
  });
  test('url is match regexp, should return true', () => {
    expect(isMatchUrl('https://www.foo/a.js', [/a\.js/])).toBe(true);
  });

  test('global regexp should produce the same result repeatedly without changing lastIndex', () => {
    const matcher = /a\.js/g;
    matcher.lastIndex = 3;

    expect(isMatchUrl('https://www.foo/a.js', [matcher])).toBe(true);
    expect(isMatchUrl('https://www.foo/a.js', [matcher])).toBe(true);
    expect(matcher.lastIndex).toBe(3);
  });

  test('sticky regexp should also be deterministic', () => {
    const matcher = /https:\/\//y;

    expect(isMatchUrl('https://www.foo/a.js', [matcher])).toBe(true);
    expect(isMatchUrl('https://www.foo/a.js', [matcher])).toBe(true);
    expect(matcher.lastIndex).toBe(0);
  });
});

describe('loader pipeline ordering', () => {
  test('replace runs first and css loaders run in plugin order', () => {
    const loader = getCssLoader({
      replace: (code) => `[${code}]`,
      plugins: [{ cssLoader: (code) => `${code}:first` }, {}, { cssLoader: (code) => `${code}:second` }],
    });

    expect(loader('source', 'app.css', 'https://example.com/')).toBe('[source]:first:second');
  });

  test('js loaders use the same left-to-right pipeline', () => {
    const loader = getJsLoader({
      plugins: [{ jsLoader: (code, url) => `${code}:${url}` }, { jsLoader: (code, _url, base) => `${code}:${base}` }],
    });

    expect(loader('source', 'app.js', 'https://example.com/')).toBe('source:app.js:https://example.com/');
  });

  test('normalizes missing preset content before replace and js loaders', () => {
    const loader = getJsLoader({
      replace: (code) => `[${code}]`,
      plugins: [{ jsLoader: (code) => code.trim() }],
    });

    expect(loader(undefined, 'preset.js', 'https://example.com/')).toBe('[]');
  });
});

describe('preset loader ordering', () => {
  const plugins = [
    {
      cssBeforeLoaders: [{ content: 'css-before-1' }, { content: 'css-before-2' }],
      cssAfterLoaders: [{ content: 'css-after-1' }],
      jsBeforeLoaders: [{ content: 'js-before-1' }],
    },
    {
      cssBeforeLoaders: [{ content: 'css-before-3' }],
      cssAfterLoaders: [{ content: 'css-after-2' }],
      jsBeforeLoaders: [{ content: 'js-before-2' }],
    },
  ];

  test('cssBeforeLoaders reverse the flattened order', () => {
    expect(getPresetLoaders('cssBeforeLoaders', plugins).map((loader) => loader.content)).toEqual([
      'css-before-3',
      'css-before-2',
      'css-before-1',
    ]);
  });

  test('other preset groups retain plugin and item order', () => {
    expect(getPresetLoaders('cssAfterLoaders', plugins).map((loader) => loader.content)).toEqual([
      'css-after-1',
      'css-after-2',
    ]);
    expect(getPresetLoaders('jsBeforeLoaders', plugins).map((loader) => loader.content)).toEqual([
      'js-before-1',
      'js-before-2',
    ]);
  });
});

describe('getPlugins', () => {
  test('prepends the default plugin without mutating the caller array', () => {
    const userPlugin = { htmlLoader: (code: string) => code };
    const plugins = [userPlugin];

    const result = getPlugins(plugins);
    expect(result).toEqual([defaultPlugin, userPlugin]);
    expect(plugins).toEqual([userPlugin]);
  });

  test('returns only the default plugin when no plugin array is provided', () => {
    expect(getPlugins(undefined)).toEqual([defaultPlugin]);
  });
});

describe('test default cssLoader plugin', () => {
  const cssLoader = defaultPlugin.cssLoader;
  if (!cssLoader) throw new Error('The default plugin must provide a CSS loader');

  test('test relative code with src', () => {
    const relativeCode = "background-image: url('./test.gif');";
    const src = 'https://test.com/base/home';
    const resultCode = cssLoader(relativeCode, src, '');
    expect(resultCode).toBe("background-image: url('https://test.com/base/test.gif');");
  });
  test('test relative code with base', () => {
    const relativeCode = "background-image: url('./test.gif');";
    const base = 'https://test.com/base/home';
    const resultCode = cssLoader(relativeCode, '', base);
    expect(resultCode).toBe("background-image: url('https://test.com/base/test.gif');");
  });
  test('test relative code with src and base', () => {
    const relativeCode = "background-image: url('./test.gif');";
    const url = './home/';
    const base = 'https://test.com/base/';
    const resultCode = cssLoader(relativeCode, url, base);
    expect(resultCode).toBe("background-image: url('https://test.com/base/home/test.gif');");
  });
  test('test relative code with src and base', () => {
    const relativeCode = 'background-image: url(./test.gif);';
    const url = './home/';
    const base = 'https://test.com/base/';
    const resultCode = cssLoader(relativeCode, url, base);
    expect(resultCode).toBe('background-image: url(https://test.com/base/home/test.gif);');
  });
  test('test base data code with src and base', () => {
    const relativeCode =
      'background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFIAAABSCAYAAADHLIObAAAAMUlEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3gxpYgAB841K1AAAAABJRU5ErkJggg==);';
    const url = './home/';
    const base = 'https://test.com/base/';
    const resultCode = cssLoader(relativeCode, url, base);
    expect(resultCode).toBe(relativeCode);
  });
});
