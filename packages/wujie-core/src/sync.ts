import { appRouteParse, getDegradeIframe } from "./utils";
import { renderIframeReplaceApp, patchEventTimeStamp } from "./iframe";
import { renderElementToContainer, initRenderIframeAndContainer } from "./shadow";
import { getWujieById, rawDocumentQuerySelector } from "./common";
import { compactRoutePath, getAppRoute, readRouteState, writeRouteState } from "./route-state";
import { shouldHandlePageHideTeardown } from "./sandbox-policy";

/**
 * 同步子应用路由到主应用路由
 */
export function syncUrlToWindow(iframeWindow: Window): void {
  const { sync, id, prefix } = iframeWindow.__WUJIE;
  const routeState = readRouteState(window.location.href);
  // 非同步且url上没有当前id的查询参数，否则就要同步参数或者清理参数
  if (!sync && !routeState.query[id]) return;
  const curUrl = iframeWindow.location.pathname + iframeWindow.location.search + iframeWindow.location.hash;
  // 同步
  if (sync) {
    // queryMap 来自 URLSearchParams，已经是 decoded 形态；统一在写回 URL 时再 encode，避免重复 encode
    routeState.query[id] = compactRoutePath(curUrl, prefix || undefined);
    // 清理
  } else {
    delete routeState.query[id];
  }
  const nextHref = writeRouteState(routeState);
  if (nextHref !== window.location.href) {
    window.history.replaceState(null, "", nextHref);
  }
}

/**
 * 同步主应用路由到子应用
 */
export function syncUrlToIframe(iframeWindow: Window): void {
  // 获取当前路由路径
  const { pathname, search, hash } = iframeWindow.location;
  const { id, url, sync, execFlag, prefix, inject } = iframeWindow.__WUJIE;

  // 只在浏览器刷新或者第一次渲染时同步
  const idUrl = sync && !execFlag ? getAppRoute(readRouteState(window.location.href), id, prefix) : url;
  // 排除href跳转情况
  const syncUrl = (/^https?:\/\//i.test(idUrl) ? null : idUrl) || url;
  const { appRoutePath } = appRouteParse(syncUrl);

  const preAppRoutePath = pathname + search + hash;
  if (preAppRoutePath !== appRoutePath) {
    iframeWindow.history.replaceState(null, "", inject.mainHostPath + appRoutePath);
  }
}

/**
 * 清理非激活态的子应用同步参数
 * 主应用采用hash模式时，切换子应用后已销毁的子应用同步参数还存在需要手动清理
 */
interface RouteSandboxState {
  id: string;
  execFlag: boolean;
  sync?: boolean;
  hrefFlag: boolean;
  activeFlag: boolean;
}

export function clearInactiveAppUrl(tearingDownSandbox?: RouteSandboxState): void {
  const routeState = readRouteState(window.location.href);
  Object.keys(routeState.query).forEach((id) => {
    // destroy() deliberately removes the sandbox from the live registry before
    // awaiting user hooks. Keep using its explicit snapshot so its own route
    // entry is not mistaken for an unknown application and left behind.
    const sandbox = tearingDownSandbox?.id === id ? tearingDownSandbox : getWujieById(id);
    if (!sandbox) return;
    // 子应用执行过并且已经失活才需要清除
    if (sandbox.execFlag && sandbox.sync && !sandbox.hrefFlag && !sandbox.activeFlag) {
      delete routeState.query[id];
    }
  });
  const nextHref = writeRouteState(routeState);
  if (nextHref !== window.location.href) {
    window.history.replaceState(null, "", nextHref);
  }
}

/**
 * 推送指定url到主应用路由
 */
export function pushUrlToWindow(id: string, url: string): void {
  const routeState = readRouteState(window.location.href);
  // queryMap 来自 URLSearchParams，已经是 decoded 形态；统一在写回 URL 时再 encode，避免重复 encode
  routeState.query[id] = url;
  window.history.pushState(null, "", writeRouteState(routeState));
}

/**
 * 应用跳转(window.location.href)情况路由处理
 */
export function processAppForHrefJump(): void {
  window.addEventListener("popstate", () => {
    const { query } = readRouteState(window.location.href);
    Object.keys(query)
      .map((id) => getWujieById(id))
      .filter((sandbox): sandbox is NonNullable<ReturnType<typeof getWujieById>> => sandbox !== null)
      .forEach((sandbox) => {
        const url = query[sandbox.id];
        const contentDocument = sandbox.iframe?.contentDocument;
        if (!contentDocument) return;
        const iframeBody = rawDocumentQuerySelector.call(contentDocument, "body") as HTMLBodyElement | null;
        if (!iframeBody) return;
        // 前进href
        if (/^https?:\/\//i.test(url)) {
          const target = sandbox.degrade
            ? getDegradeIframe(sandbox.id)?.parentElement
            : sandbox.shadowRoot?.host?.parentElement;
          if (!target) return;
          if (sandbox.degrade) {
            const documentElement = sandbox.document?.documentElement;
            if (!documentElement) return;
            renderElementToContainer(documentElement, iframeBody);
          }
          // URLSearchParams already decoded the route value in readRouteState.
          renderIframeReplaceApp(url, target, sandbox.degradeAttrs);
          sandbox.hrefFlag = true;
          // href后退
        } else if (sandbox.hrefFlag) {
          if (sandbox.degrade) {
            // 走全套流程，但是事件恢复不需要
            const { iframe } = initRenderIframeAndContainer(sandbox.id, sandbox.el, sandbox.degradeAttrs);
            const renderWindow = iframe.contentWindow;
            const renderDocument = iframe.contentDocument;
            const appWindow = sandbox.iframe.contentWindow;
            const documentElement = iframeBody.firstElementChild;
            if (!renderWindow || !renderDocument || !appWindow || !documentElement) return;
            patchEventTimeStamp(renderWindow, appWindow);
            renderWindow.onpagehide = (event) => {
              if (shouldHandlePageHideTeardown(event)) void sandbox.unmount();
            };
            renderDocument.appendChild(documentElement);
            sandbox.document = renderDocument;
          } else if (sandbox.shadowRoot?.host) {
            renderElementToContainer(sandbox.shadowRoot.host, sandbox.el);
          } else {
            return;
          }
          sandbox.hrefFlag = false;
        }
      });
  });
}
