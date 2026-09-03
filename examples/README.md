# 界枢示例

## 本地开发

在仓库根目录启动所有框架包和示例：

```bash
pnpm start
```

文档用于示例首页的“文档”链接。请在另一个终端以约定端口启动：

```bash
pnpm dev:examples:docs
```

开发环境中的跨应用链接通过各主应用的 `hostMap` 指向真实服务：

| 内容                         | 本地地址                     |
| ---------------------------- | ---------------------------- |
| React 主应用                 | `http://localhost:7700/`     |
| React 19 + TypeScript 主应用 | `http://localhost:7800/`     |
| Vue 主应用                   | `http://localhost:8000/`     |
| 文档                         | `http://localhost:5173/doc/` |

## 同源生产预览

执行完整构建并把所有产物组装到已忽略的 `site/`：

```bash
pnpm build:examples
```

然后启动同源预览：

```bash
pnpm preview:examples
```

预览地址为 `http://localhost:4173/demo-main-react/`。生产 `hostMap` 使用同源根路径，因此子应用、另一主应用和文档分别从 `/demo-*` 与 `/doc/` 加载。

聚合映射如下：

| 构建产物                       | 聚合路径                   |
| ------------------------------ | -------------------------- |
| `examples/main-react/build/`   | `site/demo-main-react/`    |
| `examples/main-react-ts/dist/` | `site/demo-main-react-ts/` |
| `examples/main-vue/dist/`      | `site/demo-main-vue/`      |
| `examples/react16/build/`      | `site/demo-react16/`       |
| `examples/react17/build/`      | `site/demo-react17/`       |
| `examples/vue2/dist/`          | `site/demo-vue2/`          |
| `examples/vue3/dist/`          | `site/demo-vue3/`          |
| `examples/vite/dist/`          | `site/demo-vite/`          |
| `examples/angular12/dist/`     | `site/demo-angular12/`     |
| `docs/.vitepress/dist/`        | `site/doc/`                |

`assemble:examples` 会先检查每个输出目录的 `index.html`，缺少任何构建产物时立即失败。每次组装都会重建 `site/`，不要直接编辑其中的文件。
