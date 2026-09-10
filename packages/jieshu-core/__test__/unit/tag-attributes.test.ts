import { parseTagAttributes } from '../../src/template';

test.each([
  {
    markup: `<link href="" media='' disabled data-empty=>`,
    expected: { href: '', media: '', disabled: true, 'data-empty': '' },
  },
  {
    markup: `<link\tHREF \n=\r'/assets/a.css'\f media = screen disabled />`,
    expected: { HREF: '/assets/a.css', media: 'screen', disabled: true },
  },
  {
    markup: `<script data-first="a > b / c" data-second='say "hi"' data-third="it's ok">`,
    expected: { 'data-first': 'a > b / c', 'data-second': 'say "hi"', 'data-third': "it's ok" },
  },
  {
    markup: `<link href=/assets/main.css/>`,
    expected: { href: '/assets/main.css' },
  },
  {
    markup: `<link href="/assets/main.css/" data-marker='/>b'/>`,
    expected: { href: '/assets/main.css/', 'data-marker': '/>b' },
  },
  {
    markup: `<link href=one href='two' href="three" HREF=four disabled disabled=false>`,
    expected: { href: 'three', HREF: 'four', disabled: 'false' },
  },
  {
    markup: `<link href=a&amp;b data-single='&#65;&quot;' data-double="&lt;&gt;">`,
    expected: { href: 'a&b', 'data-single': 'A"', 'data-double': '<>' },
  },
  {
    markup: `<link = href=x disabled><script src=ignored.js>`,
    expected: { href: 'x', disabled: true },
  },
  {
    markup: `<link href= />`,
    expected: { href: '' },
  },
])('preserves attribute parsing for $markup', ({ markup, expected }) => {
  expect(parseTagAttributes(markup)).toEqual(expected);
});

test.each(['', 'link href=x>', '<link href=x', `<link href="unterminated>`, '<link>', '<link />'])(
  'returns no attributes for %s',
  (markup) => {
    expect(parseTagAttributes(markup)).toEqual({});
  },
);
