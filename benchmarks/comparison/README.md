# Wujie / Jieshu 可复现对比

先读 [计划](./PLAN.md)，本轮结论见 [测试报告](./REPORT.md)，逐次数据见 [results/2026-09-09](./results/2026-09-09/)。

后续优化按独立的[优化计划](./OPTIMIZATION.md)执行，结论与剩余差距见[优化报告](../../docs/notes/jieshu-performance-optimization.md)。原始基线不会被优化后的结果覆盖。

## 运行

在 Jieshu 仓库根目录执行，使用已安装的 Vite 和 Playwright，以及 Playwright 对应的 Chromium。Wujie 仓库默认位于相邻的 `../wujie`，可以通过 `WUJIE_ROOT` 指定。脚本只从源码构建内存中的 bundle，不依赖已有 dist，不改两个 core。

```bash
# 每次使用新的输出目录，已有 observations.jsonl 时主动报错，避免混入旧数据。
BENCH_OUTPUT=test-results/comparison-new node benchmarks/comparison/run.mjs
node benchmarks/comparison/summarize.mjs test-results/comparison-new
```

可单独运行：

```bash
BENCH_MODE=smoke BENCH_OUTPUT=test-results/comparison-smoke-new node benchmarks/comparison/run.mjs
BENCH_MODE=startup BENCH_SAMPLES=30 BENCH_OUTPUT=test-results/comparison-startup-new node benchmarks/comparison/run.mjs
BENCH_MODE=memory BENCH_MEMORY_ROUNDS=5 BENCH_CYCLES=30 BENCH_OUTPUT=test-results/comparison-memory-new node benchmarks/comparison/run.mjs
BENCH_MODE=stability BENCH_STABILITY_ROUNDS=3 BENCH_OUTPUT=test-results/comparison-stability-new node benchmarks/comparison/run.mjs
```

定位热点时可缩小场景或采集诊断数据：

```bash
BENCH_MODE=startup BENCH_SCENARIOS=cold-fiber,concurrent-5,cpu4x BENCH_SAMPLES=30 BENCH_OUTPUT=test-results/comparison-focused-new node benchmarks/comparison/run.mjs
# 各框架 6 次，四倍 CPU 降速、同时启动 5 应用；为保留函数名使用未压缩 bundle。
BENCH_MODE=profile BENCH_OUTPUT=test-results/comparison-profile-new node benchmarks/comparison/run.mjs
# 堆快照只取最后静置阶段。诊断限定 1 轮，避免同名快照在多轮间覆盖。
BENCH_MODE=memory BENCH_MEMORY_ROUNDS=1 BENCH_CYCLES=10 BENCH_HEAP_SNAPSHOT=1 BENCH_OUTPUT=test-results/comparison-heaps-new node benchmarks/comparison/run.mjs
node benchmarks/comparison/inspect-heap.mjs test-results/comparison-heaps-new/wujie-final.heapsnapshot test-results/comparison-heaps-new/jieshu-final.heapsnapshot > test-results/comparison-heaps-new/analysis.json
```

`profile` 输出 `.cpuprofile` 和按采样耗时聚合的函数列表，不包含正式启动观测，不能拿未压缩 profile 的耗时与生产启动数据混算。`inspect-heap.mjs` 按 V8 快照元数据解码，并聚合节点 `self_size`；分组差异只能定位成本候选，不能代替引用链分析，也不是浏览器总内存。

`smoke` 每场景包含两轮预热和一轮记录样本，仅用来确认夹具工作，不能代替正式统计。测试顺序在两框架之间交错，每个启动/稳定性样本使用独立 browser context；内存每轮使用一个 context 跟踪完整序列。运行时不要同时执行构建、其他浏览器测试或高负载任务。

## 指标含义

- `coreLoadMs`：独立加载核心 bundle 的耗时，包括本地 HTTP 获取、解析和执行；不含在 `readyMs` 中。没有把两个不同时间区间的中位数相加伪装为端到端冷启动。
- `apiMs`：调用 `startApp` 到 Promise 返回；多个应用时为各应用 API 耗时的最大值。
- `readyMs`：调用 `startApp` 到子应用报告 ready、目标容器内 ready DOM 可见，再经过两个主页面 rAF；是固定夹具的就绪指标，不是浏览器 FCP/LCP。多个应用时从批次发起到全部就绪。
- `preparationMs`：热重建/单例/保活的准备成本，或预执行请求到 ready 加两个 rAF 的成本。预加载前置工作不计入切入耗时，也不视为没有成本。
- `JSHeapUsedSize`：CDP 强制 GC 后的 JavaScript 堆，不包含完整的浏览器/进程 RSS、GPU 或所有原生内存。
- `Documents/Nodes/JSEventListeners`：Chromium DOM 计数；序列中同时记录即时回收与等待 5.5 秒后的回收。短时增长、代码/JIT 缓存、资产缓存和长期泄漏需要分别判断。

fixture 含 300 个列表节点、4,000 个 JS 对象、两个按钮及动态资源目标。有标准 mount/unmount 钩子；主子应用使用不同本地端口，允许 CORS。默认显式 `fiber:false`，另外测试 fiber 开启。`slow-resources` 对 HTML/JS/CSS 每个服务器响应各延迟 150ms，**不是**公网 RTT/带宽仿真。`cpu4x` 使用 CDP 的四倍 CPU 降速，不能当作某款手机。

## 文件

- `fixture.mjs`：两边完全相同的子应用，以及只记录 JSON 快照的观测代码。
- `run.mjs`：相同参数的源码构建、HTTP 服务、启动/内存采样与环境记录。
- `stability.mjs`：常规行为和并发健壮性检查，失败仍保存现场并继续。
- `summarize.mjs`：从原始数据生成分布、置信区间和稳定性汇总。
- `results/`：可纳入版本控制的小体积原始数据和报告；浏览器下载、trace、coverage、临时输出放在忽略目录中。

并发取消可使用明确的 `AbortError`；内部空指针、残留 loading 或错误 DOM 归属仍计作健壮性失败。框架测试失败会进入原始数据；采样器完整执行后可以以退出码 0 结束，因此必须检查汇总中的失败数，不能仅以进程退出码判断两框架全部通过。
