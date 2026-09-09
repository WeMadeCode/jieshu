import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { chromium } from '@playwright/test';
import { build } from 'vite';

import { comparisonOrder, coreRoute, fixtureFramework, readBeforeBundle } from './before-bundle.mjs';
import { childProgram, installHarness } from './fixture.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const wujieRoot = path.resolve(process.env.WUJIE_ROOT || path.join(root, '../wujie'));
const mode = process.env.BENCH_MODE || 'all';
const beforeBundle = await readBeforeBundle(process.env.BENCH_BEFORE_BUNDLE, mode);
const samples = Number(process.env.BENCH_SAMPLES || 30);
const memoryRounds = Number(process.env.BENCH_MEMORY_ROUNDS || 5);
const stabilityRounds = Number(process.env.BENCH_STABILITY_ROUNDS || 3);
const cycles = Number(process.env.BENCH_CYCLES || 30);
const output = path.resolve(process.env.BENCH_OUTPUT || path.join(root, 'test-results/comparison'));
await mkdir(output, { recursive: true });
const records = [];
const record = async (value) => {
  records.push(value);
  await appendFile(path.join(output, 'observations.jsonl'), `${JSON.stringify(value)}\n`);
  if (value.passed === false) {
    console.log(`FAIL ${value.framework} ${value.scenario}: ${value.error || JSON.stringify(value.details)}`);
  }
};
// Each invocation is a distinct run; avoid silently appending to an older data set.
await writeFile(path.join(output, 'observations.jsonl'), '', { flag: 'wx' });
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const bundles = {};
const revisions = {};
for (const [framework, repository] of [
  ['jieshu', root],
  ['wujie', wujieRoot],
]) {
  const source = path.join(repository, 'packages', `${framework}-core`, 'src/index.ts');
  const built = await build({
    configFile: false,
    root: repository,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      target: 'es2018',
      write: false,
      minify: mode !== 'profile',
      sourcemap: false,
      lib: { entry: source, name: 'ComparisonCore', formats: ['iife'] },
    },
  });
  const outputs = Array.isArray(built) ? built : [built];
  const chunks = outputs.flatMap((entry) => entry.output || []).filter((entry) => entry.type === 'chunk');
  if (chunks.length !== 1) {
    throw new Error(`Expected a single bundled core for ${framework}`);
  }
  // Encode all variants before sampling; frozen bundles are also byte buffers.
  bundles[framework] = Buffer.from(chunks[0].code);
  revisions[framework] = {
    commit: git(repository, ['rev-parse', 'HEAD']),
    status: git(repository, ['status', '--short']),
    package: JSON.parse(await readFile(path.join(repository, 'packages', `${framework}-core`, 'package.json'), 'utf8'))
      .version,
    packageManager: JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8')).packageManager,
    bundleBytes: Buffer.byteLength(chunks[0].code),
    gzipBytes: gzipSync(chunks[0].code).length,
    sha256: createHash('sha256').update(chunks[0].code).digest('hex'),
  };
}
if (beforeBundle) {
  bundles['jieshu-before'] = beforeBundle.bundle;
  revisions['jieshu-before'] = beforeBundle.revision;
  await writeFile(path.join(output, 'jieshu-before.js'), beforeBundle.bundle);
  await writeFile(path.join(output, 'jieshu-before.environment.json'), beforeBundle.sourceEnvironment);
}

const childCode = `(${childProgram.toString()})();`;
const css = '.bench-isolation-target{color:rgb(211,17,29)}li{line-height:18px}';
const servers = [];
const listen = async (handler) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP address');
  }
  return `http://127.0.0.1:${address.port}`;
};
const childOrigin = await listen((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const variant = url.searchParams.get('variant') || 'normal';
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'public, max-age=3600');
  const send = () => {
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204).end();
    } else if (url.pathname.startsWith('/child/')) {
      response.setHeader('Content-Type', 'text/html');
      const query = `?variant=${variant}&asset=${url.searchParams.get('asset') || 'fixed'}`;
      const script = variant === 'missing-script' ? '/missing.js' : '/app.js';
      response.end(
        `<!doctype html><html><head><link rel="stylesheet" href="/app.css${query}"></head><body><main id="root"></main><script src="${script}${query}"></script></body></html>`,
      );
    } else if (url.pathname === '/app.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(childCode);
    } else if (url.pathname === '/app.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end(css);
    } else if (url.pathname === '/dynamic.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end('window.__BENCH_DYNAMIC__ = true;');
    } else if (url.pathname === '/dynamic.css') {
      response.setHeader('Content-Type', 'text/css');
      response.end('#dynamic-target{background-color:rgb(31,97,173)}');
    } else {
      response.writeHead(404).end('missing');
    }
  };
  if (variant === 'slow') {
    setTimeout(send, 150);
  } else {
    send();
  }
});
const hostOrigin = await listen((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.endsWith('.js')) {
    const route = url.pathname.slice(1, -3);
    const framework = beforeBundle && route === 'before' ? 'jieshu-before' : route;
    if (bundles[framework]) {
      response.setHeader('Content-Type', 'text/javascript');
      response.setHeader('Cache-Control', 'public, max-age=3600');
      response.end(bundles[framework]);
      return;
    }
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(
    '<!doctype html><html><head><link rel="icon" href="data:,"><style>.bench-isolation-target{color:rgb(19,37,53)}main{min-height:40px}</style></head><body><main id="app"></main></body></html>',
  );
});

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const metadata = {
    startedAt: new Date().toISOString(),
    mode,
    samples,
    memoryRounds,
    stabilityRounds,
    cycles,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    totalMemoryBytes: os.totalmem(),
    cpu: os.cpus()[0]?.model,
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg(),
    node: process.version,
    browser: browser.version(),
    playwright: JSON.parse(await readFile(path.join(root, 'node_modules/@playwright/test/package.json'), 'utf8'))
      .version,
    vite: JSON.parse(await readFile(path.join(root, 'node_modules/vite/package.json'), 'utf8')).version,
    revisions,
    ...(beforeBundle
      ? {
          comparison: {
            frameworks: ['jieshu', 'wujie', 'jieshu-before'],
            order:
              'Cyclic order by round, reversing each three-round block; six measured rounds cover all permutations.',
            savedBundle:
              'Hash-verified frozen Jieshu; fixture framework remains jieshu, recorded label is jieshu-before.',
            routes: 'Current /jieshu.js and frozen /before.js have equal URL length.',
          },
        }
      : {}),
    bundleTransport: 'All core bundles are UTF-8 buffers prepared before sampling; no per-request string encoding.',
    build: { target: 'es2018', minify: mode !== 'profile', format: 'iife', mode: 'production' },
    fixture: {
      jsBytes: Buffer.byteLength(childCode),
      cssBytes: Buffer.byteLength(css),
      domItems: 300,
      heapItems: 4000,
    },
    viewport: { width: 1280, height: 800 },
    limitations: [
      'Headless Chromium only',
      'Local HTTP, cross-origin ports',
      'No browser total RSS measurement',
      'Background desktop activity uncontrolled',
    ],
  };
  await writeFile(path.join(output, 'environment.json'), JSON.stringify(metadata, null, 2) + '\n');
  const openPage = async (framework, { loadCore = true, cpuRate = 1 } = {}) => {
    const context = await browser.newContext({ viewport: metadata.viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    const diagnostics = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (['warning', 'error'].includes(message.type())) {
        diagnostics.push({ type: message.type(), message: message.text() });
      }
    });
    page.on('requestfailed', (request) =>
      diagnostics.push({ type: 'requestfailed', url: request.url(), error: request.failure() }),
    );
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    if (cpuRate !== 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    }
    await page.goto(hostOrigin);
    const load = async () => {
      const coreLoadMs = await page.evaluate(async (framework) => {
        const started = performance.now();
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `/${framework}.js`;
          script.onload = resolve;
          script.onerror = () => reject(new Error('Core bundle failed to load'));
          document.head.appendChild(script);
        });
        return performance.now() - started;
      }, coreRoute(framework));
      await page.evaluate(installHarness, { framework: fixtureFramework(framework), childOrigin });
      return coreLoadMs;
    };
    const coreLoadMs = loadCore ? await load() : undefined;
    return { context, page, cdp, errors, diagnostics, coreLoadMs, load };
  };
  const bounded = async (promise, timeout = 15000) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Scenario timeout after ${timeout} ms`)), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const scenarioNames = [
    'cold',
    'cold-fiber',
    'warm-rebuild',
    'singleton-remount',
    'alive-reactivate',
    'preloaded-enter',
    'concurrent-5',
    'slow-resources',
    'cpu4x',
  ];
  if (['all', 'startup', 'smoke'].includes(mode)) {
    const selectedScenarios = process.env.BENCH_SCENARIOS?.split(',') || scenarioNames;
    for (const scenario of selectedScenarios) {
      if (!scenarioNames.includes(scenario)) {
        throw new Error(`Unknown startup scenario: ${scenario}`);
      }
      const count = mode === 'smoke' ? 1 : samples;
      for (let round = -2; round < count; round += 1) {
        for (const framework of comparisonOrder(round, Boolean(beforeBundle))) {
          const opened = await openPage(framework, { cpuRate: scenario === 'cpu4x' ? 4 : 1 });
          const { page, context, errors, diagnostics, coreLoadMs } = opened;
          let result;
          try {
            result = await bounded(
              page.evaluate(async (scenario) => {
                const bench = window.bench;
                const name = 'primary';
                let preparationMs = 0;
                if (['warm-rebuild', 'singleton-remount', 'alive-reactivate'].includes(scenario)) {
                  const began = performance.now();
                  await bench.start(name, { alive: scenario === 'alive-reactivate' });
                  if (scenario === 'warm-rebuild') {
                    await bench.destroy(name);
                  } else {
                    document.getElementById('app').replaceChildren();
                    await bench.twoFrames();
                  }
                  preparationMs = performance.now() - began;
                }
                if (scenario === 'preloaded-enter') {
                  const began = performance.now();
                  bench.core.preloadApp(bench.options(name, { exec: true }));
                  await bench.waitReady(name);
                  await bench.twoFrames();
                  preparationMs = performance.now() - began;
                }
                if (scenario === 'concurrent-5') {
                  const names = Array.from({ length: 5 }, (_, index) => `app-${index}`);
                  for (const appName of names) {
                    const container = document.createElement('main');
                    container.id = appName;
                    document.body.appendChild(container);
                  }
                  const began = performance.now();
                  const times = await Promise.all(names.map((appName) => bench.start(appName, { el: `#${appName}` })));
                  return {
                    readyMs: performance.now() - began,
                    apiMs: Math.max(...times.map((time) => time.apiMs)),
                    preparationMs,
                    names,
                  };
                }
                const timing = await bench.start(name, {
                  alive: scenario === 'alive-reactivate',
                  fiber: scenario === 'cold-fiber',
                  variant: scenario === 'slow-resources' ? 'slow' : 'normal',
                });
                return { ...timing, preparationMs, names: [name] };
              }, scenario),
            );
            for (const name of result.names) {
              await page.locator(`#ready[data-name="${name}"]`).waitFor({ state: 'visible' });
            }
            if (errors.length) {
              throw new Error(errors.join('; '));
            }
            if (round >= 0) {
              await record({
                kind: 'startup',
                framework,
                scenario,
                round,
                passed: true,
                coreLoadMs,
                ...result,
                diagnostics,
              });
            }
          } catch (error) {
            await record({
              kind: 'startup',
              framework,
              scenario,
              round,
              warmup: round < 0,
              passed: false,
              error: String(error),
              pageErrors: errors,
              diagnostics,
            });
          } finally {
            await context.close();
          }
        }
      }
      console.log(`Startup completed: ${scenario}`);
    }
  }
  if (['all', 'memory'].includes(mode)) {
    const snapshot = async ({ page, cdp }) => {
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 30)));
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      const selected = Object.fromEntries(
        metrics
          .filter(({ name }) =>
            ['JSHeapUsedSize', 'JSHeapTotalSize', 'Documents', 'Nodes', 'JSEventListeners'].includes(name),
          )
          .map(({ name, value }) => [name, value]),
      );
      const dom = await cdp.send('Memory.getDOMCounters');
      return { ...selected, dom };
    };
    for (let round = 0; round < memoryRounds; round += 1) {
      for (const framework of comparisonOrder(round, Boolean(beforeBundle))) {
        const opened = await openPage(framework, { loadCore: false });
        const { page, context, errors, diagnostics } = opened;
        try {
          const series = [{ stage: 'blank', ...(await snapshot(opened)) }];
          await opened.load();
          series.push({ stage: 'core', ...(await snapshot(opened)) });
          await page.evaluate(() => window.bench.start('memory'));
          series.push({ stage: 'mounted-1', ...(await snapshot(opened)) });
          await page.evaluate(() => window.bench.destroy('memory'));
          await page.evaluate(() => window.bench.resetObservations());
          series.push({ stage: 'destroyed-first', ...(await snapshot(opened)) });
          for (const scenario of ['same-assets', 'unique-assets']) {
            for (let cycle = 1; cycle <= cycles; cycle += 1) {
              await bounded(
                page.evaluate(
                  async ({ scenario, cycle }) => {
                    const bench = window.bench;
                    const extra =
                      scenario === 'unique-assets' ? { url: `${bench.childOrigin}/child/?asset=${cycle}` } : {};
                    await bench.start('memory', extra);
                    await bench.destroy('memory');
                    bench.resetObservations();
                  },
                  { scenario, cycle },
                ),
              );
              if (cycle === 1 || cycle % 5 === 0 || cycle === cycles) {
                series.push({ stage: scenario, cycle, ...(await snapshot(opened)) });
              }
            }
          }
          await page.evaluate(() => window.bench.core.clearAssetsCache());
          series.push({ stage: 'cache-cleared', ...(await snapshot(opened)) });
          await page.waitForTimeout(5500);
          series.push({ stage: 'cache-cleared-settled-5.5s', ...(await snapshot(opened)) });
          for (let index = 0; index < 5; index += 1) {
            await page.evaluate(async (index) => {
              const container = document.createElement('main');
              container.id = `memory-${index}`;
              document.body.appendChild(container);
              await window.bench.start(`memory-${index}`, { el: `#memory-${index}`, alive: true });
            }, index);
          }
          series.push({ stage: 'mounted-5-alive', ...(await snapshot(opened)) });
          await page.evaluate(async () => {
            for (let index = 0; index < 5; index += 1) {
              document.getElementById(`memory-${index}`).replaceChildren();
            }
            await window.bench.twoFrames();
          });
          series.push({ stage: 'deactivated-5-alive', ...(await snapshot(opened)) });
          await page.evaluate(async () => {
            for (let index = 0; index < 5; index += 1) {
              await window.bench.destroy(`memory-${index}`);
              document.getElementById(`memory-${index}`).remove();
            }
            window.bench.resetObservations();
            window.bench.core.clearAssetsCache();
          });
          series.push({ stage: 'final-cleanup', ...(await snapshot(opened)) });
          // Wujie's iframe bootstrap fallback captures the child Window for 5 s.
          // Keep the immediate sample, then distinguish delayed release from a leak.
          await page.waitForTimeout(5500);
          series.push({ stage: 'final-settled-5.5s', ...(await snapshot(opened)) });
          if (process.env.BENCH_HEAP_SNAPSHOT === '1') {
            const chunks = [];
            opened.cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => chunks.push(chunk));
            await opened.cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
            await writeFile(path.join(output, `${framework}-final.heapsnapshot`), chunks.join(''));
          }
          await record({
            kind: 'memory',
            framework,
            scenario: 'lifecycle-and-cache',
            round,
            passed: errors.length === 0,
            series,
            pageErrors: errors,
            diagnostics,
          });
        } catch (error) {
          await record({
            kind: 'memory',
            framework,
            scenario: 'lifecycle-and-cache',
            round,
            passed: false,
            error: String(error),
            pageErrors: errors,
            diagnostics,
          });
        } finally {
          await context.close();
        }
      }
      console.log(`Memory completed: round ${round + 1}/${memoryRounds}`);
    }
  }
  if (['all', 'stability'].includes(mode)) {
    const { runStability } = await import('./stability.mjs');
    await runStability({ openPage, record, rounds: stabilityRounds });
  }
  if (mode === 'profile') {
    for (const framework of ['wujie', 'jieshu']) {
      const totals = new Map();
      for (let round = 0; round < 6; round += 1) {
        const { page, context, cdp } = await openPage(framework, { cpuRate: 4 });
        try {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
          await cdp.send('Profiler.start');
          await page.evaluate(async () => {
            const names = Array.from({ length: 5 }, (_, index) => `profile-${index}`);
            for (const name of names) {
              const container = document.createElement('main');
              container.id = name;
              document.body.appendChild(container);
            }
            await Promise.all(names.map((name) => window.bench.start(name, { el: `#${name}` })));
          });
          const { profile } = await cdp.send('Profiler.stop');
          await writeFile(path.join(output, `${framework}-${round}.cpuprofile`), JSON.stringify(profile));
          const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
          for (let index = 0; index < profile.samples.length; index += 1) {
            const frame = nodes.get(profile.samples[index]).callFrame;
            const key = `${frame.functionName || '(anonymous)'} ${frame.url.replace(/:\d+\//, ':/')}:${frame.lineNumber + 1}`;
            totals.set(key, (totals.get(key) || 0) + profile.timeDeltas[index]);
          }
        } finally {
          await context.close();
        }
      }
      const top = [...totals]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 70)
        .map(([frame, microseconds]) => ({ frame, milliseconds: microseconds / 1000 }));
      await writeFile(path.join(output, `${framework}-top.json`), JSON.stringify(top, null, 2) + '\n');
      console.log(`Profile completed: ${framework}`);
    }
  }
  metadata.finishedAt = new Date().toISOString();
  metadata.counts = {
    observations: records.length,
    failures: records.filter((entry) => entry.passed === false).length,
  };
  await writeFile(path.join(output, 'environment.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...metadata.counts }));
} finally {
  await browser?.close();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
}
