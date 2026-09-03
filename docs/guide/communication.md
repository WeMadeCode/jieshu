# 界枢提供三种方式进行通信

## props 通信

主应用可以通过[props](/api/startApp.html#props)注入数据和方法：

```vue
<JieshuVue name="xxx" url="xxx" :props="{ data: xxx, methods: xxx }"></JieshuVue>
```

子应用可以通过[$jieshu](/api/jieshu.html#jieshu-props)来获取：

```javascript
const props = window.$jieshu?.props; // {data: xxx, methods: xxx}
```

## window 通信

由于子应用运行的`iframe`的`src`和主应用是同域的，所以相互可以直接通信

主应用调用子应用的全局数据

```javascript
window.document.querySelector('iframe[name=子应用id]').contentWindow.xxx;
```

子应用调用主应用的全局数据

```javascript
window.parent.xxx;
```

## eventBus 通信

界枢提供一套去中心化的通信方案，主应用和子应用、子应用和子应用都可以通过这种方式方便的进行通信， 详见 [api](/api/bus.html#bus)

主应用使用方式:

```javascript
// 如果使用jieshu
import { bus } from "jieshu-core";

// 如果使用jieshu-vue3
import JieshuVue from "jieshu-vue3";
const { bus } = JieshuVue;

// 如果使用jieshu-react
import JieshuReact from "jieshu-react";
const { bus } = JieshuReact;

// 主应用监听事件
bus.$on("事件名字", function (arg1, arg2, ...) {});
// 主应用发送事件
bus.$emit("事件名字", arg1, arg2, ...);
// 主应用取消事件监听
bus.$off("事件名字", function (arg1, arg2, ...) {});
```

子应用使用方式:

```javascript
// 子应用监听事件
window.$jieshu?.bus.$on("事件名字", function (arg1, arg2, ...) {});
// 子应用发送事件
window.$jieshu?.bus.$emit("事件名字", arg1, arg2, ...);
// 子应用取消事件监听
window.$jieshu?.bus.$off("事件名字", function (arg1, arg2, ...) {});
```
