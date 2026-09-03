# 全局变量

界枢会在子应用的`window`对象中注入一些全局变量:

```typescript
declare global {
  interface Window {
    // 是否存在界枢
    __POWERED_BY_JIESHU__?: boolean;
    // 子应用公共加载路径
    __JIESHU_PUBLIC_PATH__: string;
    // 原生的querySelector
    __JIESHU_RAW_DOCUMENT_QUERY_SELECTOR__: typeof Document.prototype.querySelector;
    // 原生的querySelectorAll
    __JIESHU_RAW_DOCUMENT_QUERY_SELECTOR_ALL__: typeof Document.prototype.querySelectorAll;
    // 原生的window对象
    __JIESHU_RAW_WINDOW__: Window;
    // 子应用沙盒实例
    __JIESHU: Jieshu;
    // 子应用mount函数
    __JIESHU_MOUNT: () => void;
    // 子应用unmount函数
    __JIESHU_UNMOUNT: () => void | Promise<void>;
    // 注入对象
    $jieshu: {
      bus: EventBus;
      shadowRoot?: ShadowRoot;
      props?: { [key: string]: any };
      location?: Object;
    };
  }
}
```

## `__POWERED_BY_JIESHU__`

- **类型：** `Boolean`

- **描述：** 子应用是否在界枢的环境中

## `__JIESHU_PUBLIC_PATH__`

- **类型：** `string`

- **描述：** 子应用公共加载路径

## `__JIESHU_RAW_DOCUMENT_QUERY_SELECTOR__`

- **类型：** `typeof Document.prototype.querySelector`

- **描述：** 子应用的 document.querySelector 都被劫持到 webcomponent 上，如果需要没有劫持的 querySelector， 可以使用此变量

## `__JIESHU_RAW_DOCUMENT_QUERY_SELECTOR_ALL__`

- **类型：** `typeof Document.prototype.querySelectorAll`

- **描述：** 子应用的 document.querySelectorAll 都被劫持到 webcomponent 上，如果需要没有劫持的 querySelectorAll 可以使用此变量

## `__JIESHU_RAW_WINDOW__`

- **类型：** `Window`

- **描述：** 子应用的原生 window 对象

## `__JIESHU`

- **类型：** `Jieshu`

- **描述：** 子应用界枢实例，用户不应该使用

## `__JIESHU_MOUNT`

- **类型：** `Function`

- **描述：** 用户自定义的 mount 生命周期

## `__JIESHU_UNMOUNT`

- **类型：** `Function`

- **描述：** 用户自定义的 unmount 生命周期

## $jieshu

[详见](/api/jieshu.html#jieshu)
