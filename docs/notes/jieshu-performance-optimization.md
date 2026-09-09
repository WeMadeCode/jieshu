# Jieshu 相对 Wujie 的性能优化记录

日期：2026-09-09。范围是两份本地 core 源码及固定 Chromium 夹具，不推广为所有浏览器、业务应用或设备。执行过程见[优化计划](../../benchmarks/comparison/OPTIMIZATION.md)，优化前记录见[首次报告](../../benchmarks/comparison/REPORT.md)。

首批优化已落地并完成完整对比。原先五应用并发启动、CPU 降速和活动应用内存的退化，在本轮样本中已经逆转；fiber 长尾和 Loading 残留也已改善。但核心包、核心加载和空闲常驻内存仍偏高，部分场景尾延迟仍有差距，**尚未达到所有指标都与 Wujie 持平**。

## 先确认哪些地方退化

首次测试使用各场景每框架 30 个启动样本、每框架 5 轮内存序列。以下是优化前的实测值，不能与不同时间的绝对耗时直接相减来衡量收益。

| 指标                       |     Wujie | 优化前 Jieshu | 问题                                                          |
| -------------------------- | --------: | ------------: | ------------------------------------------------------------- |
| 五应用并发启动中位数       |  71.90 ms |      80.90 ms | 慢 12.52%                                                     |
| 四倍 CPU 降速启动中位数    | 170.20 ms |     178.90 ms | 慢 5.11%                                                      |
| fiber 冷启动 P95           |  61.62 ms |     109.61 ms | 尾延迟偏高                                                    |
| 单应用挂载 heap            | 4.010 MiB |     4.179 MiB | 多 4.22%                                                      |
| 五应用保活挂载 heap        | 9.894 MiB |    10.515 MiB | 多 6.28%                                                      |
| 最终销毁、静置 5.5 秒 heap | 2.924 MiB |     3.231 MiB | 空闲常驻成本更高                                              |
| 核心包 gzip                |  19,802 B |      32,603 B | 多 12,801 B                                                   |
| 统一稳定性矩阵             |     42/48 |         42/48 | 两边都存在取消启动后 Loading 残留；Wujie 还出现内部 TypeError |

冷启动、热重建、单例回挂、保活切回、预加载切入及资源延迟场景没有观察到同等规模的中位数差距。问题优先级据此确定，没有先预设一个框架整体更快。

## 原因与已经落地的优化

1. **子窗口全局属性被过早读取。** `patchInstanceofAcrossRealms` 原先先读取子窗口每个全局属性，再判断宿主是否存在对应 DOM 构造器。这会让浏览器在每个子 realm 中初始化无关接口。现在先检查宿主 DOM 构造器，只有需要跨 realm 识别时才读取子窗口。仍逐次发现新加的自定义 EventTarget，捕获 getter / 构造器分类异常，保留继承关系、释放和隔离行为。
2. **DOM 节点重复创建 WeakRef、描述符和 getter。** `patchElementEffect` 现在按子窗口通过 WeakMap 共享一组描述符和 WeakRef；getter 工厂只捕获引用对象，每次读取仍访问当前 proxyLocation / document。保留节点在应用销毁后回退宿主 document；没有用强缓存把 Window 留住。无 WeakRef 的旧环境继续使用原有兼容回退。
3. **热点上的无效分配与查找。** 内联事件编译跳过空 attributes / children 的快照分配，非空集合仍使用快照以保留修改过程中的迭代语义。window 事件排除集合每个窗口只生成一次；函数绑定移除只缓存 `typeof === 'function'` 结果的 WeakMap，减少重复查询；插件 hook 在实际存在时才生成一次数组，继续先取完整快照、再按序调用并在异常时停止。
4. **fiber 在没有初始 async 脚本时额外等待空 barrier。** 原本仍安排 `Promise.all([])` 的后续队列任务，多让出一次 idle 调度。现在只省略 fiber 的空 barrier；确实有 async 脚本时仍等待其原生完成，非 fiber 保留微任务检查点，保证 DOMContentLoaded 中排入的取消能阻止后续 load。
5. **Loading 在应用挂载前没有启动请求所有权。** `addLoading` 现在返回具体遮罩的释放函数，启动结束 / 失败 / 取消时释放自己仍拥有的遮罩；渲染接管后转移所有权，避免旧请求删除新应用。只查找直接子节点的 Loading，覆盖嵌套容器；替换遮罩前恢复原布局，避免把临时 `overflow:hidden` 当成原值。

修改集中于 core 的 iframe 初始化、绑定 / hook、脚本调度及 Loading 清理；公开 `startApp` 文档补充了取消清理行为。适配包源码、依赖、锁文件及发布配置未修改。

CPU profile 用于定位热点，源码路径和行为测试验证优化机制；正式采样验证这些改动的合计效果。没有通过逐项消融测出每个改动独占的毫秒或字节贡献。

## 完整复测

正式复测于 2026-09-09 完成：540 条启动观测、10 轮内存序列、96 条稳定性观测。Jieshu 全部 323 条通过；Wujie 的 6 条失败均为此前两个并发压力场景，没有忽略或重试。使用原有 fixture 和稳定性断言，同时重测未修改的 Wujie；两边相同生产构建参数，每场景每框架 30 个启动样本、每框架 5 轮内存及每稳定性场景 3 轮。

数据见[统计汇总](../../benchmarks/comparison/results/2026-09-09-optimized/SUMMARY.md)、[原始观测](../../benchmarks/comparison/results/2026-09-09-optimized/observations.jsonl)与[环境和 bundle 哈希](../../benchmarks/comparison/results/2026-09-09-optimized/environment.json)。Jieshu 是基于 `b0c73aa` 的未提交优化工作树，不能只用 commit 认定与原基线相同；Wujie 仍为干净的 `c459329`，bundle 哈希与原基线一致。原始目录没有覆盖，fixture / stability / summarize 的文件哈希也与首次运行一致。

### 启动

单位 ms。ready 从调用 start 到子应用 ready、目标 DOM 可见并经过两个主页面 rAF；独立核心加载和预加载准备不包含在内，不能称作页面完整首开时间。

| 场景                  | Wujie 中位数 | Jieshu 中位数 | Jieshu 相对差 | Wujie / Jieshu P95 |
| --------------------- | -----------: | ------------: | ------------: | -----------------: |
| 冷启动                |        33.80 |         30.35 |       -10.21% |      38.45 / 36.33 |
| fiber 冷启动          |        46.65 |         45.60 |        -2.25% |      47.76 / 46.40 |
| 缓存重建              |        15.55 |         15.20 |        -2.25% |      15.87 / 16.19 |
| 单例回挂              |        16.70 |         16.70 |         0.00% |      18.66 / 16.80 |
| 保活切回              |        16.70 |         16.70 |         0.00% |      17.44 / 17.74 |
| 预加载切入            |        16.50 |         16.50 |         0.00% |      16.70 / 16.66 |
| 五应用并发            |        72.50 |         70.05 |        -3.38% |      75.50 / 78.07 |
| 资源响应各延迟 150 ms |       485.35 |        494.80 |        +1.95% |    496.97 / 499.31 |
| 四倍 CPU 降速         |       128.65 |        123.55 |        -3.96% |    143.29 / 139.08 |

负值表示本轮 Jieshu 成功样本中位耗时更低。相对首次 Wujie 同期对照的五应用 **+12.52%**、CPU **+5.11%**，本轮分别为 **-3.38%**、**-3.96%**；这表达两轮各自的相对位置，不把跨时段绝对差直接归因给代码。

不把中位数等同于完整分布：并发 P95 仍高 2.575 ms（3.41%），缓存重建和保活切回的 P95 也略高。资源延迟场景中位差为 +9.45 ms，但配对 bootstrap 95% 区间为 **[-9.10, 12.70] ms**；冷启动、CPU 场景的区间也跨过零，当前样本不足以宣称它们必然更快或已经证明等价。fiber 与并发中位数区间在本轮都低于零。统计未做多重比较校正，完整区间保留在汇总中。

资源延迟样本按每轮先后顺序拆分后，每组 15 个样本：先测的 W/J 中位数为 483.0/484.6 ms，后测为 494.7/497.7 ms。观测有明显顺序分组，且指标包含 rAF 帧边界；这提示需要打散采样相位后复核，不能把总体 +9.45 ms 全部归因到框架。

独立核心加载仍较慢：普通冷场景 Wujie **4.70 ms**、Jieshu **5.90 ms**；CPU 降速为 **8.15 / 10.40 ms**。它包含本地请求、解析、执行，不能把不同时间段的两个中位数相加伪装成测过的端到端指标。

### 内存

以下为同一完整序列中各阶段、跨 5 轮的 GC 后 JS heap 中位数，单位 MiB；不是总进程内存。

| 阶段                  |  Wujie | Jieshu | 本轮判断                |
| --------------------- | -----: | -----: | ----------------------- |
| core 已载入           |  0.660 |  0.714 | Jieshu 仍较高           |
| 单应用挂载            |  4.010 |  3.762 | Jieshu 约低 6.2%        |
| 同资源第 30 次销毁    | 35.429 |  3.157 | Jieshu 即时占用较低     |
| 不同资源第 30 次销毁  | 67.049 |  3.298 | Jieshu 即时占用较低     |
| 清缓存并静置 5.5 秒   |  2.921 |  3.233 | Jieshu 常驻成本仍较高   |
| 五应用保活挂载        |  9.892 |  8.437 | Jieshu 约低 14.7%       |
| 最终销毁并静置 5.5 秒 |  2.922 |  3.238 | Jieshu 仍多约 0.316 MiB |

活动应用内存的差距已逆转；原先单应用 Jieshu 多 4.22%、五应用多 6.28%。本轮最终双方均回到 Documents=1、Nodes=11、JSEventListeners=3。Wujie 的即时大额占用会在静置后释放，继续按延迟释放记录，不能改写成永久泄漏。

### 稳定性与核心体积

Jieshu **48/48**，Wujie **42/48**。取消未完成启动和同名应用切换容器的两类压力用例中，Jieshu 已无旧 Loading 残留，均 3/3 通过；后续交互断言也执行通过。原有 14 项公共行为两边仍全部通过。本轮稳定性覆盖有限，不等于所有业务场景。

同一 IIFE 构建下，Wujie **65,660 B / gzip 19,802 B**，Jieshu **108,681 B / gzip 32,759 B**。Jieshu 本轮 gzip 还比自身优化前多 **156 B**；清理和边界保障并未带来包体缩减。这项仍未达标。

## 空载内存与包体积为什么还需要继续处理

诊断堆快照来自本轮阶段优化后的一轮运行：同资源、不同资源各 10 次销毁，最终静置 5.5 秒再 GC。它与正式的 30 次 / 5 轮内存矩阵分开记录。

- V8 节点 `self_size` 总和：Wujie 3,604,285 B，Jieshu 4,011,444 B，差 407,159 B；它不是 retained size，也不能与 CDP `JSHeapUsedSize` 混作同一口径。
- 其中 code 类差 258,216 B；`InstructionStream` 差 103,008 B、`BytecodeArray` 差 27,488 B，说明编译代码及元数据也是常驻增量。
- 核心源码字符串的 `ExternalStringData`：Wujie 131,332 B，Jieshu 217,106 B，分别对应该诊断 bundle 的 `2 × bundleBytes + 12`。差 85,774 B 能由源码字符串本身解释；不能把这部分正常保留的源码当作子应用泄漏。
- 两边完整销毁并静置后均为 Documents=1、Nodes=11、JSEventListeners=3；相比刚加载 core 的 Nodes=10，多 1 个节点，文档与监听计数相同。当前证据不支持把最终约 0.3 MiB 的 heap 差距称为持续增长的子应用泄漏，也不证明无限时长都没有泄漏。

详细的 `Script → source → backing_store` 节点、引用边和快照哈希见[堆归因证据](../../benchmarks/comparison/results/2026-09-09-optimized/heap-attribution.json)。快照属于阶段诊断构建（108,547 B），与最终构建（108,681 B）分别标识。当前 HTTP 夹具未声明 charset，源码字符串存储是该页面的实测；`2 × bundleBytes + 12` 不推广到正常声明 UTF-8 的生产页面。

源码检查将主要功能增量定位在 HTML tokenizer、资源缓存作用域与失效、动态脚本完成 / 取消、控制器生命周期协调，以及更完整的事件和内联 DOM 隔离。它们解释了增加了哪些行为，尚未精确量出各模块对压缩包或编译代码的字节贡献。

因此，活动应用开销减少后，仍需单独减少常驻代码成本。不能为了数字持平移除隔离、并发取消、异步脚本或兼容性保障；也不能仅凭有限样本宣称“所有场景都不退化”。

下一轮按以下顺序继续：先对 UTF-8 生产页面做包体 / 核心加载与模块字节归因；验证 `entry.ts` 和 `template.ts` 的重复属性转义可否安全共享；再测只有单例的脚本执行包装和固定分发层是否值得简化。还需改变采样起始相位并重复资源延迟、并发 P95 测量，区分真实差距和帧调度 / 轮次顺序影响。以上是未完成事项，不算入本轮收益。

## 回归与验证

最终代码执行：

- `pnpm --filter @cloud/jieshu-core run test:unit`：53 个文件、515 项通过；statements 78.65%、branches 71.52%、functions 83.85%、lines 80.65%。相较最初基线增加 37 项单元回归。
- `pnpm --filter @cloud/jieshu-core run typecheck`：源码、单元、浏览器及集成四套类型检查通过。
- `pnpm --filter @cloud/jieshu-core run build:esm`：通过，供真实示例使用；构建产物保持在忽略目录。
- `node node_modules/@playwright/test/cli.js test --config packages/jieshu-core/__test__/browser/playwright.config.mts`：137/137 通过，44.9 秒；相较最初基线增加 7 项浏览器回归。
- 使用下面说明的临时配置执行原集成矩阵：77/77 通过，1.2 分钟；使用最终核心构建，零重试。
- 补跑默认 Webpack 主应用及 Vue 主应用的原始集成配置：`PATH=<pnpm-10.28.2-bin>:$PATH NODE_OPTIONS=--openssl-legacy-provider JIESHU_REACT_MAIN_WORKSPACE=main-react JIESHU_REACT_MAIN_PORT=7700 JIESHU_REACT_MAIN_URL=http://localhost:7700/ node node_modules/@playwright/test/cli.js test --config packages/jieshu-core/__test__/integration/playwright.config.mts`，同一 77 项全部通过，1.2 分钟。两次矩阵分别覆盖 Webpack / Rspack React 主应用；共享的 Vue 和子应用用例会重复执行，不算 154 个独立用例。
- 对修改的 core 源码、测试和 benchmark 脚本运行只读 ESLint，零 warning，通过。

使用根 `packageManager` 要求的 pnpm 10.28.2；因 PATH 中是其他版本，将官方 pnpm 10.28.2 CLI 解包到临时目录并仅对命令调整 PATH，复用现有依赖。未改动工作区中用户已有的 AGENTS.md 变更。

集成启动器另发现已有问题：选用 `main-react-ts`（`examples/main-react-rspack`）时，其脚本包含 `--port 7700`，测试配置又追加 `--port 7800`，当前 rspack 将它解析成数组并报 `ERR_INVALID_ARG_VALUE`。第一次运行尚未执行用例。复测用临时配置直接执行 `pnpm --filter main-react-ts exec rspack dev --mode development --port 7800 --no-open`，保留原来的全部 77 项测试及其他服务设置；这是测试启动命令修正，没有修改应用或测试断言。默认 Webpack 主应用配置不触发该重复端口问题。

命令、临时配置正文、退出码、日志哈希和被测源码哈希记录在 [validation.json](../../benchmarks/comparison/results/2026-09-09-optimized/validation.json)。没有创建提交。
