import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

export const readBeforeBundle = async (bundlePath, mode) => {
  if (!bundlePath) {
    return undefined;
  }
  if (!['startup', 'memory', 'smoke'].includes(mode)) {
    throw new Error('BENCH_BEFORE_BUNDLE is supported only with BENCH_MODE=startup, memory or smoke');
  }
  const resolvedBundlePath = path.resolve(bundlePath);
  const environmentPath = path.join(path.dirname(resolvedBundlePath), 'environment.json');
  const [bundle, sourceEnvironment] = await Promise.all([readFile(resolvedBundlePath), readFile(environmentPath)]);
  const environment = JSON.parse(sourceEnvironment.toString('utf8'));
  const revision = environment.revisions?.jieshu;
  const sha256 = createHash('sha256').update(bundle).digest('hex');
  if (typeof revision?.sha256 !== 'string' || revision.sha256 !== sha256) {
    throw new Error('BENCH_BEFORE_BUNDLE does not match adjacent environment.json revisions.jieshu.sha256');
  }
  if (
    environment.build?.target !== 'es2018' ||
    environment.build?.minify !== true ||
    environment.build?.format !== 'iife' ||
    environment.build?.mode !== 'production'
  ) {
    throw new Error('BENCH_BEFORE_BUNDLE requires a production, minified ES2018 IIFE build');
  }
  return {
    bundle,
    sourceEnvironment,
    revision: {
      ...revision,
      bundleBytes: bundle.length,
      gzipBytes: gzipSync(bundle).length,
      sha256,
      source: {
        kind: 'saved-bundle',
        bundlePath: resolvedBundlePath,
        sha256,
        environmentPath,
        environmentSha256: createHash('sha256').update(sourceEnvironment).digest('hex'),
        copiedBundle: 'jieshu-before.js',
        copiedEnvironment: 'jieshu-before.environment.json',
      },
    },
  };
};

export const comparisonOrder = (round, includeBefore = false) => {
  if (!includeBefore) {
    return round % 2 === 0 ? ['jieshu', 'wujie'] : ['wujie', 'jieshu'];
  }
  const frameworks = ['jieshu', 'wujie', 'jieshu-before'];
  // Normalize the two negative startup warmup rounds as well as measured rounds.
  const offset = ((round % frameworks.length) + frameworks.length) % frameworks.length;
  const rotated = [...frameworks.slice(offset), ...frameworks.slice(0, offset)];
  return Math.floor(round / frameworks.length) % 2 !== 0 ? rotated.reverse() : rotated;
};

export const fixtureFramework = (label) => (label === 'jieshu-before' ? 'jieshu' : label);

// Keep the frozen and current Jieshu URL lengths equal for memory comparisons.
export const coreRoute = (label) => (label === 'jieshu-before' ? 'before' : label);
