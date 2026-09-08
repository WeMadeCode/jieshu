# destroyApp

- 类型： `Function`

- 参数： `string`，子应用`name`

- 返回值： `Promise<void>`

主动销毁子应用，承载子应用的 `iframe`、`shadowRoot` 和界枢实例都会被销毁，实例的运行时状态也会被清空。除非后续不会再使用子应用，否则通常不需要主动销毁。模块级资源缓存的清理见 [clearAssetsCache](/api/clearAssetsCache.html)。

## 完成与异常

主应用普通调用的 Promise 会等待异步卸载钩子和实例清理实际结束。同名销毁已经进行时，再次调用也会等待这次清理，不会因为实例已从注册表移除就提前完成。应用不存在且没有进行中的清理时，Promise 直接完成。

若卸载失败，框架完成其余清理后，原始调用和仍在等待同一次销毁的其他普通调用都会以该错误拒绝，可以通过 `await` 配合 `try/catch` 处理。后续操作不会让这些销毁等待者提前成功。

```typescript
import { destroyApp } from '@cloud/jieshu-core';

const firstDestroy = destroyApp('vue3');
const concurrentDestroy = destroyApp('vue3');

await Promise.all([firstDestroy, concurrentDestroy]);
// 同一次销毁已完成，可以继续复用容器。
```

## 卸载钩子内重入

若 `__JIESHU_UNMOUNT` 等待自身的 `destroyApp(name)` 完成，就会形成循环等待：销毁等待卸载钩子，卸载钩子又等待销毁。框架可自动识别钩子同步调用栈内的重入，以及子应用自身 core 在卸载期间调用同名 API 的路径。

这些重入调用仍发起实际销毁，但返回的 Promise 只确认请求已接收，不等待自身清理。原始外部销毁调用继续等待实际完成并接收错误；重入请求的后续失败会被记录。

重入销毁仍是一次新的同名操作，会取消正在等待的 start/refresh。因此，refresh 的卸载钩子若再次销毁自身，该 refresh 也可能被取消并返回 `undefined`。

通过 props 传入的主应用回调若在 `await` 后调用 API，需要在实际调用处使用 [runAsUnmountReentry](/api/runAsUnmountReentry.html) 明确标记重入；框架无法自动区分这种异步回调与普通的主应用并发调用。
