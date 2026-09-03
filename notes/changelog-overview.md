# CHANGELOG 统一梳理

> 整理日期：2026-09-03
>
> 原始记录：仓库内全部 CHANGELOG.md；完成归并后，源文件已删除
>
> 问题回归结论：见 [changelog-regression-audit.md](./changelog-regression-audit.md)

## 1. 整理原则

历史 changelog 由 Lerna 独立包模式生成，同一次提交会被写入根目录、核心包、适配包、文档和多个 example。当前工作区正在移除 Lerna，但这不会改变旧记录的重复来源。直接拼接会产生大量重复，所以这里采用“根时间轴 + 包独有记录”的方式归并：

- 根 CHANGELOG.md 作为 workspace 发布主时间轴。
- packages/wujie-core/CHANGELOG.md 用于核心运行时问题。
- packages/wujie-react 和 packages/wujie-vue3 只提取适配器独有变化。
- docs 和 examples 只提取文档、demo 或集成验证特有变化。
- 原始 changelog 已在完成归并和问题审计后删除；本文档是后续查阅历史版本的统一入口。

## 2. 文件清单

删除前，项目自有 changelog 共 13 份；另有 1 份 TinyMCE 上游 changelog。下表记录其原路径和归并前状态。

| 文件                                      | 行数 | 最新记录         | 当前 package 版本    | 定位                                  |
| ----------------------------------------- | ---: | ---------------- | -------------------- | ------------------------------------- |
| CHANGELOG.md                              |  491 | 2.1.0            | workspace 0.0.0      | workspace 总记录                      |
| packages/wujie-core/CHANGELOG.md          |  451 | 2.1.0            | 2.1.0                | 核心运行时                            |
| packages/wujie-react/CHANGELOG.md         |  264 | 2.1.0            | 2.1.0                | React 适配器                          |
| packages/wujie-vue3/CHANGELOG.md          |  258 | 2.1.0            | 2.1.0                | Vue 3 适配器                          |
| docs/CHANGELOG.md                         |  215 | 2.1.0            | 2.1.0                | 文档站                                |
| examples/main-react/CHANGELOG.md          |  243 | 2.1.0            | 2.1.0                | React 主应用 demo                     |
| examples/main-vue/CHANGELOG.md            |  250 | 2.1.0            | 2.1.0                | Vue 主应用 demo                       |
| examples/react16/CHANGELOG.md             |  224 | 2.1.0            | 2.1.0                | React 16 子应用 demo                  |
| examples/react17/CHANGELOG.md             |   46 | 1.0.26           | 2.0.0                | 记录滞后                              |
| examples/vite/CHANGELOG.md                |   40 | 1.0.23           | 2.0.0                | 记录滞后                              |
| examples/vue2/CHANGELOG.md                |   48 | 2.0.1            | 2.0.1                | Vue 2 子应用 demo                     |
| examples/vue3/CHANGELOG.md                |   40 | 2.1.0            | 2.1.0                | Vue 3 子应用 demo                     |
| examples/angular12/CHANGELOG.md           |   22 | 1.0.23           | 2.0.0                | 记录滞后                              |
| examples/vue2/public/tinymce/CHANGELOG.md | 3453 | TinyMCE 上游版本 | 非 workspace package | 第三方静态资源，不并入 Wujie 发布历史 |

根 changelog 包含 57 个版本段、116 条 Bug Fixes、36 条 Features。全部项目自有 changelog 合计引用 169 个去重后的 GitHub issue；其中 #34、#62 和 #42 只出现在适配包 changelog。

## 3. 去重后的版本脉络

### 2.1.x：完整刷新与销毁安全

- refreshApp 全量重建，解决刷新时销毁竞态。
- 异步 CSS 去重，字体样式提升到最外层 document.head。
- 支持子应用作用域内的内联事件处理器。
- lint-staged 接管提交前格式化。

### 2.0.x：沙箱重构与内存治理

- 重写 iframe 沙箱，使用空白同源 iframe 作为 JavaScript realm。
- 补齐 destroy 引用断链、$wujie 清理、适配器队列清理。
- 修复降级 iframe 的 base URL、富文本跨 realm 与动态皮肤 CSS。
- 处理 Popper 坐标偏移；老 Element UI 的特定 absolute 组合仍有边界，见 [popper-offset-resolved.md](./popper-offset-resolved.md)。

### 1.0.23–1.0.29：动态资源、路由与容错

- 动态 style 链式 patch、URL 解码、import map、iframe ready deadline。
- 快速切换与异步 unmount 并发安全。
- 嵌套路由 query、重复引入 Wujie 的注入上下文。
- error/unhandledrejection、HTML 根属性、CSS URL、adopted stylesheets 和动态脚本移除。

### 1.0.9–1.0.22：代理、事件与执行顺序

- document/window 事件、主应用 listener 销毁、降级模式 listener 恢复。
- DOM 查询异常保护、caretPositionFromPoint、多应用全局对象缓存。
- ESM、async、defer 和普通脚本的顺序及属性保留。
- 加载失败的 loadError 通知与缓存重试。

### 1.0.0–1.0.8：核心兼容面形成

- 降级 iframe、degradeAttrs、路由保活、键盘事件。
- 媒体、字体、CSS 相对路径与 :root 样式适配。
- React/Vue 容器样式、Vue 插件类型、预加载资源。
- 1.0.0 曾声明 IE11 兼容；这一承诺与当前 ES2018/Vite 构建不一致。

### 1.0.0-rc：初始能力和早期稳定化

- setupApp、全局配置缓存、loading、插件 hooks、JS/CSS ignore/exclude。
- window.window、ownerDocument、location origin/hash、嵌套主应用。
- 异步/module 脚本、fiber、样式重建和 destroy/unmount 顺序。

## 4. 包与 demo 的独有记录

| 范围                  | 去重后的独有信息                                                                      |
| --------------------- | ------------------------------------------------------------------------------------- |
| wujie-react           | #34 props 声明、#62 React 类型、props 变化重启、重复渲染保活、容器 style、refresh API |
| wujie-vue3            | #42 width 处理、Vue 注册类型、容器 style、refresh API                                 |
| docs                  | 搜索、实时体验页、create-wujie/自定义 demo 文档；少量 core 提交被误分到 docs          |
| main-react / main-vue | 通信、路由、富文本、主应用运行错误的演示与修复                                        |
| 子应用 examples       | 配合 core 验证字体、CSS 变量、生命周期、message 和富文本                              |

## 5. 现有 changelog 的数据质量问题

1. 1.0.21 与 1.0.22 的内容和日期完全重复。
2. 多数包为没有实际变更的 workspace 版本生成了空壳段落。
3. 根 changelog 没有 1.0.24 段落，但 1.0.25 的 compare 链接以 v1.0.24 为基线。
4. Markdown 标题层级和列表符号不统一。
5. 一些修复被放在 Features，一些 core 变更被写入 docs/example，包边界不清晰。
6. react17、vite、angular12 example 的 package 版本已高于最新 changelog 记录。
7. 当前包名、构建格式和适配器支持面有大幅变化，但版本仍是 2.1.0，新变化尚未进入任何 changelog。

## 6. 后续维护建议

- 下次发布前新增明确版本，集中记录包名、exports、ES target、React/Vue 支持范围和已移除的包。
- 根 changelog 只写 workspace 级概要；包 changelog 只写该包真实变更，不再生成空壳版本。
- 每条 bug fix 增加稳定的回归测试名或测试文件链接。
- 不再在源码树中保存分散的包级或第三方 changelog；后续项目发布记录统一维护在 `notes/`。
