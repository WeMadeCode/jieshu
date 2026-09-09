# 核心加载优化前后对照

有效记录 720/720，失败 0；排除 trace/warmup 42 条。

current 为 jieshu，before 为 jieshu-before。差值为 current − before；正值表示该项增加。耗时单位 ms，heapDeltaBytes 单位 B。方括号为配对 bootstrap 95% 区间，5000 次固定种子；不作显著性结论。

## load / legacy

| 指标 | current 中位/p95 | before 中位/p95 | Wujie 中位/p95 | 配对差值 [95% CI] | 配对 n/预期（排除） |
|---|---:|---:|---:|---:|---:|
| totalLoadMs | 4.400 / 5.200 (n=60) | 4.350 / 5.005 (n=60) | 3.300 / 3.705 (n=60) | 0.050 [-0.100, 0.100] | 60/60 (0) |
| requestAndResponseMs | 1.100 / 1.310 (n=60) | 0.900 / 1.300 (n=60) | 1.000 / 1.105 (n=60) | 0.200 [0.100, 0.200] | 60/60 (0) |
| responseEndToOnloadMs | 2.800 / 3.200 (n=60) | 2.900 / 3.205 (n=60) | 1.800 / 2.000 (n=60) | -0.100 [-0.200, 0.000] | 60/60 (0) |
| scriptDurationMs | 0.451 / 0.528 (n=60) | 0.490 / 0.588 (n=60) | 0.281 / 0.360 (n=60) | -0.039 [-0.052, -0.018] | 60/60 (0) |
| v8CompileDurationMs | 0.013 / 0.018 (n=60) | 0.014 / 0.018 (n=60) | 0.013 / 0.018 (n=60) | -0.001 [-0.002, 0.000] | 60/60 (0) |
| heapDeltaBytes | 216672.000 / 216672.000 (n=60) | 217956.000 / 217956.000 (n=60) | 161808.000 / 161808.000 (n=60) | -1284.000 [-1284.000, -1284.000] | 60/60 (0) |

## load / utf8

| 指标 | current 中位/p95 | before 中位/p95 | Wujie 中位/p95 | 配对差值 [95% CI] | 配对 n/预期（排除） |
|---|---:|---:|---:|---:|---:|
| totalLoadMs | 4.400 / 4.900 (n=60) | 4.200 / 5.000 (n=60) | 3.300 / 4.000 (n=60) | 0.200 [0.100, 0.250] | 60/60 (0) |
| requestAndResponseMs | 1.100 / 1.410 (n=60) | 0.900 / 1.200 (n=60) | 1.000 / 1.500 (n=60) | 0.200 [0.100, 0.200] | 60/60 (0) |
| responseEndToOnloadMs | 2.800 / 3.005 (n=60) | 2.800 / 3.305 (n=60) | 1.750 / 2.105 (n=60) | 0.000 [-0.100, 0.000] | 60/60 (0) |
| scriptDurationMs | 0.451 / 0.539 (n=60) | 0.501 / 0.597 (n=60) | 0.283 / 0.367 (n=60) | -0.051 [-0.070, -0.028] | 60/60 (0) |
| v8CompileDurationMs | 0.013 / 0.020 (n=60) | 0.014 / 0.017 (n=60) | 0.013 / 0.018 (n=60) | -0.001 [-0.001, 0.001] | 60/60 (0) |
| heapDeltaBytes | 216100.000 / 216100.000 (n=60) | 217384.000 / 217384.000 (n=60) | 161244.000 / 161244.000 (n=60) | -1284.000 [-1284.000, -1284.000] | 60/60 (0) |

## startup / cold

| 指标 | current 中位/p95 | before 中位/p95 | Wujie 中位/p95 | 配对差值 [95% CI] | 配对 n/预期（排除） |
|---|---:|---:|---:|---:|---:|
| coreLoadMs | 5.900 / 6.200 (n=30) | 5.800 / 6.100 (n=30) | 4.800 / 4.955 (n=30) | 0.100 [-0.050, 0.100] | 30/30 (0) |
| apiMs | 26.150 / 27.110 (n=30) | 26.100 / 26.800 (n=30) | 26.800 / 27.900 (n=30) | 0.050 [-0.500, 0.450] | 30/30 (0) |
| readyMs | 34.750 / 36.600 (n=30) | 35.000 / 36.500 (n=30) | 36.300 / 37.755 (n=30) | -0.250 [-1.150, 0.600] | 30/30 (0) |
| preparationMs | 0.000 / 0.000 (n=30) | 0.000 / 0.000 (n=30) | 0.000 / 0.000 (n=30) | 0.000 [0.000, 0.000] | 30/30 (0) |

## startup / cold-fiber

| 指标 | current 中位/p95 | before 中位/p95 | Wujie 中位/p95 | 配对差值 [95% CI] | 配对 n/预期（排除） |
|---|---:|---:|---:|---:|---:|
| coreLoadMs | 6.000 / 6.755 (n=30) | 5.900 / 6.655 (n=30) | 4.800 / 5.400 (n=30) | 0.100 [0.000, 0.200] | 30/30 (0) |
| apiMs | 35.200 / 43.320 (n=30) | 34.800 / 45.245 (n=30) | 36.000 / 40.450 (n=30) | 0.400 [-1.100, 2.200] | 30/30 (0) |
| readyMs | 45.100 / 53.475 (n=30) | 45.150 / 54.710 (n=30) | 45.050 / 51.650 (n=30) | -0.050 [-1.550, 1.651] | 30/30 (0) |
| preparationMs | 0.000 / 0.000 (n=30) | 0.000 / 0.000 (n=30) | 0.000 / 0.000 (n=30) | 0.000 [0.000, 0.000] | 30/30 (0) |

## startup / concurrent-5

| 指标 | current 中位/p95 | before 中位/p95 | Wujie 中位/p95 | 配对差值 [95% CI] | 配对 n/预期（排除） |
|---|---:|---:|---:|---:|---:|
| coreLoadMs | 6.100 / 6.200 (n=30) | 5.900 / 6.000 (n=30) | 4.800 / 4.955 (n=30) | 0.200 [0.100, 0.300] | 30/30 (0) |
| apiMs | 57.150 / 58.700 (n=30) | 57.800 / 59.400 (n=30) | 59.400 / 60.200 (n=30) | -0.650 [-1.300, 0.300] | 30/30 (0) |
| readyMs | 71.500 / 74.100 (n=30) | 71.600 / 78.715 (n=30) | 73.150 / 74.555 (n=30) | -0.100 [-1.050, 0.700] | 30/30 (0) |
| preparationMs | 0.000 / 0.000 (n=30) | 0.000 / 0.000 (n=30) | 0.000 / 0.000 (n=30) | 0.000 [0.000, 0.000] | 30/30 (0) |

## startup / cpu4x

| 指标 | current 中位/p95 | before 中位/p95 | Wujie 中位/p95 | 配对差值 [95% CI] | 配对 n/预期（排除） |
|---|---:|---:|---:|---:|---:|
| coreLoadMs | 10.150 / 11.565 (n=30) | 10.100 / 11.275 (n=30) | 8.050 / 9.785 (n=30) | 0.050 [-0.300, 0.450] | 30/30 (0) |
| apiMs | 106.350 / 117.880 (n=30) | 105.600 / 126.190 (n=30) | 110.750 / 136.885 (n=30) | 0.750 [-1.050, 2.250] | 30/30 (0) |
| readyMs | 125.650 / 142.195 (n=30) | 125.550 / 146.685 (n=30) | 131.150 / 159.545 (n=30) | 0.100 [-1.600, 2.000] | 30/30 (0) |
| preparationMs | 0.000 / 0.000 (n=30) | 0.000 / 0.000 (n=30) | 0.000 / 0.000 (n=30) | 0.000 [0.000, 0.000] | 30/30 (0) |

## 内存：GC 后 JS heap，单位 B

按 stage/cycle 列出各组中位数；Δcore 是每轮相对该轮核心加载后堆内存的增量。单轮不计算 CI。

| stage/cycle | current | before | Wujie | current−before | current Δcore | before Δcore | Δcore 差值 |
|---|---:|---:|---:|---:|---:|---:|---:|

## 口径

- Only non-traced, non-warmup records are summarized. Failed observations remain counted and are excluded from metric statistics.
- Bootstrap resamples complete current/before same-round pairs 5000 times with fixed derived seeds. Estimand is median(current) - median(before), not median of per-round differences; percentile 95% CI is within-run uncertainty, not a significance conclusion.
- A missing or failed pair excludes both members from that metric; per-framework median/p95 may use a larger set, while the paired median is shown separately.
- Core load metrics are grouped by encoding, startup metrics by scenario. Metrics are not added; readyMs starts after core loading and fixture installation.
- Memory lists raw stage medians, per-round stage-minus-blank/core medians, and current-minus-before median differences. No memory CI is calculated, including for single-round runs. A lower idle heap alone does not establish lower active-memory cost.
- Duplicate framework/round records are rejected within each kind/group, including across directories. Different bundle identities or runtime environments cannot be pooled.
