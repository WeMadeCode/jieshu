# runAsUnmountReentry

- **类型：** `<Value>(name: string, invoke: () => Value) => Value`
- **参数：** `name` 为正在卸载的子应用名称，`invoke` 为实际调用生命周期 API 的同步回调。
- **返回值：** `invoke` 的原始返回值；同步抛出的错误也原样传递。

明确将一次同步调用标记为同名应用的卸载重入。请直接从 `@cloud/jieshu-core` 导入此辅助 API。

只有目标应用确实存在进行中的卸载或销毁时，辅助函数才添加标记；其他情况下直接执行 `invoke`，保持普通 API 的完成语义。

## 何时使用

普通主应用调用 [destroyApp](/api/destroyApp.html)、[startApp](/api/startApp.html) 和 [refreshApp](/api/refreshApp.html) 时，应等待实际操作完成。卸载钩子调用自身生命周期 API 时，如果继续等待同一次卸载完成，就会形成死锁。

框架会自动识别 `__JIESHU_UNMOUNT` 同步调用栈内的重入，以及子应用自身 core 在卸载期间调用同名 API 的路径。子应用调用通过 props 传入的主应用闭包时，一旦执行经过 `await`，主应用的 API 就无法可靠区分这个闭包与普通外部调用。此时需要在实际 API 调用处使用本函数。

例如，主应用提供一个供卸载钩子调用的回调，回调需要先完成异步清理，再请求完整销毁：

```typescript
import { destroyApp, runAsUnmountReentry, startApp } from '@cloud/jieshu-core';

const name = 'vue3';
const createUnmountRequest = (releaseResources: () => Promise<void>) => {
  return async () => {
    await releaseResources();
    await runAsUnmountReentry(name, () => destroyApp(name));
  };
};

const mountApp = (releaseResources: () => Promise<void>) => {
  return startApp({
    name,
    url: 'https://xxx.com/',
    el: '#container',
    props: { requestDestroyFromUnmount: createUnmountRequest(releaseResources) },
  });
};
```

子应用的 `__JIESHU_UNMOUNT` 可以等待 `requestDestroyFromUnmount()`。这里等待的是重入销毁请求的确认，原始外部 destroy 仍等待整个卸载钩子和实例清理结束。

## 重入时的完成语义

存在进行中的同名卸载时，直接在 `invoke` 中调用 API 的行为如下：

| API                   | 重入行为                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `destroyApp(name)`    | 发起实际销毁，返回的 Promise 确认请求已接收，不等待自身清理；原始外部等待者继续接收真实结果。 |
| `startApp(options)`   | 视为取消，Promise 以 `undefined` 完成，不创建替换实例。                                       |
| `refreshApp(options)` | 视为取消，Promise 以 `undefined` 完成，不创建替换实例。                                       |

重入 destroy 仍参与“最新同名操作取消旧操作”的规则。例如 refresh 正在销毁旧实例，卸载钩子又发起同名 destroy，该 refresh 会被取消。应从主应用的卸载后流程发起下一次启动或刷新。

## 同步作用范围

标记仅覆盖 `invoke` 返回前的同步调用栈，返回 Promise 不会延长标记。必须先完成异步准备，再包裹真正的 API 调用。

不要用本函数包住整个 async 回调：若回调先 `await` 再调用 API，恢复执行时标记已经清除，仍可能形成循环等待。它也不能为 `createAppController().start/refresh` 等内部可能先等待其他操作的调用自动传递上下文；重入位置应直接调用 core 的上述三个 API。

本函数只用于卸载钩子发起的同名重入。普通外部并发调用无需添加标记，应使用 API 自身返回的 Promise 等待实际完成。
