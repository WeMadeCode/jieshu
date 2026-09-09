# Wujie / Jieshu 对比统计

自动生成于 2026-09-09T14:09:07.205Z。完整环境、统计值及失败现场见 [summary.json](./summary.json)。

| 框架 | commit | 版本 | core 原始 / gzip（字节） |
| --- | --- | --- | --- |
| wujie | c45932998c0602f34454df8d3e29f4d33a38446a | 2.1.0 | 65660 / 19802 |
| jieshu | bc688b28ff17b5d9fdad71ea2373885c5a953d1d | 0.0.5 | 108581 / 32708 |

环境：darwin arm64，Apple M1 Pro，Chromium 151.0.7922.34，Node v26.7.0。

## 启动

耗时单位 ms；单元格为中位数 / P95（有效 N）。仅统计成功且非预热的样本，失败另列；成功耗时不能掩盖失败。P95 用线性插值。每个样本使用独立 context，按轮次交错框架顺序。

观测文件中排除预热记录 0 条，其中失败 0 条；运行器可能不写入成功预热记录，此计数不代表实际预热总数。

| 场景 | 框架 | 成功 / 失败 | apiMs | readyMs | coreLoadMs | preparationMs |
| --- | --- | --- | --- | --- | --- | --- |

readyMs 相对差 = (Jieshu 中位数 / Wujie 中位数 − 1) × 100%；负值表示本次 Jieshu 的成功样本中位耗时更低。区间统计量为 median(J) − median(W)，不是逐对差值的中位数。

Bootstrap 5000 次，固定 seed=20260909，95% percentile 区间，不作多重比较校正。主结果独立重采样；配对结果按同一输入目录和 round 整对重采样，仅纳入双方成功的完整轮次。少于 2 个有效样本/配对时不估计区间；单次运行中的上下文独立并不消除机器负载的时间相关性。

| 场景 | ready 中位数相对差 | 中位耗时差 J−W（ms） | 独立 bootstrap 95% 区间（ms） | 配对 N | 配对 bootstrap 95% 区间（ms） |
| --- | --- | --- | --- | --- | --- |

coreLoadMs 独立于 start 调用计时；preparationMs 是重建、保活或预加载所需的前置准备。预加载进入耗时不包括这部分成本。ready 指夹具完成渲染后的帧边界，不等同于所有真实业务资源或用户可交互指标。

## 内存

| 框架 | 成功轮数 | 失败轮数 |
| --- | --- | --- |
| wujie | 0 | 0 |
| jieshu | 0 | 0 |

下面均为同阶段/周期跨成功轮次的中位数，强制 GC 后采样；1 MiB = 1,048,576 字节。JS heap、Documents、Nodes 和监听器计数来自页面 CDP 指标，不是浏览器总内存或 RSS。Δcore 为每轮先减去该轮 core 堆占用，再取中位数。

| 阶段 / 周期 | 框架 | 堆 N | JS heap（MiB） | Δcore（MiB） | Documents | Nodes | JSEventListeners |
| --- | --- | --- | --- | --- | --- | --- | --- |

cache-cleared / final-cleanup 是即时清理后快照；cache-cleared-settled-5.5s / final-settled-5.5s 额外等待 5.5 秒，必须分别解读。same-assets 与 unique-assets 在同轮依次执行，后者不是独立空白基线。缓存保留、延迟清理及单段增长都不能直接证明泄漏；完整序列保存在原始观测中。

## 稳定性

分母为实际执行次数；成功率仅适用于本次场景、浏览器与夹具，不能推出所有场景更稳定。robustness-observation 表示压力/竞态观察，需结合各框架公开契约判断，不能直接等同于承诺行为回归。

| 场景 | 契约类别 | Wujie 通过 / 总数 | Jieshu 通过 / 总数 |
| --- | --- | --- | --- |
| mount-interaction-lifecycle | shared-public-behavior | 3 / 3 | 3 / 3 |
| props-and-event-bus | shared-public-behavior | 3 / 3 | 3 / 3 |
| javascript-global-isolation | shared-public-behavior | 3 / 3 | 3 / 3 |
| stylesheet-isolation | shared-public-behavior | 3 / 3 | 3 / 3 |
| two-apps-independent-state | shared-public-behavior | 3 / 3 | 3 / 3 |
| destroy-and-recreate | shared-public-behavior | 3 / 3 | 3 / 3 |
| keep-alive-switch | shared-public-behavior | 3 / 3 | 3 / 3 |
| route-sync-disabled | shared-public-behavior | 3 / 3 | 3 / 3 |
| route-sync-enabled | shared-public-behavior | 3 / 3 | 3 / 3 |
| async-unmount-completion | shared-public-behavior | 3 / 3 | 3 / 3 |
| start-destroy-race | robustness-observation | 0 / 3 | 3 / 3 |
| same-name-concurrent-containers | robustness-observation | 0 / 3 | 3 / 3 |
| preload-execute-then-activate | shared-public-behavior | 3 / 3 | 3 / 3 |
| dynamic-script-and-stylesheet | shared-public-behavior | 3 / 3 | 3 / 3 |
| missing-script-error-and-recovery | shared-public-behavior | 3 / 3 | 3 / 3 |
| fiber-enabled-interaction | shared-public-behavior | 3 / 3 | 3 / 3 |

## 失败记录

| 类别 | 框架 | 场景 | round | 错误 | 原始位置 |
| --- | --- | --- | --- | --- | --- |
| stability | wujie | start-destroy-race | 0 | Unexpected startup rejection during cancellation. | ./observations.jsonl:21 |
| stability | wujie | same-name-concurrent-containers | 0 | Unexpected startup rejection in the superseded request. | ./observations.jsonl:23 |
| stability | wujie | start-destroy-race | 1 | Unexpected startup rejection during cancellation. | ./observations.jsonl:54 |
| stability | wujie | same-name-concurrent-containers | 1 | Unexpected startup rejection in the superseded request. | ./observations.jsonl:56 |
| stability | wujie | start-destroy-race | 2 | Unexpected startup rejection during cancellation. | ./observations.jsonl:85 |
| stability | wujie | same-name-concurrent-containers | 2 | Unexpected startup rejection in the superseded request. | ./observations.jsonl:87 |

各条失败的 error、details、pageErrors、diagnostics 原样保存在 summary.json 的 failures 中；不能仅凭失败信息省略对夹具、API 契约和复现条件的排查。

## 范围与复现

本报告不将不同场景合并成单一性能排名。结果限于本地跨端口 HTTP、合成 core 负载和本次 Headless Chromium；不覆盖公网、其他浏览器、移动端、适配包或长期业务稳定性。桌面后台负载未受控。

输入目录：

- /Users/zhouxiang/Documents/Github/jieshu/test-results/instanceof-stability
