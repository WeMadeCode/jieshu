# 创建一个新项目

### 介绍

仓库内置多套主、子应用示例，方便开发者快速上手。

- 支持选择一个或多个子应用来创建一个新的项目，便于针对特定框架进行开发测试。
- 支持主,子应用路由模式(`hash`, `history`)选择。

后续会支持更多功能及框架版本，便于快速上手 `jieshu`。如遇问题，请在[当前仓库 Issues](https://github.com/WeMadeCode/jieshu/issues)反馈。

### 快速开始

开发环境配置:

- [Node.js](https://nodejs.org/en/) 版本 < 18.0.0
- [pnpm](https://pnpm.io/) 脚手架示例模版基于 pnpm + [turborepo](https://turborepo.org/docs/getting-started) 管理项目

如果您的当前环境中需要切换 node.js 版本, 可以使用 [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) 进行安装.

以下是通过 nvm 安装 Node.js 16 LTS 版本的示例:

```bash
# Install the LTS version of Node.js 16
nvm install 16 --lts

# Make the newly installed Node.js 16 as the default version
nvm alias default 16

# Switch to the newly installed Node.js 16
nvm use 16
```

### 安装

克隆当前仓库并安装依赖：

```bash
git clone https://github.com/WeMadeCode/jieshu.git
cd jieshu
pnpm install
pnpm start
```

### 模版列表

- 主应用列表

| 主应用框架        |     |
| ----------------- | --- |
| Webpack + Vue2    | ✅  |
| Webpack + React17 | ✅  |
| Vite + Vue3       | 🚧  |

- 子应用列表

| 子应用框架        |     |
| ----------------- | --- |
| Vite + Vue3       | ✅  |
| Webpack + Vue2    | ✅  |
| Webpack + Vue3    | ✅  |
| Webpack + React16 | ✅  |
| Webpack + React17 | ✅  |
| Angular12         | ✅  |
