import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const input = path.resolve(process.env.CORE_VERIFY_INPUT || path.join(root, 'test-results/core-load-causes'));
const output = path.resolve(
  process.env.CORE_VERIFY_OUTPUT || path.join(root, 'test-results/core-load-variant-runtime-verification.json'),
);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const manifestBytes = await readFile(path.join(input, 'variants.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const variants = [{ id: 'empty-control', framework: null, exportExpected: false, code: Buffer.from('/* empty */\n') }];
for (const variant of manifest.variants) {
  const code = await readFile(path.join(input, variant.file));
  if (hash(code) !== variant.sha256 || code.length !== variant.rawBytes) {
    throw new Error(`Prepared asset mismatch: ${variant.id}`);
  }
  variants.push({ ...variant, code });
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname.endsWith('.js')) {
    const index = /^\/v([0-7])\.js$/.exec(url.pathname)?.[1];
    const variant = index === undefined ? undefined : variants[Number(index)];
    if (!variant) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    response.setHeader('Content-Length', variant.code.length);
    response.end(variant.code);
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(
    '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Expected local TCP server');
}
const origin = `http://127.0.0.1:${address.port}`;
const records = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    const context = await browser.newContext();
    const pageErrors = [];
    try {
      const page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(origin);
      const observed = await page.evaluate(async (url) => {
        const names = ['Map', 'WeakMap', 'Set', 'WeakSet'];
        const counts = { Map: 0, WeakMap: 0, Set: 0, WeakSet: 0 };
        const originalDescriptors = {};
        const listenerCalls = [];
        const errors = [];
        const originalAddDescriptor = Object.getOwnPropertyDescriptor(window, 'addEventListener');
        const originalAdd = window.addEventListener;
        const originalRemove = window.removeEventListener;
        const onError = (event) => errors.push(event.message || String(event.error));
        Reflect.apply(originalAdd, window, ['error', onError]);

        for (const name of names) {
          const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
          if (!descriptor || typeof descriptor.value !== 'function') {
            throw new Error(`Expected an own constructor descriptor for ${name}`);
          }
          originalDescriptors[name] = descriptor;
          const wrapped = new Proxy(descriptor.value, {
            construct(target, args, newTarget) {
              counts[name] += 1;
              return Reflect.construct(target, args, newTarget);
            },
          });
          Object.defineProperty(globalThis, name, { ...descriptor, value: wrapped });
        }

        // A regular function preserves the caller's dynamic receiver.
        window.addEventListener = function (...args) {
          listenerCalls.push(String(args[0]));
          return Reflect.apply(originalAdd, this, args);
        };
        try {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Diagnostic script failed to load'));
            document.head.appendChild(script);
          });
          const core = window.ComparisonCore;
          return {
            counts: { ...counts },
            windowListenerRegistrations: [...listenerCalls],
            coreValueType: typeof core,
            coreIsFalse: core === false,
            coreExportAvailable: typeof core?.startApp === 'function',
            coreExportNames: core ? Object.keys(core).sort() : [],
            customElements: ['wujie-app', 'jieshu-app'].filter((name) => Boolean(window.customElements.get(name))),
            errors: [...errors],
          };
        } finally {
          for (const name of names) {
            Object.defineProperty(globalThis, name, originalDescriptors[name]);
          }
          if (originalAddDescriptor) {
            Object.defineProperty(window, 'addEventListener', originalAddDescriptor);
          } else {
            Reflect.deleteProperty(window, 'addEventListener');
          }
          Reflect.apply(originalRemove, window, ['error', onError]);
        }
      }, `${origin}/v${index}.js`);
      records.push({ id: variant.id, sha256: hash(variant.code), ...observed, pageErrors });
    } finally {
      await context.close();
    }
  }

  const byId = Object.fromEntries(records.map((record) => [record.id, record]));
  const collectionNames = ['Map', 'WeakMap', 'Set', 'WeakSet'];
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const difference = (left, right) =>
    Object.fromEntries(collectionNames.map((name) => [name, left.counts[name] - right.counts[name]]));
  const popstates = (record) => record.windowListenerRegistrations.filter((name) => name === 'popstate').length;
  const cacheSuppressionDelta = difference(byId.jieshu, byId['jieshu-caches-skipped']);
  const validations = [
    {
      name: 'No uncaught import errors',
      valid: records.every((record) => !record.errors.length && !record.pageErrors.length),
    },
    {
      name: 'Empty control introduces no measured collections, listeners, exports or custom elements',
      valid:
        equal(byId['empty-control'].counts, { Map: 0, WeakMap: 0, Set: 0, WeakSet: 0 }) &&
        byId['empty-control'].windowListenerRegistrations.length === 0 &&
        byId['empty-control'].coreExportNames.length === 0 &&
        byId['empty-control'].customElements.length === 0,
    },
    {
      name: 'Skipping three AssetCache instances removes exactly 9 Map, 6 WeakMap and 3 WeakSet constructions',
      valid: equal(cacheSuppressionDelta, { Map: 9, WeakMap: 6, Set: 0, WeakSet: 3 }),
    },
    {
      name: 'Entry guard removes exactly one popstate registration and the custom element registration',
      valid:
        popstates(byId.jieshu) === 1 &&
        popstates(byId['jieshu-entry-skipped']) === 0 &&
        equal(byId.jieshu.customElements, ['jieshu-app']) &&
        byId['jieshu-entry-skipped'].customElements.length === 0,
    },
    {
      name: 'Wujie padding preserves complete export names and collection counts',
      valid:
        equal(byId.wujie.coreExportNames, byId['wujie-padded'].coreExportNames) &&
        equal(byId.wujie.counts, byId['wujie-padded'].counts),
    },
    {
      name: 'Jieshu partial guards preserve complete export names',
      valid: ['jieshu-entry-skipped', 'jieshu-caches-skipped'].every((id) =>
        equal(byId.jieshu.coreExportNames, byId[id].coreExportNames),
      ),
    },
    {
      name: 'IIFE guards remove all observed core constructors, listeners and exports',
      valid: ['wujie-init-skipped', 'jieshu-init-skipped'].every(
        (id) =>
          equal(byId[id].counts, byId['empty-control'].counts) &&
          byId[id].windowListenerRegistrations.length === 0 &&
          byId[id].coreExportNames.length === 0 &&
          byId[id].customElements.length === 0 &&
          byId[id].coreIsFalse,
      ),
    },
    {
      name: 'Each variant has the prepared expected startApp export presence',
      valid: variants.every((variant) => byId[variant.id].coreExportAvailable === variant.exportExpected),
    },
  ];
  const result = {
    generatedAt: new Date().toISOString(),
    input,
    manifestSha256: hash(manifestBytes),
    scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    browser: browser.version(),
    node: process.version,
    method: [
      'Separate, instrumented runtime diagnostic; no observations from this script belong to the formal performance sample.',
      'One fresh Chromium context and one page.evaluate per empty control or prepared variant.',
      'Proxy construct traps count invocations of global Map/WeakMap/Set/WeakSet; each delegates with Reflect.construct(target, args, newTarget).',
      'A receiver-preserving window.addEventListener wrapper records registration types. The diagnostic error listener is installed before wrapping.',
      'Collection and listener counters are copied after script onload; the empty script uses the same instrumentation and load path.',
      'All prepared source bytes are verified against the manifest SHA-256 before loading.',
    ],
    limitations: [
      'Instrumentation changes constructor identities and execution. These observations establish executed allocations and registrations, not timing or heap size.',
      'Counts exclude browser-engine internal collections and ordinary object/array/function allocations; they count constructions rather than unique retained objects.',
      'Matching exports confirms names and startApp type only. Guarded variants intentionally lack functionality and are not functionally equivalent framework builds.',
    ],
    records,
    cacheSuppressionDelta,
    validations,
    allDiagnosticsValid: validations.every((validation) => validation.valid),
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        output,
        counts: records.map(({ id, counts, windowListenerRegistrations }) => ({
          id,
          counts,
          windowListenerRegistrations,
        })),
        cacheSuppressionDelta,
        validations,
      },
      null,
      2,
    ),
  );
  if (!result.allDiagnosticsValid) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
