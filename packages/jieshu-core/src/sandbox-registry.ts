import type Jieshu from './sandbox';
import type { CacheOptions } from './contracts';

export interface SandboxCache {
  jieshu?: Jieshu;
  options?: CacheOptions;
}

export type SandboxTeardownRegistry = Map<string, Promise<void>>;

const activeUnmountHooks = new Map<string, number>();

function enterUnmountHook(id: string): void {
  activeUnmountHooks.set(id, (activeUnmountHooks.get(id) ?? 0) + 1);
}

function leaveUnmountHook(id: string): void {
  const remaining = (activeUnmountHooks.get(id) ?? 1) - 1;
  if (remaining > 0) activeUnmountHooks.set(id, remaining);
  else activeUnmountHooks.delete(id);
}

/** Run the synchronous entry of a child unmount hook with reentrancy metadata. */
export function runInSandboxUnmountHook<Value>(id: string, invoke: () => Value): Value {
  enterUnmountHook(id);
  try {
    return invoke();
  } finally {
    leaveUnmountHook(id);
  }
}

export function invokeSandboxUnmountHook(id: string, invoke: () => void | Promise<void>): Promise<void> {
  try {
    return Promise.resolve(runInSandboxUnmountHook(id, invoke));
  } catch (cause: unknown) {
    return Promise.reject(cause);
  }
}

/** Public destroy uses this to avoid waiting on the teardown that invoked it. */
export function isSandboxUnmountHookActive(id: string): boolean {
  return activeUnmountHooks.has(id);
}

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

function resolveTeardownRegistry(): SandboxTeardownRegistry {
  const injectedRegistry = window.__JIESHU_INJECT?.teardownById;
  if (injectedRegistry) return injectedRegistry;

  const registry = new Map<string, Promise<void>>();
  window.__JIESHU_INJECT = { ...window.__JIESHU_INJECT, teardownById: registry } as Window['__JIESHU_INJECT'];
  return registry;
}

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
