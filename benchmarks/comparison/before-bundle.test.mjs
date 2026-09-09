import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { comparisonOrder, coreRoute, fixtureFramework, readBeforeBundle } from './before-bundle.mjs';

const withSavedBundle = async (callback) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jieshu-before-bundle-test-'));
  const bundle = Buffer.from('var ComparisonCore=(()=>({startApp(){return "冻结版本"}}))();\n');
  const environment = {
    revisions: {
      jieshu: {
        commit: 'saved-commit',
        status: '',
        sha256: createHash('sha256').update(bundle).digest('hex'),
      },
    },
    build: { target: 'es2018', minify: true, format: 'iife', mode: 'production' },
  };
  const bundlePath = path.join(directory, 'jieshu.js');
  const environmentPath = path.join(directory, 'environment.json');
  await writeFile(bundlePath, bundle);
  await writeFile(environmentPath, JSON.stringify(environment));
  try {
    await callback({ bundle, bundlePath, environment, environmentPath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('omitting the saved bundle keeps all existing modes available', async () => {
  for (const mode of ['all', 'startup', 'memory', 'smoke', 'stability', 'profile']) {
    assert.equal(await readBeforeBundle(undefined, mode), undefined);
  }
});

test('rejects unsupported modes before reading a saved file', async () => {
  for (const mode of ['all', 'stability', 'profile', 'unknown']) {
    await assert.rejects(
      readBeforeBundle('/does-not-exist.js', mode),
      /supported only with BENCH_MODE=startup, memory or smoke/,
    );
  }
});

test('loads identical saved bytes, build provenance and source hashes in each supported mode', async () => {
  await withSavedBundle(async ({ bundle, bundlePath, environment, environmentPath }) => {
    for (const mode of ['startup', 'memory', 'smoke']) {
      const saved = await readBeforeBundle(bundlePath, mode);
      assert.deepEqual(saved.bundle, bundle);
      assert.equal(saved.revision.commit, 'saved-commit');
      assert.equal(saved.revision.sha256, environment.revisions.jieshu.sha256);
      assert.equal(saved.revision.bundleBytes, bundle.length);
      assert.equal(saved.revision.gzipBytes, gzipSync(bundle).length);
      assert.equal(saved.revision.source.bundlePath, bundlePath);
      assert.equal(saved.revision.source.environmentPath, environmentPath);
      assert.equal(
        saved.revision.source.environmentSha256,
        createHash('sha256').update(saved.sourceEnvironment).digest('hex'),
      );
      assert.deepEqual(JSON.parse(saved.sourceEnvironment), environment);
    }
  });
});

test('rejects changed bundle bytes even when saved metadata is otherwise valid', async () => {
  await withSavedBundle(async ({ bundlePath }) => {
    await writeFile(bundlePath, 'var ComparisonCore={};');
    await assert.rejects(readBeforeBundle(bundlePath, 'startup'), /does not match adjacent environment.json/);
  });
});

test('rejects an absent expected bundle hash', async () => {
  await withSavedBundle(async ({ bundlePath, environment, environmentPath }) => {
    delete environment.revisions.jieshu.sha256;
    await writeFile(environmentPath, JSON.stringify(environment));
    await assert.rejects(readBeforeBundle(bundlePath, 'memory'), /does not match adjacent environment.json/);
  });
});

test('rejects missing source metadata rather than accepting an unidentified bundle', async () => {
  await withSavedBundle(async ({ bundlePath, environmentPath }) => {
    await rm(environmentPath);
    await assert.rejects(readBeforeBundle(bundlePath, 'startup'), { code: 'ENOENT' });
  });
});

test('rejects a different build target, format, minification or mode', async () => {
  await withSavedBundle(async ({ bundlePath, environment, environmentPath }) => {
    for (const mismatch of [{ target: 'esnext' }, { format: 'es' }, { minify: false }, { mode: 'development' }]) {
      await writeFile(
        environmentPath,
        JSON.stringify({ ...environment, build: { ...environment.build, ...mismatch } }),
      );
      await assert.rejects(readBeforeBundle(bundlePath, 'startup'), /production, minified ES2018 IIFE/);
    }
  });
});

test('default ordering preserves the original alternating order including warmups', () => {
  for (let round = -2; round < 8; round += 1) {
    assert.deepEqual(comparisonOrder(round), round % 2 === 0 ? ['jieshu', 'wujie'] : ['wujie', 'jieshu']);
  }
});

test('six measured rounds cover each three-variant permutation with balanced positions', () => {
  const orders = Array.from({ length: 6 }, (_, round) => comparisonOrder(round, true));
  assert.equal(new Set(orders.map((order) => order.join(','))).size, 6);
  for (const label of ['jieshu', 'wujie', 'jieshu-before']) {
    for (let position = 0; position < 3; position += 1) {
      assert.equal(orders.filter((order) => order[position] === label).length, 2);
    }
  }
  for (const round of [-2, -1]) {
    assert.deepEqual([...comparisonOrder(round, true)].sort(), ['jieshu', 'jieshu-before', 'wujie']);
  }
});

test('saved Jieshu gets Jieshu fixture behavior and a distinct equal-length script route', () => {
  assert.equal(fixtureFramework('jieshu-before'), 'jieshu');
  assert.equal(fixtureFramework('jieshu'), 'jieshu');
  assert.equal(fixtureFramework('wujie'), 'wujie');
  assert.equal(coreRoute('jieshu-before'), 'before');
  assert.equal(coreRoute('jieshu'), 'jieshu');
  assert.equal(coreRoute('wujie'), 'wujie');
  assert.notEqual(coreRoute('jieshu-before'), coreRoute('jieshu'));
  assert.equal(coreRoute('jieshu-before').length, coreRoute('jieshu').length);
});
