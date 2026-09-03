export type { SandboxCache, SandboxTeardownRegistry } from './sandbox-registry';
export {
  idToSandboxCacheMap,
  sandboxTeardownById,
  getJieshuById,
  getOptionsById,
  addSandboxCacheWithJieshu,
  deleteJieshuById,
  addSandboxCacheWithOptions,
  registerSandboxTeardown,
  waitForSandboxTeardown,
  runInSandboxUnmountHook,
  invokeSandboxUnmountHook,
  isSandboxUnmountHookActive,
} from './sandbox-registry';

export {
  documentProxyProperties,
  appDocumentAddEventListenerEvents,
  appDocumentOnEvents,
  mainDocumentAddEventListenerEvents,
  mainAndAppAddEventListenerEvents,
  appWindowAddEventListenerEvents,
  appWindowOnEvent,
  relativeElementTagAttrMap,
  windowProxyProperties,
  windowRegWhiteList,
} from './sandbox-policy';

export {
  rawElementAppendChild,
  rawElementRemoveChild,
  rawElementContains,
  rawHeadInsertBefore,
  rawBodyInsertBefore,
  rawInsertAdjacentElement,
  rawAddEventListener,
  rawRemoveEventListener,
  rawWindowAddEventListener,
  rawWindowRemoveEventListener,
  rawAppendChild,
  rawDocumentQuerySelector,
} from './native-dom';

export type appAddEventListenerOptions = AddEventListenerOptions & { targetWindow?: Window };
