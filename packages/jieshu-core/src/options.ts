import type { CacheOptions, IframeAttributes, Lifecycles, JieshuPlugin, JieshuProps } from './contracts';

export type { Lifecycles } from './contracts';

export interface ResolvedOptions {
  name: string;
  el?: HTMLElement | string;
  url: string;
  html?: string;
  exec: boolean;
  replace?: (code: string) => string;
  fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  props?: JieshuProps;
  sync: boolean;
  prefix?: Record<string, string>;
  loading?: HTMLElement;
  attrs: IframeAttributes;
  degradeAttrs: IframeAttributes;
  fiber: boolean;
  alive: boolean;
  degrade: boolean;
  plugins: Array<JieshuPlugin>;
  iframeAddEventListeners: Array<string>;
  iframeOnEvents: Array<string>;
  lifecycles: Lifecycles;
}

export function resolveOptions(options: CacheOptions, cacheOptions?: CacheOptions | null): ResolvedOptions {
  const cached = cacheOptions ?? undefined;
  return {
    name: options.name,
    el: options.el || cached?.el,
    url: options.url || cached?.url || '',
    html: options.html || cached?.html,
    exec: options.exec !== undefined ? options.exec : cached?.exec !== undefined ? cached.exec : false,
    replace: options.replace || cached?.replace,
    fetch: options.fetch || cached?.fetch,
    props: options.props || cached?.props,
    sync: options.sync !== undefined ? options.sync : cached?.sync !== undefined ? cached.sync : false,
    prefix: options.prefix || cached?.prefix,
    loading: options.loading || cached?.loading,
    attrs: options.attrs !== undefined ? options.attrs : cached?.attrs || {},
    degradeAttrs: options.degradeAttrs !== undefined ? options.degradeAttrs : cached?.degradeAttrs || {},
    fiber: options.fiber !== undefined ? options.fiber : cached?.fiber !== undefined ? cached.fiber : true,
    alive: options.alive !== undefined ? options.alive : cached?.alive !== undefined ? cached.alive : false,
    degrade: options.degrade !== undefined ? options.degrade : cached?.degrade !== undefined ? cached.degrade : false,
    plugins: options.plugins || cached?.plugins || [],
    iframeAddEventListeners: options.iframeAddEventListeners || cached?.iframeAddEventListeners || [],
    iframeOnEvents: options.iframeOnEvents || cached?.iframeOnEvents || [],
    lifecycles: resolveLifecycles(options, cached),
  };
}

export type ResolvedStartOptions = ResolvedOptions & { el: HTMLElement | string };

/** Runtime validation closes the gap left by setupApp-backed optional fields. */
export function assertResolvedStartOptions(options: ResolvedOptions): asserts options is ResolvedStartOptions {
  if (!options.url) throw new TypeError(`Jieshu application "${options.name}" requires a url`);
  if (options.el === undefined) throw new TypeError(`Jieshu application "${options.name}" requires a container`);
}

function resolveLifecycles(options: CacheOptions, cached?: CacheOptions): Lifecycles {
  return {
    beforeLoad: options.beforeLoad || cached?.beforeLoad,
    beforeMount: options.beforeMount || cached?.beforeMount,
    afterMount: options.afterMount || cached?.afterMount,
    beforeUnmount: options.beforeUnmount || cached?.beforeUnmount,
    afterUnmount: options.afterUnmount || cached?.afterUnmount,
    activated: options.activated || cached?.activated,
    deactivated: options.deactivated || cached?.deactivated,
    loadError: options.loadError || cached?.loadError,
  };
}
