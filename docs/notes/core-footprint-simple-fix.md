# 核心成本的最小修复

这是[原因分析](./core-footprint-analysis.md)之后的第一步实现，基线为 Jieshu `bc688b2`、本地 Wujie `c4593299`。本次只处理未知应用名空销毁的记录增长，以及三个私有常量对象的冗余；没有新增使用计数、共享协议版本或回收配置。

## 实现与边界

`destroyApp` 在没有实例、没有未完成 teardown、也没有已有操作记录时，直接返回已完成 Promise。查询沿用原来的注入入口优先级，只读而不创建表。三个条件在同一同步调用中检查，没有等待间隙。

- `setupApp` 缓存的配置仍保留。
- 排队 preload 在调用时就有操作记录，因此仍走原取消流程。
- 已经从实例表移除、但尚未完成清理的应用，仍等待 teardown，并传播失败。
- 不删除或改变任何已有操作槽，所以没有引入旧 core 不会登记计数的问题。

这只消除从未使用过的名称空销毁导致的增长。真实应用使用结束后的历史记录仍保留，不能据此宣称整个操作记录生命周期已修复，或任意版本组合已验证兼容。

另一项改动把 `constant.ts` 中 `elementProtocol`、`runtimeProtocol`、`diagnosticText` 三个私有对象及解构导出改为同值直接常量。26 个导出值和 TypeScript 类型均与基线逐项对照一致；详情文本显式保留原 `string` 类型，其他初始化表达式不变。

## 包体实测

两份本地源码统一使用生产压缩、ES2018、IIFE，比较全部公开运行时导出。

| 构建                                     | raw（B） | gzip（B） |
| ---------------------------------------- | -------: | --------: |
| Jieshu 原基线                            |  108,681 |    32,759 |
| 仅空销毁判断                             |  108,808 |    32,793 |
| 空销毁判断与常量简化合并，查询共用原函数 |  108,183 |    32,603 |
| 本地 Wujie，同轮构建                     |   65,660 |    19,802 |

最终净减少 **498 B raw、156 B gzip**，覆盖了新判断本身的成本。这是小幅改善，仍未追平 Wujie。构建记录包括源码状态、产物哈希和常量等价检查，见[本次结果](../../benchmarks/comparison/results/2026-09-09-simple-fix/)。

## 空销毁与核心加载复测

空销毁仍按两框架、同名/不同名、各三轮执行，共 12 个独立 context、12,000 次公开调用。60 个检查点全部通过，两条共享入口的操作槽数全过程为 **0**，没有残留实例或 iframe。此前 1,000 个不同名称会留下 1,000 个槽，现已消除。

Jieshu 1,000 个不同名称空销毁后的 GC 堆中位数从分析基线的 1,504,756 B 降至本轮 1,329,556 B，观察差值 175,200 B；同轮 Wujie 为 1,268,472 B，与原对照相同。这个总堆差值也包含代码/JIT等成本变化，不能全部叫作泄漏修复，更不能代替真实应用生命周期的内存数据。[空销毁明细](../../benchmarks/comparison/results/2026-09-09-simple-fix/idle/summary.json)

纯核心加载重新串行交错采样，legacy/UTF-8 各框架各 30 次，共 120/120 通过；12/12 trace 完成且没有数据丢失。UTF-8 的结果如下：

| 指标             | 本地 Wujie | Jieshu 最终版本 |
| ---------------- | ---------: | --------------: |
| 核心加载中位数   |    3.20 ms |         4.25 ms |
| 核心加载 P95     |    3.30 ms |         4.51 ms |
| 加载后 GC 堆增量 |  161,244 B |       217,328 B |

Jieshu 的固定堆增量比原分析基线 217,420 B 少 92 B，两边 DOM/监听计数一致。中途查询包装的实现曾增加 184 B，删除一层包装后仍增加 44 B；最终将只读与创建访问共用原函数，才消除这项固定开销。各次结果保存在[变体记录](../../benchmarks/comparison/results/2026-09-09-simple-fix/load/variants.json)，没有隐藏这次发现的问题。

**仍不能宣称加载速度已经改善或与 Wujie 持平。** 两轮 Wujie 对照耗时也有变化，尚未对旧/新 Jieshu 做同轮交错 A/B；4.40→4.25 ms 不能直接归因于这 498 B 的缩减。最终同轮 Jieshu 仍比 Wujie 慢约 1.05 ms，固定堆仍多 56,084 B。[加载明细](../../benchmarks/comparison/results/2026-09-09-simple-fix/load/summary.json)

## 验证范围

新增测试检查 1,000 个未知名称无记录、配置保留、仅 teardown 时等待及异常传播，以及操作槽仅在注入入口可见时的预加载取消。原有启动取消、重入、多份 core、跨 realm、资源加载等回归继续执行。

性能复测分别记录空销毁与纯核心加载；空销毁不会挂载子应用，不代替真实挂载/销毁循环。每次用新目录，保留此前分析数据，未提交源码须显式启用 worktree 测量并记录指纹。

最终运行：

| 命令                                                                                                                                               | 结果                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm --filter @cloud/jieshu-core test:unit`                                                                                                       | 53 个文件、520 项通过；覆盖率 statements 78.76%、branches 71.62%、functions 83.85%、lines 80.76% |
| `pnpm --filter @cloud/jieshu-core exec playwright test --config __test__/browser/playwright.config.mts`                                            | 137 项通过                                                                                       |
| `NODE_OPTIONS=--openssl-legacy-provider pnpm --filter @cloud/jieshu-core exec playwright test --config __test__/integration/playwright.config.mts` | 77 项通过，默认 Webpack React 主应用与 Vue 主应用                                                |
| `pnpm --filter @cloud/jieshu-core typecheck`                                                                                                       | 核心和三类测试类型检查通过                                                                       |
| `pnpm --filter @cloud/jieshu-core build`                                                                                                           | ESM、UMD、声明构建通过，构建产物未纳入改动                                                       |
| 修改文件的 ESLint、Prettier、诊断脚本语法、`git diff --check`                                                                                      | 通过                                                                                             |

最终查询使用 TypeScript 重载区分只读与创建路径；两处局部 ESLint 注释仅说明基础 `no-redeclare` 对合法重载的误报。注释添加后重新构建，产物 SHA-256 与性能采样完全一致。源码、脚本和日志校验信息见[验证记录](../../benchmarks/comparison/results/2026-09-09-simple-fix/validation.json)。本次未修改框架适配包，未创建新提交。
