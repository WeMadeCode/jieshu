import processTpl, {
  genIgnoreAssetReplaceSymbol,
  genModuleScriptReplaceSymbol,
  parseTagAttributes,
} from '../../src/template';

const BASE_URL = 'https://child.example/app/index.html';

function compileWithModuleSupport(template: string, supported: boolean) {
  const scriptElement = (supported ? { noModule: false } : {}) as HTMLScriptElement;
  const createElement = vi.spyOn(window.document, 'createElement').mockReturnValue(scriptElement);
  try {
    return processTpl(template, BASE_URL);
  } finally {
    createElement.mockRestore();
  }
}

describe('template tokenizer and compiler', () => {
  test('parses quoted, unquoted and boolean attributes without consuming a self-closing slash', () => {
    expect(
      parseTagAttributes(
        `<link rel=stylesheet href=styles/main.css data-label="hello world" crossorigin='anonymous' disabled/>`,
      ),
    ).toEqual({
      rel: 'stylesheet',
      href: 'styles/main.css',
      'data-label': 'hello world',
      crossorigin: 'anonymous',
      disabled: true,
    });

    expect(parseTagAttributes('<link href=x/>')).toEqual({ href: 'x' });
  });

  test('collects assets in document order and retains their original attributes', () => {
    const result = compileWithModuleSupport(
      [
        '<link rel=stylesheet href=./main.css>',
        '<style media=screen>.root { color: red; }</style>',
        '<script src=./first.js defer data-owner=child></script>',
        '<script>window.inlineLoaded = true;</script>',
      ].join(''),
      true,
    );

    expect(result.styles).toEqual([
      {
        src: 'https://child.example/app/main.css',
        fallback: '<link rel="stylesheet" href="https://child.example/app/main.css">',
      },
      { src: '', content: '.root { color: red; }', attrs: { media: 'screen' } },
    ]);
    expect(result.scripts).toHaveLength(2);
    expect(result.scripts[0]).toMatchObject({
      src: 'https://child.example/app/first.js',
      defer: true,
      attrs: { src: './first.js', defer: true, 'data-owner': 'child' },
    });
    expect(result.scripts[1]).toMatchObject({ src: '', content: 'window.inlineLoaded = true;' });
    expect(result.entry).toBe(result.scripts[1]);
  });

  test('retains applicable style attributes and safely serializes a resolved native-link fallback', () => {
    const result = compileWithModuleSupport(
      [
        '<link rel=stylesheet href="./theme.css?x=1&amp;y=2" media=print nonce="nonce-value"',
        ' title="alternate" disabled integrity="sha256-demo" data-owner=child',
        " data-probe='screen&quot; onload=&quot;alert(1)'>",
      ].join(''),
      true,
    );

    expect(result.styles[0]).toMatchObject({
      src: 'https://child.example/app/theme.css?x=1&y=2',
      attrs: {
        media: 'print',
        nonce: 'nonce-value',
        title: 'alternate',
        disabled: true,
      },
    });

    const holder = document.createElement('div');
    holder.innerHTML = result.styles[0].fallback ?? '';
    const link = holder.querySelector('link');
    expect(link?.getAttribute('href')).toBe('https://child.example/app/theme.css?x=1&y=2');
    expect(link?.getAttribute('integrity')).toBe('sha256-demo');
    expect(link?.getAttribute('data-owner')).toBe('child');
    expect(link?.getAttribute('data-probe')).toBe('screen" onload="alert(1)');
    expect(link?.hasAttribute('onload')).toBe(false);
  });

  test('decodes HTML entities before resolving asset URLs and forwarding attributes', () => {
    const result = compileWithModuleSupport(
      '<link rel="stylesheet" href="./theme.css?x=1&amp;y=2"><script src="./app.js?x=1&amp;y=2" data-title="a&amp;b"></script>',
      true,
    );

    expect(result.styles[0].src).toBe('https://child.example/app/theme.css?x=1&y=2');
    expect(result.scripts[0].src).toBe('https://child.example/app/app.js?x=1&y=2');
    expect(result.scripts[0].attrs).toMatchObject({
      src: './app.js?x=1&y=2',
      'data-title': 'a&b',
    });
  });

  test('uses the browser character-reference table for named URL entities', () => {
    const result = compileWithModuleSupport(
      '<script src="https&colon;//cdn.example/app.js?x=1&amp;y=2"></script>',
      true,
    );

    expect(result.scripts[0].src).toBe('https://cdn.example/app.js?x=1&y=2');
  });

  test('uses attribute-state rules for ambiguous ampersands', () => {
    const attributes = parseTagAttributes(
      '<script src="./app.js?one=1&notit=2&copy=3&ampfoo=4&amp;ok=5" data-title="say &quot;hi&quot;"></script>',
    );

    expect(attributes['src']).toBe('./app.js?one=1&notit=2&copy=3&ampfoo=4&ok=5');
    expect(attributes['data-title']).toBe('say "hi"');
  });

  test('selects module or nomodule scripts according to runtime support', () => {
    const html = ['<script type=module src=./modern.js></script>', '<script nomodule src=./legacy.js></script>'].join(
      '',
    );

    const modern = compileWithModuleSupport(html, true);
    expect(modern.scripts.map(({ src }) => src)).toEqual(['https://child.example/app/modern.js']);
    expect(modern.scripts[0].module).toBe(true);
    expect(modern.template).toContain(genModuleScriptReplaceSymbol('https://child.example/app/legacy.js', true));

    const legacy = compileWithModuleSupport(html, false);
    expect(legacy.scripts.map(({ src }) => src)).toEqual(['https://child.example/app/legacy.js']);
    expect(legacy.template).toContain(genModuleScriptReplaceSymbol('https://child.example/app/modern.js', false));
  });

  test('keeps non-JavaScript blocks and replaces ignored assets without collecting them', () => {
    const html = [
      '<link rel=stylesheet href=./ignored.css ignore>',
      '<style ignore>.ignored { display: none; }</style>',
      '<script src=./ignored.js ignore></script>',
      '<script type=text/ng-template><p>template</p></script>',
    ].join('');
    const result = compileWithModuleSupport(html, true);

    expect(result.styles).toEqual([]);
    expect(result.scripts).toEqual([]);
    expect(result.template).toContain(genIgnoreAssetReplaceSymbol('https://child.example/app/ignored.css'));
    expect(result.template).toContain(genIgnoreAssetReplaceSymbol('style file'));
    expect(result.template).toContain(genIgnoreAssetReplaceSymbol('https://child.example/app/ignored.js'));
    expect(result.template).toContain('<script type=text/ng-template><p>template</p></script>');
  });

  test('normalizes importmap attributes for the execution pipeline', () => {
    const result = compileWithModuleSupport(
      `<script TYPE="ImportMap">{"imports":{"library":"/library.js"}}</script>`,
      true,
    );

    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0].attrs).toMatchObject({ TYPE: 'ImportMap', type: 'importmap' });
  });

  test('removes comments only in data state and preserves comment bytes inside scripts and styles', () => {
    const result = compileWithModuleSupport(
      [
        'before<!-- <script>window.commented = true;</script> -->after',
        '<script>window.marker = "<!--script-bytes-->";</script>',
        '<style>.marker::before { content: "<!--style-bytes-->"; }</style>',
      ].join(''),
      true,
    );

    expect(result.template).toContain('beforeafter');
    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0].content).toBe('window.marker = "<!--script-bytes-->";');
    expect(result.styles).toHaveLength(1);
    expect(result.styles[0].content).toBe('.marker::before { content: "<!--style-bytes-->"; }');
  });

  test('keeps UTF-16 source offsets stable when matching ASCII closing tags', () => {
    const result = compileWithModuleSupport('<p>İ</p><ScRiPt>window.x = 1;</sCrIpT>', true);

    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0].content).toBe('window.x = 1;');
    expect(result.template).toBe('<p>İ</p><!-- inline scripts replaced by wujie -->');
  });

  test('consumes complete data-state closing tags, declarations and processing instructions', () => {
    const markup = [
      '</x data-value="<script src=./from-closing.js>">',
      '<!DOCTYPE html PUBLIC "<script src=./from-doctype.js>" "identifier">',
      '<!bogus <script src=./from-bogus.js>></script>',
      '<?instruction <script src=./from-pi.js>?></script>',
      '<![CDATA[<script src=./from-html-cdata.js></script>]]>',
      '<script src=./real.js></script>',
    ].join('');
    const result = compileWithModuleSupport(markup, true);

    expect(result.scripts.map(({ src }) => src)).toEqual(['https://child.example/app/real.js']);
    expect(result.template).toContain('from-closing.js');
    expect(result.template).toContain('from-doctype.js');
    expect(result.template).toContain('from-bogus.js');
    expect(result.template).toContain('from-pi.js');
    expect(result.template).toContain('from-html-cdata.js');
  });

  test('treats CDATA contents as text while the current node is foreign', () => {
    const markup = [
      '<svg><![CDATA[<script src="./from-svg-cdata.js"></script>]]></svg>',
      '<math><![CDATA[<style>.from-math-cdata { color: red; }</style>]]></math>',
      '<script src=./real.js></script>',
    ].join('');
    const result = compileWithModuleSupport(markup, true);

    expect(result.scripts.map(({ src }) => src)).toEqual(['https://child.example/app/real.js']);
    expect(result.styles).toEqual([]);
    expect(result.template).toContain('from-svg-cdata.js');
    expect(result.template).toContain('from-math-cdata');
  });

  test('keeps script and style markup inert inside template and HTML text-state elements', () => {
    const inertMarkup = [
      '<template id=outer>',
      '<!-- inert comment bytes -->',
      '<script>window.templateClosingText = "</template>";</script>',
      '<style>.from-template { color: red; }</style>',
      '<template><script>window.fromNestedTemplate = true;</script></template>',
      '</template>',
      '<textarea><script>window.fromTextarea = true;</script></textarea>',
      '<title><style>.from-title { color: red; }</style></title>',
      '<xmp><script>window.fromXmp = true;</script></xmp>',
      '<iframe><script>window.fromIframe = true;</script></iframe>',
      '<noembed><style>.from-noembed { color: red; }</style></noembed>',
      '<noframes><script>window.fromNoframes = true;</script></noframes>',
      '<noscript><script>window.fromNoscript = true;</script></noscript>',
      '<plaintext><script>window.fromPlaintext = true;</script>',
    ].join('');
    const result = compileWithModuleSupport(inertMarkup, true);

    expect(result.scripts).toEqual([]);
    expect(result.styles).toEqual([]);
    expect(result.template).toBe(inertMarkup);
  });

  test('does not extract resources from an unterminated data-state comment', () => {
    const markup = 'before<!-- <script>window.fromBrokenComment = true;</script>';
    const result = compileWithModuleSupport(markup, true);

    expect(result.scripts).toEqual([]);
    expect(result.template).toBe(markup);
  });

  test('rejects multiple explicit entry scripts', () => {
    expect(() =>
      compileWithModuleSupport('<script entry src=./one.js></script><script src=./two.js entry></script>', true),
    ).toThrow(new SyntaxError('You should not set multiply entry script!'));
  });
});
