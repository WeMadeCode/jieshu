# 深入阅读 wujie 源码所需的前置知识

> 目标读者：准备通读 `packages/wujie-core/src` 的开发者。
> 本文只回答一个问题：**在动手读源码之前，我需要先掌握哪些基础知识？**
> 不做逐行源码解析，但每个知识点都标注了它在本仓库中的落点，方便你验证「学到什么程度算够」。
>
> 核心源码规模：`packages/wujie-core/src` 共 15 个文件、约 5600 行 TypeScript。

---

## 0. 先理解一句话，否则知识清单没有意义

wujie 与其他微前端方案最根本的区别：

> **它的沙箱不是自己造的，是借来的。**
> JS 运行在一个**同域的空 iframe** 里（借 iframe 原生的 `window`/`document` 隔离），
> DOM 渲染在主文档的 **Shadow DOM** 里（借 webcomponent 原生的样式隔离），
> 中间用 **Proxy** 把 iframe 里的 `document`/`location` 劫持，重定向到 Shadow DOM 和子应用的真实 URL。

由此推出三条主线，本文的知识点全部挂在这三条线上：

| 主线               | 解决什么                                     | 涉及的核心文件                      |
| ------------------ | -------------------------------------------- | ----------------------------------- |
| **JS 隔离**        | 子应用的全局变量、原型污染、定时器、事件监听 | `iframe.ts` `proxy.ts` `sandbox.ts` |
| **DOM / CSS 隔离** | 样式互不干扰、DOM 挂载位置、事件冒泡边界     | `shadow.ts` `effect.ts`             |
| **状态互通**       | 路由同步、应用间通信、生命周期               | `sync.ts` `event.ts` `index.ts`     |

再补一条：wujie 有**降级模式**（浏览器不支持 Proxy / webcomponent 时，用第二个 iframe 替代 Shadow DOM、用 `Object.defineProperty` 替代 Proxy）。这意味着**同一套逻辑在源码里往往有两份实现**，读代码时看到 `degrade` 分支不要慌。

---

## 第一层：必备知识（缺了就读不下去）

### 1.1 iframe 的冷知识 —— 权重最高，务必先补

这是整个框架的地基，也是历史 bug 最集中的地方。`contentWindow` 在源码中出现 74 次，`contentDocument` 28 次，`srcdoc` 18 次。

**必须搞清楚的点：**

- **同域判定**：`about:blank` 和 `srcdoc` 创建的 iframe，其 origin 由 HTML spec 规定**继承自 embedder**（即主应用），因此可以直接访问 `contentWindow` 而不触发跨域错误。这是整个方案能成立的前提。
- **`srcdoc` 与 `src` 的优先级**：spec 规定 `srcdoc` 优先级高于 `src`，只要 `srcdoc` 存在，`src` 会被浏览器忽略——想让 `src` 生效必须先 `removeAttribute("srcdoc")`。
- **iframe 导航是异步的**：`appendChild` 之后你立刻拿到的 `contentWindow.document` 还是初始的 `about:blank` 文档，随后到来的 `srcdoc` 文档会把它替换掉。**几乎所有 iframe 相关的诡异 bug 都源于这个时序。**
- **`document.open()` / `close()` 的副作用**：按 spec，`document.open()` 会**同步改写当前 document 的 URL**。wujie 用它把 iframe 的 URL 从 `about:srcdoc` 改写成主应用 URL，从而让 `location.origin` 与主应用同源。
- **iframe 有独立的 `history` 栈**，且其导航会影响父页面的前进/后退行为。

**源码印证：**

- [iframe.ts:1082-1107](../packages/wujie-core/src/iframe.ts#L1082-L1107) `iframeGenerator`：统一用 `srcdoc` 加载空白文档
- [iframe.ts:815-850](../packages/wujie-core/src/iframe.ts#L815-L850) `stopIframeLoading`：注释里完整写明了上述时序陷阱和兜底方案，**这段注释是理解 iframe 生命周期最好的材料，建议第一个读**

**自检**：你能解释为什么 `stopIframeLoading` 必须等 `load` 事件、而不能 `appendChild` 后立即调 `document.open()` 吗？

---

### 1.2 Shadow DOM / Web Components

`shadowRoot` 在源码中出现 66 次。

**必须掌握：**

- `customElements.define()` 自定义元素，以及 `connectedCallback` / `disconnectedCallback` 生命周期
- `attachShadow({ mode: "open" })`，以及 `mode: open` 与 `closed` 的差别
- **样式隔离边界**：为什么 shadow 内的 `<style>` 不会泄漏出去；以及**反向的坑**——`position: fixed` 的定位基准、第三方组件库把弹层 DOM 直接挂到 `document.body` 时会跑出 shadow 边界
- **事件重定向（event retargeting）**：事件穿过 shadow 边界时 `event.target` 会被改写成宿主元素；配套需要理解 `composed` 属性和 `composedPath()`
- `CSSStyleSheet` / `insertRule`，以及 `@font-face` 这类**无法在 shadow 内生效、必须提升到主文档**的特殊规则

**源码印证：**

- [shadow.ts:61-77](../packages/wujie-core/src/shadow.ts#L61-L77) 定义 `<wujie-app>` 自定义元素并 `attachShadow`
- [shadow.ts:389](../packages/wujie-core/src/shadow.ts#L389) `getPatchStyleElements`：处理需要特殊搬运的样式规则
- [sandbox.ts:559](../packages/wujie-core/src/sandbox.ts#L559) 用 `WUJIE_APP_ID` 标记属于当前子应用的 font 样式——正是上面"提升到主文档"的后果，销毁时要按 id 清理

**自检**：为什么 `@font-face` 定义在 shadowRoot 里不生效？把它挪到主文档后，多个子应用同时存在时怎么避免互相污染？

---

### 1.3 Proxy 与 Reflect

`new Proxy` 出现 6 次，但每一次都在要害位置。

**必须掌握：**

- `get` / `set` / `has` 陷阱的触发时机
- **`Proxy.revocable`**：wujie 用的是可撤销代理，而不是普通 Proxy。目的是**销毁子应用时彻底断开对 iframe 的引用，防止内存泄漏**——这是刻意的设计，不是随手写的
- **代理不变式（invariant）**：代理宿主对象时，若属性不可配置，`get` 必须返回与 target 一致的值，否则抛 `TypeError`。这直接解释了为什么降级模式**不能**用 Proxy 代理 `location`，只能手写一个假对象
- `Reflect.get(target, p, receiver)` 中 `receiver` 的作用，以及**故意不传 `receiver`** 的场景（沿用底层 proxy 已有的取值与 `this` 绑定逻辑）
- 两个冷门 Symbol：
  - **`Symbol.hasInstance`** —— 让跨 realm 的 `instanceof` 判断正确。iframe 里的 `Array`、`EventTarget` 等构造函数与主文档的**不是同一个对象**，不 patch 的话 `el instanceof HTMLElement` 会返回 `false`
  - **`Symbol.unscopables`** —— 控制 `with(obj){}` 语句中哪些标识符**不**从 `obj` 上取值

**源码印证：**

- [proxy.ts:51](../packages/wujie-core/src/proxy.ts#L51) `proxyWindow`、[proxy.ts:84](../packages/wujie-core/src/proxy.ts#L84) `proxyDocument`、[proxy.ts:210](../packages/wujie-core/src/proxy.ts#L210) `proxyLocation`——三个 `Proxy.revocable`，这是全项目最该精读的 200 行
- [proxy.ts:279-398](../packages/wujie-core/src/proxy.ts#L279-L398) 降级模式：注释明确写了「无法使用 `Proxy.revocable`，改用可清空的引用」
- [iframe.ts:355-380](../packages/wujie-core/src/iframe.ts#L355-L380) `Symbol.hasInstance` patch，注释解释了为什么必须用 own property
- [entry.ts:343-358](../packages/wujie-core/src/entry.ts#L343-L358) `Symbol.unscopables` 的实战用途：内联事件 `onclick="fn(event)"` 里的 `event` 必须放行给原生 handler 形参，否则会被 proxy 遮蔽成 `undefined`

**自检**：为什么代理 `location` 比代理 `window` 更容易踩不变式？降级模式下 `window.location.host` 拿到的是主应用还是子应用的 host，为什么？

---

### 1.4 脚本执行机制 —— 全项目最关键的 8 行

[iframe.ts:978-985](../packages/wujie-core/src/iframe.ts#L978-L985)：

```js
(function (window, self, global, location) {
  /* 子应用代码 */
}).bind(window.__WUJIE.proxy)(
  window.__WUJIE.proxy,
  window.__WUJIE.proxy,
  window.__WUJIE.proxy,
  window.__WUJIE.proxyLocation,
);
```

**要看懂它，你需要：**

- **函数参数遮蔽（shadowing）**：用形参名 `window` 覆盖外层 `window`，这是替代 `with` 语句的经典技巧（性能更好、不进入 sloppy mode）
- **`.bind()` 改写 `this`**：处理子应用在顶层用 `this` 指代 `window` 的写法
- **`<script>` 的三种执行时序**：普通、`async`、`defer`，以及**动态 `appendChild` 插入的 script 默认相当于 `async`**——wujie 靠手动串行队列（`execQueue`）恢复原本的执行顺序，见 [iframe.ts:1003-1007](../packages/wujie-core/src/iframe.ts#L1003-L1007)
- **ESM 与 importmap 为什么必须跳过这层包裹**：`type="module"` 有自己的作用域和严格模式，包一层函数会破坏 `import` 语法。见 [iframe.ts:977](../packages/wujie-core/src/iframe.ts#L977) 的三重判断
- **webpack `publicPath: "auto"` 的原理**：它靠 `document.currentScript.src` 反推资源基础路径。内联脚本没有真实 `src`，所以 wujie 用 `Object.defineProperty` 伪造了一个 —— [iframe.ts:987-996](../packages/wujie-core/src/iframe.ts#L987-L996)

**自检**：为什么内联脚本要包一层函数，而外链脚本不需要？如果子应用用了 `type="module"`，它的 `window` 还能被隔离吗？

---

### 1.5 属性描述符与 monkey patch

`Object.defineProperty` 出现 13 次，`getOwnPropertyDescriptor` 12 次，`Element.prototype` 13 次。这类代码"脏"但是全框架的胶水层，读源码时占比很大。

**必须掌握：**

- **先存原生、再覆盖**的标准套路。wujie 用一组 `__WUJIE_RAW_*` 全局变量保存原生方法，见 [iframe.ts:75-89](../packages/wujie-core/src/iframe.ts#L75-L89) 的类型声明和 [iframe.ts:795-798](../packages/wujie-core/src/iframe.ts#L795-L798) 的赋值
- **访问器属性（getter/setter）与数据属性**的区别，以及 `configurable` 为 `false` 时改写会失败——源码里大量 `descriptor?.configurable` 的防御性判断都是为此
- `on*` 事件属性（`onclick` 等）本质是**原型上的访问器**，patch 它们要用 `defineProperty` 而非直接赋值，见 [iframe.ts:596-680](../packages/wujie-core/src/iframe.ts#L596-L680)

**wujie 实际 patch 了哪些原型方法**（了解范围即可，不必背）：

| 原型方法                                                      | 位置                                                                    | 目的                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| `Node.prototype.appendChild` / `insertBefore` / `removeChild` | [iframe.ts:716-740](../packages/wujie-core/src/iframe.ts#L716-L740)     | 把 iframe 里的 DOM 操作重定向到 shadowRoot |
| `Node.prototype.getRootNode`                                  | [iframe.ts:720](../packages/wujie-core/src/iframe.ts#L720)              | 让子应用拿到正确的根节点                   |
| `Node.prototype.addEventListener` / `removeEventListener`     | [iframe.ts:412-440](../packages/wujie-core/src/iframe.ts#L412-L440)     | 记录监听器以便销毁时清理                   |
| `Document.prototype.addEventListener` / `removeEventListener` | [iframe.ts:520-580](../packages/wujie-core/src/iframe.ts#L520-L580)     | 同上，document 级别                        |
| `Element.prototype.setAttribute`                              | [iframe.ts:1172-1180](../packages/wujie-core/src/iframe.ts#L1172-L1180) | 编译内联事件属性                           |
| `Event.prototype.timeStamp`                                   | [iframe.ts:496](../packages/wujie-core/src/iframe.ts#L496)              | 跨 realm 时间基准对齐                      |

**自检**：为什么 patch `addEventListener` 时必须把监听器记录下来？不记录会导致什么后果？（提示：看 `notes/memory-leak-investigation.md`）

---

## 第二层：重要知识（决定你能读多深）

### 2.1 History / Location API 与路由同步

- `history.pushState` / `replaceState` 的参数与**不触发 `popstate`** 的特性
- `popstate` 与 `hashchange` 的触发条件差异
- 如何在不刷新页面的前提下，把子应用路由反映到主应用 URL 上

**源码印证**：[sync.ts](../packages/wujie-core/src/sync.ts) 全文 158 行，`replaceState` 用于同步（不产生历史记录），`pushState` 用于真实跳转，`popstate` 监听浏览器前进后退。三者的分工是理解路由同步的钥匙。

### 2.2 事件机制与应用间通信

- 捕获 / 冒泡两阶段、`stopPropagation` 与 `stopImmediatePropagation`
- `CustomEvent` 与 `EventTarget`（源码中 `CustomEvent` 出现 9 次）
- 发布订阅模式的基本实现

**源码印证**：[event.ts](../packages/wujie-core/src/event.ts) 的 `EventBus`。注意开头的 `appEventObjMap`——它同时挂在 `window.__WUJIE_INJECT` 上，**为了在嵌套场景下复用同一个事件中心**，这是理解嵌套微前端的入口。

### 2.3 MutationObserver

子应用运行时会动态插入 `<style>` / `<script>` / DOM，需要监听并处理。`MutationObserver` 出现 12 次。

**必须掌握**：`observe()` 的配置项（`childList` / `subtree` / `attributes`）、回调的批量与异步（微任务）时机、`disconnect()` 的必要性。

**源码印证**：[effect.ts:221](../packages/wujie-core/src/effect.ts#L221)、以及 [effect.ts:96-190](../packages/wujie-core/src/effect.ts#L96-L190) `patchStylesheetElement` 中「劫持递归装到新 style 上」的处理。

### 2.4 内存管理与 WeakMap

`WeakMap` 出现 17 次。微前端框架最常见的线上问题就是内存泄漏（子应用切换后实例未释放）。

**必须掌握**：强引用 / 弱引用、`WeakMap` 的键必须是对象、闭包持有 DOM 导致的泄漏、Chrome DevTools Memory 面板的 Heap Snapshot 用法（能看懂 Retainers 链就够）。

**配套阅读**：本仓库 `notes/memory-leak-investigation.md` 是真实的排查记录，比任何教程都好。

### 2.5 HTML 解析与资源提取

子应用入口 HTML 需要被拆成「模板 + JS 列表 + CSS 列表」。

**必须掌握**：正则/DOM 两种解析思路的取舍、相对路径与 `<base>` 的解析规则、`fetch` 与跨域 CORS。

**源码印证**：[template.ts](../packages/wujie-core/src/template.ts)（316 行，解析）+ [entry.ts](../packages/wujie-core/src/entry.ts)（388 行，加载与执行）。

### 2.6 TypeScript

不需要类型体操高手，但要能读懂：

- 全局声明合并（`declare global` 给 `Window` 加属性）—— [iframe.ts:75-89](../packages/wujie-core/src/iframe.ts#L75-L89)
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
| **pnpm workspace + lerna**          | 本仓库是 monorepo：`wujie-core` 是内核，`wujie-vue3/react` 是框架适配层                                    |
| **同源策略与 CSP**                  | 理解 iframe 方案的边界；某些场景 CSP 会直接禁掉 `srcdoc`                                                   |
| **CSS 变量、`:host` / `::slotted`** | Shadow DOM 内的样式穿透手段                                                                                |

---

## 上手前的最后一步：先读文档，别直接扑代码

以下三份材料决定你读代码时是否会迷路，**强烈建议按顺序先看完**：

1. [docs/guide/mode.md](../docs/guide/mode.md) —— **保活 / 单例 / 重建**三种运行模式。
   `index.ts` 和 `sandbox.ts` 中大量分支都在区分这三者，不先理解会完全看不懂为什么同一个操作有三套路径。
2. [docs/guide/degrade.md](../docs/guide/degrade.md) —— 降级方案。
   解释了为什么 `proxy.ts` / `shadow.ts` 都有"第二套实现"。
3. `docs/guide/principle.drawio` —— 架构图（用 draw.io 或 VSCode 插件打开）。

其余按需查阅：`communication.md`（通信）、`sync.md`（路由同步）、`lifecycle.md`（生命周期）、`nest.md`（嵌套）、`preload.md`（预加载）。

---

## 建议的源码阅读顺序

按依赖关系与难度递增排列，括号内为行数：

| #   | 文件                                                                                                                                                                                                      | 行数                | 读它是为了                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------- |
| 1   | [constant.ts](../packages/wujie-core/src/constant.ts)                                                                                                                                                     | 48                  | 熟悉命名约定，后面到处出现                     |
| 2   | [utils.ts](../packages/wujie-core/src/utils.ts)                                                                                                                                                           | 378                 | 工具函数，扫一遍知道有什么即可                 |
| 3   | [index.ts](../packages/wujie-core/src/index.ts)                                                                                                                                                           | 429                 | `startApp` 主流程，**只看骨架，不钻细节**      |
| 4   | [template.ts](../packages/wujie-core/src/template.ts) + [entry.ts](../packages/wujie-core/src/entry.ts)                                                                                                   | 316 + 388           | HTML/JS/CSS 如何被拆解和加载                   |
| 5   | **[iframe.ts](../packages/wujie-core/src/iframe.ts)**                                                                                                                                                     | 1183                | **核心**：JS 沙箱创建、脚本注入、原型 patch    |
| 6   | **[proxy.ts](../packages/wujie-core/src/proxy.ts)**                                                                                                                                                       | 399                 | **核心**：三个 Proxy 分别拦了什么              |
| 7   | [shadow.ts](../packages/wujie-core/src/shadow.ts)                                                                                                                                                         | 425                 | DOM 容器与样式处理                             |
| 8   | [effect.ts](../packages/wujie-core/src/effect.ts)                                                                                                                                                         | 589                 | 运行时副作用处理，最脏但最实用                 |
| 9   | [sandbox.ts](../packages/wujie-core/src/sandbox.ts)                                                                                                                                                       | 713                 | `WuJie` 类：把以上全部串起来 + 生命周期 + 销毁 |
| 10  | [sync.ts](../packages/wujie-core/src/sync.ts) / [event.ts](../packages/wujie-core/src/event.ts) / [plugin.ts](../packages/wujie-core/src/plugin.ts) / [tracker.ts](../packages/wujie-core/src/tracker.ts) | 158 / 121 / 97 / 98 | 周边能力，随时可插入阅读                       |

**关键建议：不要从头到尾顺读。**
跑起 [examples/](../examples/)（`pnpm start`），在 `startApp` 打断点，跟着走完一次
「创建 iframe → 拉取 HTML → 注入 script → 挂载 shadowRoot → 子应用首屏」
的完整调用链。这比静态读 5600 行有效得多。

---

## 自检清单

能顺畅回答以下问题，说明前置知识已经够了：

**iframe 与时序**

1. `about:blank` / `srcdoc` 的 iframe 为什么与父页面同域？
2. 为什么 `appendChild` 之后不能立即操作 `contentWindow.document`？
3. `document.open()` 为什么能改写 iframe 的 URL？

**Proxy** 4. 为什么用 `Proxy.revocable` 而不是 `new Proxy`？ 5. 代理不变式如何限制了对 `location` 的代理？ 6. `Symbol.hasInstance` 解决的跨 realm 问题具体长什么样？

**脚本执行** 7. `(function(window, self, global, location){...}).bind(proxy)(...)` 每个参数分别解决什么问题？ 8. 为什么 `type="module"` 必须跳过这层包裹？ 9. 动态插入的 `<script>` 默认执行顺序是什么？wujie 怎么恢复串行？

**Shadow DOM** 10. 事件穿过 shadow 边界时 `target` 会怎么变？ 11. `@font-face` 为什么必须提升到主文档？提升后如何避免多应用互相污染？

**架构** 12. 保活 / 单例 / 重建三种模式，切换页面时各自销毁了什么？ 13. 降级模式牺牲了什么能力，为什么？ 14. `replaceState` 和 `pushState` 在路由同步里分别用在哪？

---

## 参考资料

- MDN: [Proxy](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Proxy) · [Shadow DOM](https://developer.mozilla.org/zh-CN/docs/Web/API/Web_components/Using_shadow_DOM) · [MutationObserver](https://developer.mozilla.org/zh-CN/docs/Web/API/MutationObserver) · [History API](https://developer.mozilla.org/zh-CN/docs/Web/API/History_API)
- HTML Spec: [iframe srcdoc](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-srcdoc) · [document.open()](https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-document-open)
- 本仓库：`docs/` 官方文档、`notes/` 真实问题排查记录

---

_本文基于本地仓库代码撰写，行号引用对应当前工作副本；若源码变动请重新核对。_
