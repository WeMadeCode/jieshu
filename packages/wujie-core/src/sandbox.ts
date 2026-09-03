import {
  iframeGenerator,
  recoverEventListeners,
  recoverDocumentListeners,
  insertScriptToIframe,
  patchEventTimeStamp,
  patchDegradeInstanceofAcrossRealms,
} from './iframe';
import { syncUrlToWindow, syncUrlToIframe, clearInactiveAppUrl } from './sync';
import {
  createWujieWebComponent,
  clearChild,
  getPatchStyleElements,
  renderElementToContainer,
  renderTemplateToShadowRoot,
  renderTemplateToIframe,
  initRenderIframeAndContainer,
  removeLoading,
} from './shadow';
import { proxyGenerator, localGenerator } from './proxy';
import type { ScriptResultList } from './entry';
import { releaseAssetCacheScope } from './entry';
import { getPlugins, getPresetLoaders } from './plugin';
import { removeEventListener } from './effect';
import {
  idToSandboxCacheMap,
  getWujieById,
  addSandboxCacheWithWujie,
  deleteWujieById,
  registerSandboxTeardown,
  rawElementAppendChild,
  rawDocumentQuerySelector,
  invokeSandboxUnmountHook,
} from './common';
import type { SandboxCache } from './common';
import { EventBus, appEventObjMap } from './event';
import type { EventObj } from './event';
import { EventCleanupTracker } from './tracker';
import { isFunction, wujieSupport, appRouteParse, requestIdleCallback, getAbsolutePath, eventTrigger } from './utils';
import { WUJIE_DATA_ATTACH_CSS_FLAG, WUJIE_APP_ID, WUJIE_FONT_STYLE_CONTAINER_ATTR } from './constant';
import type {
  IframeAttributes,
  InjectedWujieProps,
  Lifecycles,
  ScriptObjectLoader,
  WujiePlugin,
  WujieProps,
} from './contracts';
import {
  cancelSandboxDynamicResources,
  groupScripts,
  SandboxCleanupRegistry,
  SandboxLifecycleController,
  SandboxScriptScheduler,
} from './sandbox-runtime';
import type { OperationSlots } from './operation-intent';
import { shouldHandlePageHideTeardown } from './sandbox-policy';

/**
 * A sandbox iframe is attached before its runtime is initialized. Keeping the
 * DOM invariant in one place avoids scattering non-null assertions throughout
 * the lifecycle code while preserving the native iframe access semantics.
 */
function getIframeWindow(iframe: HTMLIFrameElement): Window {
  return iframe.contentWindow as Window;
}

function getIframeDocument(iframe: HTMLIFrameElement): Document {
  return iframe.contentDocument as Document;
}

export type { Lifecycle, lifecycle } from './contracts';
/**
 * 基于 Proxy和iframe 实现的沙箱
 */
export default class Wujie {
  public id: string;
  /** 激活时路由地址 */
  public url: string;
  /** 子应用保活 */
  public alive?: boolean;
  /** window代理 */
  public proxy!: WindowProxy;
  /** document代理 */
  public proxyDocument: object;
  /** location代理 */
  public proxyLocation: Location;
  /**
   * 释放 window / document / location 代理。
   * 代理的 handler 闭包捕获了 iframe / urlElement 等 DOM 引用，destroy 时调用此函数
   * 解除代理与 handler 的关联，斩断「主应用 → 代理闭包 → iframe」的引用链。
   */
  public proxyRevoke: () => void;
  /** 事件中心 */
  public bus: EventBus;
  /** 容器 */
  public el!: HTMLElement;
  /** js沙箱 */
  public iframe: HTMLIFrameElement;
  /** css沙箱 */
  public shadowRoot!: ShadowRoot;
  /** 子应用的template */
  public template!: string;
  /** 子应用代码替换钩子 */
  public replace!: (code: string) => string;
  /** 子应用自定义fetch */
  public fetch!: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  /** 子应用的生命周期 */
  public lifecycles: Lifecycles;
  /** 子应用的插件 */
  public plugins: Array<WujiePlugin>;
  /** js沙箱ready态 */
  public iframeReady!: Promise<void>;
  /** 取消仍在等待 load/轮询的 iframe 初始化。 */
  public cancelIframeReady?: () => void;
  /** 子应用预加载态 */
  public preload!: Promise<void>;
  /** Isolates pending asset requests from older same-name sandbox generations. */
  public assetCacheScope: object = {};
  /** 当前实例是否完成了模板与脚本初始化，false 也表示一次 start 正在占用它。 */
  public initialized = false;
  /** 降级时渲染iframe的属性 */
  public degradeAttrs: IframeAttributes;
  /** 子应用js执行队列 */
  public execQueue: Array<() => unknown>;
  /** 子应用执行过标志 */
  public execFlag!: boolean;
  /** 子应用激活标志 */
  public activeFlag!: boolean;
  /** 子应用mount标志 */
  public mountFlag!: boolean;
  /** 子应用销毁标志，防止 destroy 被并发重复执行 */
  public destroyed = false;
  /** 生命周期状态和并发 destroy 的完成态仅供 sandbox 内部编排。 */
  private lifecycleController = new SandboxLifecycleController();
  private destroyPromise?: Promise<void>;
  private unmountPromise?: Promise<void>;
  /** A completed inactive transition is idempotent until the next activation. */
  private unmountCompleted = false;
  private scriptScheduler?: SandboxScriptScheduler;
  private activationRevision = 0;
  private clearContainerOnDestroy = true;
  /** Suppresses disconnect callbacks caused only by moving framework-owned DOM. */
  public relocating = false;
  /** 路由同步标志 */
  public sync?: boolean;
  /** 子应用短路径替换，路由同步时生效 */
  public prefix!: { [key: string]: string };
  /** 子应用跳转标志 */
  public hrefFlag!: boolean;
  /** 子应用采用fiber模式执行 */
  public fiber: boolean;
  /** 子应用降级标志 */
  public degrade: boolean;
  /** 子应用降级document */
  public document!: Document;
  /** 子应用styleSheet元素 */
  public styleSheetElements: Array<HTMLLinkElement | HTMLStyleElement>;

  /** 子应用 font-face 样式元素，挂载在最外层 document.head */
  public fontStyleSheetElements: Array<HTMLStyleElement> = [];
  /**
   * 子应用通过 document.head.appendChild(<script>) 触发的动态脚本节点。
   * 由 insertScriptToIframe 在收到 rawElement（即 effect.ts 转发的动态 script）
   * 时登记，sandbox.destroy() 时统一从 iframe head detach 并清空。
   */
  public dynamicScriptElements: Array<HTMLScriptElement> = [];
  /**
   * 动态 <link rel=stylesheet> 以空 href 插入（先 appendChild 后 setAttribute('href')，
   * 如 tinymce 的 StyleSheetLoader）时，effect.ts 会注册一个 MutationObserver 监听
   * href 的后续赋值。这些 observer 必须在 destroy 时统一 disconnect，否则游离 link
   * 会通过 node → registered observer → callback 闭包链路把已销毁的 sandbox 钉在内存中。
   */
  public deferredStyleObservers: Array<Pick<MutationObserver, 'disconnect'>> = [];
  /** 子应用head元素 */
  public head!: HTMLHeadElement;
  /** 子应用body元素 */
  public body!: HTMLBodyElement;
  /** 子应用dom监听事件留存，当降级时用于保存元素事件 */
  public elementEventCacheMap: WeakMap<
    Node,
    Array<{
      type: string;
      handler: EventListenerOrEventListenerObject;
      options?: boolean | AddEventListenerOptions;
    }>
  > = new WeakMap();
  /** 子应用window监听事件 */
  public iframeAddEventListeners?: Array<string>;
  /** 子应用iframe on事件 */
  public iframeOnEvents?: Array<string>;
  /** 销毁链路清理跟踪器：记录被转发到主应用 window/document 上的副作用，destroy 时统一回收 */
  public eventCleanupTracker: EventCleanupTracker = new EventCleanupTracker();

  /** $wujie对象，提供给子应用的接口 */
  public provide: {
    bus: EventBus;
    shadowRoot?: ShadowRoot;
    props?: InjectedWujieProps;
    location?: Location;
  };

  /** 子应用嵌套场景，父应用传递给子应用的数据 */
  public inject: {
    idToSandboxMap: Map<string, SandboxCache>;
    teardownById: Map<string, Promise<void>>;
    appEventObjMap: Map<string, EventObj>;
    mainHostPath: string;
    fontStyleSheetContainer?: HTMLElement;
    coreOperationSlots?: OperationSlots;
  };

  /** 激活子应用
   * 1、同步路由
   * 2、动态修改iframe的fetch
   * 3、准备shadow
   * 4、准备子应用注入
   */
  public async active(options: {
    url: string;
    sync?: boolean;
    prefix?: { [key: string]: string };
    template?: string;
    el?: string | HTMLElement;
    props?: WujieProps;
    alive?: boolean;
    fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
    replace?: (code: string) => string;
  }): Promise<void> {
    const activationRevision = ++this.activationRevision;
    const pendingUnmount = this.unmountPromise;
    if (pendingUnmount) await pendingUnmount;
    if (!this.isActivationCurrent(activationRevision)) return;
    if (!this.getLifecycleController().activate()) return;
    const { sync, url, el, template, props, alive, prefix, fetch, replace } = options;
    this.url = url;
    this.sync = sync;
    this.alive = alive;
    this.hrefFlag = false;
    this.prefix = prefix ?? this.prefix;
    this.replace = replace ?? this.replace;
    this.provide.props = (props as InjectedWujieProps | undefined) ?? this.provide.props;
    this.activeFlag = true;
    this.unmountCompleted = false;
    // wait iframe init
    await this.iframeReady;
    // destroy may win the race while iframe initialization is pending.
    if (!this.isActivationCurrent(activationRevision)) return;

    // 处理子应用自定义fetch
    // TODO fetch检验合法性
    const iframeWindow = getIframeWindow(this.iframe);
    const iframeFetch = fetch
      ? (input: RequestInfo, init?: RequestInit) =>
          fetch(typeof input === 'string' ? getAbsolutePath(input, (this.proxyLocation as Location).href) : input, init)
      : this.fetch;
    if (iframeFetch) {
      iframeWindow.fetch = iframeFetch;
      this.fetch = iframeFetch;
    }

    // 处理子应用路由同步
    if (this.execFlag && this.alive) {
      // 当保活模式下子应用重新激活时，只需要将子应用路径同步回主应用
      syncUrlToWindow(iframeWindow);
    } else {
      // 先将url同步回iframe，然后再同步回浏览器url
      syncUrlToIframe(iframeWindow);
      syncUrlToWindow(iframeWindow);
    }

    // inject template
    this.template = template ?? this.template;

    /* 降级处理 */
    if (this.degrade) {
      const iframeBody = rawDocumentQuerySelector.call(iframeWindow.document, 'body') as HTMLElement;
      this.relocating = true;
      let renderTarget: ReturnType<typeof initRenderIframeAndContainer>;
      try {
        renderTarget = initRenderIframeAndContainer(this.id, el ?? iframeBody, this.degradeAttrs);
      } finally {
        this.relocating = false;
      }
      const { iframe, container } = renderTarget;
      const renderIframeWindow = getIframeWindow(iframe);
      const renderIframeDocument = getIframeDocument(iframe);
      this.el = container;
      // 销毁js运行iframe容器内部dom
      if (el) clearChild(iframeBody);
      // 修复vue的event.timeStamp问题
      patchEventTimeStamp(renderIframeWindow, iframeWindow);
      // pagehide 与子 frame 销毁时机一致，且不会依赖已弃用的 unload。
      renderIframeWindow.onpagehide = (event) => {
        if (shouldHandlePageHideTeardown(event) && !this.destroyed && !this.relocating) void this.unmount();
      };
      if (this.document) {
        if (this.alive) {
          renderIframeDocument.replaceChild(this.document.documentElement, renderIframeDocument.documentElement);
          // 保活场景需要事件全部恢复
          recoverEventListeners(renderIframeDocument.documentElement, iframeWindow);
        } else {
          await renderTemplateToIframe(renderIframeDocument, iframeWindow, this.template, () =>
            this.isActivationCurrent(activationRevision),
          );
          if (!this.isActivationCurrent(activationRevision)) {
            iframe.parentNode?.removeChild(iframe);
            return;
          }
          // 非保活场景需要恢复根节点的事件，防止react16监听事件丢失
          recoverDocumentListeners(this.document.documentElement, renderIframeDocument.documentElement, iframeWindow);
        }
      } else {
        await renderTemplateToIframe(renderIframeDocument, iframeWindow, this.template, () =>
          this.isActivationCurrent(activationRevision),
        );
        if (!this.isActivationCurrent(activationRevision)) {
          iframe.parentNode?.removeChild(iframe);
          return;
        }
      }
      this.document = renderIframeDocument;
      const renderWindow = this.document.defaultView;
      if (renderWindow) {
        patchDegradeInstanceofAcrossRealms(iframeWindow, renderWindow);
      }
      return;
    }

    if (this.shadowRoot) {
      /*
       document.addEventListener was transfer to shadowRoot.addEventListener
       react 16 SyntheticEvent will remember document event for avoid repeat listen
       shadowRoot have to dispatchEvent for react 16 so can't be destroyed
       this may lead memory leak risk
       */
      this.relocating = true;
      try {
        this.el = renderElementToContainer(this.shadowRoot.host, el as string | HTMLElement);
      } finally {
        this.relocating = false;
      }
      if (this.alive) return;
    } else {
      // 预执行无容器，暂时插入iframe内部触发Web Component的connect
      const iframeBody = rawDocumentQuerySelector.call(iframeWindow.document, 'body') as HTMLElement;
      this.el = renderElementToContainer(createWujieWebComponent(this.id), el ?? iframeBody);
    }

    await renderTemplateToShadowRoot(this.shadowRoot, iframeWindow, this.template, () =>
      this.isActivationCurrent(activationRevision),
    );
    if (!this.isActivationCurrent(activationRevision) || !this.shadowRoot || !this.provide) return;
    this.patchCssRules();

    // inject shadowRoot to app
    this.provide.shadowRoot = this.shadowRoot;
  }

  // 未销毁，空闲时才回调
  public requestIdleCallback(callback: (this: Wujie) => unknown, onCancel?: () => void): number {
    return requestIdleCallback(() => {
      // 假如已经被销毁了
      if (!this.iframe || this.destroyed) {
        onCancel?.();
        return;
      }
      callback.apply(this);
    });
  }
  /** 启动子应用
   * 1、运行js
   * 2、处理兼容样式
   */
  public async start(getExternalScripts: () => ScriptResultList): Promise<void> {
    const activationRevision = this.activationRevision;
    this.execFlag = true;
    // 执行脚本
    const scriptResultList = await getExternalScripts();
    // 假如已经被销毁了
    if (!this.iframe || !this.activeFlag || !this.isActivationCurrent(activationRevision)) return;
    const iframeWindow = getIframeWindow(this.iframe);
    // 标志位，执行代码前设置
    iframeWindow.__POWERED_BY_WUJIE__ = true;
    const scheduler = new SandboxScriptScheduler(
      this.execQueue,
      this.fiber,
      (task) => requestIdleCallback(task),
      () => Boolean(this.iframe) && !this.destroyed && this.activeFlag && this.isActivationCurrent(activationRevision),
    );
    const beforeScripts: ScriptObjectLoader[] = getPresetLoaders('jsBeforeLoaders', this.plugins);
    const afterScripts: ScriptObjectLoader[] = getPresetLoaders('jsAfterLoaders', this.plugins);
    const scripts = groupScripts(scriptResultList);

    const createCompletion = (): { promise: Promise<void>; resolve(): void } => {
      let resolve!: () => void;
      const completion = new Promise<void>((onResolve) => {
        resolve = onResolve;
      });
      return { promise: Promise.race([completion, scheduler.stopped]), resolve };
    };
    const schedulePreset = (script: ScriptObjectLoader): Promise<void> => {
      const completion = createCompletion();
      scheduler.schedule(() => {
        // Preset lanes are intentionally parser-ordered even when a caller
        // supplied `async`. Serial execution also guarantees that every
        // preset advances execQueue after native completion.
        const handle = insertScriptToIframe({ ...script, async: false }, iframeWindow);
        void handle.completion.then(completion.resolve);
      });
      return completion.promise;
    };
    const scheduleSerialScript = (script: ScriptResultList[number]): Promise<void> => {
      const completion = createCompletion();
      const content = script.contentPromise.then(
        (value) => value,
        (cause: unknown): never => {
          completion.resolve();
          throw cause;
        },
      );
      scheduler.scheduleAfter(content, (resolvedContent) => {
        const handle = insertScriptToIframe({ ...script, content: resolvedContent }, iframeWindow);
        void handle.completion.then(completion.resolve);
      });
      return completion.promise;
    };

    let parserBarrier: Promise<void> = Promise.resolve();
    beforeScripts.forEach((script) => {
      parserBarrier = schedulePreset(script);
    });

    const syncCompletions = new Map<ScriptResultList[number], Promise<void>>();
    scripts.sync.forEach((script) => syncCompletions.set(script, scheduleSerialScript(script)));

    // Async fetches may finish independently, but a script cannot execute
    // before a preceding parser-blocking classic script has executed. Keep a
    // discovery barrier for each async script while leaving earlier async
    // scripts detached from later blocking work.
    scriptResultList.forEach((script) => {
      if (script.async) {
        const ready = Promise.all([parserBarrier, script.contentPromise]).then(([, content]) => content);
        scheduler.executeAfter(ready, (content) => insertScriptToIframe({ ...script, content }, iframeWindow));
      } else if (!script.defer) {
        parserBarrier = syncCompletions.get(script) ?? parserBarrier;
      }
    });

    // Defer (including non-async modules) executes in document order after
    // parser-blocking scripts and before DOMContentLoaded.
    scripts.defer.forEach((script) => {
      scheduleSerialScript(script);
    });

    // 框架主动调用mount方法
    scheduler.schedule(() => this.mount());
    this.scheduleLifecycleEvent(scheduler, iframeWindow, 'DOMContentLoaded');
    afterScripts.forEach((script) => schedulePreset(script));
    this.scheduleLifecycleEvent(scheduler, iframeWindow, 'load');
    // 由于没有办法准确定位是哪个代码做了mount，保活、重建模式提前关闭loading
    if (this.alive || !isFunction(iframeWindow.__WUJIE_UNMOUNT)) removeLoading(this.el);
    // 所有的execQueue队列执行完毕，start才算结束，保证串行的执行子应用
    this.scriptScheduler = scheduler;
    try {
      await scheduler.run();
    } finally {
      if (this.scriptScheduler === scheduler) this.scriptScheduler = undefined;
    }
  }

  private scheduleLifecycleEvent(
    scheduler: SandboxScriptScheduler,
    iframeWindow: Window,
    eventName: 'DOMContentLoaded' | 'load',
  ): void {
    scheduler.schedule(() => {
      if (eventName === 'DOMContentLoaded') {
        eventTrigger(iframeWindow.document, eventName);
        eventTrigger(iframeWindow, eventName);
      } else {
        eventTrigger(iframeWindow.document, 'readystatechange');
        eventTrigger(iframeWindow, eventName);
      }
      scheduler.advance();
    });
  }

  /**
   * 框架主动发起mount，如果子应用是异步渲染实例，比如将生命周__WUJIE_MOUNT放到async函数内
   * 此时如果采用fiber模式渲染（主应用调用mount的时机也是异步不确定的），框架调用mount时可能
   * 子应用的__WUJIE_MOUNT还没有挂载到window，所以这里封装一个mount函数，当子应用是异步渲染
   * 实例时，子应用异步函数里面最后加上window.__WUJIE.mount()来主动调用
   */
  public mount(advanceQueue = true): void {
    if (this.destroyed || !this.iframe) return;
    if (this.mountFlag) return;
    const iframeWindow = getIframeWindow(this.iframe);
    const activationRevision = this.activationRevision;
    const canMount = (): boolean => this.activeFlag && this.isActivationCurrent(activationRevision);
    const finishScheduledMount = (): void => {
      if (advanceQueue) this.execQueue?.shift()?.();
    };

    // A delayed child-side `window.__WUJIE.mount()` may arrive after the host
    // has already deactivated this sandbox. It must not revive that instance.
    if (!canMount()) {
      finishScheduledMount();
      return;
    }
    if (isFunction(iframeWindow.__WUJIE_MOUNT)) {
      removeLoading(this.el);
      this.lifecycles?.beforeMount?.(iframeWindow);
      if (!canMount()) {
        finishScheduledMount();
        return;
      }
      // Publish mounted state before user code runs so a reentrant destroy can
      // execute the child unmount path instead of releasing the iframe first.
      this.mountFlag = true;
      this.getLifecycleController().mount();
      iframeWindow.__WUJIE_MOUNT();
      if (!canMount()) {
        finishScheduledMount();
        return;
      }
      this.lifecycles?.afterMount?.(iframeWindow);
      if (!canMount()) {
        finishScheduledMount();
        return;
      }
    }
    if (this.alive) {
      this.lifecycles?.activated?.(iframeWindow);
      if (!canMount()) {
        finishScheduledMount();
        return;
      }
    }
    finishScheduledMount();
  }

  /** 保活模式和使用proxyLocation.href跳转链接都不应该销毁shadow */
  public unmount(): Promise<void> {
    if (this.unmountPromise) return this.unmountPromise;
    // Removing an already-released <wujie-app> can synchronously invoke its
    // disconnectedCallback after a controller has awaited unmount(). Do not
    // emit a second deactivated hook for that same inactive generation.
    if (this.unmountCompleted && !this.activeFlag) return Promise.resolve();
    this.unmountCompleted = false;
    let resolveUnmount!: () => void;
    let rejectUnmount!: (cause: unknown) => void;
    const pending = new Promise<void>((resolve, reject) => {
      resolveUnmount = resolve;
      rejectUnmount = reject;
    });
    // Publish the completion and inactive state before resource cancellation:
    // loader error callbacks may synchronously re-enter unmount/destroy or try
    // to insert a retry resource, and must observe the same in-flight teardown.
    this.unmountPromise = pending;
    this.activationRevision += 1;
    this.getLifecycleController().deactivate();
    this.activeFlag = false;
    // If unmount interrupts the startup scheduler, no later script or browser
    // lifecycle event may run against the now-inactive sandbox. cancel() also
    // settles start(), so callers are never left behind a skipped mount task.
    this.scriptScheduler?.cancel();
    // Rebuild-mode apps may reuse this sandbox after unmount. Give the next
    // activation a fresh dynamic-script lane even when an old fetch never settles.
    if (!this.alive) {
      // A reusable rebuild sandbox receives a fresh I/O generation. Otherwise
      // a same-URL chunk appended after remount can adopt a request that was
      // started by the cancelled generation and execute its stale payload.
      releaseAssetCacheScope(this.assetCacheScope);
      this.assetCacheScope = {};
      cancelSandboxDynamicResources(this, 'unmount');
    }

    void this.performUnmount().then(
      () => {
        if (this.unmountPromise === pending) this.unmountPromise = undefined;
        this.unmountCompleted = true;
        resolveUnmount();
      },
      (cause: unknown) => {
        if (this.unmountPromise === pending) this.unmountPromise = undefined;
        rejectUnmount(cause);
      },
    );
    return pending;
  }

  public waitForUnmount(): Promise<void> | undefined {
    return this.unmountPromise;
  }

  private async performUnmount(): Promise<void> {
    // Rebuild-mode applications discard their detached dynamic-link observers;
    // alive applications keep the same DOM/runtime and may assign href while
    // inactive, so their pending observers remain valid until destroy.
    if (!this.alive) this.clearDeferredStyleObservers();
    // 清理子应用过期的同步参数
    clearInactiveAppUrl(this);
    if (this.alive) {
      this.lifecycles?.deactivated?.(getIframeWindow(this.iframe));
    }
    if (!this.mountFlag) return;
    const iframeWindow = getIframeWindow(this.iframe);
    if (isFunction(iframeWindow.__WUJIE_UNMOUNT) && !this.alive && !this.hrefFlag) {
      this.lifecycles?.beforeUnmount?.(iframeWindow);
      await invokeSandboxUnmountHook(this.id, () => iframeWindow.__WUJIE_UNMOUNT());
      this.lifecycles?.afterUnmount?.(iframeWindow);
      this.mountFlag = false;
      this.bus?.$clear();
      if (!this.degrade) {
        clearChild(this.shadowRoot);
        // head body需要复用，每次都要清空事件
        removeEventListener(this.head);
        removeEventListener(this.body);
      }
      clearChild(this.head);
      clearChild(this.body);
      // styleSheetElements / dynamicScriptElements 不能在 unmount 中清空：
      // 子应用的 JS 模块只在 sandbox.start() 阶段执行一次，unmount → active 后
      // 模块代码不会重跑，再次 mount 依赖 rebuildStyleSheets() 把数组里登记的
      // 样式节点重新挂回 shadowRoot.head。两数组的彻底清理放在 destroy() 中。
    }
  }

  /** 销毁子应用 */
  public destroy(): Promise<void> {
    // 并发 destroy 共享同一完成态，调用方不会在首个清理仍进行时提前返回。
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyed = true;
    this.activationRevision += 1;
    this.initialized = false;
    this.cancelIframeReady?.();
    this.scriptScheduler?.cancel();
    releaseAssetCacheScope(this.assetCacheScope);
    cancelSandboxDynamicResources(this, 'destroy');
    this.getLifecycleController().beginDestroy();
    this.clearContainerOnDestroy = getWujieById(this.id) === this;
    // 同步从全局 map 移除自身：确保 await 挂起期间并发的 disconnectedCallback /
    // startApp 通过 getWujieById 拿到 null，避免对同一实例重复 destroy（竞态根因）。
    deleteWujieById(this.id, this);
    // Register the tombstone and the public completion promise before unmount
    // (and therefore user lifecycle hooks) can run. The deferred keeps the
    // historical synchronous entry into unmount without exposing a reentrant
    // same-id creation window.
    let resolveTeardown!: () => void;
    let rejectTeardown!: (cause: unknown) => void;
    const teardown = new Promise<void>((resolve, reject) => {
      resolveTeardown = resolve;
      rejectTeardown = reject;
    });
    this.destroyPromise = this.clearContainerOnDestroy ? registerSandboxTeardown(this.id, teardown) : teardown;
    void this.performDestroy().then(resolveTeardown, rejectTeardown);
    return this.destroyPromise;
  }

  private async performDestroy(): Promise<void> {
    let didUnmountFail = false;
    let unmountError: unknown;
    try {
      await this.unmount();
    } catch (error: unknown) {
      didUnmountFail = true;
      unmountError = error;
    }

    const cleanup = this.createCleanupRegistry();
    cleanup.cleanupAll();
    this.getLifecycleController().finishDestroy();

    if (didUnmountFail) throw unmountError;
  }

  private createCleanupRegistry(): SandboxCleanupRegistry {
    const cleanup = new SandboxCleanupRegistry();
    cleanup
      .register(() => this.clearStyleSheets())
      .register(() => this.clearDynamicScripts())
      .register(() => this.clearFontStyleSheets())
      .register(() => this.clearDeferredStyleObservers())
      .register(() => this.bus?.$destroy())
      .register(() => this.clearContainer())
      .register(() => this.releaseIframe())
      .register(() => this.proxyRevoke?.())
      .register(() => this.eventCleanupTracker?.cleanupAll())
      .register(() => this.releaseReferences());
    return cleanup;
  }

  private clearContainer(): void {
    if (!this.el) return;
    if (!this.clearContainerOnDestroy) {
      this.releaseReference('el');
      return;
    }
    clearChild(this.el);
    this.releaseReference('el');
  }

  private releaseIframe(): void {
    if (!this.iframe) return;
    const iframeWindow = getIframeWindow(this.iframe);
    if (iframeWindow?.__WUJIE_EVENTLISTENER__) {
      iframeWindow.__WUJIE_EVENTLISTENER__.forEach((o) => {
        iframeWindow.removeEventListener(o.type, o.listener, o.options);
      });
    }
    // patchElementEffect 给散落到主应用 DOM 上的 element 留了 baseURI / ownerDocument
    // getter，它们通过 iframeWindow.__WUJIE 动态读取。主动断链使残留 getter 降级到主 document。
    if (iframeWindow) {
      try {
        Reflect.set(iframeWindow, '__WUJIE', null);
        Reflect.set(iframeWindow, '$wujie', null);
      } catch (_) {
        /* noop: iframe 已 detach 时赋值可能抛错 */
      }
    }
    this.iframe.parentNode?.removeChild(this.iframe);
    this.releaseReference('iframe');
  }

  private releaseReferences(): void {
    this.releaseReference('shadowRoot');
    this.releaseReference('proxy');
    this.releaseReference('proxyDocument');
    this.releaseReference('proxyLocation');
    this.releaseReference('execQueue');
    this.releaseReference('degradeAttrs');
    this.releaseReference('styleSheetElements');
    this.releaseReference('fontStyleSheetElements');
    this.releaseReference('dynamicScriptElements');
    this.releaseReference('deferredStyleObservers');
    this.releaseReference('bus');
    this.releaseReference('replace');
    this.releaseReference('fetch');
    this.releaseReference('execFlag');
    this.releaseReference('mountFlag');
    this.releaseReference('hrefFlag');
    this.releaseReference('document');
    this.releaseReference('head');
    this.releaseReference('body');
    this.releaseReference('elementEventCacheMap');
    this.releaseReference('lifecycles');
    this.releaseReference('plugins');
    this.releaseReference('provide');
    this.releaseReference('inject');
    this.releaseReference('prefix');
    this.releaseReference('iframeAddEventListeners');
    this.releaseReference('iframeOnEvents');
    this.releaseReference('proxyRevoke');
    this.cancelIframeReady = undefined;
    this.releaseReference('eventCleanupTracker');
  }

  /**
   * Public fields stay non-null while the sandbox is usable. Once destroy has
   * removed the instance from the registry, references are deliberately set to
   * null so detached DOM realms can be collected. Reflect accepts that terminal
   * state without weakening every live-state consumer to a nullable type.
   */
  private releaseReference(property: keyof Wujie): void {
    Reflect.set(this, property, null);
  }

  private getLifecycleController(): SandboxLifecycleController {
    // Some focused unit tests instantiate through Object.create to avoid iframe setup.
    if (!this.lifecycleController) this.lifecycleController = new SandboxLifecycleController();
    return this.lifecycleController;
  }

  private isActivationCurrent(revision: number): boolean {
    return revision === this.activationRevision && !this.destroyed && Boolean(this.iframe);
  }

  /**
   * destroy 阶段清空 styleSheetElements，同时把节点从父节点 detach。
   *
   * 仅供 destroy 调用：unmount 阶段需要保留数组以便 rebuildStyleSheets 复用样式节点
   * （子应用 JS 模块只 init 一次，模块代码不会再次生成动态样式）。
   */
  public clearStyleSheets(): void {
    this.clearOwnedElements(this.styleSheetElements);
  }

  /**
   * destroy 阶段清空 dynamicScriptElements，同时把残留的 <script> 节点从父节点 detach。
   * 仅供 destroy 调用，理由同 clearStyleSheets。
   */
  public clearDynamicScripts(): void {
    this.clearOwnedElements(this.dynamicScriptElements);
  }

  /**
   * destroy 阶段清空 fontStyleSheetElements，同时把节点从父节点 detach。
   * 使用 WUJIE_APP_ID 标识属于当前子应用的 font 样式。
   */
  public clearFontStyleSheets(): void {
    this.clearOwnedElements(this.fontStyleSheetElements);
  }

  private clearOwnedElements<ElementType extends Element>(elements: ElementType[]): void {
    if (!Array.isArray(elements)) return;
    elements.forEach((element) => {
      const timedElement = element as Element & { _patcher?: ReturnType<typeof setTimeout> };
      if (timedElement._patcher) {
        clearTimeout(timedElement._patcher);
        timedElement._patcher = undefined;
      }
      if (element.tagName === 'SCRIPT') {
        const script = element as unknown as HTMLScriptElement;
        script.onload = null;
        script.onerror = null;
      }
      try {
        element.parentNode?.removeChild(element);
      } catch (_) {
        /* noop: destroy 阶段任何异常不应中断后续清理 */
      }
    });
    elements.length = 0;
  }

  /**
   * unmount / destroy 阶段统一 disconnect 等待 href 赋值的 MutationObserver。
   * observer 在 href 命中或超时兜底时会自行 disconnect 并出队；
   * 这里兜底处理「子应用先于 href 赋值被卸载/销毁」的场景。
   */
  public clearDeferredStyleObservers(): void {
    if (!Array.isArray(this.deferredStyleObservers)) return;
    [...this.deferredStyleObservers].forEach((observer) => {
      try {
        observer.disconnect();
      } catch (_) {
        /* noop: destroy 阶段任何异常不应中断后续清理 */
      }
    });
    this.deferredStyleObservers.length = 0;
  }

  /**
   * 创建或获取 font 样式容器（挂载在最外层 document.head）
   * 用于存放子应用的 @font-face 样式，确保嵌套子应用也能正确应用字体
   */
  private createFontStyleSheetContainer(): HTMLElement {
    const container = rawDocumentQuerySelector.call(document, `[${WUJIE_FONT_STYLE_CONTAINER_ATTR}]`);
    if (container) return container as HTMLElement;

    const styleElement = document.createElement('style');
    styleElement.setAttribute(WUJIE_FONT_STYLE_CONTAINER_ATTR, '');
    document.head.appendChild(styleElement);
    return styleElement;
  }

  /** 当子应用再次激活后，只运行mount函数，样式需要重新恢复 */
  public rebuildStyleSheets(): void {
    if (this.styleSheetElements && this.styleSheetElements.length) {
      this.styleSheetElements.forEach((styleSheetElement) => {
        rawElementAppendChild.call(this.degrade ? this.document.head : this.shadowRoot.head, styleSheetElement);
      });
    }
    this.patchCssRules();
  }

  /**
   * 子应用样式打补丁
   * 1、兼容:root选择器样式到:host选择器上
   * 2、将@font-face定义到shadowRoot外部
   */
  public patchCssRules(): void {
    if (this.degrade) return;
    if (this.shadowRoot.host.hasAttribute(WUJIE_DATA_ATTACH_CSS_FLAG)) return;
    const [hostStyleSheetElement, fontStyleSheetElement] = getPatchStyleElements(
      Array.from(getIframeDocument(this.iframe).querySelectorAll('style')).map(
        (styleSheetElement) => styleSheetElement.sheet,
      ),
    );
    if (hostStyleSheetElement) {
      this.shadowRoot.head.appendChild(hostStyleSheetElement);
      this.styleSheetElements.push(hostStyleSheetElement);
    }
    if (fontStyleSheetElement) {
      this.inject.fontStyleSheetContainer?.appendChild(fontStyleSheetElement);
      fontStyleSheetElement.setAttribute(WUJIE_APP_ID, this.id);
      this.fontStyleSheetElements.push(fontStyleSheetElement);
    }
    (hostStyleSheetElement || fontStyleSheetElement) &&
      this.shadowRoot.host.setAttribute(WUJIE_DATA_ATTACH_CSS_FLAG, '');
  }

  /**
   * @param id 子应用的id，唯一标识
   * @param url 子应用的url，可以包含protocol、host、path、query、hash
   */
  constructor(options: {
    name: string;
    url: string;
    attrs: IframeAttributes;
    degradeAttrs: IframeAttributes;
    fiber: boolean;
    degrade?: boolean;
    plugins: Array<WujiePlugin>;
    lifecycles: Lifecycles;
    iframeAddEventListeners?: Array<string>;
    iframeOnEvents?: Array<string>;
  }) {
    // 传递inject给嵌套子应用（显式 as：__WUJIE_INJECT 全局类型是 Partial，需断言回完整结构）
    if (window.__POWERED_BY_WUJIE__) this.inject = window.__WUJIE.inject as Wujie['inject'];
    else {
      this.inject = {
        idToSandboxMap: idToSandboxCacheMap,
        teardownById: window.__WUJIE_INJECT.teardownById,
        appEventObjMap,
        coreOperationSlots: window.__WUJIE_CORE_INTENTS,
        mainHostPath: window.location.protocol + '//' + window.location.host,
        fontStyleSheetContainer: this.createFontStyleSheetContainer(),
      };
    }
    const { name, url, attrs, fiber, degradeAttrs, degrade, lifecycles, plugins } = options;
    this.id = name;
    this.fiber = fiber;
    this.degrade = degrade || !wujieSupport;
    this.bus = new EventBus(this.id);
    this.url = url;
    this.degradeAttrs = degradeAttrs;
    this.provide = { bus: this.bus };
    this.styleSheetElements = [];
    this.execQueue = [];
    this.lifecycles = lifecycles;
    this.plugins = getPlugins(plugins);
    this.iframeAddEventListeners = options.iframeAddEventListeners;
    this.iframeOnEvents = options.iframeOnEvents;

    // 创建目标地址的解析
    const { urlElement, appHostPath, appRoutePath } = appRouteParse(url);
    const { mainHostPath } = this.inject;
    // 创建iframe
    this.iframe = iframeGenerator(this, attrs, mainHostPath, appHostPath, appRoutePath);

    if (this.degrade) {
      const { proxyDocument, proxyLocation, proxyRevoke } = localGenerator(
        this.iframe,
        urlElement,
        mainHostPath,
        appHostPath,
      );
      this.proxyDocument = proxyDocument;
      this.proxyLocation = proxyLocation;
      this.proxyRevoke = proxyRevoke;
    } else {
      const { proxyWindow, proxyDocument, proxyLocation, proxyRevoke } = proxyGenerator(
        this.iframe,
        urlElement,
        mainHostPath,
        appHostPath,
      );
      this.proxy = proxyWindow;
      this.proxyDocument = proxyDocument;
      this.proxyLocation = proxyLocation;
      this.proxyRevoke = proxyRevoke;
    }
    this.provide.location = this.proxyLocation;

    addSandboxCacheWithWujie(this.id, this);
  }
}
