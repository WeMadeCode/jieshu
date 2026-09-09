# Wujie / Jieshu 对比统计

自动生成于 2026-09-09T07:23:48.116Z。完整环境、统计值及失败现场见 [summary.json](./summary.json)。

| 框架   | commit                                   | 版本  | core 原始 / gzip（字节） |
| ------ | ---------------------------------------- | ----- | ------------------------ |
| wujie  | c45932998c0602f34454df8d3e29f4d33a38446a | 2.1.0 | 65660 / 19802            |
| jieshu | b0c73aaa944ea8603c6fb13f3126e341b320d2cb | 0.0.5 | 108242 / 32603           |

环境：darwin arm64，Apple M1 Pro，Chromium 151.0.7922.34，Node v26.7.0。

## 启动

耗时单位 ms；单元格为中位数 / P95（有效 N）。仅统计成功且非预热的样本，失败另列；成功耗时不能掩盖失败。P95 用线性插值。每个样本使用独立 context，按轮次交错框架顺序。

观测文件中排除预热记录 0 条，其中失败 0 条；运行器可能不写入成功预热记录，此计数不代表实际预热总数。

| 场景              | 框架   | 成功 / 失败 | apiMs                  | readyMs                | coreLoadMs           | preparationMs        |
| ----------------- | ------ | ----------- | ---------------------- | ---------------------- | -------------------- | -------------------- |
| cold              | wujie  | 30 / 0      | 27.20 / 30.20 (n=30)   | 37.25 / 40.45 (n=30)   | 5.40 / 5.70 (n=30)   | 0.00 / 0.00 (n=30)   |
| cold              | jieshu | 30 / 0      | 27.45 / 30.64 (n=30)   | 36.60 / 39.54 (n=30)   | 6.50 / 6.80 (n=30)   | 0.00 / 0.00 (n=30)   |
| cold-fiber        | wujie  | 30 / 0      | 43.05 / 51.42 (n=30)   | 53.60 / 61.62 (n=30)   | 5.40 / 5.70 (n=30)   | 0.00 / 0.00 (n=30)   |
| cold-fiber        | jieshu | 30 / 0      | 45.05 / 103.21 (n=30)  | 53.10 / 109.61 (n=30)  | 6.60 / 6.96 (n=30)   | 0.00 / 0.00 (n=30)   |
| warm-rebuild      | wujie  | 30 / 0      | 10.25 / 10.80 (n=30)   | 15.35 / 15.90 (n=30)   | 5.40 / 5.70 (n=30)   | 38.60 / 38.96 (n=30) |
| warm-rebuild      | jieshu | 30 / 0      | 10.90 / 11.91 (n=30)   | 14.80 / 15.61 (n=30)   | 6.60 / 6.86 (n=30)   | 38.30 / 42.23 (n=30) |
| singleton-remount | wujie  | 30 / 0      | 1.90 / 2.05 (n=30)     | 16.75 / 18.10 (n=30)   | 5.35 / 5.50 (n=30)   | 53.50 / 58.26 (n=30) |
| singleton-remount | jieshu | 30 / 0      | 2.05 / 2.20 (n=30)     | 16.75 / 18.01 (n=30)   | 6.50 / 6.85 (n=30)   | 52.50 / 57.82 (n=30) |
| alive-reactivate  | wujie  | 30 / 0      | 0.10 / 0.20 (n=30)     | 16.70 / 17.31 (n=30)   | 4.80 / 5.35 (n=30)   | 53.70 / 56.06 (n=30) |
| alive-reactivate  | jieshu | 30 / 0      | 0.20 / 0.30 (n=30)     | 16.65 / 17.62 (n=30)   | 6.00 / 6.46 (n=30)   | 52.75 / 57.02 (n=30) |
| preloaded-enter   | wujie  | 30 / 0      | 2.10 / 2.20 (n=30)     | 16.50 / 16.66 (n=30)   | 4.70 / 4.90 (n=30)   | 37.65 / 39.90 (n=30) |
| preloaded-enter   | jieshu | 30 / 0      | 2.40 / 2.50 (n=30)     | 16.55 / 16.66 (n=30)   | 5.85 / 6.05 (n=30)   | 36.70 / 38.96 (n=30) |
| concurrent-5      | wujie  | 30 / 0      | 55.50 / 59.05 (n=30)   | 71.90 / 73.02 (n=30)   | 4.70 / 4.90 (n=30)   | 0.00 / 0.00 (n=30)   |
| concurrent-5      | jieshu | 30 / 0      | 68.25 / 70.56 (n=30)   | 80.90 / 87.27 (n=30)   | 5.90 / 6.10 (n=30)   | 0.00 / 0.00 (n=30)   |
| slow-resources    | wujie  | 30 / 0      | 477.70 / 484.04 (n=30) | 484.60 / 495.64 (n=30) | 4.80 / 5.66 (n=30)   | 0.00 / 0.00 (n=30)   |
| slow-resources    | jieshu | 30 / 0      | 478.40 / 489.06 (n=30) | 485.95 / 500.16 (n=30) | 6.00 / 6.61 (n=30)   | 0.00 / 0.00 (n=30)   |
| cpu4x             | wujie  | 30 / 0      | 144.50 / 152.97 (n=30) | 170.20 / 177.66 (n=30) | 9.90 / 11.32 (n=30)  | 0.00 / 0.00 (n=30)   |
| cpu4x             | jieshu | 30 / 0      | 154.15 / 157.50 (n=30) | 178.90 / 182.92 (n=30) | 12.70 / 14.10 (n=30) | 0.00 / 0.00 (n=30)   |

readyMs 相对差 = (Jieshu 中位数 / Wujie 中位数 − 1) × 100%；负值表示本次 Jieshu 的成功样本中位耗时更低。区间统计量为 median(J) − median(W)，不是逐对差值的中位数。

Bootstrap 5000 次，固定 seed=20260909，95% percentile 区间，不作多重比较校正。主结果独立重采样；配对结果按同一输入目录和 round 整对重采样，仅纳入双方成功的完整轮次。少于 2 个有效样本/配对时不估计区间；单次运行中的上下文独立并不消除机器负载的时间相关性。

| 场景              | ready 中位数相对差 | 中位耗时差 J−W（ms） | 独立 bootstrap 95% 区间（ms） | 配对 N | 配对 bootstrap 95% 区间（ms） |
| ----------------- | ------------------ | -------------------- | ----------------------------- | ------ | ----------------------------- |
| cold              | -1.74%             | -0.65                | [-1.10, -0.30]                | 30     | [-1.10, -0.35]                |
| cold-fiber        | -0.93%             | -0.50                | [-1.40, 0.05]                 | 30     | [-1.40, 0.10]                 |
| warm-rebuild      | -3.58%             | -0.55                | [-1.00, -0.15]                | 30     | [-1.00, -0.20]                |
| singleton-remount | 0.00%              | 0.00                 | [-0.60, 0.30]                 | 30     | [-0.65, 0.30]                 |
| alive-reactivate  | -0.30%             | -0.05                | [-0.10, 0.05]                 | 30     | [-0.10, 0.10]                 |
| preloaded-enter   | 0.30%              | 0.05                 | [-0.50, 1.35]                 | 30     | [-0.50, 1.45]                 |
| concurrent-5      | 12.52%             | 9.00                 | [7.20, 10.30]                 | 30     | [7.25, 10.35]                 |
| slow-resources    | 0.28%              | 1.35                 | [-5.95, 10.20]                | 30     | [-7.00, 10.70]                |
| cpu4x             | 5.11%              | 8.70                 | [4.40, 12.25]                 | 30     | [5.25, 11.60]                 |

coreLoadMs 独立于 start 调用计时；preparationMs 是重建、保活或预加载所需的前置准备。预加载进入耗时不包括这部分成本。ready 指夹具完成渲染后的帧边界，不等同于所有真实业务资源或用户可交互指标。

## 内存

| 框架   | 成功轮数 | 失败轮数 |
| ------ | -------- | -------- |
| wujie  | 5        | 0        |
| jieshu | 5        | 0        |

下面均为同阶段/周期跨成功轮次的中位数，强制 GC 后采样；1 MiB = 1,048,576 字节。JS heap、Documents、Nodes 和监听器计数来自页面 CDP 指标，不是浏览器总内存或 RSS。Δcore 为每轮先减去该轮 core 堆占用，再取中位数。

| 阶段 / 周期                | 框架   | 堆 N | JS heap（MiB） | Δcore（MiB） | Documents | Nodes  | JSEventListeners |
| -------------------------- | ------ | ---- | -------------- | ------------ | --------- | ------ | ---------------- |
| blank                      | wujie  | 5    | 0.528          | -0.132       | 1.0       | 9.0    | 0.0              |
| blank                      | jieshu | 5    | 0.528          | -0.186       | 1.0       | 9.0    | 0.0              |
| core                       | wujie  | 5    | 0.660          | 0.000        | 1.0       | 10.0   | 3.0              |
| core                       | jieshu | 5    | 0.714          | 0.000        | 1.0       | 10.0   | 3.0              |
| mounted-1                  | wujie  | 5    | 4.010          | 3.350        | 2.0       | 950.0  | 9.0              |
| mounted-1                  | jieshu | 5    | 4.179          | 3.465        | 2.0       | 953.0  | 9.0              |
| destroyed-first            | wujie  | 5    | 3.671          | 3.012        | 2.0       | 32.0   | 3.0              |
| destroyed-first            | jieshu | 5    | 2.735          | 2.021        | 1.0       | 11.0   | 3.0              |
| same-assets / 1            | wujie  | 5    | 4.755          | 4.095        | 3.0       | 53.0   | 3.0              |
| same-assets / 1            | jieshu | 5    | 2.787          | 2.072        | 1.0       | 11.0   | 3.0              |
| same-assets / 5            | wujie  | 5    | 9.053          | 8.393        | 7.0       | 137.0  | 3.0              |
| same-assets / 5            | jieshu | 5    | 2.944          | 2.230        | 1.0       | 11.0   | 3.0              |
| same-assets / 10           | wujie  | 5    | 14.431         | 13.771       | 12.0      | 242.0  | 3.0              |
| same-assets / 10           | jieshu | 5    | 3.149          | 2.434        | 1.0       | 11.0   | 3.0              |
| same-assets / 15           | wujie  | 5    | 19.676         | 19.016       | 17.0      | 347.0  | 3.0              |
| same-assets / 15           | jieshu | 5    | 3.152          | 2.438        | 1.0       | 11.0   | 3.0              |
| same-assets / 20           | wujie  | 5    | 24.927         | 24.268       | 22.0      | 452.0  | 3.0              |
| same-assets / 20           | jieshu | 5    | 3.153          | 2.439        | 1.0       | 11.0   | 3.0              |
| same-assets / 25           | wujie  | 5    | 30.180         | 29.520       | 27.0      | 557.0  | 3.0              |
| same-assets / 25           | jieshu | 5    | 3.153          | 2.439        | 1.0       | 11.0   | 3.0              |
| same-assets / 30           | wujie  | 5    | 35.430         | 34.770       | 32.0      | 662.0  | 3.0              |
| same-assets / 30           | jieshu | 5    | 3.151          | 2.437        | 1.0       | 11.0   | 3.0              |
| unique-assets / 1          | wujie  | 5    | 36.509         | 35.849       | 33.0      | 683.0  | 3.0              |
| unique-assets / 1          | jieshu | 5    | 3.164          | 2.450        | 1.0       | 11.0   | 3.0              |
| unique-assets / 5          | wujie  | 5    | 40.720         | 40.060       | 37.0      | 767.0  | 3.0              |
| unique-assets / 5          | jieshu | 5    | 3.187          | 2.473        | 1.0       | 11.0   | 3.0              |
| unique-assets / 10         | wujie  | 5    | 46.003         | 45.343       | 42.0      | 872.0  | 3.0              |
| unique-assets / 10         | jieshu | 5    | 3.228          | 2.514        | 1.0       | 11.0   | 3.0              |
| unique-assets / 15         | wujie  | 5    | 51.264         | 50.604       | 47.0      | 977.0  | 3.0              |
| unique-assets / 15         | jieshu | 5    | 3.244          | 2.530        | 1.0       | 11.0   | 3.0              |
| unique-assets / 20         | wujie  | 5    | 56.518         | 55.858       | 52.0      | 1082.0 | 3.0              |
| unique-assets / 20         | jieshu | 5    | 3.254          | 2.540        | 1.0       | 11.0   | 3.0              |
| unique-assets / 25         | wujie  | 5    | 61.786         | 61.126       | 57.0      | 1187.0 | 3.0              |
| unique-assets / 25         | jieshu | 5    | 3.266          | 2.552        | 1.0       | 11.0   | 3.0              |
| unique-assets / 30         | wujie  | 5    | 67.050         | 66.390       | 62.0      | 1292.0 | 3.0              |
| unique-assets / 30         | jieshu | 5    | 3.290          | 2.575        | 1.0       | 11.0   | 3.0              |
| cache-cleared              | wujie  | 5    | 67.028         | 66.368       | 62.0      | 1292.0 | 3.0              |
| cache-cleared              | jieshu | 5    | 3.225          | 2.511        | 1.0       | 11.0   | 3.0              |
| cache-cleared-settled-5.5s | wujie  | 5    | 2.923          | 2.263        | 1.0       | 11.0   | 3.0              |
| cache-cleared-settled-5.5s | jieshu | 5    | 3.225          | 2.511        | 1.0       | 11.0   | 3.0              |
| mounted-5-alive            | wujie  | 5    | 9.894          | 9.234        | 6.0       | 4711.0 | 33.0             |
| mounted-5-alive            | jieshu | 5    | 10.515         | 9.801        | 6.0       | 4726.0 | 33.0             |
| deactivated-5-alive        | wujie  | 5    | 9.894          | 9.234        | 6.0       | 3211.0 | 33.0             |
| deactivated-5-alive        | jieshu | 5    | 10.511         | 9.797        | 6.0       | 3226.0 | 33.0             |
| final-cleanup              | wujie  | 5    | 9.879          | 9.219        | 6.0       | 3186.0 | 18.0             |
| final-cleanup              | jieshu | 5    | 3.231          | 2.517        | 1.0       | 11.0   | 3.0              |
| final-settled-5.5s         | wujie  | 5    | 2.924          | 2.264        | 1.0       | 11.0   | 3.0              |
| final-settled-5.5s         | jieshu | 5    | 3.231          | 2.517        | 1.0       | 11.0   | 3.0              |

cache-cleared / final-cleanup 是即时清理后快照；cache-cleared-settled-5.5s / final-settled-5.5s 额外等待 5.5 秒，必须分别解读。same-assets 与 unique-assets 在同轮依次执行，后者不是独立空白基线。缓存保留、延迟清理及单段增长都不能直接证明泄漏；完整序列保存在原始观测中。

## 稳定性

分母为实际执行次数；成功率仅适用于本次场景、浏览器与夹具，不能推出所有场景更稳定。robustness-observation 表示压力/竞态观察，需结合各框架公开契约判断，不能直接等同于承诺行为回归。

| 场景                              | 契约类别               | Wujie 通过 / 总数 | Jieshu 通过 / 总数 |
| --------------------------------- | ---------------------- | ----------------- | ------------------ |
| mount-interaction-lifecycle       | shared-public-behavior | 3 / 3             | 3 / 3              |
| props-and-event-bus               | shared-public-behavior | 3 / 3             | 3 / 3              |
| javascript-global-isolation       | shared-public-behavior | 3 / 3             | 3 / 3              |
| stylesheet-isolation              | shared-public-behavior | 3 / 3             | 3 / 3              |
| two-apps-independent-state        | shared-public-behavior | 3 / 3             | 3 / 3              |
| destroy-and-recreate              | shared-public-behavior | 3 / 3             | 3 / 3              |
| keep-alive-switch                 | shared-public-behavior | 3 / 3             | 3 / 3              |
| route-sync-disabled               | shared-public-behavior | 3 / 3             | 3 / 3              |
| route-sync-enabled                | shared-public-behavior | 3 / 3             | 3 / 3              |
| async-unmount-completion          | shared-public-behavior | 3 / 3             | 3 / 3              |
| start-destroy-race                | robustness-observation | 0 / 3             | 0 / 3              |
| same-name-concurrent-containers   | robustness-observation | 0 / 3             | 0 / 3              |
| preload-execute-then-activate     | shared-public-behavior | 3 / 3             | 3 / 3              |
| dynamic-script-and-stylesheet     | shared-public-behavior | 3 / 3             | 3 / 3              |
| missing-script-error-and-recovery | shared-public-behavior | 3 / 3             | 3 / 3              |
| fiber-enabled-interaction         | shared-public-behavior | 3 / 3             | 3 / 3              |

## 失败记录

| 类别      | 框架   | 场景                            | round | 错误                                                          | 原始位置                 |
| --------- | ------ | ------------------------------- | ----- | ------------------------------------------------------------- | ------------------------ |
| stability | wujie  | start-destroy-race              | 0     | Unexpected startup rejection during cancellation.             | ./observations.jsonl:571 |
| stability | jieshu | start-destroy-race              | 0     | The cancelled start left a loading overlay in its container.  | ./observations.jsonl:572 |
| stability | wujie  | same-name-concurrent-containers | 0     | Unexpected startup rejection in the superseded request.       | ./observations.jsonl:573 |
| stability | jieshu | same-name-concurrent-containers | 0     | The superseded start left a loading overlay in its container. | ./observations.jsonl:574 |
| stability | jieshu | start-destroy-race              | 1     | The cancelled start left a loading overlay in its container.  | ./observations.jsonl:603 |
| stability | wujie  | start-destroy-race              | 1     | Unexpected startup rejection during cancellation.             | ./observations.jsonl:604 |
| stability | jieshu | same-name-concurrent-containers | 1     | The superseded start left a loading overlay in its container. | ./observations.jsonl:605 |
| stability | wujie  | same-name-concurrent-containers | 1     | Unexpected startup rejection in the superseded request.       | ./observations.jsonl:606 |
| stability | wujie  | start-destroy-race              | 2     | Unexpected startup rejection during cancellation.             | ./observations.jsonl:635 |
| stability | jieshu | start-destroy-race              | 2     | The cancelled start left a loading overlay in its container.  | ./observations.jsonl:636 |
| stability | wujie  | same-name-concurrent-containers | 2     | Unexpected startup rejection in the superseded request.       | ./observations.jsonl:637 |
| stability | jieshu | same-name-concurrent-containers | 2     | The superseded start left a loading overlay in its container. | ./observations.jsonl:638 |

各条失败的 error、details、pageErrors、diagnostics 原样保存在 summary.json 的 failures 中；不能仅凭失败信息省略对夹具、API 契约和复现条件的排查。

## 范围与复现

本报告不将不同场景合并成单一性能排名。结果限于本地跨端口 HTTP、合成 core 负载和本次 Headless Chromium；不覆盖公网、其他浏览器、移动端、适配包或长期业务稳定性。桌面后台负载未受控。

输入目录：

- /Users/zhouxiang/Documents/Github/jieshu/benchmarks/comparison/results/2026-09-09
