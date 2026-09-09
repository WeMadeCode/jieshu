import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const argument = process.argv[2];
if (!argument || argument === '--help') {
  console.log('Usage: node benchmarks/comparison/summarize-core-load-causes.mjs <measurement-directory>');
  process.exit(argument === '--help' ? 0 : 1);
}
if (process.argv.length !== 3) {
  throw new Error('Expected one measurement directory argument');
}
const directory = path.resolve(argument);
const bootstrapIterations = 5000;
const bootstrapSeed = 20260909;
const measuredFields = ['totalLoadMs', 'scriptDurationMs'];
const comparisons = [
  ['J-W', 'jieshu', 'wujie'],
  ['Wpadded-W', 'wujie-padded', 'wujie'],
  ['Jentryskip-J', 'jieshu-entry-skipped', 'jieshu'],
  ['Jcacheskip-J', 'jieshu-caches-skipped', 'jieshu'],
  ['Jinitskip-Winitskip', 'jieshu-init-skipped', 'wujie-init-skipped'],
  ['Jinitskip-J', 'jieshu-init-skipped', 'jieshu'],
  ['Winitskip-W', 'wujie-init-skipped', 'wujie'],
];
const sources = [];
const warnings = [];
const readSource = async (relative) => {
  const resolved = path.resolve(directory, relative);
  if (!resolved.startsWith(`${directory}${path.sep}`)) {
    throw new Error(`Source is outside the measurement directory: ${relative}`);
  }
  const bytes = await readFile(resolved);
  sources.push({ file: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  return bytes.toString('utf8');
};
const [observationsText, environmentText, tracesText] = await Promise.all([
  readSource('observations.jsonl'),
  readSource('environment.json'),
  readSource('trace-summary.json'),
]);
const observations = observationsText.trim().split('\n').filter(Boolean).map(JSON.parse);
const environment = JSON.parse(environmentText);
const traceSummaries = JSON.parse(tracesText);
if (!Array.isArray(environment.manifest?.variants) || !Array.isArray(traceSummaries)) {
  throw new Error('Missing variant manifest or trace summary array');
}
const variants = environment.manifest.variants;
const variantIds = new Set(variants.map((variant) => variant.id));
const uniqueRecords = new Map();
const recordKey = (record) =>
  `${record.cpuRate}/${record.transport}/${record.variant}/${record.round}/${record.traced}`;
for (const record of observations) {
  if (
    !variantIds.has(record.variant) ||
    ![1, 4].includes(record.cpuRate) ||
    !['identity', 'gzip'].includes(record.transport) ||
    !Number.isSafeInteger(record.round) ||
    record.round < 0 ||
    typeof record.traced !== 'boolean'
  ) {
    throw new Error(`Invalid observation identity: ${JSON.stringify(record)}`);
  }
  const key = recordKey(record);
  if (uniqueRecords.has(key)) {
    throw new Error(`Duplicate observation: ${key}`);
  }
  uniqueRecords.set(key, record);
}
for (const [, a, b] of comparisons) {
  if (!variantIds.has(a) || !variantIds.has(b)) {
    throw new Error(`Missing comparison variant: ${a} / ${b}`);
  }
}
const rounded = (value) => (Number.isFinite(value) ? Number(value.toFixed(6)) : null);
const quantile = (values, probability) => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
};
const describe = (values) => {
  const finite = values.filter(Number.isFinite);
  return {
    n: finite.length,
    median: rounded(quantile(finite, 0.5)),
    min: rounded(quantile(finite, 0)),
    max: rounded(quantile(finite, 1)),
    p95: rounded(quantile(finite, 0.95)),
  };
};
const randomFromSeed = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};
const pairedBootstrap = (aRecords, bRecords, field, key) => {
  const aByRound = new Map(aRecords.map((record) => [record.round, record]));
  const bByRound = new Map(bRecords.map((record) => [record.round, record]));
  const rounds = [...new Set([...aByRound.keys(), ...bByRound.keys()])].sort((a, b) => a - b);
  const paired = rounds
    .map((round) => ({ round, a: aByRound.get(round), b: bByRound.get(round) }))
    .filter(({ a, b }) => a?.passed && b?.passed && Number.isFinite(a[field]) && Number.isFinite(b[field]));
  const aValues = paired.map(({ a }) => a[field]);
  const bValues = paired.map(({ b }) => b[field]);
  const seed = createHash('sha256').update(`${bootstrapSeed}/${key}/${field}`).digest().readUInt32LE(0);
  const random = randomFromSeed(seed);
  const distribution = [];
  if (paired.length > 1) {
    for (let iteration = 0; iteration < bootstrapIterations; iteration += 1) {
      const sampledA = [];
      const sampledB = [];
      for (let index = 0; index < paired.length; index += 1) {
        const pair = paired[Math.floor(random() * paired.length)];
        sampledA.push(pair.a[field]);
        sampledB.push(pair.b[field]);
      }
      distribution.push(quantile(sampledA, 0.5) - quantile(sampledB, 0.5));
    }
  }
  const aMedian = quantile(aValues, 0.5);
  const bMedian = quantile(bValues, 0.5);
  return {
    n: paired.length,
    expectedRounds: environment.samples,
    pairedRounds: paired.map(({ round }) => round),
    excludedOrMissingRounds: Math.max(0, environment.samples - paired.length),
    medianA: rounded(aMedian),
    medianB: rounded(bMedian),
    medianDifference: aMedian === null || bMedian === null ? null : rounded(aMedian - bMedian),
    confidenceInterval95: [rounded(quantile(distribution, 0.025)), rounded(quantile(distribution, 0.975))],
    bootstrapIterations: distribution.length,
    seed,
  };
};
const groups = [];
for (const cpuRate of [1, 4]) {
  for (const transport of ['identity', 'gzip']) {
    const selected = observations.filter(
      (record) => !record.traced && record.cpuRate === cpuRate && record.transport === transport,
    );
    const byVariant = (id) => selected.filter((record) => record.variant === id);
    groups.push({
      cpuRate,
      transport,
      variants: variants.map(({ id }) => {
        const records = byVariant(id);
        const passed = records.filter((record) => record.passed);
        return {
          variant: id,
          expected: environment.samples,
          total: records.length,
          passed: passed.length,
          failed: records.length - passed.length,
          ...Object.fromEntries(
            [
              ...measuredFields,
              'requestAndResponseMs',
              'responseEndToOnloadMs',
              'v8CompileDurationMs',
              'heapDeltaBytes',
            ].map((field) => [field, describe(passed.map((record) => record[field]))]),
          ),
        };
      }),
      comparisons: comparisons.map(([label, a, b]) => ({
        label,
        a,
        b,
        diagnosticOnly: a.includes('skipped') || b.includes('skipped'),
        ...Object.fromEntries(
          measuredFields.map((field) => [
            field,
            pairedBootstrap(byVariant(a), byVariant(b), field, `${cpuRate}/${transport}/${label}`),
          ]),
        ),
      })),
    });
  }
}

const hasExactUrl = (event, url) =>
  event.args?.data?.url === url || event.args?.url === url || event.args?.fileName === url;
const containedBy = (event, parent) =>
  event !== parent &&
  event.pid === parent.pid &&
  event.tid === parent.tid &&
  event.ts >= parent.ts &&
  event.ts + (event.dur || 0) <= parent.ts + parent.dur;
const traceRecords = [];
const traceKeys = new Set();
for (const item of traceSummaries) {
  const identity = {
    variant: item.variant,
    transport: item.transport,
    round: item.round,
    cpuRate: 1,
    traced: true,
  };
  const key = recordKey(identity);
  if (traceKeys.has(key)) {
    throw new Error(`Duplicate trace summary: ${key}`);
  }
  traceKeys.add(key);
  const record = uniqueRecords.get(key);
  if (!record) {
    throw new Error(`Trace summary has no matching observation: ${key}`);
  }
  if (!item.passed || !record.passed || item.trace?.dataLossOccurred || !item.trace?.file) {
    warnings.push(`Excluded failed, incomplete or data-loss trace: ${key}`);
    continue;
  }
  const events = JSON.parse(await readSource(item.trace.file)).traceEvents;
  if (!Array.isArray(events)) {
    throw new Error(`Missing traceEvents in ${item.trace.file}`);
  }
  const url = record.resource?.name;
  if (!url || url !== item.trace.sourceUrl) {
    throw new Error(`Trace URL disagrees with observation: ${key}`);
  }
  const exact = events.filter((event) => hasExactUrl(event, url));
  const uniqueComplete = (name) => {
    const matching = exact.filter((event) => event.name === name && event.ph === 'X' && Number.isFinite(event.dur));
    if (matching.length !== 1) {
      warnings.push(`${key}: ${name} has ${matching.length} complete exact-URL events; timing is null`);
      return null;
    }
    return matching[0];
  };
  const background = uniqueComplete('v8.parseOnBackground');
  const evaluate = uniqueComplete('EvaluateScript');
  const compile = uniqueComplete('v8.compile');
  const send = exact.find((event) => event.name === 'ResourceSendRequest');
  const finish = send
    ? events.find(
        (event) => event.name === 'ResourceFinish' && event.args?.data?.requestId === send.args?.data?.requestId,
      )
    : undefined;
  const networkFinishUs = Number.isFinite(finish?.args?.data?.finishTime) ? finish.args.data.finishTime * 1e6 : null;
  const onloads = events.filter(
    (event) =>
      evaluate &&
      event.pid === evaluate.pid &&
      event.tid === evaluate.tid &&
      event.ts >= evaluate.ts + evaluate.dur &&
      event.name === 'FunctionCall' &&
      event.args?.data?.functionName === 'script.onload',
  );
  const onload = onloads.length === 1 ? onloads[0] : null;
  const nested = (parent, name) => {
    if (!parent) {
      return { count: null, completeCount: null, completeDurationSumMs: null };
    }
    const matching = events.filter((event) => event.name === name && containedBy(event, parent));
    const complete = matching.filter((event) => event.ph === 'X' && Number.isFinite(event.dur));
    return {
      count: matching.length,
      completeCount: complete.length,
      completeDurationSumMs: rounded(complete.reduce((sum, event) => sum + event.dur / 1000, 0)),
    };
  };
  traceRecords.push({
    ...identity,
    file: item.trace.file,
    exactUrlDurationsMs: {
      backgroundParseCompile: background ? background.dur / 1000 : null,
      evaluateScript: evaluate ? evaluate.dur / 1000 : null,
      mainCompile: compile ? compile.dur / 1000 : null,
    },
    phaseTimingsMs: {
      backgroundStartsAfterNetworkFinish:
        background && networkFinishUs !== null ? (background.ts - networkFinishUs) / 1000 : null,
      backgroundEndsAfterNetworkFinish:
        background && networkFinishUs !== null ? (background.ts + background.dur - networkFinishUs) / 1000 : null,
      backgroundEndToEvaluateStart:
        background && evaluate ? (evaluate.ts - background.ts - background.dur) / 1000 : null,
      evaluateEndToOnloadFunctionStart: evaluate && onload ? (onload.ts - evaluate.ts - evaluate.dur) / 1000 : null,
      networkFinishToOnloadFunctionStart:
        networkFinishUs !== null && onload ? (onload.ts - networkFinishUs) / 1000 : null,
      resourceFinishNotificationDelay: networkFinishUs !== null ? (finish.ts - networkFinishUs) / 1000 : null,
    },
    relationships: {
      networkFinishedBeforeBackground: networkFinishUs !== null && background ? networkFinishUs <= background.ts : null,
      backgroundFinishedBeforeEvaluate: background && evaluate ? background.ts + background.dur <= evaluate.ts : null,
      backgroundOnOtherThread:
        background && evaluate ? background.pid === evaluate.pid && background.tid !== evaluate.tid : null,
      mainCompileInsideEvaluate: compile && evaluate ? containedBy(compile, evaluate) : null,
      streamed: typeof compile?.args?.data?.streamed === 'boolean' ? compile.args.data.streamed : null,
    },
    nestedBackgroundPreParse: nested(background, 'V8.PreParse'),
    nestedEvaluateCompileCode: nested(evaluate, 'V8.CompileCode'),
  });
}
const traceGroups = [];
for (const transport of ['identity', 'gzip']) {
  for (const { id } of variants) {
    const records = traceRecords.filter((record) => record.transport === transport && record.variant === id);
    const describeFields = (field, names) =>
      Object.fromEntries(names.map((name) => [name, describe(records.map((record) => record[field][name]))]));
    traceGroups.push({
      cpuRate: 1,
      transport,
      variant: id,
      expected: environment.traceSamples,
      included: records.length,
      exactUrlDurationsMs: describeFields('exactUrlDurationsMs', [
        'backgroundParseCompile',
        'evaluateScript',
        'mainCompile',
      ]),
      phaseTimingsMs: describeFields('phaseTimingsMs', [
        'backgroundStartsAfterNetworkFinish',
        'backgroundEndsAfterNetworkFinish',
        'backgroundEndToEvaluateStart',
        'evaluateEndToOnloadFunctionStart',
        'networkFinishToOnloadFunctionStart',
        'resourceFinishNotificationDelay',
      ]),
      relationships: Object.fromEntries(
        [
          'networkFinishedBeforeBackground',
          'backgroundFinishedBeforeEvaluate',
          'backgroundOnOtherThread',
          'mainCompileInsideEvaluate',
          'streamed',
        ].map((name) => [
          name,
          {
            true: records.filter((record) => record.relationships[name] === true).length,
            false: records.filter((record) => record.relationships[name] === false).length,
            unknown: records.filter((record) => record.relationships[name] === null).length,
          },
        ]),
      ),
      nestedBackgroundPreParse: describeFields('nestedBackgroundPreParse', [
        'count',
        'completeCount',
        'completeDurationSumMs',
      ]),
      nestedEvaluateCompileCode: describeFields('nestedEvaluateCompileCode', [
        'count',
        'completeCount',
        'completeDurationSumMs',
      ]),
    });
  }
}
const validation = {
  expectedNormalObservations: variants.length * 2 * 2 * environment.samples,
  normalObservations: observations.filter((record) => !record.traced).length,
  expectedTraceObservations: variants.length * 2 * environment.traceSamples,
  traceObservations: observations.filter((record) => record.traced).length,
  failedObservations: observations.filter((record) => !record.passed).map(recordKey),
  missingNormalGroups: groups.flatMap((group) =>
    group.variants
      .filter((variant) => variant.total !== environment.samples)
      .map((variant) => `${group.cpuRate}/${group.transport}/${variant.variant}: ${variant.total}`),
  ),
  missingTraceGroups: traceGroups
    .filter((group) => group.included !== environment.traceSamples)
    .map((group) => `${group.cpuRate}/${group.transport}/${group.variant}: ${group.included}`),
};
const limitations = [
  'Skipped entry, cache and all-initializer variants are deliberately functionally incomplete diagnostics, not usable production optimizations. Export shape checks do not validate core behavior.',
  'All-initializer skipping changes entry execution and may change V8 eager/lazy preparation decisions; its result cannot be interpreted as initialization runtime alone.',
  'Padding is a comment-byte control, not equivalent JavaScript syntax or equivalent gzip size. Its effect does not establish a cost per source byte.',
  'Differences use median(A) minus median(B) over the same included rounds. The percentile 95% bootstrap interval resamples paired rounds, 5000 times with a fixed derived seed. It describes within-run sampling uncertainty only; no significance conclusion is made.',
  'Trace observations are excluded from normal timings. Tracing overhead varies with event counts; trace phases cannot be added to or subtracted from non-trace medians as exact causal shares.',
  'Background parse spans include preparsing and compilation. Main compile and nested CompileCode can be inside EvaluateScript. These inclusive or nested metrics must not be summed.',
  'Only unique complete exact-URL parent events are timed. Unlabelled PreParse and CompileCode events are scoped by same-thread parent containment, not attributed to source functions; instant events count but have no invented duration.',
  'ResourceFinish.ts is a delayed renderer notification. Network finish uses args.data.finishTime in seconds, converted to trace microseconds. Temporal order supports a possible preparation gate, without proving its counterfactual share.',
  'Localhost identity/gzip transfers have no artificial network throttling. CPU 4x is CDP emulation, not an actual device; background V8 work must not be assumed to scale uniformly with it.',
  'Each sample has a fresh context and disabled HTTP cache; the browser process is reused and internal compilation caches are not explicitly purged. This does not guarantee a cold process.',
  'CDP ScriptDuration covers the measurement interval including common instrumentation, not just named core functions. Missing or failed pairs are excluded and their counts remain visible.',
];
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  kind: 'offline paired causal-diagnostic summary',
  sourceStartedAt: environment.startedAt,
  sourceManifestSha256: environment.manifestSha256,
  environment: {
    browser: environment.browser,
    node: environment.node,
    cpu: environment.cpu,
    platform: environment.platform,
    loadAverage: environment.loadAverage,
    method: environment.method,
  },
  variants: variants.map(({ id, framework, rawBytes, gzipBytes, sha256 }) => ({
    id,
    framework,
    rawBytes,
    gzipBytes,
    sha256,
    diagnosticOnly: id.includes('skipped'),
  })),
  estimator: {
    statistic: 'median(A) - median(B), from matched passing finite same-round observations',
    resampling: 'paired rounds with replacement; same sampled indices for A and B',
    confidenceInterval: 'percentile 95%, linear interpolation quantiles',
    bootstrapIterations,
    bootstrapSeed,
    derivedSeed: 'first UInt32LE of SHA-256(baseSeed/cpuRate/transport/comparison/field)',
    units: 'milliseconds unless a field explicitly says bytes or count',
  },
  validation,
  groups,
  traceGroups,
  traceSamples: traceRecords,
  warnings,
  limitations,
  manifestLimitations: environment.manifest.limitations,
  sources: sources.sort((a, b) => a.file.localeCompare(b.file)),
};
const format = (value) => (Number.isFinite(value) ? value.toFixed(3) : '—');
const range = (summary) => `${format(summary.median)} [${format(summary.min)}, ${format(summary.max)}], n=${summary.n}`;
const ci = (summary) => `${format(summary.medianDifference)} [${summary.confidenceInterval95.map(format).join(', ')}]`;
const markdown = [
  '# 核心加载因果诊断汇总',
  '',
  `采样开始：${environment.startedAt}。普通观测 ${validation.normalObservations}/${validation.expectedNormalObservations}；trace 观测 ${validation.traceObservations}/${validation.expectedTraceObservations}；失败 ${validation.failedObservations.length}。`,
  '',
  '**entry/cache/all-init 跳过组是功能不完整的诊断构建，不是可用优化方案。**',
  '',
  '差值为同 round 有效配对上的 median(A) − median(B)，正值表示 A 的该指标更大。方括号为配对 bootstrap 的 95% 百分位区间，5000 次、固定种子。区间仅描述本轮采样不确定性，不作显著性结论；不同指标不可相加。',
  '',
  '## 构建大小',
  '',
  '| 变体 | raw B | gzip B | 用途 |',
  '|---|---:|---:|---|',
  ...result.variants.map(
    (variant) =>
      `| ${variant.id} | ${variant.rawBytes} | ${variant.gzipBytes} | ${variant.diagnosticOnly ? '不完整诊断' : variant.id.endsWith('padded') ? '注释字节对照' : '基线'} |`,
  ),
];
for (const group of groups) {
  markdown.push(
    '',
    `## CPU ${group.cpuRate}x / ${group.transport}`,
    '',
    '| 变体 | 有效/总计/预期 | 总加载中位 ms | ScriptDuration 中位 ms | 请求至响应结束中位 ms | 响应结束至 onload 中位 ms |',
    '|---|---:|---:|---:|---:|---:|',
    ...group.variants.map(
      (variant) =>
        `| ${variant.variant} | ${variant.passed}/${variant.total}/${variant.expected} | ${format(variant.totalLoadMs.median)} | ${format(variant.scriptDurationMs.median)} | ${format(variant.requestAndResponseMs.median)} | ${format(variant.responseEndToOnloadMs.median)} |`,
    ),
    '',
    '| 对照 A − B | 配对 n：总加载/ScriptDuration | 总加载差值 ms [95% CI] | ScriptDuration 差值 ms [95% CI] |',
    '|---|---:|---:|---:|',
    ...group.comparisons.map(
      (comparison) =>
        `| ${comparison.label} | ${comparison.totalLoadMs.n}/${comparison.scriptDurationMs.n} | ${ci(comparison.totalLoadMs)} | ${ci(comparison.scriptDurationMs)} |`,
    ),
  );
}
markdown.push(
  '',
  '## Trace 诊断（仅 CPU 1x，独立于普通计时样本）',
  '',
  '以下为中位数 [最小值, 最大值]。后台 parse 包含编译/预解析；main compile 内嵌于 EvaluateScript。各层不能求和。',
  '',
  '| 传输 / 变体 | 后台 parse/compile ms | EvaluateScript ms | main compile ms | 后台 PreParse 次数中位 | Evaluate 内 CompileCode 次数中位 |',
  '|---|---:|---:|---:|---:|---:|',
  ...traceGroups.map(
    (group) =>
      `| ${group.transport} / ${group.variant} | ${range(group.exactUrlDurationsMs.backgroundParseCompile)} | ${range(group.exactUrlDurationsMs.evaluateScript)} | ${range(group.exactUrlDurationsMs.mainCompile)} | ${format(group.nestedBackgroundPreParse.count.median)} | ${format(group.nestedEvaluateCompileCode.count.median)} |`,
  ),
  '',
  '### 时序检查',
  '',
  '计数列为 true / false / unknown。缺失后台事件保持 unknown；不能据此断言“没有编译成本”。Network finish 来自 finishTime，不能用 ResourceFinish 通知的 ts 代替。',
  '',
  '| 传输 / 变体 | 网络结束早于后台开始 | 后台结束早于 Evaluate | 后台结束到 Evaluate ms |',
  '|---|---:|---:|---:|',
  ...traceGroups.map((group) => {
    const counts = (name) => {
      const value = group.relationships[name];
      return `${value.true}/${value.false}/${value.unknown}`;
    };
    return `| ${group.transport} / ${group.variant} | ${counts('networkFinishedBeforeBackground')} | ${counts('backgroundFinishedBeforeEvaluate')} | ${range(group.phaseTimingsMs.backgroundEndToEvaluateStart)} |`;
  }),
  '',
  '## 边界与完整性',
  '',
  ...limitations.map((limitation) => `- ${limitation}`),
  '',
  `缺失普通分组：${validation.missingNormalGroups.length}；缺失 trace 分组：${validation.missingTraceGroups.length}；分析警告：${warnings.length}。具体来源 SHA、每次 trace 的精简诊断和排除记录见 causal-summary.json。`,
);
if (warnings.length || validation.failedObservations.length) {
  markdown.push('', ...warnings.map((warning) => `- ${warning}`));
}
await writeFile(path.join(directory, 'causal-summary.json'), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(path.join(directory, 'CAUSAL_SUMMARY.md'), `${markdown.join('\n')}\n`);
console.log(
  JSON.stringify({
    output: directory,
    validation,
    warnings: warnings.length,
    comparisons: groups.length * comparisons.length,
  }),
);
