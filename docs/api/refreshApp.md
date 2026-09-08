# refreshApp

- **类型：** `Function`

- **参数：** `startOptions`（与 [startApp](/api/startApp.html) 相同）

- **返回值：** `Promise<DestroyHandler | void>`，其中 `DestroyHandler` 为 `() => Promise<void>`

主动刷新子应用：先调用 [destroyApp](/api/destroyApp.html) 销毁当前实例，再以传入配置调用 [startApp](/api/startApp.html) 全量重建。内部会等待 `destroyApp` 完成后再 `startApp`，避免销毁未结束就重启导致的竞态问题。

销毁和重建属于同一次操作，由框架保证调用顺序。

## 完成、取消与异常

主应用普通调用会等待旧实例的异步卸载和清理结束，再等待新实例的启动流程完成，成功后返回新实例的销毁函数。同名应用已有进行中的卸载时，返回的 Promise 也会等待，不会提前确认刷新完成。

同名的后续 start、refresh 或 destroy 会取消尚未完成的旧刷新请求；被取消的请求返回 `undefined`。仍然有效的刷新请求如果在销毁阶段失败，会拒绝并停止重建；新实例初始化失败也会拒绝。可以使用 `try/catch` 处理这些错误。

框架识别到卸载钩子内刷新自身的重入时，会将该刷新视为取消，返回 `undefined`，不创建替换实例。卸载钩子内的同名 destroy 仍会发起新的操作，因此也会取消触发这次卸载的 refresh。新刷新应由主应用在卸载完成后发起。

通过 props 传入的主应用回调若经过 `await` 后重入，需要在实际 API 调用处使用 [runAsUnmountReentry](/api/runAsUnmountReentry.html)。

::: tip 使用场景

- 子应用处于 [重建模式](/guide/mode.html#重建模式)，需要强制全量重建以清空状态、重新加载资源
- 子应用代码或静态资源已更新，需要销毁旧实例后重新拉取
- 使用 Vue / React 组件封装时，也可通过组件 ref 调用 [refresh()](/pack/#refresh)，**无需传参**，自动复用组件当前 props 全量重建

:::

::: warning 注意

- 刷新会销毁当前子应用实例，承载子应用的 `iframe` 和 `shadowRoot` 都会被销毁，过程中可能出现短暂白屏
- `name`、`replace`、`fetch`、`alive` 等参数须与首次 `startApp` 保持一致，否则渲染可能出现异常
- 若子应用后续还会被打开，一般无需主动刷新；仅在需要强制重建时使用

:::

## 示例

```javascript
import { refreshApp } from '@cloud/jieshu-core';

await refreshApp({
  name: 'vue3',
  url: 'https://xxx.com/',
  el: document.querySelector('#container'),
});
```

使用 Vue / React 组件封装时：

```javascript
// 静态方法 refreshApp，参数与 startApp 相同
import JieshuVue from '@cloud/jieshu-vue3';
await JieshuVue.refreshApp({ name: 'vue3', url: '...', el: '...' });

// 组件实例方法 refresh()，无需传参，自动复用组件当前 props 全量重建
await this.$refs.jieshu.refresh();
```
