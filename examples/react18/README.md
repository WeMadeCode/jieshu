# React18 子应用

使用 Vite + TypeScript + React 18.3.1，支持独立运行和界枢嵌入运行。

在仓库根目录执行：

```bash
pnpm --filter react18 start     # http://localhost:7900/
pnpm --filter react18 typecheck
pnpm --filter react18 build    # dist/，生产路径 /demo-react18/
pnpm --filter react18 preview  # http://localhost:7900/demo-react18/
pnpm --filter react18 test
```

三个主应用均提供 **React18** 菜单和 **all** 页面入口。`pnpm start`、`pnpm start:children` 和 `pnpm build:examples` 包含此子应用。

示例展示组件计数器、事件总线消息和调用主应用的 `props.jump`。独立运行时通信按钮禁用。

入口使用 `createRoot`，并注册 `__JIESHU_MOUNT` / `__JIESHU_UNMOUNT`；Vite 的 module 脚本异步执行后主动调用 `window.__JIESHU.mount()`。卸载时销毁 React root，再次进入会重新创建组件状态。开发入口加载 React Refresh preamble，支持 Vite 热更新。

浏览器测试覆盖独立运行、三个主应用的预加载开关、挂载、通信、卸载后重新进入及多应用共存。首次运行需要先执行 `pnpm build:packages` 和 `pnpm exec playwright install chromium`。测试默认启动所需示例服务，Rspack 主应用使用测试端口 `7801`；已有服务运行时可使用：

```bash
JIESHU_REUSE_EXISTING_SERVERS=1 pnpm --filter react18 test
```
