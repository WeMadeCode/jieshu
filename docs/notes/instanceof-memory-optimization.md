# instanceof 补丁状态的空闲内存优化

本轮接续[核心成本的最小修复](./core-footprint-simple-fix.md)，处理真实子应用挂载、销毁后仍由模块持有的 WeakMap 空表。目标是验证原因、采用局部改动并量化收益和代价；本轮没有新增跨版本登记协议或公开配置。

## 基线与复现

Jieshu 基线是上一轮尚未提交的简单修复版本，不是直接使用 `bc688b2`。统一生产压缩、ES2018、IIFE，全部公开运行时导出：

| 版本                  | raw（B） | gzip（B） | SHA-256                                                            |
| --------------------- | -------: | --------: | ------------------------------------------------------------------ |
| 本轮 before           |  108,183 |    32,603 | `f67ade90e3b0bac404996ea38ec6d3f39a12abea261191bc92ccf7d62494e433` |
| 本轮 after            |  108,581 |    32,708 | `3aff6614cb7d47525cd662c87ebbeeae74c8ba76fd02f92a660d8ea403f8c84e` |
| 本地 Wujie `c4593299` |   65,660 |    19,802 | `6a950d2373d9804976ceaca5e7b2085935629e10c1e66e373635b86dc00a6794` |

分别执行 `BENCH_CYCLES=30` 和 `100`，每种参数各测 before/after 一轮，每轮包含两个框架。夹具包含首次挂载、同资源 N 次、不同资源 N 次、5 个同时存活应用，因此每框架实际挂载/销毁次数是 `2N+6`，即 **66 / 206 次**，不是总共 30 / 100 次。每条记录有 24 / 52 个 GC 检查点。最终清空资源缓存，等待 5.5 秒并强制 GC，再保存堆快照。

## 原因与实现

原实现把补丁状态放在模块级 `instanceofPatchStates` WeakMap 中。构造器消失后，键和值已被回收，但 V8 仍保留其哈希表容量。两张 before 快照均有 **32,788 B 空底表**，2145 个 Hole→Hole 记录，没有活键记录。持有链是 host Window → `__getJieshuWindow__` 闭包 → bundle Context → WeakMap → 空底表。

这证明特定表的空容量残留，不代表该表仍泄漏子应用对象。两次容量相同，也没有证明它随循环次数线性增长；最终都有 5 个应用同时存活的阶段。

实现把普通构造器的状态放在本模块私有 Symbol 属性上，让状态随构造器一起回收。共享构造器 facade 从自己的 Proxy `get` 返回状态，避免写到 host 原始构造器。不能附加或读取状态的特殊构造器，才懒创建原有 WeakMap 作为兜底。

状态读取验证构造器身份，避免误用继承来的状态；保留重复注册计数、幂等 release、用户替换 handler 后不重新接管的语义。没有按销毁次数清空全局记录，也没有改变操作槽回收策略。

两张 after 快照中，与当次 bundle 匹配的 Context 的 fallback 变量都明确指向原生 **undefined** 节点，证实备用 WeakMap 未分配；同一 Context 仅保留 16 B 的私有 Symbol。审计脚本从实际 bundle AST 推导变量、核对产物 SHA 与 heap Script/Context，不依赖压缩变量名，也不把“找不到旧表”当作成功。

## 实测收益与成本

下表是单轮最终强制 GC 的总 JS 堆，不是浏览器 RSS，也不是统计显著的总体估计。

| 循环参数 | Jieshu before（B） | Jieshu after（B） | 差值（B） | Wujie before / after（B） |
| -------- | -----------------: | ----------------: | --------: | ------------------------: |
| 30       |          3,394,936 |         3,368,604 |   −26,332 |     3,065,540 / 3,065,692 |
| 100      |          3,486,256 |         3,460,840 |   −25,416 |     3,111,480 / 3,112,712 |

空表移除了 32,788 B，但总代码、JIT 和其他对象成本也变化，不能声称总堆净省了 32,788 B。实际观察净减少约 25–26 KB。最终两框架都回到 1 个 document、11 个 DOM node、3 个监听器。

| 其他指标                 |      before |       after | 解释                                                      |
| ------------------------ | ----------: | ----------: | --------------------------------------------------------- |
| gzip 包体                |    32,603 B |    32,708 B | 本轮增加 105 B；合并上一轮后比 `bc688b2` 仍少 51 B        |
| 纯核心 GC 堆增量，UTF-8  |   217,328 B |   217,384 B | 本轮增加 56 B                                             |
| 单应用挂载后 GC 堆       | 3,945,272 B | 3,945,836 B | 两种循环参数都增加 564 B                                  |
| 5 应用同时存活，30 参数  | 8,839,816 B | 8,841,000 B | 增加 1,184 B                                              |
| 5 应用同时存活，100 参数 | 8,939,172 B | 8,933,964 B | 减少 5,208 B；同轮 Wujie 也减少 4,048 B，不能全归因于实现 |

候选的第一轮纯加载采样中 Jieshu 中位数 4.65 ms、Wujie 3.40 ms，不能直接与上一轮的 4.25 / 3.20 ms 作因果比较。新增历史产物输入，以 before、after、Wujie 同轮交错复测，并使用等长的 before/jieshu URL，避免 URL 长度干扰微小内存差值。

同轮 A/B 的 UTF-8 结果如下，每份产物 30 次；另测 legacy 编码，合计 180/180 次加载通过，18/18 份 trace 完成。

| 指标             |     Wujie | Jieshu before | Jieshu after |
| ---------------- | --------: | ------------: | -----------: |
| 加载中位数       |   3.20 ms |       4.30 ms |      4.40 ms |
| 加载 P95         |   3.81 ms |       4.76 ms |      4.90 ms |
| 脚本执行中位数   |  0.272 ms |      0.505 ms |     0.500 ms |
| 加载后 GC 堆增量 | 161,244 B |     217,328 B |    217,384 B |

本轮观测到总加载中位数增加 0.10 ms，脚本执行没有同向增长。这是有限样本下的差值，不能据此承诺加载完全无回归；也不能说该改动改善了核心加载。当前核心加载仍比 Wujie 慢约 1.20 ms。

启动复测选取与此次构造器初始化相关的四个场景，每框架每场景 30 次，240/240 个正式样本通过。ready 时间从调用启动到夹具 DOM 就绪后的帧边界，不包含独立的核心加载时间。

| 场景         | Wujie ready 中位数 / P95（ms） | Jieshu ready 中位数 / P95（ms） |
| ------------ | -----------------------------: | ------------------------------: |
| cold         |                  36.85 / 42.88 |                   35.50 / 41.80 |
| cold-fiber   |                  51.45 / 56.85 |                   48.20 / 62.69 |
| concurrent-5 |                  72.60 / 74.57 |                   70.85 / 75.01 |
| cpu4x        |                126.90 / 132.92 |                 121.95 / 126.66 |

四个 ready 中位数都低于同轮 Wujie，但 **cold-fiber 的 P95 高 5.84 ms**，并发 5 应用的 P95 高 0.44 ms；后者 API 返回中位数也稍高（57.95 对 57.10 ms）。不能据此声称所有启动指标持平。该组只有 after 与 Wujie 的同轮对照，不能把尾部差异归因于本轮源码修改。原始分布和 bootstrap 范围见结果中的 `startup-focused/summary.json`。

## 发现的问题与边界

1. 状态迁移有固定代价：gzip 增加 105 B、核心 GC 增加 56 B；并非每个指标都改善。普通真实销毁场景的空闲堆收益远大于这项成本。
2. 不可扩展或拒绝 metadata 的构造器走 fallback WeakMap，这些特殊工作负载仍可能保留空表容量。
3. 私有 Symbol 属性不参与普通枚举，但 `Reflect.ownKeys` / `Object.getOwnPropertySymbols` 可以看到；它不是不可观察的状态。
4. 多份 core 交替 patch 同一构造器的协调限制仍存在。本轮没有引入版本协议，也没有证明任意新旧版本组合兼容。
5. Jieshu 核心包体、纯核心固定内存和销毁后的总堆仍大于本地 Wujie，不能宣称已经持平。30 / 100 参数 after 的空闲堆仍分别多 302,912 / 348,128 B。
6. 本机临时 pnpm 路径失效曾让命令落到其他 pnpm 并在安装确认前中止；没有清空依赖。重新取得仓库指定的 pnpm 10.28.2 后完成验证。该次是工具环境失败，不记作产品失败。
7. 启动尾部仍有上述 cold-fiber / 并发差异；稳定性压力复测则为 Jieshu 48/48、Wujie 42/48。Wujie 在启动中销毁、同名并发请求不同容器两个场景各失败 3 次，出现读取 null.protocol 的 TypeError 与残留 loading。这是本地 robustness 观察，与此前问题类别一致，不代表所有业务场景的稳定性排名。

## 复现与验证

复现时使用新输出目录，性能采样期间不要同时执行其他构建或浏览器测试。before 必须使用上述已保存产物或与之哈希相同的源码构建；不能把当前 after 源码跑出的结果标成 before。

```bash
BENCH_MODE=memory BENCH_MEMORY_ROUNDS=1 BENCH_CYCLES=30 BENCH_HEAP_SNAPSHOT=1 BENCH_OUTPUT=test-results/instanceof-new-30 node benchmarks/comparison/run.mjs
BENCH_MODE=memory BENCH_MEMORY_ROUNDS=1 BENCH_CYCLES=100 BENCH_HEAP_SNAPSHOT=1 BENCH_OUTPUT=test-results/instanceof-new-100 node benchmarks/comparison/run.mjs
CORE_LOAD_BEFORE_BUNDLE=test-results/footprint-simple-final-load/jieshu.js CORE_LOAD_OUTPUT=test-results/instanceof-new-load-ab node benchmarks/comparison/measure-core-load.mjs
node benchmarks/comparison/inspect-instanceof-heap.mjs test-results/instanceof-new-30/jieshu-final.heapsnapshot test-results/instanceof-new-load-ab/jieshu.js
```

同一次快照只对应同哈希产物；heap 审计遇到不认识的 V8 布局或缺失绑定时报告证据不足。完整 heap、bundle、trace 和测试日志保留在忽略目录；版本化结果只保留原始观测、环境、审计与校验清单。

验证使用 pnpm 10.28.2，未修改 React/Vue 适配包。新增 9 个补丁状态用例覆盖子类语义、重复注册与 release、构造器跨窗口别名、用户覆盖 handler、不可扩展构造器、两种拒绝 metadata 的 Proxy，以及已经 patch 的 host 构造器建立 facade 后的隔离与 Proxy invariant。

| 命令                                                                                                                                               | 结果                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm --filter @cloud/jieshu-core test:unit`                                                                                                       | 54 文件、529 项通过；最终覆盖率 statements 79%、branches 71.82%、functions 83.99%、lines 80.92% |
| `pnpm --filter @cloud/jieshu-core exec playwright test --config __test__/browser/playwright.config.mts`                                            | 137 项通过                                                                                      |
| `NODE_OPTIONS=--openssl-legacy-provider pnpm --filter @cloud/jieshu-core exec playwright test --config __test__/integration/playwright.config.mts` | 77 项通过，默认 Webpack React 主应用与 Vue 主应用                                               |
| `pnpm --filter @cloud/jieshu-core typecheck`                                                                                                       | 核心、unit、browser、integration 类型检查通过                                                   |
| `pnpm --filter @cloud/jieshu-core build`                                                                                                           | ESM、UMD、声明构建通过；构建产物未纳入改动                                                      |

此外执行 4 组真实生命周期记录（每组两框架，共 8/8）、180 次同轮核心加载、18 份独立 trace、240 次相关场景启动以及 96 次稳定性观察。稳定性中的 6 个 Wujie 失败完整保留；采样器退出成功不等于所有产品用例通过。

最终仅增加了一行解释空表容量问题的源码注释；随后同轮 A/B 重新构建的 after SHA 与 30/100 轮快照完全一致。原始观测、审计和来源校验见[本轮结果](../../benchmarks/comparison/results/2026-09-09-instanceof/)。
