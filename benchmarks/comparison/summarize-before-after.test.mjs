import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const script = fileURLToPath(new URL('./summarize-before-after.mjs', import.meta.url));
const withFixture = async (callback) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jieshu-before-after-summary-test-'));
  const frameworks = ['jieshu', 'jieshu-before', 'wujie'];
  const environment = {
    samples: 3,
    memoryRounds: 1,
    revisions: Object.fromEntries(frameworks.map((framework) => [framework, { sha256: framework }])),
    build: { target: 'es2018', minify: true, format: 'iife', mode: 'production' },
  };
  const records = { load: [], startup: [], memory: [] };
  for (const framework of frameworks) {
    for (let round = 0; round < 3; round += 1) {
      const value = (framework === 'jieshu' ? [0, 100, 101] : [0, 1, 100])[round];
      records.load.push({
        framework,
        encoding: 'utf8',
        round,
        traced: false,
        passed: true,
        totalLoadMs: value,
        requestAndResponseMs: value,
        responseEndToOnloadMs: value,
        scriptDurationMs: value,
        v8CompileDurationMs: value,
        heapDeltaBytes: value,
      });
      records.startup.push({
        framework,
        kind: 'startup',
        scenario: 'cold',
        round,
        passed: true,
        coreLoadMs: value,
        apiMs: value,
        readyMs: value,
        preparationMs: 0,
      });
    }
    records.load.push({ ...records.load.at(-1), round: 0, traced: true, totalLoadMs: 10000 });
    const heap = framework === 'jieshu' ? [100, 150, 300] : [100, 160, 310];
    records.memory.push({
      framework,
      kind: 'memory',
      scenario: 'lifecycle-and-cache',
      round: 0,
      passed: true,
      series: ['blank', 'core', 'mounted-1'].map((stage, index) => ({
        stage,
        JSHeapUsedSize: heap[index],
        JSHeapTotalSize: 1000,
        Documents: 1,
        Nodes: 10,
        JSEventListeners: 0,
      })),
    });
  }
  const directories = Object.keys(records).map((kind) => path.join(directory, kind));
  const save = async () => {
    for (const [kind, values] of Object.entries(records)) {
      const input = path.join(directory, kind);
      await mkdir(input, { recursive: true });
      await writeFile(path.join(input, 'environment.json'), JSON.stringify({ ...environment, mode: kind }));
      await writeFile(path.join(input, 'observations.jsonl'), `${values.map(JSON.stringify).join('\n')}\n`);
    }
  };
  const run = async (name) => {
    const output = path.join(directory, name);
    await execute(process.execPath, [script, '--output', output, ...directories]);
    return JSON.parse(await readFile(path.join(output, 'before-after-summary.json'), 'utf8'));
  };
  try {
    await save();
    await callback({ environment, records, save, run, directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('summarizes both harnesses with paired median differences, excludes traces, and normalizes memory', async () => {
  await withFixture(async ({ run }) => {
    const result = await run('summary');
    const load = result.timing.find((group) => group.kind === 'load');
    assert.equal(load.currentMinusBefore.totalLoadMs.medianDifference, 99);
    assert.equal(load.currentMinusBefore.totalLoadMs.iterations, 5000);
    assert.equal(load.currentMinusBefore.totalLoadMs.n, 3);
    assert.equal(load.frameworks.jieshu.metrics.totalLoadMs.p95, 100.9);
    assert.equal(result.excluded.filter((entry) => entry.reason === 'traced').length, 3);
    assert.equal(result.timing.find((group) => group.kind === 'startup').group, 'cold');
    const mounted = result.memory.stages.find((stage) => stage.stage === 'mounted-1');
    assert.equal(mounted.currentMinusBefore.JSHeapUsedSize, -10);
    assert.equal(mounted.currentMinusBefore.deltaCoreHeapBytes, 0);
    assert.equal(mounted.frameworks.jieshu.JSHeapUsedSize.n, 1);
    assert.equal(Reflect.getOwnPropertyDescriptor(mounted, 'confidenceInterval95'), undefined);
    const repeated = await run('summary-repeat');
    assert.deepEqual(result.timing, repeated.timing);
  });
});

test('excludes both members of incomplete pairs and reports failed and missing rounds', async () => {
  await withFixture(async ({ records, save, run }) => {
    records.load = records.load.filter((record) => !(record.framework === 'jieshu-before' && record.round === 1));
    const failed = records.startup.find((record) => record.framework === 'jieshu' && record.round === 1);
    failed.passed = false;
    await save();
    const result = await run('summary');
    const load = result.timing.find((group) => group.kind === 'load').currentMinusBefore.totalLoadMs;
    assert.equal(load.n, 2);
    assert.equal(load.excludedRounds, 1);
    assert.equal(load.medianDifference, 0.5);
    assert.equal(load.exclusions[0].before, 'missing');
    const startup = result.timing.find((group) => group.kind === 'startup').currentMinusBefore.readyMs;
    assert.equal(startup.n, 2);
    assert.equal(startup.exclusions[0].current, 'failed');
    assert.equal(result.failures.length, 1);
  });
});

test('rejects duplicate rounds and incompatible frozen bundle identities', async () => {
  await withFixture(async ({ records, save, run, directory, environment }) => {
    records.load.push(records.load[0]);
    await save();
    await assert.rejects(run('duplicate'), /Duplicate round/);
    records.load.pop();
    await save();
    await writeFile(
      path.join(directory, 'startup', 'environment.json'),
      JSON.stringify({
        ...environment,
        revisions: { ...environment.revisions, 'jieshu-before': { sha256: 'another-before' } },
      }),
    );
    await assert.rejects(run('mismatch'), /Cannot combine different bundles or runtime environments/);
  });
});

test('rejects pooling results collected before and after HTTP payload normalization', async () => {
  await withFixture(async ({ run, directory, environment }) => {
    await writeFile(
      path.join(directory, 'startup', 'environment.json'),
      JSON.stringify({
        ...environment,
        bundleTransport: 'All core bundles are UTF-8 buffers prepared before sampling; no per-request string encoding.',
      }),
    );
    await assert.rejects(run('transport-mismatch'), /Cannot combine different bundles or runtime environments/);
  });
});
