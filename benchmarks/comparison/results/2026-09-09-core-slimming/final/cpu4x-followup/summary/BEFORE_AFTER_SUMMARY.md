# 核心加载优化前后对照

有效记录 270/270，失败 0；排除 trace/warmup 0 条。

current 为 jieshu，before 为 jieshu-before。差值为 current − before；正值表示该项增加。耗时单位 ms，heapDeltaBytes 单位 B。方括号为配对 bootstrap 95% 区间，5000 次固定种子；不作显著性结论。

## startup / cpu4x

| 指标 | current 中位/p95 | before 中位/p95 | Wujie 中位/p95 | 配对差值 [95% CI] | 配对 n/预期（排除） |
|---|---:|---:|---:|---:|---:|
| coreLoadMs | 12.000 / 12.800 (n=90) | 12.200 / 13.255 (n=90) | 9.950 / 10.700 (n=90) | -0.200 [-0.500, 0.000] | 90/90 (0) |
| apiMs | 138.100 / 142.500 (n=90) | 138.500 / 142.210 (n=90) | 142.050 / 146.575 (n=90) | -0.400 [-1.000, 0.250] | 90/90 (0) |
| readyMs | 162.750 / 166.755 (n=90) | 162.550 / 166.155 (n=90) | 166.250 / 170.600 (n=90) | 0.200 [-1.050, 1.200] | 90/90 (0) |
| preparationMs | 0.000 / 0.000 (n=90) | 0.000 / 0.000 (n=90) | 0.000 / 0.000 (n=90) | 0.000 [0.000, 0.000] | 90/90 (0) |

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
