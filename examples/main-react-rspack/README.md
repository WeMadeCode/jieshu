# main-react-ts

界枢的 React 主应用示例，技术栈为 Rspack、TypeScript 和 React 19。

## 使用

在仓库根目录安装依赖后运行：

```bash
pnpm --filter main-react-ts start
```

开发服务器默认运行在 <http://localhost:7800>。构建与类型检查命令：

```bash
pnpm --filter main-react-ts typecheck
pnpm --filter main-react-ts build
```

单独启动主应用时，还需按需启动 `react16`、`react17`、`vue2`、`vue3`、`vite` 和 `react18` 子应用；也可以在仓库根目录运行 `pnpm start` 一并启动所有示例。

## React18 核心能力手动验证

进入 `http://localhost:7800/#/react18`，页面顶部提供消息输入、发送、刷新、销毁和重新挂载按钮。

- **通信**：打开子应用“通信”页，从顶部发送消息，检查接收内容与次数；在子应用输入回传消息，检查顶部的回传结果。修改主应用消息后刷新，再进入通信页检查 props 注入值。
- **状态**：在子应用“状态”页加一，切换主应用再返回应保留计数；点击“刷新子应用”后重新进入状态页，计数应恢复为 10。
- **销毁与重建**：点击“销毁子应用”，画面应移除；点击“重新挂载”，应用应恢复且状态重置。

刷新、销毁按钮分别调用 React 组件的 `ref.refresh()`、`ref.destroy()`。通信页接收次数可用来检查离开页面再返回后是否重复订阅。

本示例没有 ESLint 或 Prettier 配置。
