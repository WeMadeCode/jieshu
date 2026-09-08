import type Jieshu from './sandbox';
import type { CacheOptions } from './contracts';

export interface SandboxCache {
  jieshu?: Jieshu;
  options?: CacheOptions;
}

export type SandboxTeardownRegistry = Map<string, Promise<void>>;

const resolveUnmountHooks = () => {
  const inherited =
    window.__JIESHU_INJECT?.unmountHookDepthById ??
    (window.__POWERED_BY_JIESHU__ ? window.__JIESHU?.inject.unmountHookDepthById : undefined);
  const hooks = inherited ?? new Map<string, number>();
  window.__JIESHU_INJECT = { ...window.__JIESHU_INJECT, unmountHookDepthById: hooks };
  return hooks;
};

/** Shared synchronous call depth across independently bundled core runtimes. */
export const unmountHookDepthById = resolveUnmountHooks();

const enterUnmountHook = (id: string) => {
  unmountHookDepthById.set(id, (unmountHookDepthById.get(id) ?? 0) + 1);
};

const leaveUnmountHook = (id: string) => {
  const remaining = (unmountHookDepthById.get(id) ?? 1) - 1;
  if (remaining > 0) {
    unmountHookDepthById.set(id, remaining);
  } else {
    unmountHookDepthById.delete(id);
  }
};

/** Run the synchronous entry of a child unmount hook with reentrancy metadata. */
export const runInSandboxUnmountHook = <Value>(id: string, invoke: () => Value) => {
  enterUnmountHook(id);
  try {
    return invoke();
  } finally {
    leaveUnmountHook(id);
  }
};

export function invokeSandboxUnmountHook(id: string, invoke: () => void | Promise<void>): Promise<void> {
  try {
    return Promise.resolve(runInSandboxUnmountHook(id, invoke));
  } catch (cause: unknown) {
    return Promise.reject(cause);
  }
}

/** Public destroy uses this to avoid waiting on the teardown that invoked it. */
export const isSandboxUnmountHookActive = (id: string) => unmountHookDepthById.has(id);

function resolveSandboxRegistry(): Map<string, SandboxCache> {
  const injectedRegistry = window.__JIESHU_INJECT?.idToSandboxMap;
  if (injectedRegistry) return injectedRegistry;

  const registry = window.__POWERED_BY_JIESHU__
    ? window.__JIESHU.inject.idToSandboxMap
    : new Map<string, SandboxCache>();
  window.__JIESHU_INJECT = { ...window.__JIESHU_INJECT, idToSandboxMap: registry };
  return registry;
}

export const idToSandboxCacheMap = resolveSandboxRegistry();

const resolveTeardownRegistry = () => {
  // A child core also needs host tombstones when it operates on another app;
  // sharing only live instances would let it overtake the host's old cleanup.
  const inherited =
    window.__JIESHU_INJECT?.teardownById ??
    (window.__POWERED_BY_JIESHU__ ? window.__JIESHU?.inject.teardownById : undefined);
  const registry = inherited ?? new Map<string, Promise<void>>();
  window.__JIESHU_INJECT = { ...window.__JIESHU_INJECT, teardownById: registry };
  return registry;
};

/**
 * A teardown remains discoverable after its live sandbox is synchronously
 * removed from the instance registry. This prevents a same-name replacement
 * from mounting into a container that the old teardown has yet to clear.
 */
export const sandboxTeardownById = resolveTeardownRegistry();

export function registerSandboxTeardown(id: string, teardown: Promise<void>): Promise<void> {
  let tracked!: Promise<void>;
  tracked = teardown.then(
    (): void => {
      if (sandboxTeardownById.get(id) === tracked) sandboxTeardownById.delete(id);
    },
    (cause: unknown): never => {
      if (sandboxTeardownById.get(id) === tracked) sandboxTeardownById.delete(id);
      throw cause;
    },
  );
  // Keep the rejecting completion in the registry so every concurrent public
  // destroy observes the same outcome. Attach a side observer solely to avoid
  // an unhandled rejection when no second waiter exists.
  void tracked.catch((): void => undefined);
  sandboxTeardownById.set(id, tracked);
  return tracked;
}

export function waitForSandboxTeardown(id: string): Promise<void> | undefined {
  return sandboxTeardownById.get(id);
}

function updateSandboxCache(id: string, update: SandboxCache): void {
  const current = idToSandboxCacheMap.get(id);
  idToSandboxCacheMap.set(id, current ? { ...current, ...update } : update);
}

export function getJieshuById(id: string): Jieshu | null {
  return idToSandboxCacheMap.get(id)?.jieshu || null;
}

export function getOptionsById(id: string): CacheOptions | null {
  return idToSandboxCacheMap.get(id)?.options || null;
}

export function addSandboxCacheWithJieshu(id: string, sandbox: Jieshu): void {
  updateSandboxCache(id, { jieshu: sandbox });
}

export function deleteJieshuById(id: string, expected?: Jieshu): void {
  const cached = idToSandboxCacheMap.get(id);
  // A late destroy callback belongs to one concrete sandbox. It must never
  // erase a newer same-name replacement from the shared registry.
  if (expected && cached?.jieshu !== expected) return;
  if (cached?.options) {
    idToSandboxCacheMap.set(id, { options: cached.options });
  } else {
    idToSandboxCacheMap.delete(id);
  }
}

export function addSandboxCacheWithOptions(id: string, options: CacheOptions): void {
  updateSandboxCache(id, { options });
}
