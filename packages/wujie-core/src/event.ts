import { warn, error } from "./utils";
import { WUJIE_ALL_EVENT, WUJIE_TIPS_NO_SUBJECT } from "./constant";

/**
 * EventBus does not prescribe a payload shape. The generic tuple is inferred at
 * each call site while the registry stores callbacks behind a non-callable
 * `never[]` boundary. Invocation is centralized in `invoke`, where the runtime
 * payload is deliberately applied with Reflect.
 */
export type EventCallback<Arguments extends unknown[] = never[]> = (...args: Arguments) => unknown;
type StoredEventCallback = EventCallback;

export type EventObj = Record<string, StoredEventCallback[]>;
type EventRegistry = Map<string, EventObj>;

interface EventRuntimeWindow {
  __POWERED_BY_WUJIE__?: boolean;
  __WUJIE_INJECT?: {
    appEventObjMap?: EventRegistry;
  };
  __WUJIE?: {
    inject: {
      appEventObjMap: EventRegistry;
    };
  };
}

function eraseCallbackArguments<Arguments extends unknown[]>(callback: EventCallback<Arguments>): StoredEventCallback {
  // The registry is intentionally payload-agnostic. Preserve the original
  // function identity while erasing only its compile-time argument tuple.
  return callback as unknown as StoredEventCallback;
}

function createEventRegistry(): EventRegistry {
  const runtimeWindow = window as unknown as EventRuntimeWindow;
  const inheritedRegistry = runtimeWindow.__WUJIE_INJECT?.appEventObjMap;
  if (inheritedRegistry) return inheritedRegistry;

  const registry = runtimeWindow.__POWERED_BY_WUJIE__
    ? runtimeWindow.__WUJIE!.inject.appEventObjMap
    : new Map<string, EventObj>();

  runtimeWindow.__WUJIE_INJECT = {
    ...runtimeWindow.__WUJIE_INJECT,
    appEventObjMap: registry,
  };
  return registry;
}

/** Shared across host and nested applications so an emit reaches every bus. */
export const appEventObjMap = createEventRegistry();

function invoke(callback: StoredEventCallback, args: readonly unknown[]): unknown {
  return Reflect.apply(callback, undefined, args);
}

function reportListenerError(caughtError: unknown): void {
  // utils.error historically accepts the thrown value as its sole runtime
  // argument even though its old declaration only mentions strings.
  Reflect.apply(error, undefined, [caughtError]);
}

function listenersFor(eventObj: EventObj, event: string): StoredEventCallback[] {
  return eventObj[event] ?? [];
}

/** Cross-application event hub. */
export class EventBus {
  private readonly id: string;
  private eventObj: EventObj;

  constructor(id: string) {
    this.id = id;

    // Constructing another bus with the same id intentionally replaces its
    // subscriptions. This is relied on when a sandbox is rebuilt.
    const existingEvents = appEventObjMap.get(id);
    if (existingEvents) {
      Object.keys(existingEvents).forEach((event) => delete existingEvents[event]);
      this.eventObj = existingEvents;
    } else {
      this.eventObj = {};
      appEventObjMap.set(id, this.eventObj);
    }
  }

  public $on<Arguments extends unknown[]>(event: string, callback: EventCallback<Arguments>): EventBus {
    const storedCallback = eraseCallbackArguments(callback);
    const currentListeners = this.eventObj[event];

    if (!currentListeners) {
      this.eventObj[event] = [storedCallback];
    } else if (!currentListeners.includes(storedCallback)) {
      currentListeners.push(storedCallback);
    }
    return this;
  }

  /** Listen to every emitted event; the first callback argument is its name. */
  public $onAll<Arguments extends unknown[]>(callback: EventCallback<[event: string, ...args: Arguments]>): EventBus {
    return this.$on(WUJIE_ALL_EVENT, callback);
  }

  public $once<Arguments extends unknown[]>(event: string, callback: EventCallback<Arguments>): void {
    const onceCallback: EventCallback<Arguments> = (...args: Arguments): unknown => {
      this.$off(event, onceCallback);
      return callback(...args);
    };
    this.$on(event, onceCallback);
  }

  public $off<Arguments extends unknown[]>(event: string, callback: EventCallback<Arguments>): EventBus {
    const currentListeners = this.eventObj[event];
    if (!event || !currentListeners?.length) {
      warn(`${event} ${WUJIE_TIPS_NO_SUBJECT}`);
      return this;
    }

    const storedCallback = eraseCallbackArguments(callback);
    const callbackIndex = currentListeners.lastIndexOf(storedCallback);
    if (callbackIndex >= 0) currentListeners.splice(callbackIndex, 1);
    return this;
  }

  public $offAll<Arguments extends unknown[]>(callback: EventCallback<[event: string, ...args: Arguments]>): EventBus {
    return this.$off(WUJIE_ALL_EVENT, callback);
  }

  public $emit<Arguments extends unknown[]>(event: string, ...args: Arguments): EventBus {
    const eventListeners: StoredEventCallback[] = [];
    const allEventListeners: StoredEventCallback[] = [];

    // Snapshot before invoking. Adds/removals during an emit only affect the
    // next (or a recursively triggered) emission.
    appEventObjMap.forEach((eventObj) => {
      eventListeners.push(...listenersFor(eventObj, event));
      allEventListeners.push(...listenersFor(eventObj, WUJIE_ALL_EVENT));
    });

    if (!event || (eventListeners.length === 0 && allEventListeners.length === 0)) {
      warn(`${event} ${WUJIE_TIPS_NO_SUBJECT}`);
      return this;
    }

    try {
      for (const callback of eventListeners) invoke(callback, args);
      const allArgs: readonly unknown[] = [event, ...args];
      for (const callback of allEventListeners) invoke(callback, allArgs);
    } catch (caughtError: unknown) {
      // Keep the historical fail-fast behavior: one failing listener aborts
      // the remainder of this emission, but the error never escapes $emit.
      reportListenerError(caughtError);
    }
    return this;
  }

  public $clear(): EventBus {
    Object.keys(this.eventObj).forEach((event) => delete this.eventObj[event]);
    return this;
  }

  public $destroy(): void {
    this.$clear();
    appEventObjMap.delete(this.id);
    this.eventObj = {};
  }
}
