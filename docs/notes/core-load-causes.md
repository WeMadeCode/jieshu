# 核心加载为什么慢

日期：2026-09-09。本轮分析 Jieshu `557c51d` 与本地 Wujie `c4593299`，只新增诊断脚本和记录，没有修改核心或适配包。接续[上一轮优化](./instanceof-memory-optimization.md)。

**主要差距来自更多 JavaScript 代码的预解析、编译等准备工作；导入时的额外初始化也有成本，但单独延后缓存或入口注册不足以追平。** 这不是在核心加载阶段执行了 iframe 枚举或子应用挂载：这些操作还没有发生。

当前已经能定位原因和候选方向，但还没有经过行为验证、能够消除全部加载差距的实现。诊断构建故意跳过部分功能，不能作为优化代码交付。

## 测量范围与基线

先审计旧加载观测和源码，再构建七种固定变体，浏览器预检后进行串行交错实验，最后独立采集 trace。全部使用 UTF-8、ES2018、生产压缩 IIFE、完整公开运行时导出；两基线 SHA 与上一轮完全一致。

| 版本   | raw（B） | gzip（B） | SHA-256                                                            |
| ------ | -------: | --------: | ------------------------------------------------------------------ |
| Jieshu |  108,581 |    32,708 | `3aff6614cb7d47525cd662c87ebbeeae74c8ba76fd02f92a660d8ea403f8c84e` |
| Wujie  |   65,660 |    19,802 | `6a950d2373d9804976ceaca5e7b2085935629e10c1e66e373635b86dc00a6794` |

每条观测使用独立 context，不安装子应用或旧 benchmark fixture；禁用 HTTP 缓存，网络为本机 HTTP，gzip 预先生成。七变体 × 两种传输 × CPU 1x/4x × 35 轮，共 **980 条普通观测**。Trace 只测 CPU 1x，每条件另取 7 次，共 **98 条**，不混入普通计时。CPU 和传输顺序交替，变体循环轮转并按块反转。

| 指标，中位数                         |    Wujie |   Jieshu |  同轮差值 |
| ------------------------------------ | -------: | -------: | --------: |
| CPU 1x，原始传输，总加载             |  3.70 ms |  4.90 ms |  +1.20 ms |
| CPU 1x，gzip，总加载                 |  3.70 ms |  4.90 ms |  +1.20 ms |
| CPU 1x，原始传输，请求至响应结束     |  1.10 ms |  1.10 ms |      约 0 |
| CPU 1x，原始传输，响应结束至 onload  |  2.00 ms |  3.10 ms |  +1.10 ms |
| CPU 1x，原始传输，CDP ScriptDuration | 0.312 ms | 0.561 ms | +0.249 ms |
| CPU 4x，原始传输，总加载             |  8.50 ms | 10.50 ms |  +2.00 ms |
| CPU 4x，gzip，总加载                 |  8.40 ms | 10.60 ms |  +2.20 ms |

两种 CPU 1x 传输的总加载差值，35 轮配对 bootstrap 95% 区间均为 **[1.10, 1.30] ms**。统计量为同一批有效 round 上的 `median(A) − median(B)`，不是逐对差值的中位数；固定 seed、5000 次重采样，不作多重比较校正。区间仅描述这次采样的不确定性，不是跨设备保证。

本轮采样器和采样时段与旧轮不同，不能拿旧的 4.40 ms 与新的 4.90 ms 判断源码退化；源码产物 SHA 未变。正文传输、后台准备、主线程编译和执行会重叠或嵌套，表内差值不能直接相加为总加载差值。`responseEnd→onload` 不是纯执行时间，`ScriptDuration` 也包含相同 probe 的执行和导出检查。

## 证据一：等体积并没有让 Wujie 同样变慢

在 Wujie 已压缩产物末尾增加 ASCII 注释，使原始 UTF-8 长度恰好等于 Jieshu 的 **108,581 B**。没有增加可执行语句，也没有重新压缩 JavaScript 或删改函数。

- 原始传输：Wujie 3.70 ms，填充后仍为 3.70 ms，配对差值 0 ms，95% 区间 [−0.10, 0.10] ms。
- 同样大小的 Jieshu 是 4.90 ms。
- Trace 中后台准备仍约 1.27 ms，预解析事件仍为 155 次。

这排除了“本机多传输这些字节就会慢 1.2 ms”的解释，支持额外的代码语法和编译工作才是主要差异。注释不等于相同复杂度的 JavaScript，不能据此推导每 KB 代码的耗时。填充只匹配 raw 大小，其 gzip 是 20,112 B，不与 Jieshu 匹配。

实际开启 gzip 后，两基线传输正文分别为 19,802 / 32,708 B，浏览器记录的编码前后字节数逐条核对通过，但这轮本地总加载差距仍为 1.20 ms。**gzip 没有解决本轮本地差距，不代表它在线上网络无价值**；本轮没有模拟公网 RTT、带宽、CDN 或代码缓存命中。

## 证据二：不运行初始化，后台差距仍存在

对两边唯一的 `ComparisonCore` IIFE 初始化表达式加 `false &&`，保留其余代码文本。这时整个核心不执行初始化，导出不可用，专用于检查初始化是否解释了全部差距。

| CPU 1x，原始传输                  |    Wujie |   Jieshu |
| --------------------------------- | -------: | -------: |
| 正常总加载                        |  3.70 ms |  4.90 ms |
| 跳过全部初始化后的总加载          |  3.30 ms |  4.10 ms |
| 正常后台准备，trace 中位数        | 1.269 ms | 2.197 ms |
| 跳过全部初始化后的后台准备        | 1.192 ms | 2.022 ms |
| 正常 EvaluateScript，trace 中位数 | 0.391 ms | 0.667 ms |
| 跳过全部初始化后的 EvaluateScript | 0.057 ms | 0.059 ms |

跳过初始化后，主线程 EvaluateScript 已基本相同，**总加载仍差 0.80 ms**，配对区间 [0.70, 1.00] ms；后台准备差距也仍存在。gzip 对照也留下 0.80 ms 的总加载差值。

这是“仅减初始化不能解决主要差距”的强证据，不能把 0.80/1.20 算成精确的解析占比。常量短路还可能改变 V8 的 eager/lazy 编译选择；保留源码文本不代表解析、编译策略完全不变。Trace 与非 trace 又是不同观测，所以不把它们拼成一个可相加的时间分解。

正常原始传输的 7 份 trace 中，Jieshu/Wujie 后台预解析事件为 **346 / 155 次**，EvaluateScript 内的 CompileCode 事件为 **16 / 4 次**。这些是事件数量，不是唯一函数数量；没有源码函数名的事件只按线程和父事件区间归属，不能据此给某个模块分配毫秒。

V8 即使延后完整编译，也需要预解析函数语法和作用域相关信息；“函数尚未执行”不等于“加载没有成本”。这是引擎机制，与本轮观测吻合。[V8 预解析说明](https://v8.dev/blog/preparser)、[后台编译说明](https://v8.dev/blog/background-compilation)

## 证据三：额外初始化存在，但单项收益有限

从空白宿主首次导入的源码调用路径计数，Jieshu 显式创建 Map / WeakMap / Set / WeakSet 为 **14 / 17 / 10 / 4**，Wujie 为 **2 / 4 / 1 / 0**。独立 Chromium 诊断通过包装集合构造器再次得到同样结果；这不包括 V8 内部对象或总内存，同页已有共享注册表时计数可能减少。

最大的具体候选是 `entry.ts` 的三个 AssetCache：共 18 个集合容器及 9 个箭头方法闭包。两边都会创建 EventBus、绑定 fetch、捕获原生 DOM 方法、注册 popstate 和定义自定义元素。Jieshu 另有模板与代理查找集合、清理状态表、处理器注册等工作。

做两组独立干预，均在已压缩产物中通过 AST 与当次 source map 定位，只插入短路条件，保留原函数体：

| 干预                             | 原始传输总加载变化 | gzip 总加载变化 | 原始传输 ScriptDuration 变化 | 加载后 GC 堆变化 |
| -------------------------------- | -----------------: | --------------: | ---------------------------: | ---------------: |
| 跳过三个 AssetCache 构造         |           −0.20 ms |         0.00 ms |                    −0.078 ms |         −4,232 B |
| 跳过路由监听与自定义元素入口注册 |           −0.20 ms |        −0.10 ms |                    −0.061 ms |           −316 B |

缓存干预的 gzip 总加载配对区间为 [−0.20, 0.00] ms；CPU 4x 的原始传输总加载差值为 0 ms，区间 [−0.50, 0.30] ms。缓存可减少固定开销，但尚不能承诺跨条件稳定节省 0.20 ms。跳过缓存后主线程 CompileCode 事件从 16 变成 15 次，也直接说明干预包含按需编译变化，不能称作纯构造耗时。

额外的 8 条运行验证确认：缓存控制精确少 9 个 Map、6 个 WeakMap、3 个 WeakSet；入口控制的 popstate 从 1 次注册变成 0 次，并且没有定义自定义元素。空脚本与两个全初始化跳过组都没有集合分配或事件注册。完整导出名单也与各自基线核对一致。这些验证包装了构造器和事件注册函数，只验证干预是否生效，不纳入计时，也不证明功能等价。

跳过缓存的构建不能正常加载资源或执行 clearAssetsCache；跳过入口注册的构建缺少路由与自定义元素行为。两组都不能直接拿来做功能等价声明，也不能简单累加两项收益。原冻结 manifest 中对缓存实验的“isolates eager construction costs”表述偏强，原记录保留，后续脚本说明已修正为“初始化及其触发的编译、分配开销”。

## 更多代码主要在哪里

对当前同哈希产物重新按 source map 的生成区间分配字节，并按职责合并文件：

| 职责                              | Jieshu raw 映射字节 |  Wujie |    增量 |
| --------------------------------- | ------------------: | -----: | ------: |
| 生命周期、sandbox、入口与操作协调 |              24,448 | 11,304 | +13,144 |
| HTML 模板与资源入口               |              17,736 |  6,674 | +11,062 |
| 动态 DOM / 资源处理               |              13,460 |  6,643 |  +6,817 |
| iframe、脚本与内联事件            |              20,866 | 14,109 |  +6,757 |

这四组解释了 **42,921 B raw 差额中的 37,780 B（约 88%）**。它们包含更多隔离、取消、异步卸载、资源身份和 HTML 处理逻辑，详见[既有源码分析](./core-footprint-analysis.md)。这是体积归属，不是可直接删除的字节，也不是加载耗时占比；本轮没有得到可靠的逐模块解析毫秒。

只导入 startApp 后，Jieshu 仍为 **102,936 B / gzip 31,305 B**，Wujie 为 **64,115 B / gzip 19,461 B**；未使用的公开 API 不是主要来源。ES2022 全包诊断为 Jieshu 103,554 B、Wujie 62,967 B，差距仍大，而且改变 target 会改变兼容要求。本轮没有修改 ES2018。

## 下一步怎么做

1. **优先减少首批必须携带的代码。** 在上述体积增量最大的模块中，先查重复的生命周期分支、取消检查和资源处理代码，做保持语义的合并；每项同时看产物字节和加载 A/B。优先从生命周期协调与模板/资源入口着手，不能靠删隔离或异常路径换取较短代码。
2. **缓存懒创建作为小范围候选。** 已有约 4.2 KB 固定 GC 堆和少量初始化开销的证据；实现时须验证旧 cache record 深导入、clearAssetsCache、fetch 身份隔离及取消语义。成本会移到首次使用，必须同时复测核心加载和首次 startApp，不能只报告前者变快。
3. **若等价精简仍不足，再评估可选分包。** 真正不进入首次下载的代码能减少相应的源码准备，但动态加载会增加请求、异步边界，并可能影响同步入口和首个子应用启动。当前只有方向，没有经过验证的分包方案。

不建议把改几个常量、缓存对象、gzip 或提高 target 当成能直接追平的方案。当前还不能承诺在保留全部行为的同时消除这 1.2 ms 差距。

## 发现的测量问题与边界

- `v8.parseOnBackground` 包含预解析和后台编译，不是纯 parse；只看约 0.02 ms 的主线程 `v8.compile` 会漏掉大量工作。
- `ResourceFinish.ts` 是延后通知，真实网络完成需取 `args.data.finishTime` 并统一单位；错误使用通知时间会把后台处理误计为网络。
- 原始传输的本轮 trace 均先结束网络、再开始后台准备；**gzip 经常边收边准备**，不能把旧的“全部发生在响应之后”推广到压缩传输。全部 98 份 trace 都显示后台完成后才开始 EvaluateScript，但这不等于量出了后台工作的精确因果占比。
- CPU 4x 是 CDP 模拟，不能代表某款移动设备，也不能假设所有后台线程按同一倍数变慢。
- 独立 context 与禁用 HTTP 缓存不保证冷浏览器进程；内部编译缓存未显式清空。没有覆盖生产 ESM 消费、其他浏览器、公网或实际业务页面。
- 42 条预检、980 条正式导入/传输观测、98 条 trace 校验通过，仅证明诊断输入和预期状态有效；不代表故意缺失功能的变体可用于生产。构建包、source map、heap 与完整 trace 没有加入版本化数据。
- 辅助 JSDOM 检查因默认 window.fetch 缺失而停止，记录为环境限制；最终采用真实 Chromium 预检，没有把它计作核心故障。

原始观测、环境、静态清单、时序审计、配对统计、完整性校验见[本轮结果](../../benchmarks/comparison/results/2026-09-09-core-load/)。

## 复现

每次使用新目录；构建完成后再采样，不并行运行构建或其他高负载测试。

```bash
CORE_CAUSE_OUTPUT=test-results/core-load-causes-new node benchmarks/comparison/prepare-core-load-variants.mjs
CORE_CAUSE_INPUT=test-results/core-load-causes-new CORE_CAUSE_RUN=test-results/core-load-causes-new/preflight CORE_CAUSE_SAMPLES=1 CORE_CAUSE_TRACE_SAMPLES=1 node benchmarks/comparison/measure-core-load-causes.mjs
CORE_CAUSE_INPUT=test-results/core-load-causes-new CORE_CAUSE_RUN=test-results/core-load-causes-new/formal node benchmarks/comparison/measure-core-load-causes.mjs
node benchmarks/comparison/summarize-core-load-causes.mjs test-results/core-load-causes-new/formal
# 在计时全部结束后，单独核对分配、监听注册和完整导出名单。
CORE_VERIFY_INPUT=test-results/core-load-causes-new CORE_VERIFY_OUTPUT=test-results/core-load-causes-new/runtime-verification.json node benchmarks/comparison/verify-core-load-variants.mjs
```

脚本验证基线与 guard 的原文恢复、实际 gzip 解压结果、响应编码前后字节、导出与标签状态；统计脚本检查重复观测、配对完整性及 trace 缺失。语法、ESLint、Prettier 和四项统计合成检查通过。核心源码没有变动，本轮不重复运行已通过的核心行为回归。
