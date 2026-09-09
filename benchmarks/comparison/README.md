# Wujie / Jieshu 可复现对比

先读 [计划](./PLAN.md)，本轮结论见 [测试报告](./REPORT.md)，逐次数据见 [results/2026-09-09](./results/2026-09-09/)。

后续优化按独立的[优化计划](./OPTIMIZATION.md)执行，结论与剩余差距见[优化报告](../../docs/notes/jieshu-performance-optimization.md)。原始基线不会被优化后的结果覆盖。

核心体积、加载和空闲内存的进一步[原因与方案](../../docs/notes/core-footprint-analysis.md)见独立诊断，证据保存在 [results/2026-09-09-footprint](./results/2026-09-09-footprint/)。

后续第一步[最小修复](../../docs/notes/core-footprint-simple-fix.md)处理未知名称空销毁及常量冗余，原分析基线保持不变。

第二步处理真实销毁后的 instanceof WeakMap 空表容量，[实现、收益与代价](../../docs/notes/instanceof-memory-optimization.md)及[原始记录](./results/2026-09-09-instanceof/)单独保存。

后续[核心加载原因分析](../../docs/notes/core-load-causes.md)用等体积注释、跳过初始化、gzip 和 CPU 对照定位成本，结果见 [2026-09-09-core-load](./results/2026-09-09-core-load/)。跳过行为的构建只用于诊断。

后续[核心加载等价精简](../../docs/notes/core-load-slimming.md)记录实际修改、优化前后 A/B 和回归结果。

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

对比优化前后的首次启动与生命周期内存，可加入此前 `measure-core-load.mjs` 保存的 Jieshu 产物：

```bash
BENCH_BEFORE_BUNDLE=test-results/previous-load/jieshu.js BENCH_MODE=startup BENCH_SCENARIOS=cold,cold-fiber,concurrent-5,cpu4x BENCH_SAMPLES=30 BENCH_OUTPUT=test-results/startup-ab-new node benchmarks/comparison/run.mjs
BENCH_BEFORE_BUNDLE=test-results/previous-load/jieshu.js BENCH_MODE=memory BENCH_MEMORY_ROUNDS=1 BENCH_CYCLES=30 BENCH_OUTPUT=test-results/memory-ab-new node benchmarks/comparison/run.mjs
node benchmarks/comparison/summarize-before-after.mjs --output test-results/ab-summary-new test-results/footprint-load-ab-new test-results/startup-ab-new test-results/memory-ab-new
```

`BENCH_BEFORE_BUNDLE` 仅支持 startup/memory/smoke；校验旁边 `environment.json` 的 SHA 和 production/minified/ES2018/IIFE 元数据。所有核心包在采样前统一编码为 UTF-8 Buffer，避免当前字符串和冻结字节采用不同服务器发送路径。冻结版本标记为 `jieshu-before`，夹具按 Jieshu 运行，与当前 Jieshu/Wujie 每六轮覆盖全部顺序。默认不设置时仍是原两组行为。

三组数据需使用 `summarize-before-after.mjs`；既有 `summarize.mjs` 会拒绝该格式。前后统计按同 encoding 或 scenario、同 round 配对，排除 trace/预热及失败/缺失配对，报告 `median(current) − median(before)` 和固定种子 bootstrap 区间。多个输入目录必须使用相同产物和运行环境，同一组重复 round 会被拒绝。内存列出各阶段及相对 blank/core 的增量，单轮不估计区间。

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

核心成本诊断可独立复跑，下面各目录每次都换成新名称：

```bash
# 相同构建的模块生成字节、普通ESM消费者tree shaking及目标降级成本。
BENCH_OUTPUT=test-results/footprint-bundle-new node benchmarks/comparison/analyze-bundle.mjs
# 从上一步source map冻结源码，只在构建内存中应用候选；输出独立candidates-*目录。
node benchmarks/comparison/probe-bundle-candidates.mjs test-results/footprint-bundle-new
# 不安装子应用：legacy/UTF-8，各框架30次加载；trace另各3次。
CORE_LOAD_OUTPUT=test-results/footprint-load-new node benchmarks/comparison/measure-core-load.mjs
# 可选：加入此前本脚本保存的Jieshu产物，与当前Jieshu及Wujie同轮交错。
# 必须保留旧产物同目录environment.json；脚本核对SHA，并复制原metadata。
CORE_LOAD_BEFORE_BUNDLE=test-results/previous-load/jieshu.js CORE_LOAD_OUTPUT=test-results/footprint-load-ab-new node benchmarks/comparison/measure-core-load.mjs
# 从同哈希产物与heap Context审计instanceof状态表，支持旧全局表和新懒分配兜底。
node benchmarks/comparison/inspect-instanceof-heap.mjs test-results/comparison-heaps-new/jieshu-final.heapsnapshot test-results/footprint-load-new/jieshu.js
# 对分析基线bc688b2的干净core复现空destroy的槽数增长。
IDLE_RETENTION_COMMIT=bc688b2 IDLE_RETENTION_OUTPUT=test-results/footprint-retention-new node benchmarks/comparison/measure-idle-retention.mjs
# 验收后续空destroy修复：允许未提交core，记录并核对构建前后源码指纹，要求全过程0槽。
IDLE_RETENTION_ALLOW_DIRTY=1 IDLE_RETENTION_EXPECT_SLOTS=none IDLE_RETENTION_OUTPUT=test-results/footprint-retention-fixed-new node benchmarks/comparison/measure-idle-retention.mjs
```

核心加载脚本区分请求/响应、响应结束到 onload、脚本执行和带 URL 的后台解析事件；它们可能重叠，不能相加为互斥阶段。空 destroy 诊断只操作不存在的应用，在无活跃操作的测试页删除槽引用作归因干预，不将该操作当作生产修复。ES2022 构建只是反事实诊断，不修改框架的 ES2018 兼容目标。候选构建只证明包体变化，不能代替后续行为验证。

`smoke` 每场景包含两轮预热和一轮记录样本，仅用来确认夹具工作，不能代替正式统计。测试顺序在两框架之间交错，每个启动/稳定性样本使用独立 browser context；内存每轮使用一个 context 跟踪完整序列。运行时不要同时执行构建、其他浏览器测试或高负载任务。

## 指标含义

核心加载原因实验分为固定产物准备、浏览器测量、离线配对统计三个阶段。每次使用新目录，源码不作生产修改：

```bash
CORE_CAUSE_OUTPUT=test-results/core-load-causes-new node benchmarks/comparison/prepare-core-load-variants.mjs
CORE_CAUSE_INPUT=test-results/core-load-causes-new CORE_CAUSE_RUN=test-results/core-load-causes-new/formal node benchmarks/comparison/measure-core-load-causes.mjs
node benchmarks/comparison/summarize-core-load-causes.mjs test-results/core-load-causes-new/formal
CORE_VERIFY_INPUT=test-results/core-load-causes-new CORE_VERIFY_OUTPUT=test-results/core-load-causes-new/runtime-verification.json node benchmarks/comparison/verify-core-load-variants.mjs
```

默认七变体、35 轮、identity/gzip、CPU 1x/4x，共 980 个普通观测；另有 98 个 CPU 1x trace。可先设置 `CORE_CAUSE_SAMPLES=1 CORE_CAUSE_TRACE_SAMPLES=1` 并使用独立 `preflight` 输出目录验证 42 个样本。所有 guard 在已压缩产物中插入，原函数文本保留，但 V8 编译策略仍可能变化；不能把差值叫作纯初始化耗时。

- `coreLoadMs`：独立加载核心 bundle 的耗时，包括本地 HTTP 获取、解析和执行；不含在 `readyMs` 中。没有把两个不同时间区间的中位数相加伪装为端到端冷启动。
- `apiMs`：调用 `startApp` 到 Promise 返回；多个应用时为各应用 API 耗时的最大值。
- `readyMs`：调用 `startApp` 到子应用报告 ready、目标容器内 ready DOM 可见，再经过两个主页面 rAF；是固定夹具的就绪指标，不是浏览器 FCP/LCP。多个应用时从批次发起到全部就绪。
- `preparationMs`：热重建/单例/保活的准备成本，或预执行请求到 ready 加两个 rAF 的成本。预加载前置工作不计入切入耗时，也不视为没有成本。
- `JSHeapUsedSize`：CDP 强制 GC 后的 JavaScript 堆，不包含完整的浏览器/进程 RSS、GPU 或所有原生内存。
- `Documents/Nodes/JSEventListeners`：Chromium DOM 计数；序列中同时记录即时回收与等待 5.5 秒后的回收。短时增长、代码/JIT 缓存、资产缓存和长期泄漏需要分别判断。

fixture 含 300 个列表节点、4,000 个 JS 对象、两个按钮及动态资源目标。有标准 mount/unmount 钩子；主子应用使用不同本地端口，允许 CORS。默认显式 `fiber:false`，另外测试 fiber 开启。`slow-resources` 对 HTML/JS/CSS 每个服务器响应各延迟 150ms，**不是**公网 RTT/带宽仿真。`cpu4x` 使用 CDP 的四倍 CPU 降速，不能当作某款手机。

## 文件

- `fixture.mjs`：两边完全相同的子应用，以及只记录 JSON 快照的观测代码。
- `run.mjs`：相同参数的源码构建、HTTP 服务、启动/内存采样与环境记录；`before-bundle.mjs` 校验可选冻结基线及轮换顺序。
- `stability.mjs`：常规行为和并发健壮性检查，失败仍保存现场并继续。
- `summarize.mjs`：两框架原始数据的分布、置信区间和稳定性汇总；`summarize-before-after.mjs` 处理含冻结 Jieshu 的前后对照。
- `results/`：可纳入版本控制的小体积原始数据和报告；浏览器下载、trace、coverage、临时输出放在忽略目录中。

并发取消可使用明确的 `AbortError`；内部空指针、残留 loading 或错误 DOM 归属仍计作健壮性失败。框架测试失败会进入原始数据；采样器完整执行后可以以退出码 0 结束，因此必须检查汇总中的失败数，不能仅以进程退出码判断两框架全部通过。
