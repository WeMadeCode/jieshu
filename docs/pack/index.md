---
sidebarDepth: 2
collapsable: false
---

# Vue 组件封装

界枢提供 Vue 3 组件封装，示例源码位于 [examples/main-vue](https://github.com/WeMadeCode/jieshu/tree/master/examples/main-vue)。

## 安装

```bash
npm i @cloud/jieshu-vue3 -S

```

## 引入

```javascript
import JieshuVue from '@cloud/jieshu-vue3';

const { bus, setupApp, preloadApp, destroyApp, refreshApp, clearAssetsCache } = JieshuVue;

app.use(JieshuVue);
```

## 使用

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

子应用通过[$jieshu.bus.$emit](/api/jieshu.html#jieshu-bus)`(event, args)`出来的事件都可以直接`@event`来监听

### bus

[同 API](/api/bus.html)

### setupApp

[同 API](/api/setupApp.html)

### preloadApp

[同 API](/api/preloadApp.html)

### destroyApp

[同 API](/api/destroyApp.html)

### refreshApp

[同 API](/api/refreshApp.html)

### clearAssetsCache

[同 API](/api/clearAssetsCache.html)

### refresh

组件实例方法，**无需传参**。销毁当前子应用实例后，自动复用组件当前 props（`name`、`url`、`alive` 等）全量重建。返回 `startAppQueue` 对应的 `Promise`，可在刷新完成后继续后续逻辑。

```javascript
// 直接调用，不需要传递任何参数
await this.$refs.jieshu.refresh();
```

## 原理

```javascript
import Vue from 'vue';
import { bus, setupApp, preloadApp, startApp, destroyApp } from '@cloud/jieshu-core';
import { createApp, h, defineComponent } from 'vue';
const vue3Flag = !!createApp;

const jieshuVueOptions = {
  name: 'JieshuVue',
  props: {
    width: { type: String, default: '' },
    height: { type: String, default: '' },
    name: { type: String, default: '' },
    loading: { type: HTMLElement, default: undefined },
    url: { type: String, default: '' },
    sync: { type: Boolean, default: false },
    prefix: { type: Object, default: undefined },
    alive: { type: Boolean, default: false },
    props: { type: Object, default: undefined },
    replace: { type: Function, default: undefined },
    fetch: { type: Function, default: undefined },
    fiber: { type: Boolean, default: true },
    plugins: { type: Array, default: null },
    beforeLoad: { type: Function, default: null },
    beforeMount: { type: Function, default: null },
    afterMount: { type: Function, default: null },
    beforeUnmount: { type: Function, default: null },
    afterUnmount: { type: Function, default: null },
    activated: { type: Function, default: null },
    deactivated: { type: Function, default: null },
    loadError: { type: Function, default: null },
    iframeAddEventListeners: { type: Array, default: null },
    iframeOnEvents: { type: Array, default: null },
  },
  data() {
    return {
      destroy: null,
      startAppQueue: Promise.resolve(),
    };
  },
  mounted() {
    bus.$onAll(this.handleEmit);
    this.execStartApp();
    this.$watch(
      () => this.name + this.url,
      () => this.execStartApp(),
    );
  },
  methods: {
    handleEmit(event, ...args) {
      this.$emit(event, ...args);
    },
    execStartApp() {
      this.startAppQueue = this.startAppQueue.then(async () => {
        try {
          this.destroy = await startApp({
            name: this.name,
            url: this.url,
            el: this.$refs.jieshu,
            loading: this.loading,
            alive: this.alive,
            fetch: this.fetch,
            props: this.props,
            replace: this.replace,
            sync: this.sync,
            prefix: this.prefix,
            fiber: this.fiber,
            plugins: this.plugins,
            beforeLoad: this.beforeLoad,
            beforeMount: this.beforeMount,
            afterMount: this.afterMount,
            beforeUnmount: this.beforeUnmount,
            afterUnmount: this.afterUnmount,
            activated: this.activated,
            deactivated: this.deactivated,
            loadError: this.loadError,
            iframeAddEventListeners: this.iframeAddEventListeners,
            iframeOnEvents: this.iframeOnEvents,
          });
        } catch (error) {
          console.log(error);
        }
      });
    },
  },
  beforeDestroy() {
    bus.$offAll(this.handleEmit);
  },
  render(c) {
    const createElement = vue3Flag ? h : c;
    return createElement('div', {
      style: {
        width: this.height,
        height: this.height,
      },
      ref: 'jieshu',
    });
  },
};

const JieshuVue = vue3Flag ? defineComponent(jieshuVueOptions) : Vue.extend(jieshuVueOptions);

JieshuVue.setupApp = setupApp;
JieshuVue.preloadApp = preloadApp;
JieshuVue.bus = bus;
JieshuVue.destroyApp = destroyApp;
JieshuVue.install = function (Vue) {
  Vue.component('JieshuVue', JieshuVue);
};

export default JieshuVue;
```
