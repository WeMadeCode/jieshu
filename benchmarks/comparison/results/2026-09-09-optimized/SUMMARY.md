# Wujie / Jieshu 对比统计

自动生成于 2026-09-09T08:08:11.729Z。完整环境、统计值及失败现场见 [summary.json](./summary.json)。

| 框架   | commit                                   | 版本  | core 原始 / gzip（字节） |
| ------ | ---------------------------------------- | ----- | ------------------------ |
| wujie  | c45932998c0602f34454df8d3e29f4d33a38446a | 2.1.0 | 65660 / 19802            |
| jieshu | b0c73aaa944ea8603c6fb13f3126e341b320d2cb | 0.0.5 | 108681 / 32759           |

环境：darwin arm64，Apple M1 Pro，Chromium 151.0.7922.34，Node v26.7.0。

## 启动

耗时单位 ms；单元格为中位数 / P95（有效 N）。仅统计成功且非预热的样本，失败另列；成功耗时不能掩盖失败。P95 用线性插值。每个样本使用独立 context，按轮次交错框架顺序。

观测文件中排除预热记录 0 条，其中失败 0 条；运行器可能不写入成功预热记录，此计数不代表实际预热总数。

| 场景              | 框架   | 成功 / 失败 | apiMs                  | readyMs                | coreLoadMs           | preparationMs        |
| ----------------- | ------ | ----------- | ---------------------- | ---------------------- | -------------------- | -------------------- |
| cold              | wujie  | 30 / 0      | 24.70 / 26.70 (n=30)   | 33.80 / 38.45 (n=30)   | 4.70 / 4.80 (n=30)   | 0.00 / 0.00 (n=30)   |
| cold              | jieshu | 30 / 0      | 22.25 / 26.03 (n=30)   | 30.35 / 36.33 (n=30)   | 5.90 / 6.00 (n=30)   | 0.00 / 0.00 (n=30)   |
| cold-fiber        | wujie  | 30 / 0      | 36.25 / 38.01 (n=30)   | 46.65 / 47.76 (n=30)   | 4.70 / 4.80 (n=30)   | 0.00 / 0.00 (n=30)   |
| cold-fiber        | jieshu | 30 / 0      | 35.10 / 36.70 (n=30)   | 45.60 / 46.40 (n=30)   | 5.90 / 6.00 (n=30)   | 0.00 / 0.00 (n=30)   |
| warm-rebuild      | wujie  | 30 / 0      | 9.20 / 9.85 (n=30)     | 15.55 / 15.87 (n=30)   | 4.70 / 4.86 (n=30)   | 37.85 / 39.91 (n=30) |
| warm-rebuild      | jieshu | 30 / 0      | 7.20 / 7.66 (n=30)     | 15.20 / 16.19 (n=30)   | 5.85 / 6.00 (n=30)   | 31.10 / 38.19 (n=30) |
| singleton-remount | wujie  | 30 / 0      | 1.70 / 1.80 (n=30)     | 16.70 / 18.66 (n=30)   | 4.70 / 4.90 (n=30)   | 54.25 / 56.48 (n=30) |
| singleton-remount | jieshu | 30 / 0      | 1.60 / 1.70 (n=30)     | 16.70 / 16.80 (n=30)   | 5.90 / 5.96 (n=30)   | 51.70 / 55.36 (n=30) |
| alive-reactivate  | wujie  | 30 / 0      | 0.10 / 0.20 (n=30)     | 16.70 / 17.44 (n=30)   | 4.70 / 4.76 (n=30)   | 54.40 / 56.50 (n=30) |
| alive-reactivate  | jieshu | 30 / 0      | 0.10 / 0.20 (n=30)     | 16.70 / 17.74 (n=30)   | 5.80 / 5.96 (n=30)   | 46.00 / 53.91 (n=30) |
| preloaded-enter   | wujie  | 30 / 0      | 2.10 / 2.30 (n=30)     | 16.50 / 16.70 (n=30)   | 4.70 / 5.05 (n=30)   | 37.65 / 40.45 (n=30) |
| preloaded-enter   | jieshu | 30 / 0      | 2.20 / 2.40 (n=30)     | 16.50 / 16.66 (n=30)   | 5.95 / 6.30 (n=30)   | 35.85 / 38.72 (n=30) |
| concurrent-5      | wujie  | 30 / 0      | 58.15 / 61.39 (n=30)   | 72.50 / 75.50 (n=30)   | 4.80 / 5.10 (n=30)   | 0.00 / 0.00 (n=30)   |
| concurrent-5      | jieshu | 30 / 0      | 57.55 / 59.65 (n=30)   | 70.05 / 78.07 (n=30)   | 6.00 / 6.26 (n=30)   | 0.00 / 0.00 (n=30)   |
| slow-resources    | wujie  | 30 / 0      | 478.90 / 485.88 (n=30) | 485.35 / 496.97 (n=30) | 4.90 / 5.20 (n=30)   | 0.00 / 0.00 (n=30)   |
| slow-resources    | jieshu | 30 / 0      | 483.35 / 487.62 (n=30) | 494.80 / 499.31 (n=30) | 6.05 / 6.55 (n=30)   | 0.00 / 0.00 (n=30)   |
| cpu4x             | wujie  | 30 / 0      | 108.80 / 121.45 (n=30) | 128.65 / 143.29 (n=30) | 8.15 / 9.35 (n=30)   | 0.00 / 0.00 (n=30)   |
| cpu4x             | jieshu | 30 / 0      | 103.70 / 117.81 (n=30) | 123.55 / 139.08 (n=30) | 10.40 / 11.86 (n=30) | 0.00 / 0.00 (n=30)   |

readyMs 相对差 = (Jieshu 中位数 / Wujie 中位数 − 1) × 100%；负值表示本次 Jieshu 的成功样本中位耗时更低。区间统计量为 median(J) − median(W)，不是逐对差值的中位数。

Bootstrap 5000 次，固定 seed=20260909，95% percentile 区间，不作多重比较校正。主结果独立重采样；配对结果按同一输入目录和 round 整对重采样，仅纳入双方成功的完整轮次。少于 2 个有效样本/配对时不估计区间；单次运行中的上下文独立并不消除机器负载的时间相关性。

| 场景              | ready 中位数相对差 | 中位耗时差 J−W（ms） | 独立 bootstrap 95% 区间（ms） | 配对 N | 配对 bootstrap 95% 区间（ms） |
| ----------------- | ------------------ | -------------------- | ----------------------------- | ------ | ----------------------------- |
| cold              | -10.21%            | -3.45                | [-7.40, 3.80]                 | 30     | [-7.50, 3.90]                 |
| cold-fiber        | -2.25%             | -1.05                | [-1.80, -0.75]                | 30     | [-1.75, -0.75]                |
| warm-rebuild      | -2.25%             | -0.35                | [-0.65, 0.00]                 | 30     | [-0.60, 0.00]                 |
| singleton-remount | 0.00%              | 0.00                 | [-0.15, 0.10]                 | 30     | [-0.15, 0.10]                 |
| alive-reactivate  | 0.00%              | 0.00                 | [-0.10, 0.10]                 | 30     | [-0.10, 0.10]                 |
| preloaded-enter   | 0.00%              | 0.00                 | [-0.35, 1.50]                 | 30     | [-0.30, 1.50]                 |
| concurrent-5      | -3.38%             | -2.45                | [-4.15, -0.90]                | 30     | [-4.30, -1.00]                |
| slow-resources    | 1.95%              | 9.45                 | [-7.60, 12.35]                | 30     | [-9.10, 12.70]                |
| cpu4x             | -3.96%             | -5.10                | [-14.80, 5.40]                | 30     | [-14.70, 5.65]                |

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
| blank                      | jieshu | 5    | 0.528          | -0.185       | 1.0       | 9.0    | 0.0              |
| core                       | wujie  | 5    | 0.660          | 0.000        | 1.0       | 10.0   | 3.0              |
| core                       | jieshu | 5    | 0.714          | 0.000        | 1.0       | 10.0   | 3.0              |
| mounted-1                  | wujie  | 5    | 4.010          | 3.350        | 2.0       | 950.0  | 9.0              |
| mounted-1                  | jieshu | 5    | 3.762          | 3.049        | 2.0       | 953.0  | 9.0              |
| destroyed-first            | wujie  | 5    | 3.671          | 3.012        | 2.0       | 32.0   | 3.0              |
| destroyed-first            | jieshu | 5    | 2.735          | 2.021        | 1.0       | 11.0   | 3.0              |
| same-assets / 1            | wujie  | 5    | 4.755          | 4.095        | 3.0       | 53.0   | 3.0              |
| same-assets / 1            | jieshu | 5    | 2.787          | 2.074        | 1.0       | 11.0   | 3.0              |
| same-assets / 5            | wujie  | 5    | 9.053          | 8.393        | 7.0       | 137.0  | 3.0              |
| same-assets / 5            | jieshu | 5    | 2.931          | 2.218        | 1.0       | 11.0   | 3.0              |
| same-assets / 10           | wujie  | 5    | 14.431         | 13.771       | 12.0      | 242.0  | 3.0              |
| same-assets / 10           | jieshu | 5    | 3.162          | 2.449        | 1.0       | 11.0   | 3.0              |
| same-assets / 15           | wujie  | 5    | 19.676         | 19.016       | 17.0      | 347.0  | 3.0              |
| same-assets / 15           | jieshu | 5    | 3.168          | 2.454        | 1.0       | 11.0   | 3.0              |
| same-assets / 20           | wujie  | 5    | 24.927         | 24.267       | 22.0      | 452.0  | 3.0              |
| same-assets / 20           | jieshu | 5    | 3.165          | 2.452        | 1.0       | 11.0   | 3.0              |
| same-assets / 25           | wujie  | 5    | 30.180         | 29.520       | 27.0      | 557.0  | 3.0              |
| same-assets / 25           | jieshu | 5    | 3.166          | 2.452        | 1.0       | 11.0   | 3.0              |
| same-assets / 30           | wujie  | 5    | 35.429         | 34.769       | 32.0      | 662.0  | 3.0              |
| same-assets / 30           | jieshu | 5    | 3.157          | 2.444        | 1.0       | 11.0   | 3.0              |
| unique-assets / 1          | wujie  | 5    | 36.508         | 35.849       | 33.0      | 683.0  | 3.0              |
| unique-assets / 1          | jieshu | 5    | 3.168          | 2.454        | 1.0       | 11.0   | 3.0              |
| unique-assets / 5          | wujie  | 5    | 40.719         | 40.059       | 37.0      | 767.0  | 3.0              |
| unique-assets / 5          | jieshu | 5    | 3.194          | 2.480        | 1.0       | 11.0   | 3.0              |
| unique-assets / 10         | wujie  | 5    | 46.002         | 45.342       | 42.0      | 872.0  | 3.0              |
| unique-assets / 10         | jieshu | 5    | 3.236          | 2.522        | 1.0       | 11.0   | 3.0              |
| unique-assets / 15         | wujie  | 5    | 51.263         | 50.603       | 47.0      | 977.0  | 3.0              |
| unique-assets / 15         | jieshu | 5    | 3.249          | 2.536        | 1.0       | 11.0   | 3.0              |
| unique-assets / 20         | wujie  | 5    | 56.517         | 55.857       | 52.0      | 1082.0 | 3.0              |
| unique-assets / 20         | jieshu | 5    | 3.258          | 2.545        | 1.0       | 11.0   | 3.0              |
| unique-assets / 25         | wujie  | 5    | 61.784         | 61.124       | 57.0      | 1187.0 | 3.0              |
| unique-assets / 25         | jieshu | 5    | 3.271          | 2.558        | 1.0       | 11.0   | 3.0              |
| unique-assets / 30         | wujie  | 5    | 67.049         | 66.389       | 62.0      | 1292.0 | 3.0              |
| unique-assets / 30         | jieshu | 5    | 3.298          | 2.584        | 1.0       | 11.0   | 3.0              |
| cache-cleared              | wujie  | 5    | 67.027         | 66.367       | 62.0      | 1292.0 | 3.0              |
| cache-cleared              | jieshu | 5    | 3.233          | 2.520        | 1.0       | 11.0   | 3.0              |
| cache-cleared-settled-5.5s | wujie  | 5    | 2.921          | 2.261        | 1.0       | 11.0   | 3.0              |
| cache-cleared-settled-5.5s | jieshu | 5    | 3.233          | 2.520        | 1.0       | 11.0   | 3.0              |
| mounted-5-alive            | wujie  | 5    | 9.892          | 9.233        | 6.0       | 4711.0 | 33.0             |
| mounted-5-alive            | jieshu | 5    | 8.437          | 7.724        | 6.0       | 4726.0 | 33.0             |
| deactivated-5-alive        | wujie  | 5    | 9.892          | 9.232        | 6.0       | 3211.0 | 33.0             |
| deactivated-5-alive        | jieshu | 5    | 8.438          | 7.724        | 6.0       | 3226.0 | 33.0             |
| final-cleanup              | wujie  | 5    | 9.878          | 9.218        | 6.0       | 3186.0 | 18.0             |
| final-cleanup              | jieshu | 5    | 3.238          | 2.524        | 1.0       | 11.0   | 3.0              |
| final-settled-5.5s         | wujie  | 5    | 2.922          | 2.262        | 1.0       | 11.0   | 3.0              |
| final-settled-5.5s         | jieshu | 5    | 3.238          | 2.524        | 1.0       | 11.0   | 3.0              |

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
| start-destroy-race                | robustness-observation | 0 / 3             | 3 / 3              |
| same-name-concurrent-containers   | robustness-observation | 0 / 3             | 3 / 3              |
| preload-execute-then-activate     | shared-public-behavior | 3 / 3             | 3 / 3              |
| dynamic-script-and-stylesheet     | shared-public-behavior | 3 / 3             | 3 / 3              |
| missing-script-error-and-recovery | shared-public-behavior | 3 / 3             | 3 / 3              |
| fiber-enabled-interaction         | shared-public-behavior | 3 / 3             | 3 / 3              |

## 失败记录

| 类别      | 框架  | 场景                            | round | 错误                                                    | 原始位置                 |
| --------- | ----- | ------------------------------- | ----- | ------------------------------------------------------- | ------------------------ |
| stability | wujie | start-destroy-race              | 0     | Unexpected startup rejection during cancellation.       | ./observations.jsonl:571 |
| stability | wujie | same-name-concurrent-containers | 0     | Unexpected startup rejection in the superseded request. | ./observations.jsonl:573 |
| stability | wujie | start-destroy-race              | 1     | Unexpected startup rejection during cancellation.       | ./observations.jsonl:604 |
| stability | wujie | same-name-concurrent-containers | 1     | Unexpected startup rejection in the superseded request. | ./observations.jsonl:606 |
| stability | wujie | start-destroy-race              | 2     | Unexpected startup rejection during cancellation.       | ./observations.jsonl:635 |
| stability | wujie | same-name-concurrent-containers | 2     | Unexpected startup rejection in the superseded request. | ./observations.jsonl:637 |

各条失败的 error、details、pageErrors、diagnostics 原样保存在 summary.json 的 failures 中；不能仅凭失败信息省略对夹具、API 契约和复现条件的排查。

## 范围与复现

本报告不将不同场景合并成单一性能排名。结果限于本地跨端口 HTTP、合成 core 负载和本次 Headless Chromium；不覆盖公网、其他浏览器、移动端、适配包或长期业务稳定性。桌面后台负载未受控。

输入目录：

- /Users/zhouxiang/Documents/Github/jieshu/benchmarks/comparison/results/2026-09-09-optimized
