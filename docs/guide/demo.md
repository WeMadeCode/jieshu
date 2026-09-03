---
sidebarDepth: 2
---

# 定制化 Jieshu Demo

## 快速开始

:::tip
jieshu 仓库内置多套主、子应用示例，可按需选择框架和路由模式进行调试。
:::

### 获取示例

```bash
git clone https://github.com/WeMadeCode/jieshu.git
cd jieshu
pnpm install
pnpm start
```

### 支持包管理器

本仓库采用 pnpm workspace + Lerna 管理，请使用 pnpm：

- pnpm

### 支持路由定制

可以选择主应用跟子应用的不同路由模式 `hash | history`

### 支持主应用框架

| MainFramework     | finish |
| ----------------- | ------ |
| React17 + Webpack | ✅ 🆕  |
| Vue2 + Webpack    | ✅     |
| Vue3 + Vite3      | ✅     |

### 支持子应用框架

| SubFramework      | finish |
| ----------------- | ------ |
| React16 + Webpack | ✅ 🆕  |
| React17 + Webpack | ✅ 🆕  |
| React18 + Webpack | 🚧     |
| Vue3 + Vite       | ✅     |
| Vue2 + Webpack    | ✅     |
| Vue3 + Webpack    | ✅     |
| Angular12         | ✅     |
