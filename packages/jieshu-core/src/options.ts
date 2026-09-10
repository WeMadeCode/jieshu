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
  fiber: boolean;
  alive: boolean;
  plugins: Array<JieshuPlugin>;
  iframeAddEventListeners: Array<string>;
  iframeOnEvents: Array<string>;
  lifecycles: Lifecycles;
}

const resolveBooleanOption = (value: boolean | undefined, cached: boolean | undefined, fallback: boolean) => {
  if (value !== undefined) {
    return value;
  }
  return cached !== undefined ? cached : fallback;
};

const resolveResourceOptions = (options: CacheOptions, cached?: CacheOptions) => {
  return {
    name: options.name,
    el: options.el || cached?.el,
    url: options.url || cached?.url || '',
    html: options.html || cached?.html,
    exec: resolveBooleanOption(options.exec, cached?.exec, false),
    replace: options.replace || cached?.replace,
    fetch: options.fetch || cached?.fetch,
    props: options.props || cached?.props,
  };
};

const resolveIframeEvents = (options: CacheOptions, cached?: CacheOptions) => {
  return {
    iframeAddEventListeners: options.iframeAddEventListeners || cached?.iframeAddEventListeners || [],
    iframeOnEvents: options.iframeOnEvents || cached?.iframeOnEvents || [],
  };
};

export const resolveOptions = (options: CacheOptions, cacheOptions?: CacheOptions | null) => {
  const cached = cacheOptions ?? undefined;
  const resolved: ResolvedOptions = {
    ...resolveResourceOptions(options, cached),
    sync: resolveBooleanOption(options.sync, cached?.sync, false),
    prefix: options.prefix || cached?.prefix,
    loading: options.loading || cached?.loading,
    attrs: options.attrs !== undefined ? options.attrs : cached?.attrs || {},
    fiber: resolveBooleanOption(options.fiber, cached?.fiber, true),
    alive: resolveBooleanOption(options.alive, cached?.alive, false),
    plugins: options.plugins || cached?.plugins || [],
    ...resolveIframeEvents(options, cached),
    lifecycles: resolveLifecycles(options, cached),
  };
  return resolved;
};

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
