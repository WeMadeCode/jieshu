import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { chromium } from '@playwright/test';
import { build } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = path.resolve(process.env.CORE_LOAD_OUTPUT || path.join(root, 'test-results/footprint-load'));
const samples = Number(process.env.CORE_LOAD_SAMPLES || 30);
const traceSamples = Number(process.env.CORE_LOAD_TRACE_SAMPLES || 3);
const beforeBundlePath = process.env.CORE_LOAD_BEFORE_BUNDLE
  ? path.resolve(process.env.CORE_LOAD_BEFORE_BUNDLE)
  : undefined;
const frameworks = ['wujie', 'jieshu'];
const encodings = ['legacy', 'utf8'];
const bundles = {};
const revisions = {};
const records = [];
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const frameworkOrder = (round) => {
  if (frameworks.length === 2) {
    return round % 2 ? [...frameworks].reverse() : frameworks;
  }
  const offset = round % frameworks.length;
  const rotated = [...frameworks.slice(offset), ...frameworks.slice(0, offset)];
  // Three rounds balance positions; reversing the next block covers all six permutations.
  return Math.floor(round / frameworks.length) % 2 ? rotated.reverse() : rotated;
};

if (!Number.isSafeInteger(samples) || samples < 1 || !Number.isSafeInteger(traceSamples) || traceSamples < 1) {
  throw new Error('CORE_LOAD_SAMPLES and CORE_LOAD_TRACE_SAMPLES must be positive integers');
}
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'observations.jsonl'), '', { flag: 'wx' });
for (const framework of frameworks) {
  const repository =
    framework === 'jieshu' ? root : path.resolve(process.env.WUJIE_ROOT || path.join(root, '../wujie'));
  const result = await build({
    configFile: false,
    root: repository,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      target: 'es2018',
      minify: true,
      sourcemap: false,
      write: false,
      lib: {
        entry: path.join(repository, 'packages', `${framework}-core`, 'src/index.ts'),
        name: 'ComparisonCore',
        formats: ['iife'],
      },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((entry) => entry.output || [])
    .filter((entry) => entry.type === 'chunk');
  if (chunks.length !== 1) {
    throw new Error(`Expected exactly one ${framework} core chunk`);
  }
  // Encode all variants before sampling; frozen bundles are also byte buffers.
  bundles[framework] = Buffer.from(chunks[0].code);
  revisions[framework] = {
    commit: git(repository, ['rev-parse', 'HEAD']),
    status: git(repository, ['status', '--short']),
    bundleBytes: Buffer.byteLength(chunks[0].code),
    gzipBytes: gzipSync(chunks[0].code).length,
    sha256: createHash('sha256').update(chunks[0].code).digest('hex'),
  };
  await writeFile(path.join(output, `${framework}.js`), chunks[0].code);
}
if (beforeBundlePath) {
  const environmentPath = path.join(path.dirname(beforeBundlePath), 'environment.json');
  const savedBundle = await readFile(beforeBundlePath);
  const savedEnvironment = await readFile(environmentPath);
  const environment = JSON.parse(savedEnvironment.toString('utf8'));
  const revision = environment.revisions?.jieshu;
  const sha256 = createHash('sha256').update(savedBundle).digest('hex');
  if (typeof revision?.sha256 !== 'string' || sha256 !== revision.sha256) {
    throw new Error('CORE_LOAD_BEFORE_BUNDLE does not match adjacent environment.json revisions.jieshu.sha256');
  }
  frameworks.push('jieshu-before');
  bundles['jieshu-before'] = savedBundle;
  revisions['jieshu-before'] = {
    ...revision,
    source: {
      kind: 'saved-bundle',
      bundlePath: beforeBundlePath,
      sha256,
      environmentPath,
      environmentSha256: createHash('sha256').update(savedEnvironment).digest('hex'),
      copiedEnvironment: 'jieshu-before.environment.json',
    },
  };
  await writeFile(path.join(output, 'jieshu-before.js'), savedBundle);
  await writeFile(path.join(output, 'jieshu-before.environment.json'), savedEnvironment);
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const encoding = url.searchParams.get('encoding') || 'legacy';
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname.endsWith('.js')) {
    const route = url.pathname.slice(1, -3);
    const framework = route === 'before' ? 'jieshu-before' : route;
    if (!bundles[framework]) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', `text/javascript${encoding === 'utf8' ? '; charset=utf-8' : ''}`);
    response.end(bundles[framework]);
    return;
  }
  response.setHeader('Content-Type', `text/html${encoding === 'utf8' ? '; charset=utf-8' : ''}`);
  response.end(
    `<!doctype html><html><head>${encoding === 'utf8' ? '<meta charset="utf-8">' : ''}<link rel="icon" href="data:,"></head><body></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Expected a TCP address');
}
const origin = `http://127.0.0.1:${address.port}`;

const getMetrics = async (cdp) =>
  Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
const heapAndDom = async (cdp) => {
  await cdp.send('HeapProfiler.collectGarbage');
  const metrics = await getMetrics(cdp);
  const dom = await cdp.send('Memory.getDOMCounters');
  return { heapUsedBytes: metrics.JSHeapUsedSize ?? null, heapTotalBytes: metrics.JSHeapTotalSize ?? null, ...dom };
};
const metricDeltaMs = (before, after, key) =>
  typeof before[key] === 'number' && typeof after[key] === 'number' ? (after[key] - before[key]) * 1000 : null;
const quantile = (values, percentile) => {
  const sorted = values.filter((value) => typeof value === 'number').sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
};
const describe = (values) => ({
  n: values.filter((value) => typeof value === 'number').length,
  median: quantile(values, 0.5),
  p95: quantile(values, 0.95),
  min: quantile(values, 0),
  max: quantile(values, 1),
});
const summarizeTrace = (events, coreUrl) => {
  const selected = events.filter(
    (event) =>
      event.name === 'EvaluateScript' ||
      event.name === 'v8.parseOnBackground' ||
      event.name === 'BackgroundJSStreamManager::RunScriptStreamingTask' ||
      event.name.toLowerCase().includes('v8.compile'),
  );
  const names = [...new Set(selected.map((event) => event.name))];
  return {
    categories: [...new Set(selected.map((event) => event.cat))],
    events: selected,
    durations: names.map((name) => {
      const matching = selected.filter((event) => event.name === name);
      const attributed = matching.filter((event) => JSON.stringify(event.args || {}).includes(coreUrl));
      const complete = attributed.filter((event) => event.ph === 'X' && typeof event.dur === 'number');
      return {
        name,
        eventCount: matching.length,
        coreAttributedCount: attributed.length,
        coreCompleteDurationCount: complete.length,
        coreTotalMs: complete.length ? complete.reduce((sum, event) => sum + event.dur, 0) / 1000 : null,
        missingDurationCount: attributed.length - complete.length,
      };
    }),
    limitations: [
      'Only complete X events with numeric dur are quantified; duration uses Chrome trace microseconds / 1000.',
      'Only events carrying the exact core URL in args are attributed to the core; unlabelled events remain unquantified.',
      'Parse, compile, streaming and EvaluateScript events may be nested or overlap; do not add them as disjoint phases.',
      'Tracing changes execution overhead; these diagnostics are excluded from the 30-sample load comparison.',
    ],
  };
};

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const metadata = {
    startedAt: new Date().toISOString(),
    samples,
    traceSamplesPerEncoding: traceSamples,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    loadAverage: os.loadavg(),
    node: process.version,
    browser: browser.version(),
    playwright: JSON.parse(await readFile(path.join(root, 'node_modules/@playwright/test/package.json'), 'utf8'))
      .version,
    vite: JSON.parse(await readFile(path.join(root, 'node_modules/vite/package.json'), 'utf8')).version,
    revisions,
    bundleTransport: 'All core bundles are UTF-8 buffers prepared before sampling; no per-request string encoding.',
    build: { target: 'es2018', minify: true, format: 'iife', mode: 'production' },
    method: [
      beforeBundlePath
        ? 'Fresh browser context for every observation; three-framework order rotates each round and reverses every three rounds to balance all positions; serial sampling, CPU 1x. jieshu-before uses the hash-verified saved bundle and original metadata. Its request route is /before.js, equal in length to /jieshu.js to avoid URL-length differences in GC heap measurements; the recorded framework and output file remain jieshu-before.'
        : 'Fresh browser context for every observation; framework order alternates each round; serial sampling, CPU 1x.',
      'No sub-application or benchmark fixture installed. Measurement function installed before baseline GC.',
      'Legacy HTML/JS omits charset; UTF-8 HTML/JS declares charset. Both transfer identical UTF-8 source bytes.',
      'Before/after heap uses forced GC outside load timing. After core load, no mounts or lifecycle operations occur.',
      'Resource responseEnd-startTime includes request scheduling, localhost network and response transfer.',
      'onload-responseEnd is response end to onload, not pure parsing or execution; work can overlap transfer.',
      'Performance duration deltas include identical measurement instrumentation. Missing metrics are null.',
      'GC JS heap and DOM counts are not process RSS or total browser memory.',
      'Each context has an empty HTTP cache; Chromium process-level compilation caches are not explicitly cleared.',
    ],
  };
  await writeFile(path.join(output, 'environment.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  const observe = async (framework, encoding, round, traced) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const events = [];
    const errors = [];
    try {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await page.goto(`${origin}/?encoding=${encoding}`);
      await page.evaluate(() => {
        window.__CORE_LOAD_PROBE__ = async (url) => {
          const started = performance.now();
          const loaded = await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve(performance.now());
            script.onerror = () => reject(new Error('Core bundle failed to load'));
            document.head.appendChild(script);
          });
          const resource = performance.getEntriesByName(url).find((entry) => entry.entryType === 'resource');
          return {
            characterSet: document.characterSet,
            totalLoadMs: loaded - started,
            requestAndResponseMs: resource ? resource.responseEnd - resource.startTime : null,
            responseEndToOnloadMs: resource ? loaded - resource.responseEnd : null,
            resource: resource?.toJSON() ?? null,
            coreExportAvailable: typeof window.ComparisonCore?.startApp === 'function',
          };
        };
      });
      const before = await heapAndDom(cdp);
      if (traced) {
        cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
        await cdp.send('Tracing.start', {
          categories: 'devtools.timeline,v8,disabled-by-default-v8.compile',
          transferMode: 'ReportEvents',
        });
      }
      const metricsBefore = await getMetrics(cdp);
      const route = framework === 'jieshu-before' ? 'before' : framework;
      const coreUrl = `${origin}/${route}.js?encoding=${encoding}`;
      const timing = await page.evaluate((url) => window.__CORE_LOAD_PROBE__(url), coreUrl);
      const metricsAfter = await getMetrics(cdp);
      let trace;
      if (traced) {
        const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end');
        const completion = await complete;
        const filename = `${framework}-${encoding}-${round}.trace.json`;
        await writeFile(path.join(output, filename), JSON.stringify({ traceEvents: events }));
        trace = { file: filename, dataLossOccurred: completion.dataLossOccurred, ...summarizeTrace(events, coreUrl) };
      }
      const after = await heapAndDom(cdp);
      const record = {
        framework,
        encoding,
        round,
        traced,
        ...timing,
        scriptDurationMs: metricDeltaMs(metricsBefore, metricsAfter, 'ScriptDuration'),
        v8CompileDurationMs: metricDeltaMs(metricsBefore, metricsAfter, 'V8CompileDuration'),
        metricNames: Object.keys(metricsAfter),
        before,
        after,
        heapDeltaBytes:
          after.heapUsedBytes !== null && before.heapUsedBytes !== null
            ? after.heapUsedBytes - before.heapUsedBytes
            : null,
        trace,
        errors,
        passed: timing.coreExportAvailable && errors.length === 0,
      };
      records.push(record);
      await appendFile(path.join(output, 'observations.jsonl'), `${JSON.stringify(record)}\n`);
    } finally {
      await context.close();
    }
  };
  for (const traced of [false, true]) {
    const count = traced ? traceSamples : samples;
    for (let round = 0; round < count; round += 1) {
      for (const encoding of round % 2 ? [...encodings].reverse() : encodings) {
        for (const framework of frameworkOrder(round)) {
          await observe(framework, encoding, round, traced);
        }
      }
      console.log(`${traced ? 'trace' : 'load'} round ${round + 1}/${count} complete`);
    }
  }
  const summary = [];
  for (const encoding of encodings) {
    for (const framework of frameworks) {
      const observations = records.filter(
        (record) => record.framework === framework && record.encoding === encoding && !record.traced,
      );
      const fields = [
        'totalLoadMs',
        'requestAndResponseMs',
        'responseEndToOnloadMs',
        'scriptDurationMs',
        'v8CompileDurationMs',
        'heapDeltaBytes',
      ];
      summary.push({
        encoding,
        framework,
        passed: observations.filter((record) => record.passed).length,
        characterSets: [...new Set(observations.map((record) => record.characterSet))],
        ...Object.fromEntries(fields.map((field) => [field, describe(observations.map((record) => record[field]))])),
        beforeHeapBytes: describe(observations.map((record) => record.before.heapUsedBytes)),
        afterHeapBytes: describe(observations.map((record) => record.after.heapUsedBytes)),
        beforeDom: [
          ...new Set(
            observations.map((record) =>
              JSON.stringify({
                documents: record.before.documents,
                nodes: record.before.nodes,
                jsEventListeners: record.before.jsEventListeners,
              }),
            ),
          ),
        ].map((value) => JSON.parse(value)),
        afterDom: [
          ...new Set(
            observations.map((record) =>
              JSON.stringify({
                documents: record.after.documents,
                nodes: record.after.nodes,
                jsEventListeners: record.after.jsEventListeners,
              }),
            ),
          ),
        ].map((value) => JSON.parse(value)),
      });
    }
  }
  await writeFile(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(
    path.join(output, 'trace-summary.json'),
    `${JSON.stringify(
      records
        .filter((record) => record.traced)
        .map(({ framework, encoding, round, trace }) => ({ framework, encoding, round, ...trace })),
      null,
      2,
    )}\n`,
  );
  if (records.some((record) => !record.passed)) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
