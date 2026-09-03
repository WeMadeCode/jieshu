import importHTML, { initInlineEventHelper, processCssLoader } from './entry';

export { clearAssetsCache } from './entry';
import WuJie from './sandbox';
import { defineWujieWebComponent, addLoading, getDisconnectAction } from './shadow';
import { processAppForHrefJump } from './sync';
import { getPlugins } from './plugin';
import { wujieSupport, isFunction, requestIdleCallback, isMatchSyncQueryById, warn, stopMainAppRun } from './utils';
import { assertResolvedStartOptions, resolveOptions } from './options';
import {
  getWujieById,
  getOptionsById,
  addSandboxCacheWithOptions,
  waitForSandboxTeardown,
  isSandboxUnmountHookActive,
} from './common';
import { EventBus } from './event';
import { RuntimeAppController } from './controller';
import { beginOperation, isOperationCurrent, observeOperation } from './operation-intent';
import type { OperationIntent } from './operation-intent';
import { WUJIE_TIPS_NOT_SUPPORTED } from './constant';
import type { CacheOptions, DestroyHandler, PreOptions, StartOptions } from './contracts';
import type { AppController } from './controller';

export type {
  BaseOptions,
  CacheOptions,
  DestroyHandler,
  EventListenerHook,
  IframeAttributes,
  InjectedWujieProps,
  Lifecycle,
  Lifecycles,
  LoadErrorHandler,
  PreOptions,
  ScriptObjectLoader,
  StartOptions,
  WujiePlugin,
  WujieProps,
  cacheOptions,
  lifecycle,
  loadErrorHandler,
  plugin,
  preOptions,
  startOptions,
} from './contracts';
export type { AppController } from './controller';
export type { ResolvedOptions } from './options';

export const bus = new EventBus(Date.now().toString());

type ContinuationGuard = () => boolean;

function isChildSelfUnmountOperation(id: string): boolean {
  try {
    const owner = window.__WUJIE;
    return Boolean(
      window.__POWERED_BY_WUJIE__ &&
      owner?.id === id &&
      typeof owner.waitForUnmount === 'function' &&
      owner.waitForUnmount(),
    );
  } catch {
    return false;
  }
}

function isReentrantUnmountOperation(id: string): boolean {
  // The synchronous marker covers host-side closures. The realm check covers
  // the real deployment shape: an independently bundled child core, including
  // continuations after await, without making unrelated host calls complete
  // before teardown actually finishes.
  return isSandboxUnmountHookActive(id) || isChildSelfUnmountOperation(id);
}

function detachReentrantOperation<Value>(work: Promise<Value>, operation: string): Promise<Value | void> {
  void work.catch((cause: unknown) => warn(`reentrant ${operation} failed: ${String(cause)}`));
  return Promise.resolve();
}

function hasPendingLifecycle(id: string): boolean {
  return Boolean(waitForSandboxTeardown(id) || getWujieById(id)?.waitForUnmount());
}

function isSandboxUnavailable(sandbox: WuJie, canContinue: ContinuationGuard): boolean {
  return (
    !canContinue() ||
    sandbox.destroyed ||
    !sandbox.iframe ||
    !sandbox.iframe.contentWindow ||
    getWujieById(sandbox.id) !== sandbox
  );
}

function pendingTeardownCompletion(id: string, canContinue: ContinuationGuard): Promise<boolean> | undefined {
  const firstTeardown = waitForSandboxTeardown(id);
  if (!firstTeardown) return undefined;
  return (async () => {
    let pendingTeardown: Promise<void> | undefined = firstTeardown;
    while (canContinue() && pendingTeardown) {
      try {
        await pendingTeardown;
      } catch {
        // A failed previous teardown must not permanently poison later starts;
        // the destroy caller still receives the original rejection.
      }
      pendingTeardown = waitForSandboxTeardown(id);
    }
    return canContinue();
  })();
}

function settleWhenCancelled<Value>(work: Promise<Value>, intent: OperationIntent): Promise<Value | void> {
  return Promise.race([work, intent.cancelled.then((): void => undefined)]);
}

async function discardSandboxIfOwned(sandbox: WuJie): Promise<void> {
  if (sandbox.destroyed || getWujieById(sandbox.id) !== sandbox) return;
  try {
    await sandbox.destroy();
  } catch {
    // Preserve the initiating start/preload failure; teardown is best-effort.
  }
}

async function retainOnlyActiveInitialization(sandbox: WuJie, canContinue: ContinuationGuard): Promise<boolean> {
  if (isSandboxUnavailable(sandbox, canContinue)) return false;
  if (sandbox.activeFlag) return true;
  // An ordinary disconnect may interrupt mount without destroying the
  // sandbox. Its scheduler is then incomplete and must never be cached as a
  // successful initialization.
  await discardSandboxIfOwned(sandbox);
  return false;
}

/**
 * 强制中断主应用运行
 * wujie.__WUJIE 如果为true说明当前运行环境是子应用
 * window.__POWERED_BY_WUJIE__ 如果为false说明子应用还没初始化完成
 * 上述条件同时成立说明主应用代码在iframe的loading阶段混入进来了，必须中断执行
 */
if (window.__WUJIE && !window.__POWERED_BY_WUJIE__) {
  stopMainAppRun();
}

// 处理子应用链接跳转
processAppForHrefJump();

// 定义webComponent容器
defineWujieWebComponent();

// 如果不支持则告警
if (!wujieSupport) warn(WUJIE_TIPS_NOT_SUPPORTED);

/**
 * 缓存子应用配置
 */
export function setupApp(options: CacheOptions): void {
  if (options.name) addSandboxCacheWithOptions(options.name, options);
}

/**
 * 运行无界app
 */
async function startAppNow(startOptions: StartOptions, canContinue: ContinuationGuard): Promise<DestroyHandler | void> {
  // 初始化内联事件处理器辅助函数
  initInlineEventHelper();
  const teardown = pendingTeardownCompletion(startOptions.name, canContinue);
  if (teardown && !(await teardown)) return;
  const sandbox = getWujieById(startOptions.name);
  const cacheOptions = getOptionsById(startOptions.name);
  // 合并缓存配置
  const options = resolveOptions(startOptions, cacheOptions);
  assertResolvedStartOptions(options);
  const {
    name,
    url,
    html,
    replace,
    fetch,
    props,
    attrs,
    degradeAttrs,
    fiber,
    alive,
    degrade,
    sync,
    prefix,
    el,
    loading,
    plugins,
    lifecycles,
    iframeAddEventListeners,
    iframeOnEvents,
  } = options;
  if (!canContinue()) return;
  // 已经初始化过的应用，快速渲染。普通 start 若撞到另一个未完成的
  // bootstrap，会取消旧实例后重建；preload 则是可复用的显式准备阶段。
  if (sandbox) {
    const pendingUnmount = sandbox.waitForUnmount();
    if (pendingUnmount) await pendingUnmount;
    if (sandbox.preload) await sandbox.preload;
    if (isSandboxUnavailable(sandbox, canContinue)) return;

    if (!sandbox.initialized) {
      await sandbox.destroy();
      if (!canContinue()) return;
    } else {
      sandbox.initialized = false;
      try {
        sandbox.plugins = getPlugins(plugins);
        sandbox.lifecycles = lifecycles;
        const iframeWindow = sandbox.iframe.contentWindow;
        if (!iframeWindow) return;
        if (alive) {
          // 保活
          await sandbox.active({ url, sync, prefix, el, props, alive, fetch, replace });
          if (isSandboxUnavailable(sandbox, canContinue)) return;
          if (!sandbox.activeFlag) {
            await discardSandboxIfOwned(sandbox);
            return;
          }
          // 预加载但是没有执行的情况
          if (!sandbox.execFlag) {
            sandbox.lifecycles?.beforeLoad?.(iframeWindow);
            if (isSandboxUnavailable(sandbox, canContinue)) return;
            const { getExternalScripts } = await importHTML({
              url,
              html,
              opts: {
                fetch: fetch || window.fetch,
                plugins: sandbox.plugins,
                loadError: sandbox.lifecycles.loadError,
                fiber,
                cacheScope: sandbox.assetCacheScope,
              },
            });
            if (isSandboxUnavailable(sandbox, canContinue)) return;
            await sandbox.start(getExternalScripts);
          }
          if (!(await retainOnlyActiveInitialization(sandbox, canContinue))) return;
          sandbox.lifecycles?.activated?.(iframeWindow);
          if (isSandboxUnavailable(sandbox, canContinue)) return;
          sandbox.initialized = true;
          return () => sandbox.destroy();
        } else if (isFunction(iframeWindow.__WUJIE_MOUNT)) {
          /**
           * 子应用切换会触发webcomponent的disconnectedCallback调用sandbox.unmount进行实例销毁
           * 此处是防止没有销毁webcomponent时调用startApp的情况，需要手动调用unmount
           */
          await sandbox.unmount();
          if (isSandboxUnavailable(sandbox, canContinue)) return;
          await sandbox.active({ url, sync, prefix, el, props, alive, fetch, replace });
          if (isSandboxUnavailable(sandbox, canContinue)) return;
          if (!sandbox.activeFlag) {
            await discardSandboxIfOwned(sandbox);
            return;
          }
          // 正常加载的情况，先注入css，最后才mount。重新激活也保持同样的时序
          sandbox.rebuildStyleSheets();
          sandbox.mount(false);
          if (!(await retainOnlyActiveInitialization(sandbox, canContinue))) return;
          sandbox.initialized = true;
          return () => sandbox.destroy();
        } else {
          // 没有渲染函数
          await sandbox.destroy();
          if (!canContinue()) return;
        }
      } catch (cause: unknown) {
        if (canContinue()) await discardSandboxIfOwned(sandbox);
        throw cause;
      }
    }
  }

  // 设置loading
  addLoading(el, loading);
  if (!canContinue()) return;
  const newSandbox = new WuJie({
    name,
    url,
    attrs,
    degradeAttrs,
    fiber,
    degrade,
    plugins,
    lifecycles,
    iframeAddEventListeners,
    iframeOnEvents,
  });
  if (isSandboxUnavailable(newSandbox, canContinue)) {
    await discardSandboxIfOwned(newSandbox);
    return;
  }
  const iframeWindow = newSandbox.iframe.contentWindow;
  if (!iframeWindow) {
    await discardSandboxIfOwned(newSandbox);
    return;
  }
  try {
    newSandbox.lifecycles?.beforeLoad?.(iframeWindow);
    if (isSandboxUnavailable(newSandbox, canContinue)) return;
    const { template, getExternalScripts, getExternalStyleSheets } = await importHTML({
      url,
      html,
      opts: {
        fetch: fetch || window.fetch,
        plugins: newSandbox.plugins,
        loadError: newSandbox.lifecycles.loadError,
        fiber,
        cacheScope: newSandbox.assetCacheScope,
      },
    });

    if (isSandboxUnavailable(newSandbox, canContinue)) return;
    const processedHtml = await processCssLoader(newSandbox, template, getExternalStyleSheets);
    if (isSandboxUnavailable(newSandbox, canContinue)) return;
    await newSandbox.active({ url, sync, prefix, template: processedHtml, el, props, alive, fetch, replace });
    if (isSandboxUnavailable(newSandbox, canContinue)) return;
    if (!newSandbox.activeFlag) {
      await discardSandboxIfOwned(newSandbox);
      return;
    }
    await newSandbox.start(getExternalScripts);
    if (!(await retainOnlyActiveInitialization(newSandbox, canContinue))) return;
    newSandbox.initialized = true;
    return () => newSandbox.destroy();
  } catch (cause: unknown) {
    if (canContinue()) await discardSandboxIfOwned(newSandbox);
    throw cause;
  }
}

function startAppWithCompletion(request: StartOptions): Promise<DestroyHandler | void> {
  const reentrantUnmount = isReentrantUnmountOperation(request.name);
  // Starting the application that is currently executing its own unmount
  // hook has no stable owner realm. Treat it as already superseded; callers
  // can initiate the next start from the host after unmount completion.
  if (reentrantUnmount) return Promise.resolve();
  const intent = beginOperation(request.name);
  const starting = settleWhenCancelled(
    startAppNow(request, () => isOperationCurrent(intent)),
    intent,
  );
  return starting;
}

export function startApp(startOptions: StartOptions): Promise<DestroyHandler | void> {
  const request = { ...startOptions };
  const pendingLifecycle = hasPendingLifecycle(request.name);
  const starting = startAppWithCompletion(request);
  // During an in-flight unmount, the real start remains queued behind cleanup
  // but its outward acknowledgement cannot be awaited by that same hook. This
  // matches the historical concurrent-call contract while preventing overlap.
  return pendingLifecycle
    ? (detachReentrantOperation(starting, 'start app after teardown') as Promise<DestroyHandler | void>)
    : starting;
}

/**
 * 预加载无界APP
 */
export function preloadApp(preOptions: PreOptions): void {
  const request = { ...preOptions };
  const intent = observeOperation(request.name);
  requestIdleCallback(() => {
    const preload = async (): Promise<void> => {
      const teardown = pendingTeardownCompletion(request.name, () => isOperationCurrent(intent));
      if (teardown && !(await teardown)) return;
      if (!isOperationCurrent(intent)) return;
      /**
       * 已经存在
       * url查询参数中有子应用的id，大概率是刷新浏览器或者分享url，此时需要直接打开子应用，无需预加载
       */
      if (getWujieById(request.name) || isMatchSyncQueryById(request.name)) return;
      const cacheOptions = getOptionsById(request.name);
      // 合并缓存配置
      const options = resolveOptions(request, cacheOptions);
      const {
        name,
        url,
        html,
        props,
        alive,
        replace,
        fetch,
        exec,
        attrs,
        degradeAttrs,
        fiber,
        degrade,
        prefix,
        plugins,
        lifecycles,
        iframeAddEventListeners,
        iframeOnEvents,
      } = options;

      const sandbox = new WuJie({
        name,
        url,
        attrs,
        degradeAttrs,
        fiber,
        degrade,
        plugins,
        lifecycles,
        iframeAddEventListeners,
        iframeOnEvents,
      });
      if (sandbox.preload) return sandbox.preload;
      const iframeWindow = sandbox.iframe.contentWindow;
      if (!iframeWindow) {
        await discardSandboxIfOwned(sandbox);
        return;
      }
      const runPreload = async () => {
        try {
          sandbox.lifecycles?.beforeLoad?.(iframeWindow);
          if (isSandboxUnavailable(sandbox, () => true)) return;
          const { template, getExternalScripts, getExternalStyleSheets } = await importHTML({
            url,
            html,
            opts: {
              fetch: fetch || window.fetch,
              plugins: sandbox.plugins,
              loadError: sandbox.lifecycles.loadError,
              fiber,
              cacheScope: sandbox.assetCacheScope,
            },
          });
          if (isSandboxUnavailable(sandbox, () => true)) return;
          const processedHtml = await processCssLoader(sandbox, template, getExternalStyleSheets);
          if (isSandboxUnavailable(sandbox, () => true)) return;
          await sandbox.active({ url, props, prefix, alive, template: processedHtml, fetch, replace });
          if (isSandboxUnavailable(sandbox, () => true)) return;
          if (!sandbox.activeFlag) {
            await discardSandboxIfOwned(sandbox);
            return;
          }
          if (exec) {
            await sandbox.start(getExternalScripts);
          } else {
            await getExternalScripts();
          }
          // Once a preload sandbox exists, a same-id start adopts it by awaiting
          // sandbox.preload. The original idle intent may therefore be stale
          // even though this concrete sandbox is still the live owner. Destroy
          // and refresh cancel the sandbox itself, so identity/liveness is the
          // correct continuation guard for the in-flight preload pipeline.
          if (await retainOnlyActiveInitialization(sandbox, () => true)) {
            sandbox.initialized = true;
          }
        } catch (cause: unknown) {
          await discardSandboxIfOwned(sandbox);
          throw cause;
        }
      };
      sandbox.preload = runPreload();
      await sandbox.preload;
    };

    // preloadApp is intentionally fire-and-forget; observe failures so a
    // rejected preload cannot become an unhandled promise after cleanup.
    void preload().catch((cause: unknown) => warn(`preload app failed: ${String(cause)}`));
  });
}

/**
 * 销毁无界APP
 */
async function destroyAppNow(id: string, canContinue: ContinuationGuard): Promise<void> {
  const sandbox = getWujieById(id);
  if (sandbox) {
    await sandbox.destroy();
    return;
  }

  while (canContinue()) {
    const pendingTeardown = waitForSandboxTeardown(id);
    if (!pendingTeardown) break;
    await pendingTeardown;
  }
  if (!canContinue()) return;

  // A start that was already waiting for the same tombstone resumes before a
  // later destroy waiter. Query again so the destroy intent can cancel that
  // just-created replacement without blocking on its resource pipeline.
  const replacement = getWujieById(id);
  if (replacement) await replacement.destroy();
}

function destroyAppWithCompletion(id: string): Promise<void> {
  const reentrantUnmount = isReentrantUnmountOperation(id);
  const intent = beginOperation(id);
  const destroying = destroyAppNow(id, () => isOperationCurrent(intent));
  if (!reentrantUnmount) return destroying;

  // Awaiting the same public destroy from inside __WUJIE_UNMOUNT would form a
  // promise cycle: the outer destroy waits for the hook while the hook waits
  // for the outer teardown tombstone. The teardown keeps running, but the
  // reentrant call must settle at the point where ownership was transferred.
  return detachReentrantOperation(destroying, 'destroy app') as Promise<void>;
}

export function destroyApp(id: string): Promise<void> {
  const pendingLifecycle = hasPendingLifecycle(id);
  const destroying = destroyAppWithCompletion(id);
  return pendingLifecycle
    ? (detachReentrantOperation(destroying, 'destroy app after teardown') as Promise<void>)
    : destroying;
}

/**
 * 刷新无界APP
 * 先销毁当前子应用实例，再以传入配置全量重建（等价于「重建模式」）
 * 等待 destroyApp 完成后再 startApp，避免销毁未结束就重启导致的竞态
 */
function refreshAppWithCompletion(request: StartOptions): Promise<DestroyHandler | void> {
  const reentrantUnmount = isReentrantUnmountOperation(request.name);
  if (reentrantUnmount) return Promise.resolve();
  const intent = beginOperation(request.name);
  const canContinue = () => isOperationCurrent(intent);
  const work = destroyAppNow(request.name, canContinue).then(() =>
    canContinue() ? startAppNow(request, canContinue) : undefined,
  );
  const refreshing = settleWhenCancelled(work, intent);
  return refreshing;
}

export function refreshApp(startOptions: StartOptions): Promise<DestroyHandler | void> {
  const request = { ...startOptions };
  const pendingLifecycle = hasPendingLifecycle(request.name);
  const refreshing = refreshAppWithCompletion(request);
  return pendingLifecycle
    ? (detachReentrantOperation(refreshing, 'refresh app after teardown') as Promise<DestroyHandler | void>)
    : refreshing;
}

/**
 * Create an adapter-scoped lifecycle coordinator. Framework integrations use
 * this instead of maintaining their own global Promise queues.
 */
export function createAppController(): AppController {
  return new RuntimeAppController({
    start: startAppWithCompletion,
    refresh: refreshAppWithCompletion,
    destroy: destroyAppWithCompletion,
    release: async (name) => {
      const sandbox = getWujieById(name);
      if (!sandbox) {
        await waitForSandboxTeardown(name);
        return;
      }
      if (getDisconnectAction(sandbox) === 'unmount') await sandbox.unmount();
      else await sandbox.destroy();
    },
    shouldPreserveOnDisconnect: (name) => {
      const sandbox = getWujieById(name);
      return sandbox ? getDisconnectAction(sandbox) === 'unmount' : false;
    },
  });
}
