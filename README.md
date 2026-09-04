<p align="center">
  <a href="./docs/">
    <img src="https://vfiles.gtimg.cn/wuji_dashboard/xy/test_wuji_damy/phFSuhUC.png" width="100" height="100" alt="logo">
  </a>
</p>

# jieshu（界枢）

界枢微前端是一款基于 Web Components + iframe 微前端框架，具备成本低、速度快、原生隔离、功能强等一系列优点。

## 文档

动机：[动机](https://zhuanlan.zhihu.com/p/551206945)

文档详见：[文档](./docs/)

演示详见：[examples](./examples/)

## 背景

微前端已经是一个非常成熟的领域了，但开发者不管采用哪个现有方案，在适配成本、样式隔离、运行性能、页面白屏、子应用通信、子应用保活、多应用激活、vite 框架支持、应用共享等用户核心诉求都或存在问题、或无法提供支持。

Web Components 是一个浏览器原生支持的组件封装技术，可以有效隔离元素之间的样式，iframe 可以给子应用提供一个原生隔离的运行环境，相比自行构造的沙箱 iframe 提供了独立的 window、document、history、location，可以更好的和外部解耦。界枢微前端采用 webcomponent + iframe 的沙箱模式，在实现原生隔离的前提下比较完善的解决了上述问题。

## 特性

1. 成本低
   - 主应用使用成本低
   - 子应用适配成本低
2. 速度快
   - 子应用首屏打开速度快
   - 子应用运行速度快
3. 原生隔离
   - css 样式通过 Web Components 可以做到严格的原生隔离
   - js 运行在 iframe 中做到严格的原生隔离
4. 功能强大
   - 支持子应用保活
   - 支持子应用嵌套
   - 支持多应用激活
   - 支持应用共享
   - 支持去中心化通信
   - 支持生命周期钩子
   - 支持插件系统
   - 支持 vite 框架

## 快速上手

### 直接使用

- 安装

```bash
npm install @cloud/jieshu-core -S
```

- 使用

```javascript
import { startApp } from '@cloud/jieshu-core';

startApp({ name: '唯一id', url: '子应用路径', el: '容器', sync: true });
```

### vue 框架

- 安装

```bash
npm i @cloud/jieshu-vue3 -S

```

- 引入

```javascript
import JieshuVue from '@cloud/jieshu-vue3';
app.use(JieshuVue);
```

- 使用

```js

<JieshuVue
  width="100%"
  height="100%"
  name="xxx"
  :url="xxx"
  :sync="true"
  :fetch="fetch"
  :props="props"
  :beforeLoad="beforeLoad"
  :beforeMount="beforeMount"
  :afterMount="afterMount"
  :beforeUnmount="beforeUnmount"
  :afterUnmount="afterUnmount"
></JieshuVue>

```

### react 框架

- 安装

```bash
npm i @cloud/jieshu-react -S

```

- 引入

```javascript
import JieshuReact from '@cloud/jieshu-react';
```

- 使用

```html
<JieshuReact
  width="100%"
  height="100%"
  name="xxx"
  url="{xxx}"
  sync="{true}"
  fetch="{fetch}"
  props="{props}"
  beforeLoad="{beforeLoad}"
  beforeMount="{beforeMount}"
  afterMount="{afterMount}"
  beforeUnmount="{beforeUnmount}"
  afterUnmount="{afterUnmount}"
></JieshuReact>
```

## 常见问题

[详见文档](./docs/question/)

## 本地开发

运行以下脚本，可以本地开发界枢微前端框架，支持实时编译调试开发。

```bash
nvm use 24               # 使用 Node.js 24
pnpm i                   # 安装包依赖，务必使用 pnpm
pnpm start               # 启动所有应用
```

也可以使用两个终端分组启动。先启动框架包监听和全部子应用，确认 7100–7600 端口就绪后，再启动主应用，避免主应用预加载尚未启动的子应用：

```bash
pnpm start:children      # 框架包监听 + 子应用
pnpm start:mains         # 主应用（另一个终端执行）
```

## 子包打包

本仓库不向公网 npm registry 发布包。需要构建子包时使用 pnpm：

```bash
pnpm run build:packages
```

每个子包的构建产物直接生成在自身目录：ESM 位于 `esm/`，UMD 位于 `lib/`，类型声明位于 `types/`。

## One more thing

界枢微前端解决方案来源于团队的[**无极低代码平台**](https://wujicode.cn)。无极是专注于高效实现企业 B 端应用、专业的一站式低代码解决方案，是腾讯内部应用最广泛的低代码平台，360 度覆盖全企业应用场景。通过界枢微前端，存量页面和低代码页面可以丝滑的互相内嵌，闭环新老系统的连接。欢迎体验[【腾讯无极低代码】](https://wujicode.cn)，感受智能而高效的研发模式！
