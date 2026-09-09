import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
if (args[0] !== '--output' || args.length < 3) {
  throw new Error('Usage: node summarize-before-after.mjs --output NEW_DIR RUN_DIR [RUN_DIR ...]');
}
const output = path.resolve(args[1]);
const directories = args.slice(2).map((directory) => path.resolve(directory));
if (new Set(directories).size !== directories.length || directories.includes(output)) {
  throw new Error('Input directories must be distinct; output must be a separate new directory');
}
const frameworks = ['jieshu', 'jieshu-before', 'wujie'];
const iterations = 5000;
const seed = 20260909;
const finite = Number.isFinite;
const quantile = (values, probability) => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
};
const round = (value) => (finite(value) ? Number(value.toFixed(6)) : null);
const statistics = (values) => {
  const selected = values.filter(finite);
  return { n: selected.length, median: round(quantile(selected, 0.5)), p95: round(quantile(selected, 0.95)) };
};
const counts = (records) => ({
  total: records.length,
  passed: records.filter((record) => record.passed).length,
  failed: records.filter((record) => !record.passed).length,
});
const inputs = [];
const records = [];
const excluded = [];
const seen = new Set();
for (const directory of directories) {
  const [environmentBytes, observationBytes] = await Promise.all([
    readFile(path.join(directory, 'environment.json')),
    readFile(path.join(directory, 'observations.jsonl')),
  ]);
  const environment = JSON.parse(environmentBytes);
  inputs.push({
    directory,
    environment,
    environmentSha256: createHash('sha256').update(environmentBytes).digest('hex'),
    observationsSha256: createHash('sha256').update(observationBytes).digest('hex'),
  });
  for (const [index, line] of observationBytes.toString('utf8').split('\n').entries()) {
    if (!line.trim()) {
      continue;
    }
    const record = JSON.parse(line);
    const kind = record.kind ?? (typeof record.encoding === 'string' ? 'load' : undefined);
    if (
      !['load', 'startup', 'memory'].includes(kind) ||
      !frameworks.includes(record.framework) ||
      typeof record.passed !== 'boolean' ||
      !Number.isSafeInteger(record.round)
    ) {
      throw new Error(`Invalid or unsupported observation at ${directory}:${index + 1}`);
    }
    const group = kind === 'load' ? record.encoding : record.scenario;
    if (typeof group !== 'string') {
      throw new Error(`Missing encoding/scenario at ${directory}:${index + 1}`);
    }
    const key = `${kind}/${group}/${record.framework}/${record.round}/${Boolean(record.traced)}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate round: ${key}`);
    }
    seen.add(key);
    const normalized = { ...record, kind, group, source: directory, sourceLine: index + 1 };
    if (record.traced || record.warmup || record.round < 0) {
      excluded.push({ key, reason: record.traced ? 'traced' : 'warmup', passed: record.passed });
    } else {
      records.push(normalized);
    }
  }
}
// Never pool data from different bundles or runtime environments, even across harnesses.
const comparable = ({ environment }) => ({
  browser: environment.browser,
  node: environment.node,
  cpu: environment.cpu,
  platform: environment.platform,
  release: environment.release,
  arch: environment.arch,
  playwright: environment.playwright,
  vite: environment.vite,
  build: environment.build,
  bundleTransport: environment.bundleTransport,
  bundles: frameworks.map((framework) => environment.revisions?.[framework]?.sha256),
});
const comparison = JSON.stringify(comparable(inputs[0]));
for (const input of inputs) {
  if (frameworks.some((framework) => typeof input.environment.revisions?.[framework]?.sha256 !== 'string')) {
    throw new Error(`Missing current/before/Wujie bundle identity: ${input.directory}`);
  }
  if (JSON.stringify(comparable(input)) !== comparison) {
    throw new Error(`Cannot combine different bundles or runtime environments: ${input.directory}`);
  }
}
const paired = (selected, metric, groupKey) => {
  const current = new Map(
    selected.filter((record) => record.framework === 'jieshu').map((record) => [record.round, record]),
  );
  const before = new Map(
    selected.filter((record) => record.framework === 'jieshu-before').map((record) => [record.round, record]),
  );
  const expectedRounds = Math.max(
    ...selected.map((record) => {
      const environment = inputs.find((input) => input.directory === record.source).environment;
      return environment.mode === 'smoke' ? 1 : environment.samples;
    }),
  );
  const pairs = [];
  const exclusions = [];
  for (let sampleRound = 0; sampleRound < expectedRounds; sampleRound += 1) {
    const a = current.get(sampleRound);
    const b = before.get(sampleRound);
    if (a?.passed && b?.passed && finite(a[metric]) && finite(b[metric])) {
      pairs.push({ round: sampleRound, a: a[metric], b: b[metric] });
    } else {
      exclusions.push({
        round: sampleRound,
        current: !a ? 'missing' : !a.passed ? 'failed' : !finite(a[metric]) ? 'metric-missing' : 'available',
        before: !b ? 'missing' : !b.passed ? 'failed' : !finite(b[metric]) ? 'metric-missing' : 'available',
      });
    }
  }
  let state = createHash('sha256').update(`${seed}/${groupKey}/${metric}`).digest().readUInt32LE(0);
  const derivedSeed = state;
  const distribution = [];
  if (pairs.length >= 2) {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const a = [];
      const b = [];
      for (let index = 0; index < pairs.length; index += 1) {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        const pair = pairs[Math.floor((state / 4294967296) * pairs.length)];
        a.push(pair.a);
        b.push(pair.b);
      }
      distribution.push(quantile(a, 0.5) - quantile(b, 0.5));
    }
  }
  const a = statistics(pairs.map((pair) => pair.a));
  const b = statistics(pairs.map((pair) => pair.b));
  return {
    n: pairs.length,
    expectedRounds,
    excludedRounds: exclusions.length,
    exclusions,
    pairedRounds: pairs.map((pair) => pair.round),
    currentMedian: a.median,
    beforeMedian: b.median,
    medianDifference: a.n
      ? round(
          quantile(
            pairs.map((pair) => pair.a),
            0.5,
          ) -
            quantile(
              pairs.map((pair) => pair.b),
              0.5,
            ),
        )
      : null,
    confidenceInterval95: [round(quantile(distribution, 0.025)), round(quantile(distribution, 0.975))],
    iterations: distribution.length,
    seed: derivedSeed,
  };
};
const timing = [];
for (const kind of ['load', 'startup']) {
  const fields =
    kind === 'load'
      ? [
          'totalLoadMs',
          'requestAndResponseMs',
          'responseEndToOnloadMs',
          'scriptDurationMs',
          'v8CompileDurationMs',
          'heapDeltaBytes',
        ]
      : ['coreLoadMs', 'apiMs', 'readyMs', 'preparationMs'];
  for (const group of [...new Set(records.filter((record) => record.kind === kind).map((record) => record.group))]) {
    const selected = records.filter((record) => record.kind === kind && record.group === group);
    timing.push({
      kind,
      group,
      frameworks: Object.fromEntries(
        frameworks.map((framework) => {
          const matching = selected.filter((record) => record.framework === framework);
          return [
            framework,
            {
              ...counts(matching),
              metrics: Object.fromEntries(
                fields.map((metric) => [
                  metric,
                  statistics(matching.filter((record) => record.passed).map((record) => record[metric])),
                ]),
              ),
            },
          ];
        }),
      ),
      currentMinusBefore: Object.fromEntries(
        fields.map((metric) => [metric, paired(selected, metric, `${kind}/${group}`)]),
      ),
    });
  }
}
const memoryRecords = records.filter((record) => record.kind === 'memory');
const memorySamples = memoryRecords
  .filter((record) => record.passed)
  .flatMap((record) => {
    if (!Array.isArray(record.series)) {
      throw new Error(`Missing memory series: ${record.source}:${record.sourceLine}`);
    }
    const blank = record.series.find((snapshot) => snapshot.stage === 'blank')?.JSHeapUsedSize;
    const core = record.series.find((snapshot) => snapshot.stage === 'core')?.JSHeapUsedSize;
    const stages = new Set();
    return record.series.map((snapshot) => {
      const key = `${snapshot.stage}/${snapshot.cycle ?? ''}`;
      if (stages.has(key)) {
        throw new Error(`Duplicate memory stage: ${record.framework}/${record.round}/${key}`);
      }
      stages.add(key);
      return {
        framework: record.framework,
        round: record.round,
        key,
        ...snapshot,
        deltaBlankHeapBytes: finite(blank) && finite(snapshot.JSHeapUsedSize) ? snapshot.JSHeapUsedSize - blank : null,
        deltaCoreHeapBytes: finite(core) && finite(snapshot.JSHeapUsedSize) ? snapshot.JSHeapUsedSize - core : null,
      };
    });
  });
const memoryFields = [
  'JSHeapUsedSize',
  'JSHeapTotalSize',
  'Documents',
  'Nodes',
  'JSEventListeners',
  'deltaBlankHeapBytes',
  'deltaCoreHeapBytes',
];
const memory = {
  rounds: Object.fromEntries(
    frameworks.map((framework) => [
      framework,
      counts(memoryRecords.filter((record) => record.framework === framework)),
    ]),
  ),
  stages: [...new Set(memorySamples.map((sample) => sample.key))].map((key) => {
    const selected = memorySamples.filter((sample) => sample.key === key);
    const groups = Object.fromEntries(
      frameworks.map((framework) => [
        framework,
        Object.fromEntries(
          memoryFields.map((field) => [
            field,
            statistics(selected.filter((sample) => sample.framework === framework).map((sample) => sample[field])),
          ]),
        ),
      ]),
    );
    return {
      stage: selected[0].stage,
      cycle: selected[0].cycle ?? null,
      frameworks: groups,
      currentMinusBefore: Object.fromEntries(
        memoryFields.map((field) => {
          const a = groups.jieshu[field].median;
          const b = groups['jieshu-before'][field].median;
          return [field, finite(a) && finite(b) ? round(a - b) : null];
        }),
      ),
    };
  }),
};
const result = {
  generatedAt: new Date().toISOString(),
  inputs,
  methodology: [
    'Only non-traced, non-warmup records are summarized. Failed observations remain counted and are excluded from metric statistics.',
    'Bootstrap resamples complete current/before same-round pairs 5000 times with fixed derived seeds. Estimand is median(current) - median(before), not median of per-round differences; percentile 95% CI is within-run uncertainty, not a significance conclusion.',
    'A missing or failed pair excludes both members from that metric; per-framework median/p95 may use a larger set, while the paired median is shown separately.',
    'Core load metrics are grouped by encoding, startup metrics by scenario. Metrics are not added; readyMs starts after core loading and fixture installation.',
    'Memory lists raw stage medians, per-round stage-minus-blank/core medians, and current-minus-before median differences. No memory CI is calculated, including for single-round runs. A lower idle heap alone does not establish lower active-memory cost.',
    'Duplicate framework/round records are rejected within each kind/group, including across directories. Different bundle identities or runtime environments cannot be pooled.',
  ],
  counts: counts(records),
  excluded,
  failures: records.filter((record) => !record.passed),
  timing,
  memory,
};
const format = (value) => (finite(value) ? value.toFixed(3) : '—');
const metricCell = (value) => `${format(value.median)} / ${format(value.p95)} (n=${value.n})`;
const lines = [
  '# 核心加载优化前后对照',
  '',
  `有效记录 ${result.counts.passed}/${result.counts.total}，失败 ${result.counts.failed}；排除 trace/warmup ${excluded.length} 条。`,
  '',
  'current 为 jieshu，before 为 jieshu-before。差值为 current − before；正值表示该项增加。耗时单位 ms，heapDeltaBytes 单位 B。方括号为配对 bootstrap 95% 区间，5000 次固定种子；不作显著性结论。',
];
for (const group of timing) {
  lines.push(
    '',
    `## ${group.kind} / ${group.group}`,
    '',
    '| 指标 | current 中位/p95 | before 中位/p95 | Wujie 中位/p95 | 配对差值 [95% CI] | 配对 n/预期（排除） |',
    '|---|---:|---:|---:|---:|---:|',
  );
  for (const [metric, pairedMetric] of Object.entries(group.currentMinusBefore)) {
    lines.push(
      `| ${metric} | ${frameworks.map((framework) => metricCell(group.frameworks[framework].metrics[metric])).join(' | ')} | ${format(pairedMetric.medianDifference)} [${pairedMetric.confidenceInterval95.map(format).join(', ')}] | ${pairedMetric.n}/${pairedMetric.expectedRounds} (${pairedMetric.excludedRounds}) |`,
    );
  }
}
lines.push(
  '',
  '## 内存：GC 后 JS heap，单位 B',
  '',
  '按 stage/cycle 列出各组中位数；Δcore 是每轮相对该轮核心加载后堆内存的增量。单轮不计算 CI。',
  '',
  '| stage/cycle | current | before | Wujie | current−before | current Δcore | before Δcore | Δcore 差值 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
);
for (const stage of memory.stages) {
  lines.push(
    `| ${stage.stage}${stage.cycle === null ? '' : `/${stage.cycle}`} | ${frameworks.map((framework) => format(stage.frameworks[framework].JSHeapUsedSize.median)).join(' | ')} | ${format(stage.currentMinusBefore.JSHeapUsedSize)} | ${format(stage.frameworks.jieshu.deltaCoreHeapBytes.median)} | ${format(stage.frameworks['jieshu-before'].deltaCoreHeapBytes.median)} | ${format(stage.currentMinusBefore.deltaCoreHeapBytes)} |`,
  );
}
lines.push('', '## 口径', '', ...result.methodology.map((method) => `- ${method}`));
// A new output directory prevents accidentally replacing prior audit results.
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output);
await writeFile(path.join(output, 'before-after-summary.json'), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(path.join(output, 'BEFORE_AFTER_SUMMARY.md'), `${lines.join('\n')}\n`);
console.log(
  JSON.stringify({ output, counts: result.counts, timingGroups: timing.length, memoryStages: memory.stages.length }),
);
