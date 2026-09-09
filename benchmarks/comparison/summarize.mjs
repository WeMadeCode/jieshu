import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const directories = process.argv.slice(2).map((directory) => path.resolve(directory));
if (directories.length === 0) {
  throw new Error('Usage: node benchmarks/comparison/summarize.mjs RUN_DIR [RUN_DIR ...]');
}
if (new Set(directories).size !== directories.length) {
  throw new Error('Each input directory must be supplied once.');
}

const frameworks = ['wujie', 'jieshu'];
const bootstrapIterations = 5000;
const bootstrapSeed = 20260909;
const mebibyte = 1024 * 1024;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const quantile = (values, probability) => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};
const statistics = (values) => {
  const valid = values.filter(finite);
  return { n: valid.length, median: quantile(valid, 0.5), p95: quantile(valid, 0.95) };
};
const counts = (records) => ({
  total: records.length,
  passed: records.filter((record) => record.passed).length,
  failed: records.filter((record) => !record.passed).length,
});
const randomGenerator = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
const bootstrap = (wujie, jieshu, paired = false) => {
  if (wujie.length < 2 || jieshu.length < 2) {
    return null;
  }
  const random = randomGenerator(bootstrapSeed);
  const differences = [];
  for (let iteration = 0; iteration < bootstrapIterations; iteration += 1) {
    const sampledWujie = [];
    const sampledJieshu = [];
    for (let index = 0; index < wujie.length; index += 1) {
      const chosen = Math.floor(random() * wujie.length);
      sampledWujie.push(wujie[chosen]);
      if (paired) {
        sampledJieshu.push(jieshu[chosen]);
      }
    }
    if (!paired) {
      for (let index = 0; index < jieshu.length; index += 1) {
        sampledJieshu.push(jieshu[Math.floor(random() * jieshu.length)]);
      }
    }
    differences.push(quantile(sampledJieshu, 0.5) - quantile(sampledWujie, 0.5));
  }
  return {
    method: paired ? 'paired-round-percentile' : 'independent-samples-percentile',
    estimand: 'median(jieshu.readyMs) - median(wujie.readyMs)',
    iterations: bootstrapIterations,
    seed: bootstrapSeed,
    wujieN: wujie.length,
    jieshuN: jieshu.length,
    observedDifferenceMs: quantile(jieshu, 0.5) - quantile(wujie, 0.5),
    interval95Ms: [quantile(differences, 0.025), quantile(differences, 0.975)],
  };
};

const inputs = await Promise.all(
  directories.map(async (directory, sourceIndex) => {
    const [environmentText, observationsText] = await Promise.all([
      readFile(path.join(directory, 'environment.json'), 'utf8'),
      readFile(path.join(directory, 'observations.jsonl'), 'utf8'),
    ]);
    const records = observationsText.split('\n').flatMap((line, index) => {
      if (!line.trim()) {
        return [];
      }
      const record = JSON.parse(line);
      if (
        !frameworks.includes(record.framework) ||
        !['startup', 'memory', 'stability'].includes(record.kind) ||
        typeof record.scenario !== 'string' ||
        typeof record.passed !== 'boolean'
      ) {
        throw new Error(`Invalid observation at ${directory}/observations.jsonl:${index + 1}`);
      }
      return [{ ...record, sourceIndex, sourceLine: index + 1 }];
    });
    return { directory, environment: JSON.parse(environmentText), records };
  }),
);

// Different machine, browser or bundle inputs must not be silently pooled.
const comparability = (environment) => ({
  platform: environment.platform,
  release: environment.release,
  arch: environment.arch,
  cpu: environment.cpu,
  node: environment.node,
  browser: environment.browser,
  playwright: environment.playwright,
  vite: environment.vite,
  build: environment.build,
  fixture: environment.fixture,
  viewport: environment.viewport,
  bundles: frameworks.map((framework) => environment.revisions?.[framework]?.sha256),
});
const baseline = JSON.stringify(comparability(inputs[0].environment));
for (const input of inputs.slice(1)) {
  if (JSON.stringify(comparability(input.environment)) !== baseline) {
    throw new Error(`Cannot pool different environments or bundles: ${input.directory}`);
  }
}

const allRecords = inputs.flatMap((input) => input.records);
const warmups = allRecords.filter((record) => record.kind === 'startup' && (record.warmup || record.round < 0));
const records = allRecords.filter((record) => !warmups.includes(record));
const byKind = (kind) => records.filter((record) => record.kind === kind);
const scenarioNames = (kind) => [...new Set(byKind(kind).map((record) => record.scenario))];
const startupMetrics = ['apiMs', 'readyMs', 'coreLoadMs', 'preparationMs'];
const startup = scenarioNames('startup').map((scenario) => {
  const selected = byKind('startup').filter((record) => record.scenario === scenario);
  const groups = Object.fromEntries(
    frameworks.map((framework) => {
      const group = selected.filter((record) => record.framework === framework);
      const successful = group.filter((record) => record.passed);
      return [
        framework,
        {
          ...counts(group),
          metrics: Object.fromEntries(
            startupMetrics.map((metric) => [metric, statistics(successful.map((record) => record[metric]))]),
          ),
        },
      ];
    }),
  );
  const readyRecords = selected.filter((record) => record.passed && finite(record.readyMs));
  const pairedRounds = new Map();
  for (const record of readyRecords) {
    if (!Number.isInteger(record.round)) {
      continue;
    }
    const key = `${record.sourceIndex}:${record.round}`;
    const pair = pairedRounds.get(key) ?? {};
    if (Reflect.getOwnPropertyDescriptor(pair, record.framework)) {
      throw new Error(`Duplicate startup sample: ${scenario}/${record.framework}/${key}`);
    }
    pair[record.framework] = record.readyMs;
    pairedRounds.set(key, pair);
  }
  const pairs = [...pairedRounds.values()].filter((pair) => frameworks.every((framework) => finite(pair[framework])));
  const wujieMedian = groups.wujie.metrics.readyMs.median;
  const jieshuMedian = groups.jieshu.metrics.readyMs.median;
  return {
    scenario,
    frameworks: groups,
    readyMedianChangePercent:
      finite(wujieMedian) && finite(jieshuMedian) && wujieMedian !== 0 ? (jieshuMedian / wujieMedian - 1) * 100 : null,
    readyDifferenceBootstrap: bootstrap(
      readyRecords.filter((record) => record.framework === 'wujie').map((record) => record.readyMs),
      readyRecords.filter((record) => record.framework === 'jieshu').map((record) => record.readyMs),
    ),
    pairedRoundBootstrap: bootstrap(
      pairs.map((pair) => pair.wujie),
      pairs.map((pair) => pair.jieshu),
      true,
    ),
  };
});

const memoryRecords = byKind('memory');
const snapshots = memoryRecords
  .filter((record) => record.passed)
  .flatMap((record) => {
    const core = record.series?.find((snapshot) => snapshot.stage === 'core');
    return (record.series ?? []).map((snapshot) => ({
      framework: record.framework,
      stage: snapshot.stage,
      cycle: snapshot.cycle ?? null,
      heapUsedMiB: finite(snapshot.JSHeapUsedSize) ? snapshot.JSHeapUsedSize / mebibyte : null,
      heapTotalMiB: finite(snapshot.JSHeapTotalSize) ? snapshot.JSHeapTotalSize / mebibyte : null,
      documents: snapshot.Documents,
      nodes: snapshot.Nodes,
      jsEventListeners: snapshot.JSEventListeners,
      deltaCoreHeapMiB:
        finite(snapshot.JSHeapUsedSize) && finite(core?.JSHeapUsedSize)
          ? (snapshot.JSHeapUsedSize - core.JSHeapUsedSize) / mebibyte
          : null,
    }));
  });
const memoryStages = [
  ...new Map(snapshots.map(({ stage, cycle }) => [`${stage}:${cycle}`, { stage, cycle }])).values(),
];
const memoryMetricNames = ['heapUsedMiB', 'heapTotalMiB', 'documents', 'nodes', 'jsEventListeners', 'deltaCoreHeapMiB'];
const memory = {
  rounds: Object.fromEntries(
    frameworks.map((framework) => [
      framework,
      counts(memoryRecords.filter((record) => record.framework === framework)),
    ]),
  ),
  stages: memoryStages.map(({ stage, cycle }) => ({
    stage,
    cycle,
    frameworks: Object.fromEntries(
      frameworks.map((framework) => {
        const selected = snapshots.filter(
          (snapshot) => snapshot.framework === framework && snapshot.stage === stage && snapshot.cycle === cycle,
        );
        return [
          framework,
          Object.fromEntries(
            memoryMetricNames.map((metric) => [metric, statistics(selected.map((snapshot) => snapshot[metric]))]),
          ),
        ];
      }),
    ),
  })),
};

const stability = scenarioNames('stability').map((scenario) => {
  const selected = byKind('stability').filter((record) => record.scenario === scenario);
  return {
    scenario,
    contract: selected[0]?.details?.contract ?? null,
    expected: selected[0]?.details?.expected ?? null,
    frameworks: Object.fromEntries(
      frameworks.map((framework) => [framework, counts(selected.filter((record) => record.framework === framework))]),
    ),
  };
});
const failures = records.filter((record) => !record.passed);
const summary = {
  generatedAt: new Date().toISOString(),
  inputs: inputs.map(({ directory, environment }) => ({ directory, environment })),
  methodology: {
    percentile: 'Linear interpolation at (N - 1) * p',
    startup:
      'Successful non-warmup observations only; separate fresh browser contexts with alternating framework order',
    readyMedianChangePercent: '(median(jieshu.readyMs) / median(wujie.readyMs) - 1) * 100',
    bootstrapIterations,
    bootstrapSeed,
    bootstrapPrimary: 'Independent sample percentile bootstrap for median(J) - median(W), in ms',
    bootstrapSensitivity:
      'Complete same-source, same-round pairs resampled together; statistic remains median(J) - median(W)',
    memory: 'Successful rounds only; medians across rounds per stage/cycle; CDP after forced GC; MiB = 1048576 bytes',
    memoryDelta: 'Median of per-round stage heap minus that same round core heap',
  },
  counts: counts(records),
  warmupRecords: { ...counts(warmups), failures: warmups.filter((record) => !record.passed) },
  startup,
  memory,
  stability,
  failures,
};

const cell = (value) =>
  String(value ?? '—')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
const number = (value, digits = 2) => (finite(value) ? value.toFixed(digits) : '—');
const table = (headers, rows) =>
  [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
const metricCell = (metric) => `${number(metric.median)} / ${number(metric.p95)} (n=${metric.n})`;
const intervalCell = (result) =>
  result ? `[${number(result.interval95Ms[0])}, ${number(result.interval95Ms[1])}]` : '—';
const lines = [
  '# Wujie / Jieshu 对比统计',
  '',
  `自动生成于 ${summary.generatedAt}。完整环境、统计值及失败现场见 [summary.json](./summary.json)。`,
  '',
  table(
    ['框架', 'commit', '版本', 'core 原始 / gzip（字节）'],
    frameworks.map((framework) => {
      const revision = inputs[0].environment.revisions?.[framework];
      return [
        framework,
        revision?.commit,
        revision?.package,
        `${revision?.bundleBytes ?? '—'} / ${revision?.gzipBytes ?? '—'}`,
      ];
    }),
  ),
  '',
  `环境：${inputs[0].environment.platform ?? '未知'} ${inputs[0].environment.arch ?? ''}，${inputs[0].environment.cpu ?? '未知 CPU'}，Chromium ${inputs[0].environment.browser ?? '未知'}，Node ${inputs[0].environment.node ?? '未知'}。`,
  '',
  '## 启动',
  '',
  '耗时单位 ms；单元格为中位数 / P95（有效 N）。仅统计成功且非预热的样本，失败另列；成功耗时不能掩盖失败。P95 用线性插值。每个样本使用独立 context，按轮次交错框架顺序。',
  '',
  `观测文件中排除预热记录 ${warmups.length} 条，其中失败 ${summary.warmupRecords.failed} 条；运行器可能不写入成功预热记录，此计数不代表实际预热总数。`,
  '',
  table(
    ['场景', '框架', '成功 / 失败', ...startupMetrics],
    startup.flatMap((entry) =>
      frameworks.map((framework) => {
        const group = entry.frameworks[framework];
        return [
          entry.scenario,
          framework,
          `${group.passed} / ${group.failed}`,
          ...startupMetrics.map((metric) => metricCell(group.metrics[metric])),
        ];
      }),
    ),
  ),
  '',
  'readyMs 相对差 = (Jieshu 中位数 / Wujie 中位数 − 1) × 100%；负值表示本次 Jieshu 的成功样本中位耗时更低。区间统计量为 median(J) − median(W)，不是逐对差值的中位数。',
  '',
  `Bootstrap ${bootstrapIterations} 次，固定 seed=${bootstrapSeed}，95% percentile 区间，不作多重比较校正。主结果独立重采样；配对结果按同一输入目录和 round 整对重采样，仅纳入双方成功的完整轮次。少于 2 个有效样本/配对时不估计区间；单次运行中的上下文独立并不消除机器负载的时间相关性。`,
  '',
  table(
    [
      '场景',
      'ready 中位数相对差',
      '中位耗时差 J−W（ms）',
      '独立 bootstrap 95% 区间（ms）',
      '配对 N',
      '配对 bootstrap 95% 区间（ms）',
    ],
    startup.map((entry) => [
      entry.scenario,
      finite(entry.readyMedianChangePercent) ? `${number(entry.readyMedianChangePercent)}%` : '—',
      number(entry.readyDifferenceBootstrap?.observedDifferenceMs),
      intervalCell(entry.readyDifferenceBootstrap),
      entry.pairedRoundBootstrap?.wujieN ?? '—',
      intervalCell(entry.pairedRoundBootstrap),
    ]),
  ),
  '',
  'coreLoadMs 独立于 start 调用计时；preparationMs 是重建、保活或预加载所需的前置准备。预加载进入耗时不包括这部分成本。ready 指夹具完成渲染后的帧边界，不等同于所有真实业务资源或用户可交互指标。',
  '',
  '## 内存',
  '',
  table(
    ['框架', '成功轮数', '失败轮数'],
    frameworks.map((framework) => [framework, memory.rounds[framework].passed, memory.rounds[framework].failed]),
  ),
  '',
  '下面均为同阶段/周期跨成功轮次的中位数，强制 GC 后采样；1 MiB = 1,048,576 字节。JS heap、Documents、Nodes 和监听器计数来自页面 CDP 指标，不是浏览器总内存或 RSS。Δcore 为每轮先减去该轮 core 堆占用，再取中位数。',
  '',
  table(
    ['阶段 / 周期', '框架', '堆 N', 'JS heap（MiB）', 'Δcore（MiB）', 'Documents', 'Nodes', 'JSEventListeners'],
    memory.stages.flatMap((entry) =>
      frameworks.map((framework) => {
        const metrics = entry.frameworks[framework];
        return [
          `${entry.stage}${entry.cycle === null ? '' : ` / ${entry.cycle}`}`,
          framework,
          metrics.heapUsedMiB.n,
          number(metrics.heapUsedMiB.median, 3),
          number(metrics.deltaCoreHeapMiB.median, 3),
          number(metrics.documents.median, 1),
          number(metrics.nodes.median, 1),
          number(metrics.jsEventListeners.median, 1),
        ];
      }),
    ),
  ),
  '',
  'cache-cleared / final-cleanup 是即时清理后快照；cache-cleared-settled-5.5s / final-settled-5.5s 额外等待 5.5 秒，必须分别解读。same-assets 与 unique-assets 在同轮依次执行，后者不是独立空白基线。缓存保留、延迟清理及单段增长都不能直接证明泄漏；完整序列保存在原始观测中。',
  '',
  '## 稳定性',
  '',
  '分母为实际执行次数；成功率仅适用于本次场景、浏览器与夹具，不能推出所有场景更稳定。robustness-observation 表示压力/竞态观察，需结合各框架公开契约判断，不能直接等同于承诺行为回归。',
  '',
  table(
    ['场景', '契约类别', 'Wujie 通过 / 总数', 'Jieshu 通过 / 总数'],
    stability.map((entry) => [
      entry.scenario,
      entry.contract,
      ...frameworks.map((framework) => `${entry.frameworks[framework].passed} / ${entry.frameworks[framework].total}`),
    ]),
  ),
  '',
  '## 失败记录',
  '',
];
if (failures.length === 0) {
  lines.push('本次非预热观测未记录失败。');
} else {
  lines.push(
    table(
      ['类别', '框架', '场景', 'round', '错误', '原始位置'],
      failures.map((failure) => [
        failure.kind,
        failure.framework,
        failure.scenario,
        failure.round,
        typeof failure.error === 'string'
          ? failure.error
          : (failure.error?.message ?? JSON.stringify(failure.pageErrors ?? failure.details)),
        `${path.relative(directories[0], inputs[failure.sourceIndex].directory) || '.'}/observations.jsonl:${failure.sourceLine}`,
      ]),
    ),
  );
  lines.push(
    '',
    '各条失败的 error、details、pageErrors、diagnostics 原样保存在 summary.json 的 failures 中；不能仅凭失败信息省略对夹具、API 契约和复现条件的排查。',
  );
}
lines.push(
  '',
  '## 范围与复现',
  '',
  '本报告不将不同场景合并成单一性能排名。结果限于本地跨端口 HTTP、合成 core 负载和本次 Headless Chromium；不覆盖公网、其他浏览器、移动端、适配包或长期业务稳定性。桌面后台负载未受控。',
  '',
  '输入目录：',
  '',
  ...directories.map((directory) => `- ${directory}`),
  '',
);

await writeFile(path.join(directories[0], 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(directories[0], 'SUMMARY.md'), lines.join('\n'));
console.log(JSON.stringify({ output: directories[0], ...summary.counts, excludedWarmupRecords: warmups.length }));
