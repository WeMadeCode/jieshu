import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer | undefined;
let origin: string;

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../../..', import.meta.url)),
    appType: 'custom',
    server: { host: '127.0.0.1', port: 0 },
  });
  server.middlewares.use((request, response, next) => {
    if (request.url !== '/') {
      next();
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head></head><body></body></html>');
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    throw new Error('The stylesheet regression server must expose a local URL');
  }
  origin = url;
});

test.afterAll(async () => {
  await server?.close();
});

const exerciseCssom = async () => {
  const sandboxUrl = '/packages/jieshu-core/src/sandbox.ts';
  const effectUrl = '/packages/jieshu-core/src/effect.ts';
  const { default: Sandbox }: typeof import('../../src/sandbox') = await import(sandboxUrl);
  const { patchStylesheetElement }: typeof import('../../src/effect') = await import(effectUrl);
  const sandbox = new Sandbox({
    name: 'cssom-rules',
    url: location.href,
    attrs: {},
    fiber: false,
    plugins: [],
    lifecycles: {},
  });
  const style = document.createElement('style');
  style.textContent = '.seed { color: black; }';
  document.head.appendChild(style);
  const calls: string[] = [];
  patchStylesheetElement(
    style,
    (code) => {
      calls.push(code);
      return code.replace(/red/g, 'blue');
    },
    sandbox,
    location.href,
  );
  const sheet = style.sheet;
  if (!sheet) {
    throw new Error('A connected style must expose a stylesheet');
  }
  const rules = () => Array.from(style.sheet?.cssRules ?? [], (rule) => rule.cssText);
  try {
    sheet.disabled = true;
    const firstIndex = sheet.insertRule('.first { color: red; }', 0);
    const first = rules();
    const secondIndex = sheet.insertRule('.second { color: red; }', 1);
    const second = rules();
    const callsAfterSuccess = calls.length;
    sheet.deleteRule(1);
    const afterDelete = rules();
    const textBeforeFailure = style.textContent;
    const beforeFailure = style.sheet;
    const failures: string[] = [];
    for (const [rule, index] of [
      ['.invalid { color: red; }', 99],
      ['broken', 0],
    ] satisfies Array<[string, number]>) {
      try {
        sheet.insertRule(rule, index);
      } catch (cause) {
        failures.push(cause instanceof DOMException ? cause.name : String(cause));
      }
    }
    return {
      firstIndex,
      secondIndex,
      first,
      second,
      afterDelete,
      callsAfterSuccess,
      failures,
      unchangedAfterFailure: style.sheet === beforeFailure && style.textContent === textBeforeFailure,
      mirrored: style.textContent === afterDelete.join('\n'),
      disabled: style.sheet?.disabled,
    };
  } finally {
    style.remove();
    await sandbox.destroy();
  }
};

test('CSSOM insertions preserve native order, validation and deletion without duplicate rules', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(exerciseCssom);
  expect(result).toEqual({
    firstIndex: 0,
    secondIndex: 1,
    first: ['.first { color: blue; }', '.seed { color: black; }'],
    second: ['.first { color: blue; }', '.second { color: blue; }', '.seed { color: black; }'],
    afterDelete: ['.first { color: blue; }', '.seed { color: black; }'],
    callsAfterSuccess: 2,
    failures: ['IndexSizeError', 'SyntaxError'],
    unchangedAfterFailure: true,
    mirrored: true,
    disabled: true,
  });
});

const exerciseReplacement = async (update: string) => {
  const sandboxUrl = '/packages/jieshu-core/src/sandbox.ts';
  const effectUrl = '/packages/jieshu-core/src/effect.ts';
  const { default: Sandbox }: typeof import('../../src/sandbox') = await import(sandboxUrl);
  const { patchStylesheetElement }: typeof import('../../src/effect') = await import(effectUrl);
  const sandbox = new Sandbox({
    name: 'cssom-replacement',
    url: location.href,
    attrs: {},
    fiber: false,
    plugins: [],
    lifecycles: {},
  });
  const style = document.createElement('style');
  document.head.appendChild(style);
  let calls = 0;
  const loader = (code: string) => {
    calls += 1;
    return code.replace(/red/g, 'blue');
  };
  patchStylesheetElement(style, loader, sandbox, location.href);
  let target = style;
  try {
    if (update === 'appendChild') {
      style.appendChild(document.createTextNode('.reset { color: red; }'));
    } else if (update === 'adjacent') {
      target = document.createElement('style');
      target.textContent = '.reset { color: red; }';
      style.insertAdjacentElement('afterend', target);
    } else if (update === 'reattach') {
      style.sheet?.insertRule('.reset { color: red; }', 0);
      style.remove();
      document.head.appendChild(style);
      patchStylesheetElement(style, loader, sandbox, location.href);
    } else {
      Reflect.set(style, update, '.reset { color: red; }');
    }
    const beforeInsert = calls;
    const sheet = target.sheet;
    if (!sheet) {
      throw new Error('A replaced style must still expose a stylesheet');
    }
    sheet.insertRule('.first { color: red; }', 0);
    sheet.insertRule('.second { color: red; }', 1);
    return {
      calls: calls - beforeInsert,
      rules: Array.from(target.sheet?.cssRules ?? [], (rule) => rule.cssText),
      text: target.textContent,
    };
  } finally {
    style.remove();
    target.remove();
    await sandbox.destroy();
  }
};

for (const update of ['innerHTML', 'textContent', 'innerText', 'appendChild', 'adjacent', 'reattach']) {
  test(`CSSOM patches survive ${update}`, async ({ page }) => {
    await page.goto(origin);
    const result = await page.evaluate(exerciseReplacement, update);
    expect(result.calls).toBe(2);
    expect(result.rules).toEqual(['.first { color: blue; }', '.second { color: blue; }', '.reset { color: blue; }']);
    expect(result.text).toBe(result.rules.join('\n'));
  });
}
