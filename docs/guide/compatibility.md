# 运行环境要求

界枢使用 `Proxy` 实现 JavaScript 运行时代理，使用 Custom Elements 和 Shadow DOM 承载子应用 DOM。运行框架的浏览器必须支持这些能力。

框架不再将子应用切换到另一套 iframe 渲染路径。如果当前环境缺少 `Proxy` 或 Custom Elements，启动或预加载会明确失败，不会自动改变隔离模型。

::: tip 建议

- 在主应用的 browserslist 和 CI 中明确列出支持的现代浏览器。
- 应用启动前可以用 `typeof Proxy === 'function'` 和 `window.customElements` 做能力检测，并向不支持的用户展示升级提示。
- `attrs` 仍用于配置子应用的 JavaScript 运行 iframe；子应用的可见 DOM 始终渲染在 Shadow DOM 中。

:::
