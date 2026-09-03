import type { ScriptAttributes, StyleObject } from "./template";

/** 销毁已启动子应用的回调。 */
export type DestroyHandler = () => Promise<void>;

/** 子应用生命周期回调。返回值由框架忽略。 */
export type Lifecycle = (appWindow: Window) => unknown;

/** 资源加载失败回调。返回值由框架忽略。 */
export type LoadErrorHandler = (url: string, error: Error) => unknown;

/** 主应用传入的业务属性；接受没有字符串索引签名的具名接口。 */
export type WujieProps = object;

/** 子应用通过 `$wujie.props` 读取时的安全默认视图。 */
export type InjectedWujieProps = Record<string, unknown>;

/** 应用 iframe 的原生属性集合。 */
export type IframeAttributes = object;

export type EventListenerHook = (
  iframeWindow: Window,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
) => void;

export interface ScriptObjectLoader {
  /** 脚本地址，内联为空 */
  src?: string;
  /** 脚本是否为module模块 */
  module?: boolean;
  /** 脚本是否为async执行 */
  async?: boolean;
  /** 脚本是否设置crossorigin */
  crossorigin?: boolean;
  /** 脚本crossorigin的类型 */
  crossoriginType?: "anonymous" | "use-credentials" | "";
  /** 脚本原始属性 */
  attrs?: ScriptAttributes;
  /** 内联script的代码 */
  content?: string;
  /** 执行回调钩子 */
  callback?: Lifecycle;
  /** 子应用加载完毕事件 */
  onload?: () => void;
  /** 子应用加载失败事件 */
  onerror?: () => void;
}

export interface WujiePlugin {
  /** 处理html的loader */
  htmlLoader?: (code: string) => string;
  /** js排除列表 */
  jsExcludes?: Array<string | RegExp>;
  /** js忽略列表 */
  jsIgnores?: Array<string | RegExp>;
  /** 处理js加载前的loader */
  jsBeforeLoaders?: Array<ScriptObjectLoader>;
  /** 处理js的loader */
  jsLoader?: (code: string, url: string, base: string) => string;
  /** 处理js加载后的loader */
  jsAfterLoaders?: Array<ScriptObjectLoader>;
  /** css排除列表 */
  cssExcludes?: Array<string | RegExp>;
  /** css忽略列表 */
  cssIgnores?: Array<string | RegExp>;
  /** 处理css加载前的loader */
  cssBeforeLoaders?: Array<StyleObject>;
  /** 处理css的loader */
  cssLoader?: (code: string, url: string, base: string) => string;
  /** 处理css加载后的loader */
  cssAfterLoaders?: Array<StyleObject>;
  /** 子应用 window addEventListener 钩子回调 */
  windowAddEventListenerHook?: EventListenerHook;
  /** 子应用 window removeEventListener 钩子回调 */
  windowRemoveEventListenerHook?: EventListenerHook;
  /** 子应用 document addEventListener 钩子回调 */
  documentAddEventListenerHook?: EventListenerHook;
  /** 子应用 document removeEventListener 钩子回调 */
  documentRemoveEventListenerHook?: EventListenerHook;
  /** 子应用向 body、head 插入元素后执行的钩子回调 */
  appendOrInsertElementHook?: <T extends Node>(element: T, iframeWindow: Window) => void;
  /** 子应用劫持元素的钩子回调 */
  patchElementHook?: <T extends Node>(element: T, iframeWindow: Window) => void;
  /** 用户自定义覆盖子应用 window 属性 */
  windowPropertyOverride?: (iframeWindow: Window) => void;
  /** 用户自定义覆盖子应用 document 属性 */
  documentPropertyOverride?: (iframeWindow: Window) => void;
}

export interface Lifecycles {
  beforeLoad?: Lifecycle;
  beforeMount?: Lifecycle;
  afterMount?: Lifecycle;
  beforeUnmount?: Lifecycle;
  afterUnmount?: Lifecycle;
  activated?: Lifecycle;
  deactivated?: Lifecycle;
  loadError?: LoadErrorHandler;
}

export interface BaseOptions {
  /** 唯一性用户必须保证 */
  name: string;
  /** 需要渲染的url */
  url: string;
  /** 需要渲染的html, 如果已有则无需从url请求 */
  html?: string;
  /** 代码替换钩子 */
  replace?: (code: string) => string;
  /** 自定义fetch */
  fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  /** 注入给子应用的属性 */
  props?: WujieProps;
  /** 自定义运行iframe的属性 */
  attrs?: IframeAttributes;
  /** 自定义降级渲染iframe的属性 */
  degradeAttrs?: IframeAttributes;
  /** 子应用采用fiber模式执行 */
  fiber?: boolean;
  /** 子应用保活，state不会丢失 */
  alive?: boolean;
  /** 子应用采用降级iframe方案 */
  degrade?: boolean;
  /** 子应用插件 */
  plugins?: Array<WujiePlugin>;
  /** 子应用window监听事件 */
  iframeAddEventListeners?: Array<string>;
  /** 子应用iframe on事件 */
  iframeOnEvents?: Array<string>;
  /** 子应用生命周期 */
  beforeLoad?: Lifecycle;
  beforeMount?: Lifecycle;
  afterMount?: Lifecycle;
  beforeUnmount?: Lifecycle;
  afterUnmount?: Lifecycle;
  activated?: Lifecycle;
  deactivated?: Lifecycle;
  loadError?: LoadErrorHandler;
}

export type PreOptions = Omit<BaseOptions, "url"> & {
  /** 预执行 */
  exec?: boolean;
  url?: string;
};

export type StartOptions = Omit<BaseOptions, "url"> & {
  /** 子应用地址；可由 setupApp 缓存提供。 */
  url?: string;
  /** 渲染的容器 */
  el?: HTMLElement | string;
  /** 路由同步开关 */
  sync?: boolean;
  /** 子应用短路径替换，路由同步时生效 */
  prefix?: Record<string, string>;
  /** 子应用加载时loading元素 */
  loading?: HTMLElement;
};

/** setupApp 可缓存预加载与启动阶段使用的全部可选配置。 */
export type CacheOptions = PreOptions & StartOptions;

/** @deprecated 请使用 WujiePlugin。 */
export type plugin = WujiePlugin;
/** @deprecated 请使用 LoadErrorHandler。 */
export type loadErrorHandler = LoadErrorHandler;
/** @deprecated 请使用 PreOptions。 */
export type preOptions = PreOptions;
/** @deprecated 请使用 StartOptions。 */
export type startOptions = StartOptions;
/** @deprecated 请使用 CacheOptions。 */
export type cacheOptions = CacheOptions;
/** @deprecated 请使用 Lifecycle。 */
export type lifecycle = Lifecycle;
