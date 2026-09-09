# 核心加载因果诊断汇总

采样开始：2026-09-09T14:29:18.374Z。普通观测 980/980；trace 观测 98/98；失败 0。

**entry/cache/all-init 跳过组是功能不完整的诊断构建，不是可用优化方案。**

差值为同 round 有效配对上的 median(A) − median(B)，正值表示 A 的该指标更大。方括号为配对 bootstrap 的 95% 百分位区间，5000 次、固定种子。区间仅描述本轮采样不确定性，不作显著性结论；不同指标不可相加。

## 构建大小

| 变体 | raw B | gzip B | 用途 |
|---|---:|---:|---|
| wujie | 65660 | 19802 | 基线 |
| jieshu | 108581 | 32708 | 基线 |
| wujie-padded | 108581 | 20112 | 注释字节对照 |
| jieshu-entry-skipped | 108599 | 32715 | 不完整诊断 |
| jieshu-caches-skipped | 108602 | 32716 | 不完整诊断 |
| wujie-init-skipped | 65667 | 19807 | 不完整诊断 |
| jieshu-init-skipped | 108588 | 32713 | 不完整诊断 |

## CPU 1x / identity

| 变体 | 有效/总计/预期 | 总加载中位 ms | ScriptDuration 中位 ms | 请求至响应结束中位 ms | 响应结束至 onload 中位 ms |
|---|---:|---:|---:|---:|---:|
| wujie | 35/35/35 | 3.700 | 0.312 | 1.100 | 2.000 |
| jieshu | 35/35/35 | 4.900 | 0.561 | 1.100 | 3.100 |
| wujie-padded | 35/35/35 | 3.700 | 0.309 | 1.100 | 2.000 |
| jieshu-entry-skipped | 35/35/35 | 4.700 | 0.500 | 1.100 | 3.000 |
| jieshu-caches-skipped | 35/35/35 | 4.700 | 0.483 | 1.100 | 3.000 |
| wujie-init-skipped | 35/35/35 | 3.300 | 0.029 | 1.100 | 1.600 |
| jieshu-init-skipped | 35/35/35 | 4.100 | 0.036 | 1.100 | 2.400 |

| 对照 A − B | 配对 n：总加载/ScriptDuration | 总加载差值 ms [95% CI] | ScriptDuration 差值 ms [95% CI] |
|---|---:|---:|---:|
| J-W | 35/35 | 1.200 [1.100, 1.300] | 0.249 [0.222, 0.281] |
| Wpadded-W | 35/35 | 0.000 [-0.100, 0.100] | -0.003 [-0.028, 0.028] |
| Jentryskip-J | 35/35 | -0.200 [-0.300, -0.100] | -0.061 [-0.118, -0.035] |
| Jcacheskip-J | 35/35 | -0.200 [-0.300, -0.100] | -0.078 [-0.114, -0.032] |
| Jinitskip-Winitskip | 35/35 | 0.800 [0.700, 1.000] | 0.007 [0.002, 0.012] |
| Jinitskip-J | 35/35 | -0.800 [-0.900, -0.700] | -0.525 [-0.556, -0.508] |
| Winitskip-W | 35/35 | -0.400 [-0.500, -0.300] | -0.283 [-0.305, -0.273] |

## CPU 1x / gzip

| 变体 | 有效/总计/预期 | 总加载中位 ms | ScriptDuration 中位 ms | 请求至响应结束中位 ms | 响应结束至 onload 中位 ms |
|---|---:|---:|---:|---:|---:|
| wujie | 35/35/35 | 3.700 | 0.328 | 1.200 | 1.800 |
| jieshu | 35/35/35 | 4.900 | 0.584 | 1.400 | 2.900 |
| wujie-padded | 35/35/35 | 3.800 | 0.340 | 1.300 | 1.900 |
| jieshu-entry-skipped | 35/35/35 | 4.800 | 0.515 | 1.300 | 2.900 |
| jieshu-caches-skipped | 35/35/35 | 4.900 | 0.533 | 1.300 | 2.900 |
| wujie-init-skipped | 35/35/35 | 3.300 | 0.034 | 1.200 | 1.500 |
| jieshu-init-skipped | 35/35/35 | 4.100 | 0.037 | 1.300 | 2.200 |

| 对照 A − B | 配对 n：总加载/ScriptDuration | 总加载差值 ms [95% CI] | ScriptDuration 差值 ms [95% CI] |
|---|---:|---:|---:|
| J-W | 35/35 | 1.200 [1.100, 1.300] | 0.256 [0.227, 0.300] |
| Wpadded-W | 35/35 | 0.100 [-0.100, 0.200] | 0.012 [-0.018, 0.039] |
| Jentryskip-J | 35/35 | -0.100 [-0.200, 0.000] | -0.069 [-0.093, -0.057] |
| Jcacheskip-J | 35/35 | 0.000 [-0.200, 0.000] | -0.051 [-0.083, -0.017] |
| Jinitskip-Winitskip | 35/35 | 0.800 [0.700, 0.900] | 0.003 [0.000, 0.007] |
| Jinitskip-J | 35/35 | -0.800 [-0.900, -0.700] | -0.547 [-0.568, -0.537] |
| Winitskip-W | 35/35 | -0.400 [-0.600, -0.300] | -0.294 [-0.316, -0.272] |

## CPU 4x / identity

| 变体 | 有效/总计/预期 | 总加载中位 ms | ScriptDuration 中位 ms | 请求至响应结束中位 ms | 响应结束至 onload 中位 ms |
|---|---:|---:|---:|---:|---:|
| wujie | 35/35/35 | 8.500 | 1.574 | 1.200 | 4.300 |
| jieshu | 35/35/35 | 10.500 | 2.760 | 1.200 | 6.400 |
| wujie-padded | 35/35/35 | 8.500 | 1.805 | 1.200 | 4.300 |
| jieshu-entry-skipped | 35/35/35 | 10.000 | 2.444 | 1.100 | 5.900 |
| jieshu-caches-skipped | 35/35/35 | 10.500 | 2.626 | 1.300 | 6.200 |
| wujie-init-skipped | 35/35/35 | 6.800 | 0.041 | 1.200 | 2.600 |
| jieshu-init-skipped | 35/35/35 | 7.600 | 0.044 | 1.300 | 3.700 |

| 对照 A − B | 配对 n：总加载/ScriptDuration | 总加载差值 ms [95% CI] | ScriptDuration 差值 ms [95% CI] |
|---|---:|---:|---:|
| J-W | 35/35 | 2.000 [1.600, 2.400] | 1.186 [1.046, 1.373] |
| Wpadded-W | 35/35 | 0.000 [-0.400, 0.400] | 0.231 [-0.023, 0.465] |
| Jentryskip-J | 35/35 | -0.500 [-0.800, 0.000] | -0.316 [-0.501, -0.163] |
| Jcacheskip-J | 35/35 | 0.000 [-0.500, 0.300] | -0.134 [-0.324, 0.030] |
| Jinitskip-Winitskip | 35/35 | 0.800 [0.600, 1.200] | 0.003 [-0.084, 0.008] |
| Jinitskip-J | 35/35 | -2.900 [-3.100, -2.400] | -2.716 [-2.877, -2.606] |
| Winitskip-W | 35/35 | -1.700 [-2.100, -1.200] | -1.533 [-1.661, -1.399] |

## CPU 4x / gzip

| 变体 | 有效/总计/预期 | 总加载中位 ms | ScriptDuration 中位 ms | 请求至响应结束中位 ms | 响应结束至 onload 中位 ms |
|---|---:|---:|---:|---:|---:|
| wujie | 35/35/35 | 8.400 | 1.584 | 1.300 | 4.200 |
| jieshu | 35/35/35 | 10.600 | 2.860 | 1.400 | 6.300 |
| wujie-padded | 35/35/35 | 8.500 | 1.629 | 1.200 | 4.300 |
| jieshu-entry-skipped | 35/35/35 | 10.200 | 2.354 | 1.800 | 5.800 |
| jieshu-caches-skipped | 35/35/35 | 10.300 | 2.484 | 1.500 | 6.000 |
| wujie-init-skipped | 35/35/35 | 6.800 | 0.043 | 1.200 | 2.600 |
| jieshu-init-skipped | 35/35/35 | 7.900 | 0.045 | 1.500 | 3.500 |

| 对照 A − B | 配对 n：总加载/ScriptDuration | 总加载差值 ms [95% CI] | ScriptDuration 差值 ms [95% CI] |
|---|---:|---:|---:|
| J-W | 35/35 | 2.200 [1.800, 2.700] | 1.276 [0.972, 1.458] |
| Wpadded-W | 35/35 | 0.100 [-0.200, 0.500] | 0.045 [-0.262, 0.309] |
| Jentryskip-J | 35/35 | -0.400 [-0.800, -0.100] | -0.506 [-0.637, -0.259] |
| Jcacheskip-J | 35/35 | -0.300 [-0.700, 0.000] | -0.376 [-0.519, -0.175] |
| Jinitskip-Winitskip | 35/35 | 1.100 [0.700, 1.300] | 0.002 [-0.016, 0.018] |
| Jinitskip-J | 35/35 | -2.700 [-3.200, -2.500] | -2.815 [-2.929, -2.611] |
| Winitskip-W | 35/35 | -1.600 [-2.000, -1.100] | -1.541 [-1.786, -1.390] |

## Trace 诊断（仅 CPU 1x，独立于普通计时样本）

以下为中位数 [最小值, 最大值]。后台 parse 包含编译/预解析；main compile 内嵌于 EvaluateScript。各层不能求和。

| 传输 / 变体 | 后台 parse/compile ms | EvaluateScript ms | main compile ms | 后台 PreParse 次数中位 | Evaluate 内 CompileCode 次数中位 |
|---|---:|---:|---:|---:|---:|
| identity / wujie | 1.269 [1.182, 1.396], n=7 | 0.391 [0.343, 0.423], n=7 | 0.024 [0.018, 0.029], n=7 | 155.000 | 4.000 |
| identity / jieshu | 2.197 [2.108, 2.578], n=7 | 0.667 [0.555, 0.721], n=7 | 0.023 [0.021, 0.024], n=7 | 346.000 | 16.000 |
| identity / wujie-padded | 1.267 [1.245, 1.442], n=7 | 0.411 [0.376, 0.420], n=7 | 0.023 [0.021, 0.029], n=7 | 155.000 | 4.000 |
| identity / jieshu-entry-skipped | 2.184 [2.130, 2.437], n=7 | 0.574 [0.478, 0.646], n=7 | 0.023 [0.020, 0.028], n=7 | 346.000 | 14.000 |
| identity / jieshu-caches-skipped | 2.172 [2.105, 2.520], n=7 | 0.561 [0.480, 0.600], n=7 | 0.021 [0.017, 0.030], n=7 | 346.000 | 15.000 |
| identity / wujie-init-skipped | 1.192 [1.138, 1.300], n=7 | 0.057 [0.053, 0.076], n=7 | 0.023 [0.019, 0.027], n=7 | 155.000 | 0.000 |
| identity / jieshu-init-skipped | 2.022 [1.980, 2.402], n=7 | 0.059 [0.054, 0.065], n=7 | 0.023 [0.020, 0.024], n=7 | 346.000 | 0.000 |
| gzip / wujie | 1.297 [1.245, 1.372], n=7 | 0.393 [0.351, 0.441], n=7 | 0.022 [0.020, 0.035], n=7 | 155.000 | 4.000 |
| gzip / jieshu | 2.218 [2.112, 2.301], n=7 | 0.566 [0.520, 0.667], n=7 | 0.019 [0.017, 0.023], n=7 | 346.000 | 16.000 |
| gzip / wujie-padded | 1.332 [1.288, 1.559], n=7 | 0.421 [0.318, 0.431], n=7 | 0.024 [0.017, 0.027], n=7 | 155.000 | 4.000 |
| gzip / jieshu-entry-skipped | 2.181 [2.157, 2.557], n=7 | 0.499 [0.486, 0.579], n=7 | 0.021 [0.018, 0.023], n=7 | 346.000 | 14.000 |
| gzip / jieshu-caches-skipped | 2.341 [2.202, 2.453], n=7 | 0.489 [0.466, 0.578], n=7 | 0.018 [0.016, 0.025], n=7 | 346.000 | 15.000 |
| gzip / wujie-init-skipped | 1.254 [1.129, 1.401], n=7 | 0.060 [0.054, 0.078], n=7 | 0.021 [0.019, 0.024], n=7 | 155.000 | 0.000 |
| gzip / jieshu-init-skipped | 2.096 [1.996, 2.220], n=7 | 0.056 [0.045, 0.094], n=7 | 0.021 [0.016, 0.053], n=7 | 346.000 | 0.000 |

### 时序检查

计数列为 true / false / unknown。缺失后台事件保持 unknown；不能据此断言“没有编译成本”。Network finish 来自 finishTime，不能用 ResourceFinish 通知的 ts 代替。

| 传输 / 变体 | 网络结束早于后台开始 | 后台结束早于 Evaluate | 后台结束到 Evaluate ms |
|---|---:|---:|---:|
| identity / wujie | 7/0/0 | 7/0/0 | 0.242 [0.234, 0.290], n=7 |
| identity / jieshu | 7/0/0 | 7/0/0 | 0.260 [0.241, 0.295], n=7 |
| identity / wujie-padded | 7/0/0 | 7/0/0 | 0.273 [0.241, 0.295], n=7 |
| identity / jieshu-entry-skipped | 7/0/0 | 7/0/0 | 0.254 [0.225, 0.322], n=7 |
| identity / jieshu-caches-skipped | 7/0/0 | 7/0/0 | 0.281 [0.251, 0.338], n=7 |
| identity / wujie-init-skipped | 7/0/0 | 7/0/0 | 0.251 [0.221, 0.273], n=7 |
| identity / jieshu-init-skipped | 7/0/0 | 7/0/0 | 0.262 [0.249, 0.295], n=7 |
| gzip / wujie | 1/6/0 | 7/0/0 | 0.250 [0.215, 0.279], n=7 |
| gzip / jieshu | 0/7/0 | 7/0/0 | 0.277 [0.245, 0.285], n=7 |
| gzip / wujie-padded | 3/4/0 | 7/0/0 | 0.270 [0.208, 0.290], n=7 |
| gzip / jieshu-entry-skipped | 0/7/0 | 7/0/0 | 0.264 [0.254, 0.349], n=7 |
| gzip / jieshu-caches-skipped | 0/7/0 | 7/0/0 | 0.265 [0.254, 0.282], n=7 |
| gzip / wujie-init-skipped | 1/6/0 | 7/0/0 | 0.249 [0.226, 0.299], n=7 |
| gzip / jieshu-init-skipped | 0/7/0 | 7/0/0 | 0.295 [0.255, 0.308], n=7 |

## 边界与完整性

- Skipped entry, cache and all-initializer variants are deliberately functionally incomplete diagnostics, not usable production optimizations. Export shape checks do not validate core behavior.
- All-initializer skipping changes entry execution and may change V8 eager/lazy preparation decisions; its result cannot be interpreted as initialization runtime alone.
- Padding is a comment-byte control, not equivalent JavaScript syntax or equivalent gzip size. Its effect does not establish a cost per source byte.
- Differences use median(A) minus median(B) over the same included rounds. The percentile 95% bootstrap interval resamples paired rounds, 5000 times with a fixed derived seed. It describes within-run sampling uncertainty only; no significance conclusion is made.
- Trace observations are excluded from normal timings. Tracing overhead varies with event counts; trace phases cannot be added to or subtracted from non-trace medians as exact causal shares.
- Background parse spans include preparsing and compilation. Main compile and nested CompileCode can be inside EvaluateScript. These inclusive or nested metrics must not be summed.
- Only unique complete exact-URL parent events are timed. Unlabelled PreParse and CompileCode events are scoped by same-thread parent containment, not attributed to source functions; instant events count but have no invented duration.
- ResourceFinish.ts is a delayed renderer notification. Network finish uses args.data.finishTime in seconds, converted to trace microseconds. Temporal order supports a possible preparation gate, without proving its counterfactual share.
- Localhost identity/gzip transfers have no artificial network throttling. CPU 4x is CDP emulation, not an actual device; background V8 work must not be assumed to scale uniformly with it.
- Each sample has a fresh context and disabled HTTP cache; the browser process is reused and internal compilation caches are not explicitly purged. This does not guarantee a cold process.
- CDP ScriptDuration covers the measurement interval including common instrumentation, not just named core functions. Missing or failed pairs are excluded and their counts remain visible.

缺失普通分组：0；缺失 trace 分组：0；分析警告：0。具体来源 SHA、每次 trace 的精简诊断和排除记录见 causal-summary.json。
