# jieshu 与 wujie 源码缺陷修复 TODO

本文记录 2026-09-07 源码对比中发现的问题，供后续修复、补充回归测试和更新公开契约使用。初始审计记录 11 项，修复中新增 FIX-012；当前共 **12 项，已修复 4 项（FIX-001、FIX-002、FIX-003、FIX-012），剩余 8 项 P2**。修复范围、验证结果和限制见对应条目及文末交付记录。

## 使用与关闭规则

- 每项使用稳定编号 `FIX-001` 至 `FIX-012`，后续提交、测试和讨论可以直接引用编号。
- 开始修复时，将具体复现步骤转为仓库内的失败测试；不要只依据旧行号修改实现。
- 勾选总览中的完成框前，必须完成该项的修复与验收清单，并在文末登记验证命令、结果及提交或 PR。
- “与 wujie 相同”仅说明问题来源，不表示行为正确；“现有测试通过”不表示本文的边界场景已经通过。
- 本文补充了 [历史回归审计](./changelog-regression-audit.md) 尚未覆盖的组合场景。旧报告中关于销毁、事件清理和路由的验证结论，不能扩大到本文列出的场景。

## 对比基线与证据范围

| 项目                | 基线                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| 审计日期            | 2026-09-07                                                                                  |
| jieshu HEAD         | `6d118ee9cc86af99f09158e8e9576c372b62dc07`                                                  |
| wujie HEAD          | `c45932998c0602f34454df8d3e29f4d33a38446a`                                                  |
| 实际比较对象        | 两个本地仓库当时的工作区源码，包含已有未提交改动；不等同于官方发布版本                      |
| jieshu 当时已有改动 | `examples/main-react-rspack/src/fetch.ts`                                                   |
| wujie 当时已有改动  | `package.json`、`pnpm-lock.yaml`、`packages/wujie-core/src/{common,entry,index,sandbox}.ts` |
| 主要审查范围        | core 的入口、沙箱生命周期、动态资源、DOM 补丁、事件清理、路由、缓存；另核对适配包打包方式   |

**初始审计时已执行的验证（修复后的结果见文末）：**

1. jieshu 核心单元测试 **44 个文件、327 项全部通过**。覆盖率：statements 75.29%、branches 67.55%、functions 79.65%、lines 78.06%。
2. 临时增加 **9 个定向行为断言，9 项均失败**，对应 FIX-001 至 FIX-006、FIX-008、FIX-010、FIX-011。这些用例尚未纳入仓库测试集；部分使用聚焦的 sandbox fixture，不能代替完整浏览器集成测试。
3. 使用真实 Chromium 对两个仓库执行 **7 组同参数场景**，对应 FIX-001、FIX-002、FIX-003、FIX-005、FIX-006、FIX-007、FIX-009。两个仓库均以当前源码临时打包，在本地 HTTP 页面中通过真实 `startApp` 等路径运行。对照使用 `fiber: true`，没有使用修改后的框架实现。
4. 浏览器场景保存的是观测值，不是“回归测试已通过”。各项观测值已写入本文，后续需要转成明确的自动化断言。
5. 未执行整套 examples 集成测试、适配包测试或 Safari/Firefox 验证；没有据此宣称跨浏览器或适配包全量验证通过。

核心单测实际执行命令如下。最初的 pnpm 入口触发依赖检查，因非交互环境中止；随后直接调用已安装的 Vitest，没有重装依赖。

```bash
node node_modules/vitest/vitest.mjs run --config packages/jieshu-core/__test__/unit/vitest.config.mts --coverage
```

源码定位中的行号均为审计时的参考位置，后续应以函数名和测试场景为准。下文未注明仓库的源码路径均相对于 jieshu 根目录。

## 修复总览

- [x] **P1 · [FIX-001](#fix-001)**：保活应用后台加载脚本导致队列阻塞。已统一状态校验与队列收尾；内联 module 的独立完成语义问题见 FIX-012。
- [x] **P1 · [FIX-002](#fix-002)**：旧 head/body 引用可向同名新实例注入代码。jieshu 已修复并补充回归测试；wujie 未修改。
- [x] **P1 · [FIX-003](#fix-003)**：旧应用异步销毁误清理新应用容器。jieshu 已限定清理范围并补充回归测试；wujie 未修改。
- [ ] **P2 · [FIX-004](#fix-004)**：公开 API 的 Promise 提前完成。普通调用与卸载重入处理混在一起。
- [ ] **P2 · [FIX-005](#fix-005)**：多份 core 的事件清理恢复已销毁实例的处理器。两边共有，jieshu 的单副本修复覆盖不足。
- [ ] **P2 · [FIX-006](#fix-006)**：子应用路由同步清空主应用 `history.state`。两边共有。
- [ ] **P2 · [FIX-007](#fix-007)**：合成 `load` 早于 async 脚本执行。两边共有。
- [ ] **P2 · [FIX-008](#fix-008)**：已完成资源缓存跨请求上下文串用。风险已复现，缓存共享契约需要明确。
- [ ] **P2 · [FIX-009](#fix-009)**：首次 HTML/CSS 处理未应用 `replace`。两边共有。
- [ ] **P2 · [FIX-010](#fix-010)**：资源的属性回调与事件监听器不能同时收到通知。jieshu 已复现，wujie 有相同实现。
- [ ] **P2 · [FIX-011](#fix-011)**：EventBus 无法处理与对象原型属性同名的事件。jieshu 已复现，wujie 有相同实现。

- [x] **P2 · [FIX-012](#fix-012)**：内联 module 等待成功 load 导致队列阻塞。已改用独立的原生 module 完成标记，并验证模块语法、顺序、错误及取消路径。

FIX-001、FIX-002、FIX-003、FIX-012 已修复。剩余建议依次处理 FIX-004 → FIX-005，再处理路由、资源语义和 EventBus。FIX-003 的回归保留了重复调用 `destroyApp` 的场景；FIX-004 仍需独立修正公开 Promise 的完成语义。

## FIX-001

**P1：保活应用后台加载脚本导致队列阻塞**

**定位：**

- `packages/jieshu-core/src/effect.ts`：`isDynamicEffectContextLive`，约 382 行；`DynamicScriptScheduler.executeWithForwardedOutcome`、`reserveExecutionLane`。
- `packages/jieshu-core/src/iframe-script.ts`：`isExecutionOwnerCurrent`，约 93 行；执行器返回 `cancelled` 的分支。
- 对照：wujie 的 `packages/wujie-core/src/iframe.ts` 中 `insertScriptToIframe`。

**触发与复现：**

1. 启动 `alive: true` 的应用，等待首次启动完成。
2. 调用 `sandbox.unmount()`，使其进入 `activeFlag=false` 的保活状态。
3. 通过子应用 head 插入外部脚本 A，自定义 fetch 返回有效 JavaScript。
4. 等待请求完成，再用同一配置 `startApp()` 激活应用。
5. 再插入外部脚本 B，观察执行次数、load 回调和 `execQueue`。

| 观测项             | jieshu | wujie | 预期 |
| ------------------ | ------ | ----- | ---- |
| A 的 load 回调次数 | 0      | 1     | 1    |
| B 的 load 回调次数 | 0      | 1     | 1    |
| 脚本累计执行次数   | 0      | 2     | 2    |
| 最终队列长度       | 2      | 0     | 0    |

**原因与影响：** 动态资源入口接受 `sandbox.alive || sandbox.activeFlag`，执行器却要求 `owner.activeFlag !== false`。入口已预留执行位置，执行器随后返回取消结果，但上层没有消费这个取消结果并释放位置。应用再次激活也不能恢复队列，后续分包加载可能长期不完成。

**修复与验收：**

- [x] 统一动态资源入口、执行器和完成回调对保活状态的判断；保活失活与已销毁必须区别处理。
- [x] 让 `load`、`error`、`cancelled` 以及 loader/DOM 抛错都能完成资源收尾，队列只推进一次。
- [x] 覆盖请求在激活时发起、失活时完成，以及失活后新发起请求两种时序。
- [x] 覆盖 `fiber=true/false`、内联经典脚本、外部经典脚本、外部 module、原生加载回退和异常路径；内联 module 的原生完成语义单列 FIX-012。
- [x] 验证重新激活后新脚本继续执行，最终队列为空；destroy 后迟到结果仍不得执行。
- [x] 在 `dynamic-script-sequence.test.ts`、`iframe-script.test.ts` 补充针对性测试，并添加真实浏览器回归。

**已实施修复（2026-09-07）：** 动态资源入口和 iframe 执行器共用 `isSandboxExecutionAllowed`，允许存活的保活实例在 `activeFlag=false` 时继续执行；销毁状态、iframe 身份和当前注册实例校验继续生效。动态脚本由 `DynamicScriptScheduler` 独占自己的队列位置，执行器只为启动脚本插入原生队列推进节点，避免两处重复推进。

**收尾规则：** 内联经典脚本也经过同一执行句柄路径，但不合成 load 事件。load/error 回调保持同步通知，并在用户回调完成后释放队列位置；`completion` Promise 兜底处理 cancelled 或被抑制的回调。重复事件、取消和完成只能释放一次；卸载/销毁整体取消后，迟到完成不能推进下一代队列。loader 抛错释放位置，DOM 插入或执行器 callback 抛错还会移除已登记的原生脚本及取消处理器。

**回归结果：** 首批 19 项用例在修复前全部失败，随后补充完成幂等及事件重入测试，并移除 2 项把内联 module 原生 load 当作前提的新增模拟测试。最终新增 23 项单测，核心 45 文件、367 项通过。新增 2 项 Chromium 回归覆盖两种 fiber 设置、激活时发起/失活时完成、后台新请求、内联经典脚本、外部 module、原生回退成功/失败、loader 异常、复用激活，以及 destroy 后迟到请求与同名重建；FIX-002/003 的 6 项 Chromium 回归继续通过。

**验证边界：** Chromium 实测发现，内联 module 会执行代码却不触发成功 load，原有执行器仍会等待该事件。它在活跃状态也存在，不是本项保活状态判断不一致造成；已新增 FIX-012，不能将本项关闭解释为内联 module 的完成顺序已修复。jsdom 中人为派发 module 事件仅用于验证收尾分支，不能证明浏览器会产生该事件。本次未修改 wujie、框架适配包或公开 API。

## FIX-002

**P1：旧 head/body 引用可向同名新实例注入代码**

**定位：** `packages/jieshu-core/src/effect.ts` 中 `rewriteAppendOrInsertChild`，约 863 行；同时检查 `patchRenderEffect`、`rewriteRemoveChild`、`rewriteContains`。wujie 的同名 DOM 补丁同样通过应用 id 查询当前实例。

**触发与复现：**

1. 启动应用 A，保存其渲染 head 的引用 `oldHead`。
2. `await destroyApp(A.name)`，再启动同名的新实例 A2。
3. 向 `oldHead` 插入新的外部脚本；请求返回 `window.__staleCodeRan = true`。
4. 检查 A2 的 iframe，而非旧 iframe。

**修复前实际结果：** 两个仓库的 A2 都执行了脚本；`staleCodeRanInReplacement=true`，新实例登记的动态脚本数为 1。预期旧节点不能把执行资源归属转移到新实例。

**原因与影响：** head/body 补丁只保存应用名字，插入发生时重新 `getJieshuById(id)`，因此旧节点会采用新实例的 iframe、fetch、插件和资源队列。异步回调持有旧 DOM 引用即可污染重建后的运行时。这与“旧请求发起后，完成时实例已经替换”是两个不同场景，现有请求完成校验不能替代节点归属校验。

**修复与验收：**

- [x] 为 DOM 补丁绑定具体实例身份或代次，在插入、移除、contains 等入口核验。
- [x] 避免为了校验身份引入无法释放的 iframe 强引用；明确销毁后的补丁行为。
- [x] 明确陈旧 script/link 的拒绝或原生回退策略，无论采用哪种策略都不得执行到新实例。
- [x] 覆盖旧 head、旧 body、保存的方法引用及同名重建多次的情况。
- [x] 验证旧操作不使用新实例的 fetch/插件、不进入新队列、不修改新样式或脚本登记表。
- [x] 在 `dynamic-script-sequence.test.ts` 增加“重建后通过旧节点新发起操作”的测试，并保留真实浏览器断言。

**已实施修复（2026-09-07）：** `effect.ts` 为具体沙箱分配 `symbol` 身份，通过 `WeakMap<Jieshu, symbol>` 保存；每次安装 DOM 补丁只捕获应用 id 和身份标记。插入和脚本查找统一核对当前注册实例的标记及销毁状态。同一实例重复渲染复用标记，同名新实例获得独立标记；无实例时安装的补丁也不能在稍后接管新实例。

**陈旧节点策略：** 插入回退到该调用目标的原生 DOM 操作，不调用新实例的 fetch、插件和资源调度。`contains` 只检查旧节点自己的原生或虚拟子节点；`removeChild` 可清理旧脚本占位节点，但不得查找或移除新实例 iframe 中的脚本。删除不属于旧节点的脚本保持原生 `NotFoundError`。身份元数据没有新增到 iframe/沙箱的强引用；本次没有以堆快照证明整个框架不存在内存泄漏。

**回归结果：** 新增 9 项单测；最初的 7 项中，6 项在修复前失败，1 项验证同实例复用的既有行为，随后补充 2 项未注册/已销毁边界。修复后核心 336 项单测全部通过。新增 `__test__/browser/render-effect-owner.test.mts`，使用源码服务和真实 `startApp/destroyApp`，在 Chromium 的 `fiber=false/true` 两组测试中均通过：连续同名重建后，旧 head/body 及保存的方法不污染新实例，新脚本仍正常执行。浏览器测试已接入 core 的 `test:browser` 和完整 `test` 脚本。

**代码规范复查：** `rewriteAppendOrInsertChild` 使用箭头形式的 `Proxy.apply` 保留原生调用目标，以及 `.call/.bind` 的语义；函数内部与插入方法安装处均已移除类型断言。HTML 元素通过节点类型和命名空间收窄，非 HTML 节点走普通插入流程；原生方法和管线返回值由编译器推导。追加 3 项单测，覆盖借用 head 方法向 body 插入跨 realm 脚本，以及文本、注释、SVG、DocumentFragment 和普通 HTML 元素的返回值与插件通知。当前累计新增 12 项单测，核心总计 339 项通过；两组 Chromium 回归也加入跨 iframe 元素和动态调用目标断言。

## FIX-003

**P1：旧应用异步销毁误清理新应用容器**

**定位：** `packages/jieshu-core/src/sandbox.ts` 中 `destroy` 设置 `clearContainerOnDestroy`，约 569 行；`performDestroy`、`clearContainer`，约 621 行；`packages/jieshu-core/src/shadow.ts` 中断开回调。wujie 的 `sandbox.destroy()` 也会清空 `this.el`。

**触发与复现：**

1. 在容器 C 中启动 A，A 提供 mount/unmount 钩子。
2. 让 `__JIESHU_UNMOUNT` 返回由测试控制的 Promise；调用 `destroyApp(A)`，暂不完成卸载。
3. 在同一容器 C 中启动另一个名字的 B，等待 B 显示。
4. 完成 A 的卸载 Promise，等待 A 销毁结束。

| 修复前观测项         | jieshu | wujie | 预期          |
| -------------------- | ------ | ----- | ------------- |
| A 清理前 B 可见      | true   | true  | true          |
| A 清理后容器子节点数 | 0      | 0     | 保留 B 的节点 |
| B 是否被销毁         | true   | false | false         |

最终的浏览器复现还在步骤 2 后调用了一次 `await destroyApp(A)`；它因 FIX-004 提前返回，随后 B 仍被旧清理误伤。因此该问题也可能出现在调用者已经使用 `await` 的路径中。

**原因与影响：** 是否清理容器在销毁开始时确定，异步卸载之后仍按旧决定调用 `clearChild(this.el)`。同名 teardown 等待不能保护不同应用名字共用容器的场景。jieshu 的断开回调进一步销毁了无复用 mount 的 B。

**修复与验收：**

- [x] 将清理范围限定为旧实例拥有的宿主、loading 等节点，或在清理时重新核验容器归属。
- [x] 不得只以 `getJieshuById(oldName)` 的结果判断整个容器是否仍属于旧实例。
- [x] 覆盖 A → B → C 共用容器、不同应用使用独立容器、卸载成功/失败等情况。
- [x] 验证新应用宿主保持连接，新实例仍存在，且其生命周期不会被旧清理触发。
- [x] 验证旧应用 iframe、事件和资源仍被释放，不能以跳过整个 destroy 回避问题。
- [x] 在对应的 `container-destroy.test.ts` 单测及 `container-destroy.test.mts` 浏览器测试中加入不同名字共用容器的回归。

**已实施修复（2026-09-07）：** `sandbox.clearContainer` 不再清空整个 `el`，而是调用 `removeRenderedElementFromContainer`，只移除仍直接挂在该容器中的旧宿主。`renderElementToContainer` 将当时的 loading 与具体宿主身份关联；清理时只有身份匹配才移除 loading、恢复布局。后继应用的宿主、loading 及主应用额外插入的节点均予以保留。

**归属与释放：** 宿主和 loading 分别通过弱映射保存 `symbol` 身份，loading 元数据不会强引用旧宿主或沙箱；正常移除 loading 时也会删除它的归属记录。销毁仍完整执行旧实例的 iframe、脚本、样式、事件、代理和引用清理。原有同名注册表/teardown 保护继续保留，但它不再授权清空整个容器。

**回归结果：** 新增 5 项单测，修复前全部失败，修复后全部通过；覆盖 A → B → C 的异步销毁、卸载抛错、独立容器、主应用额外节点、旧资源释放，以及后继应用尚未挂载时的 loading。新增 4 项 Chromium 回归，在真实 `startApp/destroyApp` 路径组合“卸载成功/失败 × 后继应用已显示/仍在加载”，验证后继应用保持连接、正常执行代码并可独立销毁。FIX-002 的 2 项浏览器回归继续通过。当前核心总计 344 项单测、6 项 Chromium 测试通过。

## FIX-004

**P2：公开 API 的 Promise 提前完成**

**定位：** `packages/jieshu-core/src/index.ts` 中 `startApp`（约 391 行）、`destroyApp`（约 549 行）、`refreshApp`（约 574 行），以及 `hasPendingLifecycle`、`detachReentrantOperation`。

**触发与复现：**

1. 让 A 的 unmount 等待测试控制的 Promise，调用第一次 `destroyApp(A)`。
2. 在主应用的普通调用路径再次调用 `destroyApp(A)`，记录第二个 Promise 是否完成。
3. 保持 unmount 未完成，清空微任务队列。
4. 第二个 Promise 已完成；第一轮清理此时仍在等待。

**实际结果：** 定向断言得到 `premature=true`，预期为 `false`。浏览器中的第二次 await 也没有阻止 FIX-003 的复现。`startApp`、`refreshApp` 存在相同的公开包装分支，仍需为它们分别补充完成时序与返回值测试。

**原因与影响：** 避免卸载钩子等待自身形成死锁的逻辑，被扩大为“只要有 pending lifecycle 就立即确认”。内部已经有重入识别，但公开包装又按所有 pending lifecycle 处理。调用者可能在清理未完成时复用容器，或在应用未启动完成时继续操作；部分错误只会被记录为 warning，不能通过原调用者的 await 捕获。

**修复与验收：**

- [ ] 明确普通调用的 Promise 表示实际完成，正常启动返回有效的销毁函数。
- [ ] 仅对真正会形成等待循环的卸载重入执行特殊策略，并记录该策略。
- [ ] 覆盖并发 destroy、多方外部 await、卸载期间 start/refresh 以及 teardown 拒绝。
- [ ] 保留同名最新操作取消旧操作的既有契约，不能将合法的取消完成误判为本缺陷。
- [ ] 覆盖子应用内同步重入、await 后重入、独立打包 core 的调用路径，确保不新增死锁。
- [ ] 核对 `createAppController` 使用的完成态与直接公开 API 保持一致。
- [ ] 更新 `docs/api/destroyApp.md` 的返回值，以及 start/refresh 的完成、取消和异常说明。

## FIX-005

**P2：多份 core 的事件清理恢复已销毁实例的处理器**

**定位：** `packages/jieshu-core/src/tracker.ts` 中模块局部的 `sharedWindowOverrides`，约 22 行；`setWindowOnEvent`、`cleanupWindowOnEventOverrides`。另见 `packages/jieshu-react/vite.config.mts`、`packages/jieshu-vue3/vite.config.mts` 的 UMD core 内嵌配置。

**触发与复现：**

1. 主应用设置原始 `window.onresize` 处理器 H。
2. 加载第一份独立 core，启动 A，让其覆盖 `onresize` 为 HA。
3. 同页再次加载独立打包的 core，启动 B，让其覆盖为 HB。
4. 依次销毁 A、B，检查最终处理器。

**实际结果：** Chromium 中确认两份 core 的 `startApp` 函数身份不同；最终 `restoredHostHandler=false`，`restoredDestroyedChildHandler=true`。两个仓库均复现，最终恢复 HA。

**原因与影响：** jieshu 的事件覆盖栈可以协调同一模块内的多个实例，但不同 bundle 的 WeakMap 不共享。B 保存 HA 为前值，A 销毁不能更新 B 的栈，B 销毁后又恢复 HA。旧处理器仍被主 window 引用，可能保留旧应用闭包并在事件发生时访问已释放对象。本次验证的是处理器恢复错误，没有进行堆快照或量化内存泄漏。

**修复与验收：**

- [ ] 将覆盖栈共享范围与目标 window 及多份 core 的运行范围对齐，而非仅在模块内共享。
- [ ] 保留主应用主动更新处理器后不被旧 cleanup 覆盖的保护。
- [ ] 用两份真实独立 bundle 验证，不能只在同一模块实例中创建两个 tracker。
- [ ] 覆盖 A/B 两种销毁顺序、同一应用多次覆盖、主应用中途改写及多个 onXXX 属性。
- [ ] 最终恢复正确主应用处理器，已销毁应用的处理器不再被事件调用。
- [ ] 在 `destroy-cleanup.test.ts` 及多副本浏览器场景中补测试。
- [ ] 若修改任何适配包文件，逐包执行其 UI、单元和完整 test，并满足四项 100% 覆盖率要求。

## FIX-006

**P2：子应用路由同步清空主应用 history.state**

**定位：** `packages/jieshu-core/src/sync.ts` 中 `syncUrlToWindow`（约 26 行）、`clearInactiveAppUrl`、`pushUrlToWindow`。wujie 的对应路由同步同样使用 `replaceState(null, ...)`。

**触发与复现：**

1. 启动 `sync: true` 的子应用。
2. 主应用通过 `history.replaceState({ idx: 7, key: 'host-route' }, '', location.href)` 保存路由状态。
3. 子应用执行 `history.pushState({}, '', '/child/next')`。
4. 读取主应用 `history.state`。

**实际结果：** 两个仓库都得到 `null`，预期在仅重写同步查询参数时保留主应用原有状态。

**原因与影响：** URL 同步写入了空 state，覆盖主应用路由器或业务存储的导航索引、key、滚动位置等。实际路由器受影响程度取决于其实现；本次直接确认的是 state 被清空。

**修复与验收：**

- [ ] 对只修改当前地址的 replace 操作保留当前 state，不注入子应用自身的 state。
- [ ] 分别明确清理同步参数和 href 跳转新增历史项时的 state 策略，避免统一替换造成其他语义变化。
- [ ] 覆盖 sync 开关切换、unmount/destroy 清理、主应用 hash、多子应用同步及浏览器前进后退。
- [ ] 验证 state 内容保留、主应用 hash 不丢失、同步参数正确且不会重复编码。
- [ ] 在 `sync-route.test.ts` / `sync.test.ts` 增加 state 断言，并用至少一个真实主应用路由场景验收。

## FIX-007

**P2：合成 load 早于 async 脚本执行**

**定位：** `packages/jieshu-core/src/sandbox.ts` 中 `start` 的 async 调度分支（约 370 行）、`scheduleLifecycleEvent`；`sandbox-runtime.ts` 中 `SandboxScriptScheduler.executeAfter`。wujie 的 async 调度也不参与最终 load 等待。

**触发与复现：**

1. 入口包含一个内联脚本，用于监听子应用 window 的 `load` 并记录事件。
2. 后面包含 `<script async src="/slow.js"></script>`，用自定义 fetch 的受控 Promise 暂停响应。
3. 观察 `startApp` 返回及 `load` 是否发生，再释放脚本响应，令其记录 `async-script`。

**实际结果：** 两个仓库均在 async 脚本未完成时触发 `load`；`startApp` 返回时日志已经为 `["load"]`，最终为 `["load", "async-script"]`。

**原因与影响：** async 的独立执行路径不进入 load 的完成屏障。依赖 window load 确认初始资源就绪的代码可能过早运行。不要将修复理解为“所有 async 都必须阻塞 DOMContentLoaded”；两类浏览器事件的等待语义需要区分。

**修复与验收：**

- [ ] 为初始 async 资源维护独立完成屏障，覆盖 fetch 完成之后的实际原生 script load/error。
- [ ] 保持 DOMContentLoaded 不被普通 async 请求阻塞，并保留 defer/module 的相应执行顺序。
- [ ] 明确 `startApp` 对启动完成的承诺；至少确保派发的 load 与初始资源完成时序一致。
- [ ] 覆盖 async 成功、失败、原生回退、多个并发请求及 destroy 取消。
- [ ] 对同步、defer、async、module 的组合加入浏览器事件顺序断言。
- [ ] 在 `sandbox-start.test.ts`、`iframe-script.test.ts` 及集成生命周期测试中补充验证。

## FIX-008

**P2：已完成资源缓存跨请求上下文串用**

**定位：** `packages/jieshu-core/src/entry.ts` 中 `AssetCache.getOrCreate`，约 94 行；`importHTML`、`fetchAssetText`、`releaseAssetCacheScope`。wujie 的 HTML、JS、CSS 缓存也以 URL 为主要键。

**触发与复现：**

1. 为相同入口 URL 准备两个不同的自定义 fetch，分别返回 `tenant-A` 和 `tenant-B` 的 HTML。
2. 调用 `importHTML`，使用 fetch A 和新的 cache scope，并等待完成。
3. 再次调用 `importHTML`，使用 fetch B 和另一个新的 cache scope。
4. 检查第二次 fetch 调用次数和入口模板。

**实际结果：** 第二个 fetch 调用次数为 0，模板仍为 `<html><body>tenant-A</body></html>`。本次直接复现了 HTML；JS/CSS 使用同类缓存策略，仍需分别增加行为用例。

**原因与影响：** scope 只隔离 pending 工作；已 fulfilled 的结果允许跨 scope 共享，而且共享键没有包含响应变化所依赖的请求上下文。对 URL 内容不可变的静态资源，这是有效优化；对依据登录态、租户或灰度条件变化的同 URL 入口，则可能返回另一个上下文的数据。本次没有验证真实账号数据泄漏，确认的是不同 fetch 上下文返回值被串用。

`clearAssetsCache` 文档已经说明销毁不会清空已完成缓存，因此“destroy 后仍复用缓存”本身不能作为独立缺陷。需要明确的是上下文隔离策略，以及 `refreshApp` 文档中“更新资源后重新拉取”的使用说明与缓存契约是否一致。

**修复与验收：**

- [ ] 明确可跨实例共享资源的前提，为上下文相关资源提供缓存命名空间、失效或禁用策略。
- [ ] 评估自定义 fetch 身份、显式 cache key/namespace 等方案；不要在未明确契约时一律取消静态资源共享。
- [ ] 若调整公开选项或刷新语义，同步类型、适配包透传和 API 文档。
- [ ] 覆盖不同上下文相同 URL、同上下文复用、同 scope 请求合并和失败重试。
- [ ] 保留旧 pending 请求不阻塞新实例、旧拒绝不删除新缓存、清理后迟到请求不重新污染缓存的保护。
- [ ] 在 `asset-cache.test.ts`、`entry-pipeline.test.ts` 分别覆盖 HTML、JS、CSS。
- [ ] 更新 `docs/api/clearAssetsCache.md`、`docs/api/refreshApp.md` 和自定义 fetch 的使用边界。

## FIX-009

**P2：首次 HTML/CSS 处理未应用 replace**

**定位：** `packages/jieshu-core/src/index.ts` 新实例启动分支，约 353 行；`entry.ts` 中 `processCssLoader`；`sandbox.ts` 中 `active` 对 `this.replace` 的赋值。preload 路径也应一并核对。wujie 有相同的调用顺序。

**触发与复现：**

1. 启动全新名字的应用，传入 `<html><head></head><body>PLACEHOLDER</body></html>`。
2. 配置 `replace: (code) => code.split('PLACEHOLDER').join('REPLACED')`。
3. 等待 `startApp` 完成，检查子应用 body 文本。

**实际结果：** 两个仓库都仍显示 `PLACEHOLDER`，预期为 `REPLACED`。实际浏览器用例直接确认了 HTML；静态 CSS 与其共享模板处理路径，需要补充单独断言。

**原因与影响：** `processCssLoader` 在 `active({ replace })` 之前执行，读取到的新 sandbox 的 `replace` 尚未设置。后续 JavaScript 和动态资源可能正常应用 replace，导致“脚本替换生效、首屏模板替换失效”的不一致。公开文档声明 HTML、JS、CSS 均会替换。

**修复与验收：**

- [ ] 在首次入口处理前准备好替换配置，或显式传入转换函数，不依赖尚未发生的 active 副作用。
- [ ] 明确 replace 与 htmlLoader、cssLoader、jsLoader 的执行顺序及次数，避免一次修复引入重复替换。
- [ ] 覆盖首次 start、preload 后 start、refresh、缓存命中和 `setupApp` 提供 replace 的情况。
- [ ] 分别断言 HTML、内联/外联 CSS、JavaScript 的替换结果。
- [ ] 验证 replace 抛错或重入销毁时不会留下半初始化实例。
- [ ] 在 `entry-pipeline.test.ts`、公开启动测试及浏览器测试中加入首屏占位符用例。

## FIX-010

**P2：资源的属性回调与事件监听器不能同时收到通知**

**定位：** `packages/jieshu-core/src/effect.ts` 中 `ElementEventForwarder.dispatch`，约 66 行。wujie 的 `manualInvokeElementEvent` 有相同的互斥分支。

**触发与复现：**

1. 创建外部 script，同时设置 `script.onload = handlerA` 和 `script.addEventListener('load', handlerB)`。
2. 通过已 patch 的子应用 head 插入，令自定义 fetch 返回有效脚本。
3. 等待处理完成，检查两个处理器的调用次数。

**实际结果：** handlerA 调用 1 次，handlerB 调用 0 次；预期两者各调用 1 次。此项已通过 jieshu 定向用例复现，wujie 的结论来自对应源码，没有为它另跑该用例。

**原因与影响：** 实现检测到 onload/onerror 属性处理器后直接调用，只有不存在属性处理器时才 dispatch。资源加载器、监控插件或业务同时使用两种订阅方式时，一方可能无法收到完成通知。

**修复与验收：**

- [ ] 建立统一的事件派发路径，使属性回调和 addEventListener 监听器都能收到通知。
- [ ] 保证属性回调不被手动调用与原生 dispatch 重复触发。
- [ ] 验证 `target`、`currentTarget`、回调 `this` 指向原始资源节点，而非内部替代节点。
- [ ] 覆盖 script/link、load/error、只设置属性、只注册监听器及两者同时存在。
- [ ] 覆盖监听器抛错、once、removeEventListener 和回调中重入插入资源，保证不会卡住队列。
- [ ] 将行为用例纳入动态脚本和动态 stylesheet 测试，并补充真实浏览器事件验证。

## FIX-011

**P2：EventBus 无法处理与对象原型属性同名的事件**

**定位：** `packages/jieshu-core/src/event.ts` 中 EventBus 构造函数使用 `{}`，以及 `$on`（约 87 行）、`listenersFor`、`$off`、`$emit`、`$clear`、`$destroy`。wujie 也使用普通对象存储事件数组。

**最小复现：**

```javascript
import { bus } from '@cloud/jieshu-core';

bus.$on('constructor', () => {});
```

**实际结果：** 定向用例抛出 `TypeError: currentListeners.includes is not a function`。预期 `constructor` 作为普通事件名完成订阅。wujie 的同类问题来自源码检查，没有为它另跑此用例。

**原因与影响：** `this.eventObj[event]` 会读取原型链上的属性；`constructor` 得到函数，`__proto__` 等也可能得到非数组。除订阅外，其他直接读取事件字典的路径也需要检查。问题范围是合法字符串事件名处理错误，不能仅修复一次 includes 调用。

**修复与验收：**

- [ ] 使用 Map、无原型字典或可靠的自有属性查询，统一事件名到监听器数组的访问。
- [ ] 检查构造、清空、销毁后重新创建字典的所有路径，避免重新引入 `{}`。
- [ ] 覆盖 `constructor`、`__proto__`、`toString`、`hasOwnProperty` 等名字及普通事件名。
- [ ] 验证 `$on/$once/$off/$emit/$clear/$destroy` 与全事件监听的行为。
- [ ] 保留当前事件分发快照、重复订阅去重和递归 emit 的既有契约。
- [ ] 在 `event.test.ts`、`event-registry.test.ts` 添加边界测试。

## FIX-012

**P2：内联 module 等待不会触发的成功 load 事件，阻塞后续脚本**

**来源：** 修复 FIX-001 时新增的真实 Chromium 场景暴露；不在初始 11 项审计范围内。

**修复前定位：** `packages/jieshu-core/src/iframe-script.ts` 中 `waitsForNativeCompletion` 将所有 `module` 都视为需要等待原生 load/error；`DynamicScriptScheduler` 因此保留队列位置。

**触发与证据：**

1. 在普通 Chromium 空白页面动态插入 `<script type="module">globalThis.__moduleProbe = true;</script>`，同时注册 load/error。代码已经执行，成功 load 不触发。
2. 在 jieshu 中插入内联 module，再插入外部经典脚本、外部 module 和原生回退脚本。真实源码回归在 `fiber=false/true` 均超时，内联 module 的代码标记已经出现，但完成事件仍为空，队列保留 4 个位置。
3. 旧 jsdom 测试手动派发 `new Event('load')`，因此只能检验事件到达后的收尾，无法发现这个浏览器语义差异。

**修复前影响：** 动态内联 module 后续的脚本可能长期等待；静态/预设的内联 module 也使用同一执行器，存在相同等待条件，本次修复已覆盖其 start 完成场景。该条件不依赖保活失活。下面的本地 wujie 对照未出现同类等待 load 的队列阻塞。

**wujie 对照实测：** 使用 Chromium `151.0.7922.34`，将两个本地仓库的源码分别临时打包，经 `127.0.0.1` 服务运行真实 `startApp`、动态插入、unmount 和 destroy。wujie 基线为干净工作区 `c45932998c0602f34454df8d3e29f4d33a38446a`；jieshu 为 `b25ec78cb039cdd5f4abc54e649cbc96207a4764` 加对照时尚未提交的 FIX-001 修复。两边都使用包含普通启动脚本的 HTML，启动后依次插入内联 module、外部经典脚本、外部 module。

组合为 **2 个实现 × fiber=false/true × 活跃/保活失活 × 普通模块代码/含 export 的代码，共 16 组**。以下每行均覆盖 4 种 fiber/活跃状态组合：

| 脚本内容与实现        | 内联 module 代码执行 | 后续两个脚本执行 | 最终队列长度 | 浏览器错误                  |
| --------------------- | -------------------- | ---------------- | ------------ | --------------------------- |
| 普通模块代码 · wujie  | 是                   | 均执行           | 0            | 无                          |
| 普通模块代码 · jieshu | 是                   | 均未执行         | 3            | 无                          |
| 含 `export` · wujie   | 否                   | 均执行           | 0            | `Unexpected token 'export'` |
| 含 `export` · jieshu  | 是                   | 均未执行         | 3            | 无                          |

所有场景都没有观测到内联 module 的原生成功 load。jieshu 在 2 秒观察期限结束后仍只有内联模块执行标记，队列持有自身位置及两个后续任务；wujie 的队列均为空。16 组观测结果的断言已核对，不代表 16 组预期正常行为都通过：其中 jieshu 8 组复现阻塞，wujie 4 组含 export 的用例出现语法错误。

**为何 wujie 不堵：** `wujie/packages/wujie-core/src/iframe.ts` 的 `insertScriptToIframe` 仅为 `!content && src` 的外部脚本等待 load/error；内联脚本插入后立即调用 `afterExecScript()` 推进队列。`effect.ts` 中也明确注释内联脚本不触发 load/error。因此本项队列阻塞属于 jieshu 相对此份 wujie 的回归。

**不能直接照搬的部分：** wujie 的动态内联分支未向执行器传递 `module` 标记，导致 `type="module"` 的代码仍被包进普通函数；含 `export` 时产生语法错误。此外，普通代码的 `fiber=false` 两组观测顺序均为“后续经典脚本 → 内联 module → 外部 module”，说明队列为空也不代表内联模块已经先执行完毕。这些是 wujie 当前实现的另外两项语义限制，本次没有修复它们。jieshu 的修复契约见下文。

**修复与验收：**

- [x] 明确内联 module 与后续脚本之间的执行/完成契约，不再假定浏览器提供成功 load。
- [x] 验证普通执行、静态 import、动态 import、top-level await、语法及运行时错误；保留相对导入、import map 和 `import.meta.url` 的语义。
- [x] 评估原生内联语义与串行等待的取舍；不能仅追加代码尾回调而遗漏异常，也不能未经验证将代码搬到 Blob URL 改变模块解析基址。
- [x] 覆盖动态插入、静态/预设脚本、fiber、活跃/保活失活、取消/销毁和之后的脚本推进。
- [x] 先加入真实浏览器失败断言，再调整目前人工派发 module load 的单测，避免模拟测试替代原生行为。

**已实施修复（2026-09-08）：** 串行内联 module 和独立的 module 完成标记均设置 `async=false`，进入浏览器的有序脚本列表。标记在原模块的依赖图就绪并尝试开始求值后通知执行器收尾；语法或运行时错误不会跳过独立标记。原模块代码只经过已有 loader，不追加尾回调、不添加普通函数闭包、不改为 Blob URL。标记复制 nonce，完成、错误、取消及插入异常均清理临时节点和监听器。属性中声明 `type=module` 的预设也按模块处理。

**完成与事件契约：** 不给动态内联 module 合成成功 load；依赖加载失败继续转发原生 error，语法/运行时错误交由浏览器报告。与原生外部 module 的 load 一样，串行推进不等待 top-level await 的 Promise 完成，也不等待独立 `import()`。HTML 解析保留显式 async 内联 module 的标记，使其独立调度；执行句柄以内部 `scheduled` 结果确认插入，不伪报模块求值完成。动态插入保留现有应用内排队策略；FIX-007 的外部 async 事件问题仍独立待修。公开说明见 [iframe 内联 module 的执行顺序](../guide/information.md#iframe-内联-module-的执行顺序)，规范依据见 [HTML 脚本处理模型](https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element)及[模块执行模型](https://html.spec.whatwg.org/multipage/webappapis.html#run-a-module-script)。

**取消与复用：** 原生实验确认，移除等待 import 的节点不能把它从浏览器有序列表中删除。非保活卸载在取消框架资源后中止 iframe 的原生加载；保活失活继续保留运行。浏览器回归在旧请求仍悬挂时验证同一 iframe 重新激活及同名销毁重建，新模块能够执行，旧请求迟到不会执行旧模块或阻塞新队列。已启动的 JavaScript/TLA 异步工作不承诺回滚。

**回归方式：** 先加入 4 项 fiber × 活跃状态 Chromium 断言，修复前全部失败，再修改执行器。最终新增 23 项浏览器回归，覆盖延迟 import、相对/映射/动态导入、`import.meta.url`、TLA、静态/预设/async、空模块、依赖失败、语法/运行时/TLA 拒绝以及卸载和重建。单测改掉人工派发内联 module load 的错误前提；新增的完成标记通知只验证内部收尾，原生顺序由 Playwright 验证。

## 修复验证与交付记录

每项修复至少执行相应定向测试和核心单测；影响真实脚本执行、跨 realm、DOM 挂载或路由的改动，应运行对应浏览器回归和受影响的集成测试。

```bash
pnpm --filter @cloud/jieshu-core test:unit
pnpm --filter @cloud/jieshu-core test:integration
git diff --check
git status --short
```

如果修改触及 `packages/jieshu-react` 或 `packages/jieshu-vue3`，按仓库 AGENTS.md 的强制规则，逐包运行实际 UI、单元和完整 test 脚本，四项单元覆盖率均须达到 100%。不能以 core 测试、类型检查或 lint 替代这些验证。

每次关闭任务时，在下表增加记录。若只完成局部保护、未完成本项约定的验收场景或仍存在失败场景，应明确记为部分完成，不勾选总览任务。浏览器范围必须单独记录：仓库当前浏览器回归配置使用 Chromium，通过这些测试不能扩大为 Firefox、Safari 或全部浏览器的兼容性结论。

| 编号    | 完成日期   | 提交 / PR | 实际修改范围                                                                               | 实际验证命令、结果与覆盖率                                                                                                         | 剩余限制                                                                                                   |
| ------- | ---------- | --------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| FIX-002 | 2026-09-07 | `a2b8409` | core DOM 归属校验、12 项单测、2 项浏览器回归及测试脚本                                     | 以下实际命令均通过；单测 44 文件/339 项，Chromium 2 项；覆盖率 statements 75.63%、branches 67.91%、functions 79.85%、lines 78.34%  | 仅验证 Chromium；未运行整套 examples 集成测试或适配包测试，未修改 wujie                                    |
| FIX-003 | 2026-09-07 | `b25ec78` | core 容器清理、loading 归属、5 项单测、4 项浏览器回归                                      | 下述实际命令均通过；单测 45 文件/344 项，Chromium 6 项；覆盖率 statements 75.85%、branches 68.13%、functions 80%、lines 78.53%     | 仅验证 Chromium；未运行整套 examples 集成测试或适配包测试，FIX-004 仍待修复                                |
| FIX-001 | 2026-09-07 | `0d626aa` | core 状态校验、动态队列收尾、23 项单测、2 项浏览器回归                                     | 下述实际命令均通过；单测 45 文件/367 项，Chromium 8 项；覆盖率 statements 75.88%、branches 68.26%、functions 79.92%、lines 78.50%  | 仅验证 Chromium；未运行整套 examples 集成测试或适配包测试；内联 module 独立问题登记为 FIX-012              |
| FIX-012 | 2026-09-08 | 本次提交  | core 内联 module 完成标记、HTML async 解析、卸载取消、12 项单测、23 项浏览器回归及公开说明 | 下述实际命令均通过；单测 45 文件/379 项，Chromium 31 项；覆盖率 statements 76.07%、branches 68.63%、functions 80.02%、lines 78.73% | 仅验证 Chromium；未运行整套 examples 集成测试或适配包测试；不等待 TLA 完成，不回滚已执行代码；未修改 wujie |

FIX-002 的实际验证命令如下，均在仓库根目录执行。沿用初始审计的直接调用方式，使用已安装的工具和 Chromium，没有重新安装项目依赖。Chromium 在受限沙箱内启动时受到 macOS MachPort 权限限制，随后经自动审批在沙箱外执行上述本机测试并通过。

```bash
node node_modules/vitest/vitest.mjs run --config packages/jieshu-core/__test__/unit/vitest.config.mts --coverage
node node_modules/@playwright/test/cli.js test --config packages/jieshu-core/__test__/browser/playwright.config.mts
node node_modules/typescript/bin/tsc --project packages/jieshu-core/tsconfig.json --noEmit --emitDeclarationOnly false
node node_modules/typescript/bin/tsc --project packages/jieshu-core/__test__/unit/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc --project packages/jieshu-core/__test__/integration/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc --project packages/jieshu-core/__test__/browser/tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js packages/jieshu-core/src/effect.ts packages/jieshu-core/__test__/unit/dynamic-script-sequence.test.ts packages/jieshu-core/__test__/browser --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check packages/jieshu-core/src/effect.ts packages/jieshu-core/__test__/unit/dynamic-script-sequence.test.ts packages/jieshu-core/__test__/browser packages/jieshu-core/package.json docs/notes/jieshu-wujie-fix-todo.md
git diff --check
git status --short
```

FIX-003 继续使用上面的 Vitest、Playwright、四项 TypeScript 和 Git 检查命令；本次 ESLint、Prettier 检查的实际文件范围如下。新增和修改的函数使用箭头函数，新增实现与测试未使用类型断言。Chromium 同样经自动审批在沙箱外访问本机源码服务。

```bash
node node_modules/eslint/bin/eslint.js packages/jieshu-core/src/sandbox.ts packages/jieshu-core/src/shadow.ts packages/jieshu-core/__test__/unit/container-destroy.test.ts packages/jieshu-core/__test__/browser/container-destroy.test.mts --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check packages/jieshu-core/src/sandbox.ts packages/jieshu-core/src/shadow.ts packages/jieshu-core/__test__/unit/container-destroy.test.ts packages/jieshu-core/__test__/browser/container-destroy.test.mts docs/notes/jieshu-wujie-fix-todo.md
```

FIX-001 继续使用上述 Vitest、Playwright、四项 TypeScript 和 Git 检查命令。新增场景最初因内联 module 的独立问题超时，原生 Chromium 对照确认后将其登记为 FIX-012；最终本项浏览器回归覆盖内联经典脚本与原生外部 module，不以人工派发事件冒充浏览器完成。最终 ESLint、Prettier 的实际范围如下：

```bash
node node_modules/eslint/bin/eslint.js packages/jieshu-core/src/effect.ts packages/jieshu-core/src/iframe-script.ts packages/jieshu-core/src/sandbox-runtime.ts packages/jieshu-core/__test__/unit/dynamic-script-sequence.test.ts packages/jieshu-core/__test__/unit/iframe-script.test.ts packages/jieshu-core/__test__/browser/alive-dynamic-script.test.mts --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check packages/jieshu-core/src/effect.ts packages/jieshu-core/src/iframe-script.ts packages/jieshu-core/src/sandbox-runtime.ts packages/jieshu-core/__test__/unit/dynamic-script-sequence.test.ts packages/jieshu-core/__test__/unit/iframe-script.test.ts packages/jieshu-core/__test__/browser/alive-dynamic-script.test.mts docs/notes/jieshu-wujie-fix-todo.md
```

FIX-012 继续使用上述 Vitest（含覆盖率）、Playwright、四项 TypeScript 和 Git 检查命令。新增 12 项单测覆盖完成标记的幂等、错误、nonce、取消、插入异常、异步调度、卸载及 HTML 属性解析；此前 FIX-001/002/003 的 8 项浏览器回归全部保持通过。ESLint、Prettier 的实际范围如下：

```bash
node node_modules/eslint/bin/eslint.js packages/jieshu-core/src/effect.ts packages/jieshu-core/src/iframe-script.ts packages/jieshu-core/src/sandbox.ts packages/jieshu-core/src/template.ts packages/jieshu-core/__test__/unit/dynamic-script-sequence.test.ts packages/jieshu-core/__test__/unit/iframe-script.test.ts packages/jieshu-core/__test__/unit/sandbox-lifecycle-race.test.ts packages/jieshu-core/__test__/unit/template.test.ts packages/jieshu-core/__test__/browser/inline-module.test.mts --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check packages/jieshu-core/src/effect.ts packages/jieshu-core/src/iframe-script.ts packages/jieshu-core/src/sandbox.ts packages/jieshu-core/src/template.ts packages/jieshu-core/__test__/unit/dynamic-script-sequence.test.ts packages/jieshu-core/__test__/unit/iframe-script.test.ts packages/jieshu-core/__test__/unit/sandbox-lifecycle-race.test.ts packages/jieshu-core/__test__/unit/template.test.ts packages/jieshu-core/__test__/browser/inline-module.test.mts docs/guide/information.md docs/notes/jieshu-wujie-fix-todo.md
```

## 后续实现应保持的一致性

- **应用状态：** 活跃、保活失活、普通卸载、销毁中的资源执行规则应在各入口一致。
- **实例归属：** 应用名字用于查找，具体实例或代次用于证明操作归属；旧 DOM 和旧回调不能自动获得新实例的执行权。
- **容器归属：** 按应用 id 协调生命周期之外，还要保护不同 id 复用同一容器的情况。
- **完成语义：** 普通公开 Promise 表示实际完成；重入取消、最新操作替代与失败必须有可测试、可文档化的语义。
- **共享范围：** 多副本支持需要覆盖事件栈等实际共享资源，不能只共享实例表和操作表。
- **测试组合：** 既验证模块本身，也验证“保活 × 异步资源”“重建 × 旧 DOM”“异步销毁 × 容器复用”“多 bundle × 交错销毁”等组合。

模板解析拆分、可取消调度器、销毁等待表和 pending cache scope 等现有改进应继续保留；修复本文问题时应避免退回全局队列或放松已销毁实例的保护。移除降级 iframe 路径属于已记录的运行环境取舍，不在本 TODO 的缺陷范围内。
