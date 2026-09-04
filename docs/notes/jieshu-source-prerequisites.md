# 深入阅读 jieshu 源码所需的前置知识

> 目标读者：准备通读 `packages/jieshu-core/src` 的开发者。
> 本文只回答一个问题：**在动手读源码之前，我需要先掌握哪些基础知识？**
> 不做逐行源码解析，但每个知识点都标注了它在本仓库中的落点，方便你验证「学到什么程度算够」。
>
> 核心源码规模：`packages/jieshu-core/src` 当前共 30 个 TypeScript 文件、约 9300 行（以 `src/*.ts` 统计）。

---

## 0. 先理解一句话，否则知识清单没有意义

jieshu 与其他微前端方案最根本的区别：

> **它的沙箱不是自己造的，是借来的。**
> JS 运行在一个**同域的空 iframe** 里（借 iframe 原生的 `window`/`document` 隔离），
> DOM 渲染在主文档的 **Shadow DOM** 里（借 webcomponent 原生的样式隔离），
> 中间用 **Proxy** 把 iframe 里的 `document`/`location` 劫持，重定向到 Shadow DOM 和子应用的真实 URL。

由此推出三条主线，本文的知识点全部挂在这三条线上：

| 主线               | 解决什么                                       | 涉及的核心文件                                                                         |
| ------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| **JS 隔离**        | 子应用的全局变量、原型污染、脚本调度、事件监听 | `iframe.ts` `iframe-script.ts` `iframe-inline-events.ts` `proxy.ts` `sandbox.ts`       |
| **DOM / CSS 隔离** | 样式互不干扰、DOM 挂载位置、事件冒泡边界       | `shadow.ts` `effect.ts` `effect-pipeline.ts` `native-dom.ts`                           |
| **状态互通**       | 路由同步、应用间通信、生命周期与并发意图       | `route-state.ts` `sync.ts` `event.ts` `index.ts` `operation-intent.ts` `controller.ts` |

再补一条：jieshu 只维护一条运行路径，依赖浏览器原生 `Proxy` 与 Custom Elements。缺少任一能力时，`startApp` / `preloadApp` 会直接抛出不支持错误，不会切换到另一套渲染实现。

---

## 第一层：必备知识（缺了就读不下去）

### 1.1 iframe 的冷知识 —— 权重最高，务必先补

这是整个框架的地基，也是历史 bug 最集中的地方。`contentWindow`、`contentDocument` 和 `srcdoc` 都是阅读时需要持续关注的关键词。

**必须搞清楚的点：**

- **同域判定**：`about:blank` 和 `srcdoc` 创建的 iframe，其 origin 由 HTML spec 规定**继承自 embedder**（即主应用），因此可以直接访问 `contentWindow` 而不触发跨域错误。这是整个方案能成立的前提。
- **`srcdoc` 与 `src` 的优先级**：spec 规定 `srcdoc` 优先级高于 `src`，只要 `srcdoc` 存在，`src` 会被浏览器忽略——想让 `src` 生效必须先 `removeAttribute("srcdoc")`。
- **iframe 导航是异步的**：`appendChild` 之后你立刻拿到的 `contentWindow.document` 还是初始的 `about:blank` 文档，随后到来的 `srcdoc` 文档会把它替换掉。**几乎所有 iframe 相关的诡异 bug 都源于这个时序。**
- **`document.open()` / `close()` 的副作用**：按 spec，`document.open()` 会**同步改写当前 document 的 URL**。jieshu 用它把 iframe 的 URL 从 `about:srcdoc` 改写成主应用 URL，从而让 `location.origin` 与主应用同源。
- **iframe 有独立的 `history` 栈**，且其导航会影响父页面的前进/后退行为。

**源码印证：**

- [iframe.ts](../../packages/jieshu-core/src/iframe.ts) 中的 `iframeGenerator`：统一用 `srcdoc` 加载空白文档
- [iframe.ts](../../packages/jieshu-core/src/iframe.ts) 中的 `stopIframeLoading`：注释里完整写明了上述时序陷阱和兜底方案，**这段注释是理解 iframe 生命周期最好的材料，建议第一个读**

**自检**：你能解释为什么 `stopIframeLoading` 必须等 `load` 事件、而不能 `appendChild` 后立即调 `document.open()` 吗？

---

### 1.2 Shadow DOM / Web Components

`shadowRoot` 是这条主线中最重要的关键词之一。

**必须掌握：**

- `customElements.define()` 自定义元素，以及 `connectedCallback` / `disconnectedCallback` 生命周期
- `attachShadow({ mode: "open" })`，以及 `mode: open` 与 `closed` 的差别
- **样式隔离边界**：为什么 shadow 内的 `<style>` 不会泄漏出去；以及**反向的坑**——`position: fixed` 的定位基准、第三方组件库把弹层 DOM 直接挂到 `document.body` 时会跑出 shadow 边界
- **事件重定向（event retargeting）**：事件穿过 shadow 边界时 `event.target` 会被改写成宿主元素；配套需要理解 `composed` 属性和 `composedPath()`
- `CSSStyleSheet` / `insertRule`，以及 `@font-face` 这类**无法在 shadow 内生效、必须提升到主文档**的特殊规则

**源码印证：**

- [shadow.ts](../../packages/jieshu-core/src/shadow.ts) 中的 `defineJieshuWebComponent` / `createJieshuWebComponent`：定义 `<jieshu-app>` 自定义元素并 `attachShadow`
- [shadow.ts](../../packages/jieshu-core/src/shadow.ts) 中的 `getPatchStyleElements`：提取需要特殊搬运的 `:root` 与 `@font-face` 规则
- [sandbox.ts](../../packages/jieshu-core/src/sandbox.ts) 中的 `patchCssRules` 负责标记并登记初始 font 样式，[effect.ts](../../packages/jieshu-core/src/effect.ts) 的 `handleStylesheetElementPatch` 处理动态 font 样式，`clearFontStyleSheets` 最终按登记数组移除节点

**自检**：为什么 `@font-face` 定义在 shadowRoot 里不生效？把它挪到主文档后，多个子应用同时存在时怎么避免互相污染？

---

### 1.3 Proxy 与 Reflect

Proxy 的创建集中在少数几个入口，但每一个都在要害位置。

**必须掌握：**

- `get` / `set` / `has` 陷阱的触发时机
- **`Proxy.revocable`**：jieshu 的 window / document / location 三大主代理使用可撤销代理，目的是**销毁子应用时彻底断开对 iframe 的引用，防止内存泄漏**；辅助代理仍会按需使用普通 `Proxy`
- **代理不变式（invariant）**：代理宿主对象时，若属性不可配置，`get` 必须返回与 target 一致的值，否则抛 `TypeError`。因此 `proxyLocation` 使用空对象作为 target
- `Reflect.get(target, p, receiver)` 中 `receiver` 的作用，以及**故意不传 `receiver`** 的场景（沿用底层 proxy 已有的取值与 `this` 绑定逻辑）
- 两个冷门 Symbol：
  - **`Symbol.hasInstance`** —— 让跨 realm 的 DOM / Event `instanceof` 判断正确。iframe 里的 `HTMLElement`、`EventTarget` 等构造函数与主文档的**不是同一个对象**，不 patch 的话 `el instanceof HTMLElement` 会返回 `false`
  - **`Symbol.unscopables`** —— 控制 `with(obj){}` 语句中哪些标识符**不**从 `obj` 上取值

**源码印证：**

- [proxy.ts](../../packages/jieshu-core/src/proxy.ts) 中的 `proxyGenerator`：集中创建 `proxyWindow`、`proxyDocument`、`proxyLocation` 三个可撤销代理
- [iframe.ts](../../packages/jieshu-core/src/iframe.ts) 中的 `patchInstanceofAcrossRealms`：处理 `Symbol.hasInstance` 与跨 realm 判断
- [entry.ts](../../packages/jieshu-core/src/entry.ts) 中的 `withInlineEventUnscopables`：内联事件 `onclick="fn(event)"` 里的 `event` 必须放行给原生 handler 形参，否则会被 proxy 遮蔽成 `undefined`

**自检**：为什么三大主代理需要可撤销，而某些辅助场景可以使用普通 `Proxy`？为什么 `proxyLocation` 选择空对象作为 target？

---

### 1.4 脚本执行机制 —— 关键脚本包装

[iframe-script.ts](../../packages/jieshu-core/src/iframe-script.ts) 中的 `wrapInlineCode` 会生成以下包装：

```js
(function (window, self, global, location) {
  /* 子应用代码 */
}).bind(window.__JIESHU.proxy)(
  window.__JIESHU.proxy,
  window.__JIESHU.proxy,
  window.__JIESHU.proxy,
  window.__JIESHU.proxyLocation,
);
```

**要看懂它，你需要：**

- **函数参数遮蔽（shadowing）**：用形参名 `window` 覆盖外层 `window`，这是替代 `with` 语句的经典技巧（性能更好、不进入 sloppy mode）
- **`.bind()` 改写 `this`**：处理子应用在顶层用 `this` 指代 `window` 的写法
- **`<script>` 的三种执行时序**：普通、`async`、`defer`，以及**动态 `appendChild` 插入的 script 默认相当于 `async`**。入口脚本由 [sandbox.ts](../../packages/jieshu-core/src/sandbox.ts) 的 `Jieshu.start` 配合 [sandbox-runtime.ts](../../packages/jieshu-core/src/sandbox-runtime.ts) 的 `groupScripts` / `SandboxScriptScheduler` 调度；运行时动态脚本由 [effect.ts](../../packages/jieshu-core/src/effect.ts) 的 `DynamicScriptScheduler` 接管，并通过 `scheduleSandboxDynamicScript` / `SandboxPromiseSequence` 维护外链请求顺序；最终都进入 `insertScriptToIframe` 和沙箱 `execQueue`
- **ESM 与 importmap 为什么必须跳过这层包裹**：`type="module"` 有自己的作用域和严格模式，包一层函数会破坏 `import` 语法；判断集中在 [iframe-script.ts](../../packages/jieshu-core/src/iframe-script.ts) 的 `configureScriptElement`
- **webpack `publicPath: "auto"` 的原理**：它靠 `document.currentScript.src` 反推资源基础路径。内联脚本没有真实 `src`，所以 `exposeInlineScriptSource` 会用 `Object.defineProperty` 提供脚本来源

**自检**：哪些脚本会先转成 content 再包进代理函数，哪些会保留原生 `src` 或 module 执行？如果子应用用了 `type="module"`，它的 `window` 还能被隔离吗？

---

### 1.5 属性描述符与 monkey patch

`Object.defineProperty`、`getOwnPropertyDescriptor` 与各类 DOM prototype patch 是全框架的胶水层，读源码时占比很大。

**必须掌握：**

- **先存原生、再覆盖**的标准套路。jieshu 用一组 `__JIESHU_RAW_*` 全局变量保存原生方法；声明与初始化集中在 [iframe.ts](../../packages/jieshu-core/src/iframe.ts) 的全局 `Window` 扩展和 `initIframeDom`，主文档原生能力则由 [native-dom.ts](../../packages/jieshu-core/src/native-dom.ts) 统一捕获
- **访问器属性（getter/setter）与数据属性**的区别，以及 `configurable` 为 `false` 时改写会失败——源码里大量 `descriptor?.configurable` 的防御性判断都是为此
- `window.on*` / `document.on*` 这类事件属性本质是**原型上的访问器**，相关 patch 位于 [iframe.ts](../../packages/jieshu-core/src/iframe.ts) 的 `patchWindowEffect` / `patchDocumentEffect`，清理由 [tracker.ts](../../packages/jieshu-core/src/tracker.ts) 的 `EventCleanupTracker` 统一管理
- HTML 的 `onclick="..."` 与运行时 `setAttribute` 是另一条链路，由 [iframe-inline-events.ts](../../packages/jieshu-core/src/iframe-inline-events.ts) 的 `compileInlineEvents` / `patchInlineEventSetAttribute` / `wrapInlineEventHandler` 负责编译

**jieshu 实际 patch 了哪些原型方法**（了解范围即可，不必背）：

| 原型方法                                                      | 文件与入口符号                                                                                                      | 目的                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `Node.prototype.appendChild` / `insertBefore` / `removeChild` | [iframe.ts](../../packages/jieshu-core/src/iframe.ts) 的 `patchNodeEffect`                                          | 修补 iframe 中后续插入或移除的节点 |
| `Node.prototype.getRootNode`                                  | [iframe.ts](../../packages/jieshu-core/src/iframe.ts) 的 `patchNodeEffect`                                          | 让子应用拿到正确的根节点           |
| `Document.prototype.addEventListener` / `removeEventListener` | [iframe.ts](../../packages/jieshu-core/src/iframe.ts) 的 `patchDocumentEffect`                                      | 处理 document 级监听器             |
| `head/body.appendChild` / `insertBefore` / `removeChild`      | [effect.ts](../../packages/jieshu-core/src/effect.ts) 的 `patchRenderEffect`                                        | 劫持动态 DOM、脚本与样式资源       |
| `Element.prototype.setAttribute`                              | [iframe-inline-events.ts](../../packages/jieshu-core/src/iframe-inline-events.ts) 的 `patchInlineEventSetAttribute` | 编译内联事件属性                   |
| `Event.prototype.timeStamp`                                   | [iframe.ts](../../packages/jieshu-core/src/iframe.ts) 的 `patchEventTimeStamp`                                      | 跨 realm 时间基准对齐              |

**自检**：为什么 patch `addEventListener` 时必须把监听器记录下来？不记录会导致什么后果？（提示：看 `docs/notes/memory-leak-investigation.md`）

---

## 第二层：重要知识（决定你能读多深）

### 2.1 History / Location API 与路由同步

- `history.pushState` / `replaceState` 的参数与**不触发 `popstate`** 的特性
- `popstate` 与 `hashchange` 的触发条件差异
- 如何在不刷新页面的前提下，把子应用路由反映到主应用 URL 上

**源码印证**：[route-state.ts](../../packages/jieshu-core/src/route-state.ts) 负责查询参数的编解码与短路径，[sync.ts](../../packages/jieshu-core/src/sync.ts) 负责主、子应用路由状态同步，[iframe.ts](../../packages/jieshu-core/src/iframe.ts) 的 `patchIframeHistory` / `syncIframeUrlToWindow` 则把状态接入 iframe 的 `replaceState`、`pushState` 和 `popstate`。三者的分工是理解路由同步的钥匙。

### 2.2 事件机制与应用间通信

- 捕获 / 冒泡两阶段、`stopPropagation` 与 `stopImmediatePropagation`
- `CustomEvent` 与 `EventTarget`
- 发布订阅模式的基本实现

**源码印证**：[event.ts](../../packages/jieshu-core/src/event.ts) 的 `EventBus`。注意开头的 `appEventObjMap`——它同时挂在 `window.__JIESHU_INJECT` 上，**为了在嵌套场景下复用同一个事件中心**，这是理解嵌套微前端的入口。

### 2.3 MutationObserver

子应用运行时动态插入 `<style>` / `<script>` / DOM，主要由 `patchRenderEffect` 对 DOM 方法进行同步劫持；`MutationObserver` 专门用于无法同步获知的属性变化。

**必须掌握**：`observe()` 的配置项（`childList` / `subtree` / `attributes`）、回调的批量与异步（微任务）时机、`disconnect()` 的必要性。

**源码印证**：[effect.ts](../../packages/jieshu-core/src/effect.ts) 中的 `patchRenderEffect` / `rewriteAppendOrInsertChild` 处理动态插入，`DynamicScriptScheduler` 调度脚本；唯一实际调用 `observe()` 的 `deferStyleSheetByHref` 使用 `MutationObserver` 等待动态 `<link>` 的 `href`。

### 2.4 内存管理与 WeakMap

微前端框架最常见的线上问题就是内存泄漏（子应用切换后实例未释放），源码大量使用 `WeakMap` 降低跨应用引用长期存活的风险。

**必须掌握**：强引用 / 弱引用、`WeakMap` 的键必须是对象、闭包持有 DOM 导致的泄漏、Chrome DevTools Memory 面板的 Heap Snapshot 用法（能看懂 Retainers 链就够）。

**配套阅读**：本仓库 `docs/notes/memory-leak-investigation.md` 是真实的排查记录，比任何教程都好。

### 2.5 HTML 解析与资源提取

子应用入口 HTML 需要被拆成「模板 + JS 列表 + CSS 列表」。

**必须掌握**：HTML tokenization、raw-text / RCDATA / foreign content 上下文、属性解析与序列化边界、相对路径与 `<base>` 的解析规则，以及 `fetch` 与跨域 CORS。

**源码印证**：[template.ts](../../packages/jieshu-core/src/template.ts) 的 `tokenizeTemplate` / `TemplateCompiler` / `processTpl` 负责 token 化、资源抽取与序列化，[entry.ts](../../packages/jieshu-core/src/entry.ts) 的 `parseHtmlDocument` / `importHTML` 负责资源加载、缓存与入口绑定。

### 2.6 TypeScript

不需要类型体操高手，但要能读懂：

- 全局声明合并（`declare global` 给 `Window` 加属性）——见 [iframe.ts](../../packages/jieshu-core/src/iframe.ts) 的 `Window` 接口扩展
- `typeof Document.prototype.querySelector` 这类**取值类型**写法
- 泛型约束 `<T extends Node>`、可选链与非空断言
- 交叉类型（`HTMLStyleElement & { _patcher?: any }`）

---

## 第三层：加分项（读得更顺，但不是门槛）

| 知识点                              | 为什么有用                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **打包工具的运行时机制**            | webpack 的 `__webpack_public_path__`、`publicPath: auto`；Vite 的 ESM 产物形态。子应用接入报错八成出在这里 |
| **UMD / 库打包格式**                | 子应用需要暴露生命周期钩子时会用到                                                                         |
| **事件循环、微任务/宏任务**         | `execQueue` 串行执行、`MutationObserver` 回调时机、生命周期顺序                                            |
| **pnpm workspace**                  | 本仓库是 monorepo：`jieshu-core` 是内核，`jieshu-vue3/react` 是框架适配层                                  |
| **同源策略与 CSP**                  | 理解 iframe 方案的边界；某些场景 CSP 会直接禁掉 `srcdoc`                                                   |
| **CSS 变量、`:host` / `::slotted`** | Shadow DOM 内的样式穿透手段                                                                                |

---

## 上手前的最后一步：先读文档，别直接扑代码

以下三份材料决定你读代码时是否会迷路，**强烈建议按顺序先看完**：

1. [docs/guide/mode.md](../guide/mode.md) —— **保活 / 单例 / 重建**三种运行模式。
   `index.ts` 和 `sandbox.ts` 中大量分支都在区分这三者，不先理解会完全看不懂为什么同一个操作有三套路径。
2. [docs/guide/compatibility.md](../guide/compatibility.md) —— 运行环境要求与不支持行为。
3. `docs/guide/principle.drawio` —— 架构图（用 draw.io 或 VSCode 插件打开）。

其余按需查阅：`communication.md`（通信）、`sync.md`（路由同步）、`lifecycle.md`（生命周期）、`nest.md`（嵌套）、`preload.md`（预加载）。

---

## 建议的源码阅读顺序

按依赖关系与难度递增排列。这里使用入口符号而不是行号，源码增删时更容易重新定位：

| #   | 文件组                                                                                                                                                                                                                                 | 建议入口与阅读目的                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | [constant.ts](../../packages/jieshu-core/src/constant.ts)、[contracts.ts](../../packages/jieshu-core/src/contracts.ts)、[options.ts](../../packages/jieshu-core/src/options.ts)                                                        | 先熟悉常量、公开契约与 `resolveOptions`                                                             |
| 2   | [utils.ts](../../packages/jieshu-core/src/utils.ts)、[url-utils.ts](../../packages/jieshu-core/src/url-utils.ts)、[native-dom.ts](../../packages/jieshu-core/src/native-dom.ts)、[common.ts](../../packages/jieshu-core/src/common.ts) | 浏览通用工具、URL 处理、原生 DOM 能力快照与兼容聚合出口                                             |
| 3   | [index.ts](../../packages/jieshu-core/src/index.ts)、[operation-intent.ts](../../packages/jieshu-core/src/operation-intent.ts)、[sandbox-registry.ts](../../packages/jieshu-core/src/sandbox-registry.ts)                              | 从 `startApp` / `preloadApp` / `destroyApp` 看公开流程，以及同名应用操作如何判定过期                |
| 4   | [route-state.ts](../../packages/jieshu-core/src/route-state.ts)、[sync.ts](../../packages/jieshu-core/src/sync.ts)、[event.ts](../../packages/jieshu-core/src/event.ts)                                                                | 理解路由状态编解码、History 接入与 `EventBus`                                                       |
| 5   | [template.ts](../../packages/jieshu-core/src/template.ts)、[entry.ts](../../packages/jieshu-core/src/entry.ts)                                                                                                                         | 跟踪 HTML 解析、资源提取、缓存和入口绑定                                                            |
| 6   | [iframe-script.ts](../../packages/jieshu-core/src/iframe-script.ts)、[sandbox-runtime.ts](../../packages/jieshu-core/src/sandbox-runtime.ts)                                                                                           | 从 `insertScriptToIframe` 与 `SandboxScriptScheduler` 理解脚本执行和取消                            |
| 7   | **[iframe.ts](../../packages/jieshu-core/src/iframe.ts)**、[iframe-inline-events.ts](../../packages/jieshu-core/src/iframe-inline-events.ts)                                                                                           | 从 `iframeGenerator` 开始看 JS 沙箱、跨 realm patch 与内联事件                                      |
| 8   | **[proxy.ts](../../packages/jieshu-core/src/proxy.ts)**、[proxy-resolver.ts](../../packages/jieshu-core/src/proxy-resolver.ts)、[function-binding.ts](../../packages/jieshu-core/src/function-binding.ts)                              | 从 `proxyGenerator` 看代理策略，再用 `getTargetValue` / `checkProxyFunction` 理解方法的 `this` 绑定 |
| 9   | [shadow.ts](../../packages/jieshu-core/src/shadow.ts)                                                                                                                                                                                  | 从 `defineJieshuWebComponent` 看 `<jieshu-app>`、ShadowRoot 与渲染容器                              |
| 10  | [effect.ts](../../packages/jieshu-core/src/effect.ts)、[effect-pipeline.ts](../../packages/jieshu-core/src/effect-pipeline.ts)                                                                                                         | 从 `patchRenderEffect` 看动态 DOM、脚本和样式副作用                                                 |
| 11  | **[sandbox.ts](../../packages/jieshu-core/src/sandbox.ts)**、[sandbox-policy.ts](../../packages/jieshu-core/src/sandbox-policy.ts)                                                                                                     | 阅读 `Jieshu` 类如何串起生命周期、资源、策略与销毁                                                  |
| 12  | [controller.ts](../../packages/jieshu-core/src/controller.ts)、[plugin.ts](../../packages/jieshu-core/src/plugin.ts)、[tracker.ts](../../packages/jieshu-core/src/tracker.ts)                                                          | 最后补齐适配器控制器、插件加载器与清理追踪器                                                        |

**关键建议：不要从头到尾顺读。**
跑起 [examples/](https://github.com/WeMadeCode/jieshu/tree/master/examples)（`pnpm start`），在 `startApp` 打断点，跟着走完一次
「创建执行 iframe → 拉取并解析 HTML → 挂载 Shadow DOM → 注入并执行 script → 子应用首屏」
的完整调用链。这比从头静态通读整个 `src` 目录有效得多。

---

## 自检清单

能顺畅回答以下问题，说明前置知识已经够了：

**iframe 与时序**

1. `about:blank` / `srcdoc` 的 iframe 为什么与父页面同域？
2. 为什么 `appendChild` 之后不能立即操作 `contentWindow.document`？
3. `document.open()` 为什么能改写 iframe 的 URL？

**Proxy** 4. 为什么用 `Proxy.revocable` 而不是 `new Proxy`？ 5. 代理不变式如何限制了对 `location` 的代理？ 6. `Symbol.hasInstance` 解决的跨 realm 问题具体长什么样？

**脚本执行** 7. `(function(window, self, global, location){...}).bind(proxy)(...)` 每个参数分别解决什么问题？ 8. 为什么 `type="module"` 必须跳过这层包裹？ 9. 动态插入的 `<script>` 默认执行顺序是什么？jieshu 怎么恢复串行？

**Shadow DOM** 10. 事件穿过 shadow 边界时 `target` 会怎么变？ 11. `@font-face` 为什么必须提升到主文档？提升后如何避免多应用互相污染？

**架构** 12. 保活 / 单例 / 重建三种模式，切换页面时各自销毁了什么？ 13. 为什么运行时同时要求 `Proxy` 与 Custom Elements？ 14. `replaceState` 和 `pushState` 在路由同步里分别用在哪？

---

## 参考资料

- MDN: [Proxy](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Proxy) · [Shadow DOM](https://developer.mozilla.org/zh-CN/docs/Web/API/Web_components/Using_shadow_DOM) · [MutationObserver](https://developer.mozilla.org/zh-CN/docs/Web/API/MutationObserver) · [History API](https://developer.mozilla.org/zh-CN/docs/Web/API/History_API)
- HTML Spec: [iframe srcdoc](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-srcdoc) · [document.open()](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-document-open)
- 本仓库：`docs/` 官方文档、`docs/notes/` 真实问题排查记录

---

_本文基于本地仓库代码撰写；入口以文件名和符号名定位，若源码结构变动请重新核对。_
