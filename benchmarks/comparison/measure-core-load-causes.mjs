import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const input = path.resolve(process.env.CORE_CAUSE_INPUT || path.join(root, 'test-results/core-load-causes'));
const output = path.resolve(process.env.CORE_CAUSE_RUN || path.join(input, 'measurement'));
const samples = Number(process.env.CORE_CAUSE_SAMPLES || 35);
const traceSamples = Number(process.env.CORE_CAUSE_TRACE_SAMPLES || 7);
const manifestBytes = await readFile(path.join(input, 'variants.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const variants = manifest.variants;
if (!Array.isArray(variants) || variants.length !== 7 || new Set(variants.map((item) => item.id)).size !== 7) {
  throw new Error('Expected seven distinct prepared variants');
}
if (![samples, traceSamples].every((value) => Number.isSafeInteger(value) && value > 0)) {
  throw new Error('Sample counts must be positive integers');
}
await mkdir(output, { recursive: true });
await mkdir(path.join(output, 'traces'), { recursive: true });
await writeFile(path.join(output, 'observations.jsonl'), '', { flag: 'wx' });
const assets = [];
for (const variant of variants) {
  const raw = await readFile(path.join(input, variant.file));
  const gzip = await readFile(path.join(input, variant.gzipFile));
  if (
    sha256(raw) !== variant.sha256 ||
    raw.length !== variant.rawBytes ||
    gzip.length !== variant.gzipBytes ||
    sha256(gzip) !== variant.gzipSha256 ||
    !gunzipSync(gzip).equals(raw)
  ) {
    throw new Error(`Prepared asset mismatch: ${variant.id}`);
  }
  assets.push({ raw, gzip, gzipSha256: sha256(gzip) });
}
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname.endsWith('.js')) {
    // Equal length paths across all variants and transports prevent URL length from changing heap cost.
    const match = /^\/v([0-6])([ig])\.js$/.exec(url.pathname);
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    const asset = assets[Number(match[1])];
    const compressed = match[2] === 'g';
    const bytes = compressed ? asset.gzip : asset.raw;
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    response.setHeader('Content-Length', bytes.length);
    if (compressed) {
      response.setHeader('Content-Encoding', 'gzip');
    }
    response.end(bytes);
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
const quantile = (values, probability) => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) {
    return null;
  }
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
};
const describe = (values) => ({
  n: values.filter(Number.isFinite).length,
  median: quantile(values, 0.5),
  p95: quantile(values, 0.95),
  min: quantile(values, 0),
  max: quantile(values, 1),
});
const metrics = async (cdp) =>
  Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
const snapshot = async (cdp) => {
  await cdp.send('HeapProfiler.collectGarbage');
  const current = await metrics(cdp);
  return { heapUsedBytes: current.JSHeapUsedSize, ...(await cdp.send('Memory.getDOMCounters')) };
};
const deltaMs = (before, after, field) =>
  Number.isFinite(before[field]) && Number.isFinite(after[field]) ? (after[field] - before[field]) * 1000 : null;
const exactUrl = (event, url) => event.args?.data?.url === url || event.args?.url === url;
const traceSummary = (events, url) => {
  const relevant = events.filter((event) => exactUrl(event, url));
  const complete = relevant.filter((event) => event.ph === 'X' && Number.isFinite(event.dur));
  const names = [...new Set(relevant.map((event) => event.name))];
  const send = relevant.find((event) => event.name === 'ResourceSendRequest');
  const finish = send
    ? events.find(
        (event) => event.name === 'ResourceFinish' && event.args?.data?.requestId === send.args?.data?.requestId,
      )
    : undefined;
  const finishUs = Number.isFinite(finish?.args?.data?.finishTime) ? finish.args.data.finishTime * 1e6 : null;
  const spans = complete
    .filter((event) => ['v8.parseOnBackground', 'EvaluateScript', 'v8.compile'].includes(event.name))
    .map((event) => ({
      name: event.name,
      pid: event.pid,
      tid: event.tid,
      startUs: event.ts,
      endUs: event.ts + event.dur,
      durationMs: event.dur / 1000,
      startAfterNetworkFinishMs: finishUs === null ? null : (event.ts - finishUs) / 1000,
      args: event.args,
    }));
  return {
    sourceUrl: url,
    networkFinishUs: finishUs,
    resourceFinishNotificationUs: finish?.ts ?? null,
    spans,
    durations: names.map((name) => ({
      name,
      events: relevant.filter((event) => event.name === name).length,
      completeEvents: complete.filter((event) => event.name === name).length,
      totalMs: complete.some((event) => event.name === name)
        ? complete.filter((event) => event.name === name).reduce((sum, event) => sum + event.dur / 1000, 0)
        : null,
    })),
    limitations: [
      'Only exact URL events are attributed. Missing complete durations remain null.',
      'Background parsing can include compilation and preparsing; nested or overlapping events must not be added.',
      'ResourceFinish.ts is a notification; args.data.finishTime, when present, is the network finish timestamp.',
    ],
  };
};
const order = (round) => {
  const indexes = variants.map((_, index) => index);
  const offset = round % indexes.length;
  const rotated = [...indexes.slice(offset), ...indexes.slice(0, offset)];
  return Math.floor(round / indexes.length) % 2 ? rotated.reverse() : rotated;
};
let browser;
try {
  browser = await chromium.launch({ headless: true });
  await writeFile(
    path.join(output, 'environment.json'),
    `${JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        input,
        manifestSha256: sha256(manifestBytes),
        manifest,
        assets: assets.map((asset, index) => ({ id: variants[index].id, gzipSha256: asset.gzipSha256 })),
        samples,
        traceSamples,
        browser: browser.version(),
        node: process.version,
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpu: os.cpus()[0]?.model,
        loadAverage: os.loadavg(),
        playwright: JSON.parse(await readFile(path.join(root, 'node_modules/@playwright/test/package.json'), 'utf8'))
          .version,
        method: [
          'All prepared assets are verified before sampling. No build or core source mutation during sampling.',
          'UTF-8, independent browser context for each observation, no-store and CDP network cache disabled; browser process reused, internal compilation cache not explicitly purged.',
          'Serial cyclic variant ordering with block reversal; CPU and transport order alternate by round.',
          'Normal observations: seven variants × two transports × CPU rates 1/4 × samples. Trace observations: seven variants × two transports × CPU rate 1 × traceSamples, excluded from normal timings.',
          'Timing begins before script append and ends at onload. GC occurs outside timing. CDP ScriptDuration includes identical measurement instrumentation.',
          'Localhost only, no artificial network throttling. Gzip is precomputed, not compressed inside request timing. CPU 4x is CDP emulation, not a specific device.',
          'Skipped initializer/cache/entry variants are causal diagnostics, not functional core builds or production optimization candidates. Export checks validate shape only.',
        ],
      },
      null,
      2,
    )}\n`,
  );
  const observe = async (index, transport, cpuRate, round, traced) => {
    const variant = variants[index];
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const record = { variant: variant.id, index, framework: variant.framework, transport, cpuRate, round, traced };
    const errors = [];
    try {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
      await page.goto(origin);
      await page.evaluate(() => {
        window.__CORE_CAUSE_PROBE__ = async (url) => {
          const started = performance.now();
          const loaded = await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve(performance.now());
            script.onerror = () => reject(new Error('Script failed to load'));
            document.head.appendChild(script);
          });
          const resource = performance.getEntriesByName(url).find((entry) => entry.entryType === 'resource');
          return {
            totalLoadMs: loaded - started,
            requestAndResponseMs: resource ? resource.responseEnd - resource.startTime : null,
            responseEndToOnloadMs: resource ? loaded - resource.responseEnd : null,
            resource: resource?.toJSON(),
            characterSet: document.characterSet,
            coreExportAvailable: typeof window.ComparisonCore?.startApp === 'function',
            coreExportNames: window.ComparisonCore ? Object.keys(window.ComparisonCore).sort() : [],
            customElements: ['wujie-app', 'jieshu-app'].filter((name) => Boolean(window.customElements.get(name))),
          };
        };
      });
      record.before = await snapshot(cdp);
      const events = [];
      if (traced) {
        cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
        await cdp.send('Tracing.start', {
          categories: 'devtools.timeline,v8,disabled-by-default-v8.compile',
          transferMode: 'ReportEvents',
        });
      }
      const before = await metrics(cdp);
      const url = `${origin}/v${index}${transport === 'gzip' ? 'g' : 'i'}.js`;
      Object.assign(record, await page.evaluate((url) => window.__CORE_CAUSE_PROBE__(url), url));
      const after = await metrics(cdp);
      record.scriptDurationMs = deltaMs(before, after, 'ScriptDuration');
      record.v8CompileDurationMs = deltaMs(before, after, 'V8CompileDuration');
      if (traced) {
        const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end');
        const completion = await complete;
        const file = `traces/${index}-${transport}-${round}.trace.json`;
        await writeFile(path.join(output, file), JSON.stringify({ traceEvents: events }));
        record.trace = { file, dataLossOccurred: completion.dataLossOccurred, ...traceSummary(events, url) };
      }
      record.after = await snapshot(cdp);
      record.heapDeltaBytes = record.after.heapUsedBytes - record.before.heapUsedBytes;
      const expectedEncodedBytes = transport === 'gzip' ? variant.gzipBytes : variant.rawBytes;
      const expectedTag = variant.exportExpected && variant.id !== 'jieshu-entry-skipped';
      record.passed =
        errors.length === 0 &&
        record.characterSet === 'UTF-8' &&
        record.coreExportAvailable === variant.exportExpected &&
        record.customElements.includes(`${variant.framework}-app`) === expectedTag &&
        record.resource?.encodedBodySize === expectedEncodedBytes &&
        record.resource?.decodedBodySize === variant.rawBytes &&
        !record.trace?.dataLossOccurred;
      if (!record.passed) {
        record.validation = {
          expectedEncodedBytes,
          expectedDecodedBytes: variant.rawBytes,
          expectedExport: variant.exportExpected,
          expectedTag,
        };
      }
    } catch (error) {
      record.passed = false;
      record.error = String(error);
    } finally {
      record.errors = errors;
      records.push(record);
      await appendFile(path.join(output, 'observations.jsonl'), `${JSON.stringify(record)}\n`);
      await context.close();
    }
  };
  for (const traced of [false, true]) {
    const count = traced ? traceSamples : samples;
    for (let round = 0; round < count; round += 1) {
      const rates = traced ? [1] : round % 2 ? [4, 1] : [1, 4];
      for (const cpuRate of rates) {
        for (const transport of round % 2 ? ['gzip', 'identity'] : ['identity', 'gzip']) {
          for (const index of order(round)) {
            await observe(index, transport, cpuRate, round, traced);
          }
        }
      }
      console.log(
        `${traced ? 'trace' : 'load'} round ${round + 1}/${count}, failures=${records.filter((record) => !record.passed).length}`,
      );
    }
  }
  const summary = [];
  for (const cpuRate of [1, 4]) {
    for (const transport of ['identity', 'gzip']) {
      for (const variant of variants) {
        const selected = records.filter(
          (record) =>
            !record.traced &&
            record.cpuRate === cpuRate &&
            record.transport === transport &&
            record.variant === variant.id,
        );
        const passed = selected.filter((record) => record.passed);
        summary.push({
          variant: variant.id,
          cpuRate,
          transport,
          total: selected.length,
          passed: passed.length,
          failed: selected.length - passed.length,
          ...Object.fromEntries(
            [
              'totalLoadMs',
              'requestAndResponseMs',
              'responseEndToOnloadMs',
              'scriptDurationMs',
              'v8CompileDurationMs',
              'heapDeltaBytes',
            ].map((field) => [field, describe(passed.map((record) => record[field]))]),
          ),
        });
      }
    }
  }
  await writeFile(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(
    path.join(output, 'trace-summary.json'),
    `${JSON.stringify(
      records
        .filter((record) => record.traced)
        .map(({ variant, transport, round, passed, trace }) => ({ variant, transport, round, passed, trace })),
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
