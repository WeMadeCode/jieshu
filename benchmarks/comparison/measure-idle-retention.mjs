import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { chromium } from '@playwright/test';
import { build } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = path.resolve(process.env.IDLE_RETENTION_OUTPUT || path.join(root, 'test-results/footprint-retention'));
const rounds = Number(process.env.IDLE_RETENTION_ROUNDS || 3);
const expectedJieshuCommit = process.env.IDLE_RETENTION_COMMIT;
const allowDirtySource = process.env.IDLE_RETENTION_ALLOW_DIRTY === '1';
const expectedSlotsMode = process.env.IDLE_RETENTION_EXPECT_SLOTS || 'baseline';
const frameworks = ['wujie', 'jieshu'];
const modes = ['same-name', 'distinct-names'];
const checkpoints = [0, 250, 500, 1000];
const records = [];
const bundles = {};
const revisions = {};
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const fingerprintSource = async (repository, directory) => {
  const files = [];
  const visit = async (relativeDirectory) => {
    const entries = await readdir(path.join(repository, relativeDirectory), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(relativePath);
      } else {
        const contents = await readFile(path.join(repository, relativePath));
        files.push({
          path: relativePath.split(path.sep).join('/'),
          bytes: contents.length,
          sha256: createHash('sha256').update(contents).digest('hex'),
        });
      }
    }
  };
  await visit(directory);
  return { sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
};

if (!Number.isSafeInteger(rounds) || rounds < 1) {
  throw new Error('IDLE_RETENTION_ROUNDS must be a positive integer');
}
if (!['baseline', 'none'].includes(expectedSlotsMode)) {
  throw new Error('IDLE_RETENTION_EXPECT_SLOTS must be baseline or none');
}
if (expectedJieshuCommit && git(root, ['rev-parse', 'HEAD']) !== git(root, ['rev-parse', expectedJieshuCommit])) {
  throw new Error(`This diagnostic expects Jieshu commit ${expectedJieshuCommit}`);
}
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'observations.jsonl'), '', { flag: 'wx' });
for (const framework of frameworks) {
  const repository =
    framework === 'jieshu' ? root : path.resolve(process.env.WUJIE_ROOT || path.join(root, '../wujie'));
  const sourceDirectory = `packages/${framework}-core/src`;
  const commit = git(repository, ['rev-parse', 'HEAD']);
  const sourceStatus = git(repository, ['status', '--short', '--untracked-files=all', '--', sourceDirectory]);
  if (sourceStatus && !allowDirtySource) {
    throw new Error(
      `${framework} core source has uncommitted changes; use IDLE_RETENTION_ALLOW_DIRTY=1 for an explicit worktree measurement`,
    );
  }
  const sourceFingerprint = await fingerprintSource(repository, sourceDirectory);
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
      lib: { entry: path.join(repository, sourceDirectory, 'index.ts'), name: 'ComparisonCore', formats: ['iife'] },
    },
  });
  const sourceFingerprintAfterBuild = await fingerprintSource(repository, sourceDirectory);
  const sourceStatusAfterBuild = git(repository, ['status', '--short', '--untracked-files=all', '--', sourceDirectory]);
  if (
    sourceFingerprint.sha256 !== sourceFingerprintAfterBuild.sha256 ||
    sourceStatus !== sourceStatusAfterBuild ||
    commit !== git(repository, ['rev-parse', 'HEAD'])
  ) {
    throw new Error(`${framework} core source or revision changed during build; discard the build and retry`);
  }
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((entry) => entry.output || [])
    .filter((entry) => entry.type === 'chunk');
  if (chunks.length !== 1) {
    throw new Error(`Expected one ${framework} IIFE chunk`);
  }
  const code = chunks[0].code;
  bundles[framework] = code;
  revisions[framework] = {
    commit,
    sourceTree: git(repository, ['rev-parse', `HEAD:${sourceDirectory}`]),
    sourceStatus,
    sourceDirty: Boolean(sourceStatus),
    sourceMode: allowDirtySource ? 'worktree' : 'clean',
    sourceFingerprintSha256: sourceFingerprint.sha256,
    sourceFiles: sourceFingerprint.files,
    sourceFingerprintVerifiedAfterBuild: true,
    bundleBytes: Buffer.byteLength(code),
    gzipBytes: gzipSync(code).length,
    sha256: createHash('sha256').update(code).digest('hex'),
  };
  await writeFile(path.join(output, `${framework}.js`), code);
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname.endsWith('.js')) {
    const framework = url.pathname.slice(1, -3);
    if (!bundles[framework]) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    response.end(bundles[framework]);
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
  throw new Error('Expected a TCP address');
}
const origin = `http://127.0.0.1:${address.port}`;
const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const metadata = {
    startedAt: new Date().toISOString(),
    rounds,
    allowDirtySource,
    expectedSlotsMode,
    checkpoints,
    modes,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
    browser: browser.version(),
    playwright: JSON.parse(await readFile(path.join(root, 'node_modules/@playwright/test/package.json'), 'utf8'))
      .version,
    vite: JSON.parse(await readFile(path.join(root, 'node_modules/vite/package.json'), 'utf8')).version,
    revisions,
    build: { target: 'es2018', minify: true, format: 'iife', mode: 'production', charset: 'utf-8' },
    method: [
      'No-op destroy stress: every id is absent; no child application is ever mounted. This is not a real application lifecycle workload.',
      'Fresh browser context for each framework/mode/round. Framework and mode orders alternate; all observations are serial.',
      'Await the public ComparisonCore.destroyApp(id) API 1000 times, using either one repeated id or 1000 different ids.',
      'Capture after core load and after250/500/1000 operations; force GC outside operation timing and record Performance.JSHeapUsedSize plus Memory.getDOMCounters.',
      'After the last checkpoint, diagnostically delete both host references to Jieshu coreOperationSlots and force GC. No live app exists. Wujie receives the same absent-property deletion control.',
      'Deleting protocol state is a diagnostic intervention, not a proposed fix or a production-safe API. The same-name concurrency protocol must be preserved in any implementation.',
      'Heap values are JavaScript heap bytes, not process RSS. Timing is per-batch wall time in milliseconds, excluding CDP/GC sampling.',
      'Compilation and engine cache growth can remain after deleting slots. Do not attribute all before/after heap differences to the slot objects or claim complete leak remediation.',
    ],
  };
  await writeFile(path.join(output, 'environment.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  const observe = async (framework, mode, round) => {
    const context = await browser.newContext();
    const errors = [];
    try {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin);
      await page.addScriptTag({ url: `${origin}/${framework}.js` });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const sample = async (operations, stage, batchMs, totalMs) => {
        const state = await page.evaluate(() => ({
          characterSet: document.characterSet,
          slotCount: Object.keys(window.__JIESHU_CORE_INTENTS || {}).length,
          injectedSlotCount: Object.keys(window.__JIESHU_INJECT?.coreOperationSlots || {}).length,
          slotsShareIdentity: window.__JIESHU_CORE_INTENTS === window.__JIESHU_INJECT?.coreOperationSlots,
          liveJieshuEntries: window.__JIESHU_INJECT?.idToSandboxMap?.size ?? 0,
          liveWujieEntries: window.__WUJIE_INJECT?.idToSandboxMap?.size ?? 0,
          iframeCount: document.querySelectorAll('iframe').length,
        }));
        await cdp.send('HeapProfiler.collectGarbage');
        const metrics = Object.fromEntries(
          (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]),
        );
        const dom = await cdp.send('Memory.getDOMCounters');
        const expectedSlots =
          expectedSlotsMode === 'baseline' && framework === 'jieshu' && stage !== 'cleared-slots'
            ? mode === 'same-name'
              ? Math.min(1, operations)
              : operations
            : 0;
        const record = {
          framework,
          mode,
          round,
          stage,
          operations,
          batchMs,
          totalMs,
          heapUsedBytes: metrics.JSHeapUsedSize ?? null,
          heapTotalBytes: metrics.JSHeapTotalSize ?? null,
          ...dom,
          ...state,
          errors: [...errors],
          passed:
            errors.length === 0 &&
            state.slotCount === expectedSlots &&
            state.injectedSlotCount === expectedSlots &&
            state.iframeCount === 0 &&
            state.liveJieshuEntries === 0 &&
            state.liveWujieEntries === 0,
        };
        records.push(record);
        await appendFile(path.join(output, 'observations.jsonl'), `${JSON.stringify(record)}\n`);
      };
      let totalMs = 0;
      await sample(0, 'core-loaded', 0, totalMs);
      for (let index = 1; index < checkpoints.length; index += 1) {
        const from = checkpoints[index - 1];
        const to = checkpoints[index];
        const batchMs = await page.evaluate(
          async ({ mode, from, to }) => {
            const started = performance.now();
            for (let operation = from; operation < to; operation += 1) {
              const id = mode === 'same-name' ? 'absent-app' : `absent-app-${operation}`;
              await window.ComparisonCore.destroyApp(id);
            }
            return performance.now() - started;
          },
          { mode, from, to },
        );
        totalMs += batchMs;
        await sample(to, 'after-operations', batchMs, totalMs);
      }
      await page.evaluate(() => {
        Reflect.deleteProperty(window, '__JIESHU_CORE_INTENTS');
        if (window.__JIESHU_INJECT) {
          Reflect.deleteProperty(window.__JIESHU_INJECT, 'coreOperationSlots');
        }
      });
      await sample(1000, 'cleared-slots', null, totalMs);
    } finally {
      await context.close();
    }
  };
  for (let round = 0; round < rounds; round += 1) {
    for (const mode of round % 2 ? [...modes].reverse() : modes) {
      for (const framework of round % 2 ? [...frameworks].reverse() : frameworks) {
        await observe(framework, mode, round);
      }
    }
    console.log(`idle retention round ${round + 1}/${rounds} complete`);
  }
  const summary = frameworks.flatMap((framework) =>
    modes.map((mode) => {
      const matching = records.filter((record) => record.framework === framework && record.mode === mode);
      const stages = [
        ...checkpoints.map((operations) => ({
          operations,
          stage: operations === 0 ? 'core-loaded' : 'after-operations',
        })),
        { operations: 1000, stage: 'cleared-slots' },
      ];
      return {
        framework,
        mode,
        passed: matching.filter((record) => record.passed).length,
        observations: matching.length,
        checkpoints: stages.map(({ stage, operations }) => {
          const rows = matching.filter((record) => record.stage === stage && record.operations === operations);
          return {
            stage,
            operations,
            n: rows.length,
            medianHeapUsedBytes: median(rows.map((row) => row.heapUsedBytes)),
            medianTotalMs: median(rows.map((row) => row.totalMs)),
            slots: [...new Set(rows.map((row) => row.slotCount))],
            documents: [...new Set(rows.map((row) => row.documents))],
            nodes: [...new Set(rows.map((row) => row.nodes))],
            jsEventListeners: [...new Set(rows.map((row) => row.jsEventListeners))],
          };
        }),
      };
    }),
  );
  await writeFile(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  metadata.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'environment.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  if (records.some((record) => !record.passed)) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
