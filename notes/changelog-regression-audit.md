# CHANGELOG 历史问题回归审计

> 审计日期：2026-09-03
>
> 范围：全部项目自有 CHANGELOG.md，TinyMCE 上游 changelog 除外
>
> 重构对比基线：v2.1.0 对应的 6beccb8 到 bee3b01
>
> 版本脉络与文件去重：见 [changelog-overview.md](./changelog-overview.md)

## 1. 结论

不能得出“changelog 里的问题全部不存在”的结论。

核心运行时的高风险历史问题——销毁泄漏、刷新竞态、异步 unmount、动态脚本/CSS 顺序、事件反向解绑、路由编码——在新实现中都有明确的状态机、清理注册表或专项回归测试。审计时 core 单元测试 45 个文件、322 项全部通过。

当前复核中，仓库内九个 example 的生产构建均已通过；核心 Chromium 集成测试也已完整通过 React 主应用 48 项与 Vue 主应用 49 项，共 97/97。审计仍确认下列当前问题：

| 级别 | 当前问题                                               | 结论                                                                                                               |
| ---- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| P0   | core 包名已迁移为 jieshu-core，但仍使用 2.1.0          | **确认存在**。这是无法原位升级的包名和分发变更，应在新 major 或迁移说明中明示。                                    |
| P0   | Vue 2 适配包已从 workspace 删除                        | **确认存在**。历史 Vue 2 适配器修复无法由当前代码继续保证；Vue 2 子应用 demo 仍在，不等于 Vue 2 主应用适配包仍在。 |
| P1   | React 适配包 peer 下限从 >=16.0.0 提高到 >=17.0.2      | **确认存在**。与 changelog 中 React 16 相关兼容历史不再一致。                                                      |
| P1   | IE9/IE11 承诺与当前构建不一致                          | **确认存在**。当前 TypeScript/Vite target 是 ES2018，也没有 legacy build；文档仍写“理论上兼容到 IE9”。             |
| P1   | 富文本兼容只能判定为部分验证                           | #1084 的 realm、ownerDocument、延迟 CSS 核心链路有测试，但多款真实编辑器交互、Safari 和 OnlyOffice 未自动化验收。  |
| P2   | 老 Element UI Popper 特定组合仍有偏移边界              | **已知局限**。appendToBody、禁用 GPU、absolute top/left 的组合不能由 Shadow DOM 代理完全透明兼容。                 |
| P2   | Safari、Chrome 85 以下、Vite legacy 缺少当前浏览器矩阵 | 代码中仍有兼容分支，但 Playwright 仅运行 Chromium，不能宣称真机回归已排除。                                        |

## 2. 判定口径

| 状态     | 含义                                                       |
| -------- | ---------------------------------------------------------- |
| 已验证   | 当前实现有明确保护，且有直接单元或集成回归测试             |
| 实现保留 | 相关分支/API 仍在，但没有针对原 issue 环境的完整 E2E       |
| 部分解决 | 通用问题已处理，某些库、浏览器或布局组合仍有限制           |
| 确认存在 | 在当前源码、package metadata 或实际测试中直接重现          |
| 不适用   | 纯文档、工具链、示例或已下线功能，不适合用 core 运行时判定 |

## 3. 按风险域审计

### 3.1 生命周期、并发和内存释放

**历史问题：** #1098、#1090、#1089、#976、#823、#958、#954、#742、#752、#753、#568、#175、#170、#128、#138、#139、#129。

**结论：已验证，未发现旧竞态在 core 内重现。**

- SandboxLifecycleController 明确记录 active、mounted、destroying、destroyed 转换。
- destroy 同步从 live registry 移除实例，再用 teardown tombstone 阻止同名应用抢占旧容器。
- 并发 destroy 共享同一 Promise；unmount 拒绝也会执行后续资源清理。
- SandboxCleanupRegistry 统一清理样式、脚本、字体、observer、bus、iframe、Proxy 和事件追踪器。
- RuntimeAppController 用 intent/revision 治理适配器快速切换、refresh 和 dispose。

直接证据：

- `packages/jieshu-core/__test__/unit/destroy-order.test.ts`
- `packages/jieshu-core/__test__/unit/sandbox-lifecycle-race.test.ts`
- `packages/jieshu-core/__test__/unit/public-operation-race.test.ts`
- `packages/jieshu-core/__test__/unit/controller.test.ts`
- `packages/jieshu-core/__test__/unit/destroy-cleanup-e2e.test.ts`
- `packages/jieshu-core/__test__/unit` 下的各类 leak 测试

边界：alive 保活模式本来就会保留 iframe 和运行上下文，只有 destroy 才承诺完整释放。不能把“保活后内存不下降”当作 destroy 泄漏已经解决。

### 3.2 事件、DOM 代理和跨 realm

**历史问题：** #1084、#946、#865、#792、#771、#853、#758、#574、#616、#617、#595、#514、#555、#549、#547、#693、#483、#305、#304、#275、#274、#263、#262、#246、#232、#144、#132、#106、#102、#57、#50。

**结论：通用链路已验证，特定编辑器和浏览器为部分解决。**

- document 转发到主 document/ShadowRoot 的 listener 会按 callback 和 capture 登记并反向解绑。
- window.onXXX 支持多 sandbox owner，销毁时不会覆盖当前 owner 或复活旧 handler。
- Proxy 使用 Proxy.revocable，销毁时撤销 window/document/location 代理。
- instanceof 在主/子 realm 及降级渲染 iframe 间有专项测试。
- getSelection、ownerDocument、DataTransfer 和延迟 href 是 #1084 已覆盖的核心点，但真实 wangEditor、TinyMCE、OnlyOffice 全交互矩阵没有自动化。

直接证据：destroy-cleanup-e2e、document-events-leak、iframe-event-policy、effect-listener、proxy、instanceof-patch 单元测试和 Chromium instanceof 集成测试。

### 3.3 脚本、样式和入口资源管线

**历史问题：** #1093、#434、#970、#861、#839、#648、#643、#470、#465、#472、#374、#469、#453、#363、#339、#481、#211、#210、#188、#184、#173、#166、#174、#172、#163、#161、#164、#160、#95、#80、#18。

**结论：core 管线及 React 16 example 对当前产物的消费均已验证。**

- 入口 HTML/CSS/JS 使用可退出的 cache scope，失败请求会驱逐以允许重试。
- 静态 CSS 保持源顺序；动态 CSS 和 script 使用沙箱内调度器，取消的上一代不能复活。
- module、importmap、crossorigin、onload、onerror 等属性和完成信号统一处理。
- 样式延迟 href、insertAdjacentElement 链式 patch、loader 拒绝和 unmount 清理有专项测试。

直接证据：entry-pipeline、dynamic-script-sequence、iframe-script、dynamic-stylesheet-failure、stylesheet-patch、defer-style-href 测试。

此前出现过的 React 16/CRA 严格 ESM helper 解析失败已不再重现：React 16 example 的生产构建通过，相关 degrade、font、href 与生命周期场景也包含在本次完整 Chromium 集成结果中。

### 3.4 URL、路由、baseURI 和资源地址

**历史问题：** #1088、#975、#955、#681、#439、#323、#310、#194、#193、#155、#151、#140、#136、#113、#107、#103、#37。

**结论：已验证。**

- query 使用统一 codec，处理空值、加号、重复参数、原型键、百分号和主应用 hash。
- prefix 压缩使用最长匹配；降级和 href jump 有脱离 document 保护。
- 降级 iframe 注入 base；媒体、link、script 的动态 URL 按子应用 baseURI 归一化。
- CSS loader 保留 data URL，转换其他相对 URL。

直接证据：route-state、sync-route、options、shadow-runtime、plugin 单元测试。

### 3.5 CSS、字体、Web Components 和弹层

**历史问题：** #1092、#1093、#845、#620、#771、#853、#568、#570、#434、#432、#430、#131、#116、#80、#33、#35、#12。

**结论：通用样式管线已验证，Popper 和真实 Web Component 库矩阵为部分解决。**

- :root 转 :host、不可读 stylesheet 容错、adopted 资源 URL 固化、字体外提和销毁清理均有实现。
- Chromium 集成测试包含 :host、字体和 React 16 消费场景，相关用例均已通过。
- 标准 Popper/Floating 的几何补丁仍在；老 Element UI 的特定组合仍需要业务侧关闭 append-to-body 等配置。

### 3.6 React/Vue 适配器

**历史问题：** #1089、#971、#840、#689、#599、#393、#394、#382、#147、#62、#42、#34。

**结论：React 17+ 和 Vue 3 适配器公开行为有测试；React 16 与 Vue 2 子应用 example 的 Chromium 集成链路也已通过，但 Vue 2 主应用适配包仍已移除。**

- React/Vue 3 使用 RuntimeAppController，覆盖挂载、identity 变化、refresh、destroy、bus 转发、异常和 SSR 导入。
- 两个适配器的单元测试配置了 statements、branches、functions、lines 全部 100% 的阈值。
- Vue 2 适配代码和测试已删除，不能把 Vue 3 的覆盖率作为 Vue 2 已验证的证据。
- jieshu-react peer 不再允许 React 16；React 16 子应用 example 的生产构建和集成通过并不等于 React 16 主应用适配器重新获得支持。

### 3.7 低版浏览器和降级模式

**历史问题：** #1088、#861、#758、#648、#444、#280、#312、#302、#248、#185；另关联富文本调研中的 #489。

**结论：现代 Chromium 下的主动降级逻辑有测试；IE、旧 Chrome、Safari 承诺未验证且与产物不一致。**

具体冲突：

- tsconfig.json 和 Vite library config 的 target 是 ES2018。
- 没有 legacy plugin 或等价的 IE 语法降级产物。
- docs 仍写降级模式“理论上可以兼容到 IE9”。
- Playwright 只配置 Chromium，不包含 WebKit、Firefox 或历史 Chromium。

如果项目已正式放弃 IE、React 16 主应用适配和 Vue 2 主应用适配，应删除旧承诺并写入 breaking changes；如果没有放弃，这些就是发布阻断问题。React 16 / Vue 2 子应用 example 已通过不代表对应主应用适配包仍受支持。

### 3.8 工具链、类型和文档类记录

涉及 lint-staged、pnpm workspace protocol、package lint、cacheOptions 类型、文档搜索、demo 和 UMD 暴露。

**结论：多数不适用运行时回归判定；当前构建和发布 metadata 需要单独验收。**

代码已有严格 TypeScript 和消费端类型测试，但包改名、exports map、ESM/UMD 格式和最低 peer 版本发生了 breaking changes。这些不能因为单元测试通过就视为兼容。

## 4. 公开能力保留情况

| 历史能力                                      | 当前状态        | 证据/备注                                               |
| --------------------------------------------- | --------------- | ------------------------------------------------------- |
| setupApp / preloadApp / startApp / destroyApp | 保留            | core index 导出，options 与 public operation 有专项测试 |
| refreshApp / clearAssetsCache                 | 保留            | core 和 React/Vue 3 静态 API 都导出                     |
| 自定义 HTML                                   | 保留            | StartOptions.html 与 entry pipeline                     |
| degrade / degradeAttrs                        | 保留            | options、shadow/proxy 分支仍在；仅验证现代 Chromium     |
| sync / prefix 路由同步                        | 保留            | route-state 与 sync-route 单元测试                      |
| importmap、async/defer/module/fiber           | 保留            | template、iframe-script 和 scheduler 测试               |
| plugin loader、hooks、ignores、excludes       | 保留            | plugin/effect pipeline 测试                             |
| iframe 自定义事件                             | 保留            | sandbox policy 与 iframe event policy 测试              |
| React 容器 style 和 ref refresh/destroy       | 保留，React 17+ | adapter API 与单元测试                                  |
| Vue 3 容器 style 和 exposed refresh/destroy   | 保留            | adapter 类型与单元测试                                  |
| Vue 2 主应用适配包                            | 已移除          | workspace 中已无 Vue 2 主应用适配包                     |
| IE11/IE9 可执行产物                           | 未保留          | ES2018 target，无 legacy build                          |

## 5. 实际验证结果

### Core 单元测试

    pnpm --filter jieshu-core test:unit
    45 test files passed
    322 tests passed
    Statements 73.44% | Branches 65.43% | Functions 78.63% | Lines 76.70%

单元测试支持上述专项逻辑结论，但 core 覆盖率不是 100%，不能替代真实浏览器验收。

### Chromium 集成测试

    pnpm --filter jieshu-core test:integration
    React 主应用：48 passed
    Vue 主应用：49 passed
    合计：97 passed，0 failed

Vue 主应用复核时因默认端口被占用改用临时端口 18000；未修改代码语义。两套主应用下的 React 16、React 17、Vue 2、Vue 3、Vite、Angular 12，以及 degrade、font、href、head、:host 等场景均完成执行。

### Examples 生产构建

仓库内九个 example 的生产构建均已通过，包括 React 16/17、Vue 2/3、Vite、Angular 12 与两套主应用。

## 6. 修复优先级建议

1. 决定包名、Vue 2 主应用适配、React 16 主应用适配和 IE 的正式支持策略；保留则恢复实现和测试，放弃则写入 breaking changes 和迁移指南。
2. 增加发布产物消费矩阵：现代 Vite、Webpack 5、老 CRA/Webpack、CJS require、ESM import 和 script-tag UMD。
3. 为 Safari/WebKit、Firefox 和富文本真实交互增加集成测试。
4. 增加 start/destroy N 轮的真实浏览器内存基准；单元测试只能证明断链动作发生，不能证明 iframe realm 已被 GC。
