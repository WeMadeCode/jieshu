# React18 子应用

使用 Vite + TypeScript + React 18.3.1 + Ant Design 4，参考 React17 示例补齐五个功能页面，支持独立运行和界枢嵌入运行。

在仓库根目录执行：

```bash
pnpm --filter react18 start     # http://localhost:7900/
pnpm --filter react18 typecheck
pnpm --filter react18 build    # dist/，生产路径 /demo-react18/
pnpm --filter react18 preview  # http://localhost:7900/demo-react18/
pnpm --filter react18 test
```

三个主应用均提供 **React18（保活）** 菜单、五个子菜单及 **all** 页面入口。`pnpm start`、`pnpm start:children` 和 `pnpm build:examples` 包含此子应用。

| 页面          | 功能                                                             |
| ------------- | ---------------------------------------------------------------- |
| home          | React / Ant Design 版本、运行环境、仓库地址                      |
| dialog        | Modal 确认/取消、可搜索 Select、Popover，含弹窗内浮层和滚动区域  |
| location      | 主子路由同步、query/hash、刷新、前进后退、代理地址及外部页面跳转 |
| communication | props 跳转、window.parent.alert、总线发送与接收                  |
| state         | 计数增减/重置、路由和状态保活、向 Vue3 发送 add 事件             |

## 路由与保活

手动验证核心能力时，从 Rspack 主应用的 React18 页面进入：顶部可发送消息、刷新、销毁和重新挂载。子应用“通信”页展示主应用注入值、消息接收次数，并提供回传输入框与按钮；“状态”页用于对比保活与重建后的计数。

- 普通 React18 入口开启 `sync`，将子路由写入主应用 URL 的 `react18` 参数。
- `/react18-sub/:path` 入口通过 `react18-router-change` 控制保活实例；子应用通过 `sub-route-change` 同步主应用菜单。首次启动通过 `react18-router-ready` 通知主应用，兼容预加载和异步 module 入口。
- `alive` 开启后，切换主应用只会停用实例，再次进入保留路由和计数；浏览器刷新会重新创建实例。
- Vite 的 module 脚本无法代理原生 `window.location`，子应用地址读取和外跳使用 `window.$jieshu.location`；独立运行时回退到 `window.location`。
- 测试跨应用计数前，先打开 Vue3 的状态页，再在 React18 状态页点击“Vue3 state +1 并跳转”。从主应用菜单返回 React18 可查看保留的状态。

入口使用 `createRoot`，注册 `__JIESHU_MOUNT` / `__JIESHU_UNMOUNT`，并在异步入口准备完成后主动通知界枢挂载。实例销毁时卸载 React root，组件 effect 会移除总线监听。React Refresh preamble 从入口加载，避免 HTML 内联 module 阻塞沙箱加载队列。

此 workspace 同时包含 React 17/18/19；本包的 TypeScript paths 将依赖声明中的 React 类型统一解析到本包的 React 18 类型，避免被其他主应用的类型覆盖。

## 浏览器验证

测试覆盖独立运行、三个主应用的预加载开关、双向路由同步、浏览器历史、浮层交互、通信、状态保活、刷新重建和多应用共存。首次运行先执行 `pnpm build:packages` 和 `pnpm exec playwright install chromium`。测试默认启动所需示例服务，Rspack 主应用使用测试端口 `7801`；已有服务运行时可使用：

```bash
JIESHU_REUSE_EXISTING_SERVERS=1 pnpm --filter react18 test
```
