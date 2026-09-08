# clearAssetsCache

- **类型：** `Function`

- **参数：** `host?: string | string[]`

- **返回值：** `void`

清空界枢模块级 HTML、JavaScript 和 CSS 资源缓存。资源按 URL 和 `fetch` 函数身份隔离：不同 `fetch` 不会复用同 URL 的响应；同一个 `fetch` 可以跨实例复用已完成资源。框架为子应用包装的 `fetch` 保留原函数的缓存身份。

`destroyApp` 会使该实例尚未完成的请求失效，但保留已完成资源；`refreshApp` 重建实例时也可能命中这些缓存。资源更新后需要调用此 API 主动失效。

如果同一个 `fetch` 函数内部的登录态、租户、Cookie 或灰度条件发生变化，框架无法仅凭函数身份识别变化，应在重新加载应用前清理相关缓存。也可以为不同请求上下文提供独立、稳定的 `fetch` 函数。

::: tip 使用场景

- 子应用静态资源热更新后，需要强制重新拉取 html / js / css
- 同一个 fetch 的登录态、租户或请求条件改变后，需要重新加载资源
- 同一主应用下挂载多个不同 host 的子应用，切换后希望清理指定 host 的缓存
- 排查资源缓存导致的「页面不更新」问题

:::

## host

- **类型：** `string | string[]`

- **详情：**

  - 不传参：清空全部资源缓存
  - 传入单个 host（如 `"https://a.com"`）：只清空缓存 key 以该前缀匹配的条目
  - 传入 host 数组：批量清理多个前缀

匹配前缀的条目会在所有 `fetch` 上下文中失效。已发出的请求不会因此中止，但其迟到结果不会重新填入已清理的缓存。

## 示例

```javascript
import { clearAssetsCache } from '@cloud/jieshu-core';

// 清空全部缓存
clearAssetsCache();

// 只清理指定 host
clearAssetsCache('https://a.com');

// 批量清理
clearAssetsCache(['https://a.com', 'https://b.com']);
```

::: warning 注意

此 API 仅清理界枢内部的资源加载缓存，不会销毁子应用实例。若需全量重建子应用，请使用 [refreshApp](/api/refreshApp.html) 或 [destroyApp](/api/destroyApp.html) + [startApp](/api/startApp.html)。

通过浏览器原生加载的资源（例如外部 module、配置忽略的资源）以及浏览器 HTTP 缓存不受此 API 控制；接口请求也不属于上述资源缓存。

:::
