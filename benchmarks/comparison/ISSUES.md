# Wujie / Jieshu 对比测试问题记录

记录日期：2026-09-09。本文针对本次测试的两份本地仓库版本，不代表上游 Wujie 所有版本或所有业务环境。测试边界和方法见 [PLAN.md](./PLAN.md)，正式构建与环境见 [environment.json](./results/2026-09-09/environment.json)。以下主体保留首次只读对比的原始问题；用户后续授权的 Jieshu 优化状态单列于文末，不改写原始证据。

- Jieshu：`b0c73aaa944ea8603c6fb13f3126e341b320d2cb`，包版本 `0.0.5`。
- 本地 Wujie：`c45932998c0602f34454df8d3e29f4d33a38446a`，包版本 `2.1.0`。
- 正式完成启动每框架每场景 30 样本、内存每框架 5 轮、稳定性每框架每场景 3 轮。统计见 [SUMMARY.md](./results/2026-09-09/SUMMARY.md)，完整现场见 [observations.jsonl](./results/2026-09-09/observations.jsonl)。
- 并发请求属于额外健壮性压力场景。Wujie 文档没有明确承诺所有并发调用均成功或最新请求必定获胜；取消可以正常完成，也可以返回明确的 `AbortError`。不得仅凭旧请求被取消就认定缺陷。

| 编号     | 问题                                                  | 范围                   | 正式证据与状态                                          |
| -------- | ----------------------------------------------------- | ---------------------- | ------------------------------------------------------- |
| PERF-001 | 启动被销毁或替换后，旧请求访问已清理状态              | 本地 Wujie             | 两种触发各 3/3；Jieshu 对应内部异常各 0/3；同一根因合并 |
| PERF-002 | 并发取消后旧容器残留 Loading                          | Jieshu 和本地 Wujie    | 两框架两种触发均各 3/3，loadingCount=1                  |
| PERF-003 | 销毁后出现短期内存积累，静置 5.5 秒后明显释放         | 本地 Wujie             | 5 轮复现；源码的未取消 5 秒安全定时器提供原因线索       |
| PERF-004 | Jieshu 核心生产包更大                                 | 本次相同构建条件       | JS 增加 42,582 B，gzip 增加 12,801 B                    |
| PERF-005 | Jieshu 的五应用并发、CPU 降速启动更慢，fiber 长尾更高 | 本次 Chromium 合成负载 | 每框架每场景 30 个成功样本；原因未定位                  |
| DOC-001  | Wujie destroyApp 文档返回值与缓存说明矛盾             | 本地 Wujie 文档        | 源码、文档与异步卸载行为确认；未修改                    |
| ENV-001  | 指导、packageManager 和 PATH 中的 pnpm 版本不一致     | 本地测试环境           | 已确认；未安装依赖或修改版本配置                        |
| TEST-001 | Wujie 原生单测没有有效采集源码覆盖率                  | 本地 Wujie 测试配置    | 94 项通过，但 coverage JSON 为空；覆盖率不可用          |

## PERF-001：Wujie 并发取消后的旧请求访问失效实例

**预期**：销毁或替换仍在加载的同名应用后，旧请求停止使用已释放的实例。旧请求可以正常完成或以明确的 `AbortError` 取消；新请求应保持正常。文档未规定所有取消请求必须成功，因此本项不将任意拒绝都认定为缺陷。

**复现步骤**：使用相同子应用、`fiber: false`、两个独立宿主容器；`slow` 变体将资源响应延迟 150 ms。以下两种触发分别在独立页面执行，Promise 拒绝从发起时即被捕获。

1. `start-destroy-race`：调用 `startApp({ name: 'cancelled-start', url: slowUrl, el: firstContainer, fiber: false })`，在 `beforeLoad` 已触发、资源仍未完成时调用并等待 `destroyApp('cancelled-start')`；等待旧启动结果及额外 250 ms，检查容器。
2. `same-name-concurrent-containers`：立即连续调用同名 `startApp`，第一个使用 `slowUrl + firstContainer`，第二个使用 `normalUrl + secondContainer`；等待两个结果、第二容器出现真实 ready DOM，再观察 250 ms。

可执行实现见 [stability.mjs](./stability.mjs) 的同名场景。当前断言接受旧启动的成功或 `AbortError`；残余 Loading 另列 PERF-002，避免把不同修复点混为一项。

**正式实际观测**：

| 场景                            | 旧启动                                                           | 后续请求                        | DOM 与 iframe                         |
| ------------------------------- | ---------------------------------------------------------------- | ------------------------------- | ------------------------------------- |
| start-destroy-race              | `TypeError: Cannot read properties of null (reading 'protocol')` | destroy 成功                    | ready=0，iframe=0                     |
| same-name-concurrent-containers | 同样的 null.protocol 拒绝                                        | 第二个 start 成功，ready 已出现 | 第一容器 ready=0，第二=1，总 iframe=1 |

原始证据见 [正式观测](./results/2026-09-09/observations.jsonl) 的两种场景、round 0–2。两场景的 `pageErrors` 均为空：这是由测试通过 `Promise.allSettled` 捕获的拒绝，不能写成未捕获页面异常。未观察到重复挂载，也未观察到最新实例启动失败；断言在旧请求拒绝处结束，后续点击未执行，不应声称本压力用例验证了新实例完整交互。

正式 3 轮均重现 Wujie 的 `TypeError`；Jieshu 对应旧请求均 fulfilled，但因 PERF-002 而场景失败，不能宣称 Jieshu 并发场景全部通过。

**源码定位与原因**：以下路径由源码和错误文本共同支持；原始结果未保存浏览器内部错误栈，因此不是堆栈直接证明。

- [Wujie index.ts:285](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/index.ts:285) 等待 `importHTML`；`:296` 继续调用 `processCssLoader` 前未检查实例是否已销毁或被替换。
- [Wujie sandbox.ts:443](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/sandbox.ts:443) 在 destroy 时移除实例注册，`:457` 将 `proxyLocation` 置为 `null`。旧 HTML 请求返回后，[entry.ts:84](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/entry.ts:84) 调用 `getCurUrl(sandbox.proxyLocation)`，后者在 [utils.ts:213](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/utils.ts:213) 读取 `location.protocol`。
- 第二次同名启动发现旧实例尚无 MOUNT 钩子，经 [index.ts:264](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/index.ts:264) 的销毁分支后创建新实例；旧请求仍沿上述路径继续。两个触发合并为同一个内部失效实例访问问题。

**影响与建议**：快速切页、关闭仍在加载的应用、切换同名应用容器时，调用方收到内部实现异常。建议在异步启动的恢复点检查实例存活和请求所有权，定义可辨识的取消完成方式，并验证旧请求停止、新请求正常且不会重复挂载。

**正式频率**：start-destroy 的非取消异常 Wujie **3/3**、Jieshu **0/3**；同名并发的非取消异常 Wujie **3/3**、Jieshu **0/3**。这两种触发合计 6 次 Wujie 内部错误，不作为六个独立缺陷计数。

## PERF-002：两框架取消尚未挂载的应用后均残留 Loading

**预期与复现**：沿用 PERF-001 的两个 API 时序，待销毁及旧启动完成后检查旧容器。实例还未挂载也必须清理它已经插入的 Loading；同名新请求在另一个容器继续运行时，不得删掉新请求 DOM。

**正式 3 轮实际观测**：

| 场景                            | Wujie                                        | Jieshu                                    | 两框架的 DOM 归属                                  |
| ------------------------------- | -------------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| start-destroy-race              | loadingCount=1；旧 start 为 TypeError        | loadingCount=1；旧 start fulfilled        | 旧 ready=0，destroy fulfilled                      |
| same-name-concurrent-containers | 旧容器 loadingCount=1；旧 start 为 TypeError | 旧容器 loadingCount=1；旧 start fulfilled | 旧容器 ready=0，新容器 ready=1，新 start fulfilled |

记录中的残留节点为 `DIV[data-loading-flag]`。Jieshu 的请求取消没有内部拒绝，但仍有用户可见的清理缺陷。Wujie 的 `TypeError` 断言较早触发，其记录已在抛错前采集 loadingCount，因此仍有直接证据确认同一 Loading 缺陷。当前断言在错误或残留 Loading 处结束，两个压力用例均未走到最后的点击，不把新 DOM ready 等同于完整交互验证。

证据：[正式 observations.jsonl](./results/2026-09-09/observations.jsonl)，按上述场景名、framework 和 round 过滤，查看 `failureObservations.loadingCount`。正式使用统一 Loading 断言，两框架这两个压力场景均为 0/3 通过；其余 14 项公共行为均为 3/3 通过。

**Wujie 源码定位**：[index.ts:271](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/index.ts:271) 先调用 `addLoading`，`new WuJie` 未接收容器；`this.el` 要到 [sandbox.ts:261](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/sandbox.ts:261) 或 `:266` 的 active 阶段才赋值。销毁发生得更早，[sandbox.ts:484](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/sandbox.ts:484) 的 `if (this.el)` 因而未清理 Loading。

**Jieshu 源码定位**：

- [index.ts:319](/Users/zhouxiang/Documents/Github/jieshu/packages/jieshu-core/src/index.ts:319) 调用 `addLoading(el)`，构造 `new Jieshu` 时同样未传 el。`:351` 等待 HTML，`:363` 检查到实例已销毁或请求已取消就直接返回 undefined，避免了 Wujie 的失效实例访问，但此返回路径没有清理尚未绑定实例的 Loading。
- `this.el` 要到 [sandbox.ts:273](/Users/zhouxiang/Documents/Github/jieshu/packages/jieshu-core/src/sandbox.ts:273) 或 `:280` 的 active 阶段才绑定。destroy 的 [clearContainer:646](/Users/zhouxiang/Documents/Github/jieshu/packages/jieshu-core/src/sandbox.ts:646) 要求同时有 `this.el`、容器清理权限和 `this.shadowRoot`，此时条件不满足。
- Jieshu 已有 Loading 归属保护，但 [shadow.ts:139](/Users/zhouxiang/Documents/Github/jieshu/packages/jieshu-core/src/shadow.ts:139) 只在 `renderElementToContainer` 插入应用节点时登记 `loadingOwners`；[addLoading:426](/Users/zhouxiang/Documents/Github/jieshu/packages/jieshu-core/src/shadow.ts:426) 插入 Loading 时未登记可供启动取消阶段使用的所有权。未进入 active 的请求无法依靠渲染节点清理机制回收它。

**影响**：快速离开正在加载的应用后，旧宿主容器可能一直显示 Loading。添加 Loading 的源码还会调整容器 `position` / `overflow`，但本次未直接采集恢复情况，不把样式残留写成已确认观测。

**建议**：从插入 Loading 的时点登记请求、容器及 Loading 的具体归属；在取消、加载失败或销毁时释放该请求仍拥有的 Loading 并恢复相关布局。保留现有对新渲染的归属保护，不能用无条件清空容器解决。回归覆盖两个触发、两个容器及同容器被后续请求复用的情况。

**正式频率**：start-destroy 的 Loading 残留 Wujie **3/3**、Jieshu **3/3**；同名并发的 Loading 残留 Wujie **3/3**、Jieshu **3/3**。两框架均须修复；不能根据是否产生内部拒绝将其中一方判为通过。

## PERF-003：销毁后短期内存积累，静置 5.5 秒后释放

**预期**：iframe 初始化已完成或实例已销毁后，兜底定时器及监听不应继续持有无用的 iframe、Window 或 Document。应区分即时占用、短期延迟释放和持续泄漏。

**复现步骤**：同一页面加载 core 后，挂载并销毁一个应用，再按同资源和不同资源 URL 依次各重复 30 次；固定节点强制 GC，采集 `JSHeapUsedSize`、`Documents`、`Nodes` 和监听数。清空资源缓存后分别立即采样与静置 5.5 秒再 GC；五个保活应用销毁后同样取即时、静置样本。每框架 5 轮。

**正式结果**：以下为各阶段跨 5 轮中位数；MiB 为 1,048,576 字节。

| 阶段                 | Wujie heap / Documents | Jieshu heap / Documents |
| -------------------- | ---------------------- | ----------------------- |
| core 已载入          | 0.660 MiB / 1          | 0.714 MiB / 1           |
| 单应用已挂载         | 4.010 MiB / 2          | 4.179 MiB / 2           |
| 同资源第 30 次销毁   | 35.430 MiB / 32        | 3.151 MiB / 1           |
| 不同资源第 30 次销毁 | 67.050 MiB / 62        | 3.290 MiB / 1           |
| 清空资源缓存后立即   | 67.028 MiB / 62        | 3.225 MiB / 1           |
| 清缓存后静置 5.5 秒  | 2.923 MiB / 1          | 3.225 MiB / 1           |
| 五应用保活挂载       | 9.894 MiB / 6          | 10.515 MiB / 6          |
| 最终销毁后立即       | 9.879 MiB / 6          | 3.231 MiB / 1           |
| 最终静置 5.5 秒      | 2.924 MiB / 1          | 3.231 MiB / 1           |

来源：[正式内存统计](./results/2026-09-09/SUMMARY.md)。两框架最后静置阶段均为 **Documents=1、Nodes=11、JSEventListeners=3**。Wujie 的短期大幅积累在等待后回落，当前证据支持延迟释放，不支持永久泄漏。Jieshu 在短时高频销毁时内存更低，但 core、单应用、五应用保活及静置后占用均较高，不能宣称所有阶段都更省内存。不同资源阶段接在同资源阶段之后，不能视为独立空白基线；这些 CDP 数据也不是浏览器总内存。

**源码线索**：[Wujie iframe.ts:827](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/iframe.ts:827) 的 `stopIframeLoading` 中，`runTrick` 闭包引用 iframe / iframeWindow；`:854` 设置 5 秒安全定时器，但 load 成功后只设置 done，不保存并清除该定时器。定时器到期前仍可持有闭包，与 5.5 秒静置后下降吻合。该解释有静态和时间窗口证据，但未通过堆快照证明它是唯一持有路径。

对照 [Jieshu iframe.ts:939](/Users/zhouxiang/Documents/Github/jieshu/packages/jieshu-core/src/iframe.ts:939)，正常完成与 cancel 路径会移除监听和清除安全定时器。

**影响与建议**：高频切换可能产生明显的短期内存峰值，清空资源缓存不能代替解除初始化闭包引用。建议保存安全定时器并在初始化完成、失败、销毁时取消，清理 load 监听；修复验证同时保留即时与静置样本，必要时采集堆快照。当前状态为已复现延迟释放，未修改源码。

## PERF-004：Jieshu 核心包体积较大

**复现与预期**：使用同一 Vite、生产压缩、IIFE、ES2018 和等同入口打包两份 core，并计算原始与 gzip 字节。比较体积，不预设框架一定更小。

**正式构建实测**：

| 指标             | Wujie    | Jieshu    | Jieshu 增量 |
| ---------------- | -------- | --------- | ----------- |
| 压缩后的 JS 文件 | 65,660 B | 108,242 B | 42,582 B    |
| gzip             | 19,802 B | 32,603 B  | 12,801 B    |

来源：[正式 environment.json](./results/2026-09-09/environment.json) 的 `revisions` 与 `build`。这是本地版本在本次构建条件下的确定性结果，体积差异不按场景失败频率统计。

**影响**：首次下载的数据量和解析代码量更大。不能仅用体积断言 Jieshu 启动更慢；本次启动样本还包含缓存、执行、DOM 和调度等成本。

**建议**：使用构建分析确定模块增量来源，再评估按需导出、打包裁剪和重复逻辑；不要为减小体积移除必要的生命周期、隔离或兼容性行为。本轮未进行优化。

## PERF-005：Jieshu 部分启动场景耗时和长尾更高

**复现与预期**：以同一夹具分别运行 `concurrent-5`（五个独立应用同时启动）、`cpu4x`（Chromium CDP CPU 4 倍降速）和 `cold-fiber`（开启 fiber 的冷启动），每框架每场景 30 个独立 context，交错顺序。readyMs 从 start 调用到夹具渲染后的帧边界；不把 API Promise 完成等同于界面完成。

**正式观测**：

| 场景 / 指标               | Wujie     | Jieshu    | 差异                                 |
| ------------------------- | --------- | --------- | ------------------------------------ |
| concurrent-5 ready 中位数 | 71.90 ms  | 80.90 ms  | Jieshu +12.52%，+9.00 ms             |
| cpu4x ready 中位数        | 170.20 ms | 178.90 ms | Jieshu +5.11%，+8.70 ms              |
| cold-fiber ready P95      | 61.62 ms  | 109.61 ms | Jieshu 长尾更高                      |
| cold-fiber ready 中位数   | 53.60 ms  | 53.10 ms  | 中位数接近，不能据此推导所有样本更慢 |

三种场景均为双方 **30 成功、0 失败**。见 [正式统计](./results/2026-09-09/SUMMARY.md)：并发中位数差的配对 bootstrap 95% 区间为 **[7.25, 10.35] ms**，CPU 降速为 **[5.25, 11.60] ms**；fiber 中位数差区间 **[-1.40, 0.10] ms** 包含 0。P95 为 30 样本的线性插值点估计，没有 P95 区间，不将一次采样的尾部差异视为所有环境的确定结论。

**原因与影响**：原因尚未定位。较大的包体属于独立已测指标，不能直接归因为这些耗时差异；运行时协调、执行成本、调度和后台负载需要性能剖析验证。这些结果限制了“Jieshu 所有启动场景都更快”的结论，也不等于功能不稳定。

**建议**：复用原场景采集浏览器性能 trace，分别检查多个应用初始化的同步工作、CPU 降速下的执行热点、fiber 的 idle callback 等待与任务排队；对尾部追加独立批次样本后再评估优化效果。本轮保留完整原始数据，不针对测试更改核心代码。

## DOC-001：Wujie destroyApp 文档返回值与缓存说明不一致

**复现与实际**：

- [destroyApp 文档](/Users/zhouxiang/Documents/Github/wujie/docs/api/destroyApp.md:7) 将返回值写为 `void`；[core 实现](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/index.ts:375) 是 `async destroyApp(...): Promise<void>`，并等待 `sandbox.destroy()`。本次异步卸载正式场景双方均 3/3 通过，已实际验证等待 Promise 时序。
- 同一文档称销毁实例相当于清空所有缓存；[clearAssetsCache 文档](/Users/zhouxiang/Documents/Github/wujie/docs/api/clearAssetsCache.md:9) 明确说 `destroyApp` 不清理模块级资源缓存，与前者矛盾。[entry.ts:48](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/src/entry.ts:48) 提供独立缓存清理 API，`destroyApp` 并未调用它。

**预期**：文档应准确描述 Promise、异步卸载完成时机，以及实例状态和模块资源缓存的不同生命周期。

**影响**：调用方可能忽略异步销毁的完成时机，或误以为 destroy 后启动必定重新请求所有资源；也容易将缓存驻留误判为泄漏。

**建议**：返回值改为 `Promise<void>`，明确实例销毁与资源缓存失效的区别，链接 `clearAssetsCache` 并补充等待卸载的例子。此为本地文档矛盾，未认定为运行时失败；不按场景失败次数统计。Jieshu 当前对应文档已经区分这两类清理。

## ENV-001：pnpm 版本声明不一致

**复现与实际**：任务提供的 AGENTS 指导写 pnpm **11.13.0**，同时要求以根 `package.json` 为准。实际 [Jieshu package.json](/Users/zhouxiang/Documents/Github/jieshu/package.json:6) 为 **10.28.2**，[Wujie package.json](/Users/zhouxiang/Documents/Github/wujie/package.json:6) 为 **10.33.0**；准备阶段 PATH 中命令返回 **11.19.0**，见 [计划中的环境记录](./PLAN.md)。

**预期与影响**：仓库说明、packageManager 和实际执行工具应一致，否则安装、锁文件或脚本行为可能不可复现。这是环境与说明问题，不能算作任一微前端框架的性能失败。

**本次处理**：以各仓库 `packageManager` 为准记录基线，复用已有依赖，通过 Node 运行本地构建/测试 CLI；不混用 npm/yarn 安装依赖，也未改写锁文件或包管理器配置。正式环境保存了各自的 packageManager。

**建议**：后续将指导文件中的硬编码版本与仓库配置对齐，并在正式依赖安装或 CI 中验证实际 pnpm 版本。本轮只记录，不调整配置。

## TEST-001：Wujie 单测覆盖率报告为空

**复现**：在 Wujie core 目录执行 `node node_modules/jest/bin/jest.js -c __test__/unit/jest.config.js --runInBand --watchman=false`。本次 20 个文件、94 项测试全部通过，但覆盖率输出为没有任何源码行的 `All files 0/0/0/0`；`__test__/unit/coverage/coverage-final.json` 内容是 `{}`，`lcov.info` 为 0 字节。

**定位**：[Jest 配置](/Users/zhouxiang/Documents/Github/wujie/packages/wujie-core/__test__/unit/jest.config.js) 未设置 `rootDir`，Jest 27 默认取配置文件所在的 `__test__/unit` 目录。测试正常导入 `../../src`，但当前 Babel 覆盖率插桩以该 rootDir 为 cwd，不对其外的源码插桩，因此没有采集到源码数据。它不是测试没有执行，也不是源码的真实覆盖率为 0%。

**影响与建议**：无法判断现有用例的源码覆盖范围，不能用这个百分比与 Jieshu 的 V8 覆盖率比较。后续将 rootDir 调整到 core 包根，同步修改 testMatch、setupFiles、ts-jest tsconfig 路径，显式指定 `collectCoverageFrom: ['<rootDir>/src/**/*.ts']`，重跑后确认 coverage JSON 包含源码条目。本轮只记录，没有改动 Wujie 测试配置。

## 2026-09-09 后续优化跟进

用户授权后已修改 Jieshu 核心，Wujie 保持原样。优化前数据仍在原目录；优化后独立[原始观测](./results/2026-09-09-optimized/observations.jsonl)、[统计](./results/2026-09-09-optimized/SUMMARY.md)与[优化报告](../../docs/notes/jieshu-performance-optimization.md)保存改动、原因和验证。

| 编号     | 当前状态                                    | 后续证据                                                                                                                                                     |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PERF-001 | Wujie 未修改，仍复现                        | 两类并发用例均 3/3 内部 TypeError；Jieshu 无对应拒绝                                                                                                         |
| PERF-002 | Jieshu 已修复，Wujie 未修复                 | Jieshu 2 类用例各 3/3 通过，旧 Loading 清除、后续交互正常；启动 / 渲染转移所有权，补嵌套、异常、取消及布局恢复回归                                           |
| PERF-003 | 保留延迟释放结论；Jieshu 活动应用内存已改善 | 单应用 3.762/4.010 MiB、五应用 8.437/9.892 MiB（J/W）；最终静置 3.238/2.922 MiB，Jieshu 仍高                                                                 |
| PERF-004 | 未解决                                      | Jieshu gzip 32,759 B、Wujie 19,802 B；Jieshu 相比自身基线还多 156 B。堆快照指向源码及编译代码成本，未证明为子应用泄漏                                        |
| PERF-005 | 主要热点已优化，保留未达标项                | 同轮并发中位数 J/W=70.05/72.50 ms、CPU=123.55/128.65 ms，fiber P95=46.40/47.76 ms；并发 P95 J仍高3.41%，资源延迟差区间跨零、需复核；不能宣称所有启动场景持平 |
| ENV-002  | 新发现的测试启动问题；临时绕开，未改配置    | 选 Rspack 主应用时重复 --port，首次零用例；修正临时启动命令后 77/77 通过。默认 Webpack 主应用原配置另跑 77/77 通过                                           |

ENV-002 的复现条件是 `JIESHU_REACT_MAIN_WORKSPACE=main-react-ts` 与 `JIESHU_REACT_MAIN_PORT=7800`：`examples/main-react-rspack/package.json` 的 integration 脚本内已有 `--port 7700`，集成配置又追加端口。rspack 收到 `[7700, 7800]` 而报 `ERR_INVALID_ARG_VALUE`，服务未就绪，不属于本轮核心行为失败。实际临时配置、原始失败日志与两套通过命令均记录在 [validation.json](./results/2026-09-09-optimized/validation.json)。

本轮最终回归为 515 项 core 单测、137 项 core Chromium、两种 React 主应用各一轮 77 项集成，均通过。审查中捕获并补回归修复了新优化的两个边界：嵌套 Loading 被错误识别为外层所有，以及撤销的宿主函数 Proxy 在构造器分类时抛错。二者已修正后才进行最终采样，不当作最终仍存在的问题。
