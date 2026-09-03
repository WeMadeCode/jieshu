# main-react-ts

基于 `examples/main-react` 改写的界枢主应用示例，技术栈为 Rspack、TypeScript 和 React 19。

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

单独启动主应用时，还需按需启动 `react16`、`react17`、`vue2`、`vue3`、`vite` 和 `angular12` 子应用；也可以在仓库根目录运行 `pnpm start` 一并启动所有示例。

本示例没有 ESLint 或 Prettier 配置。
