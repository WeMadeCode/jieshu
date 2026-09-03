export interface OperationIntent {
  readonly id: string;
  readonly revision: number;
  readonly cancelled: Promise<void>;
}

interface OperationSlot {
  readonly revision: number;
  readonly cancelled: Promise<void>;
  readonly cancel: () => void;
}

export type OperationSlots = Record<string, OperationSlot>;

interface IntentRuntimeWindow {
  __POWERED_BY_JIESHU__?: boolean;
  __JIESHU_CORE_INTENTS?: OperationSlots;
  __JIESHU_INJECT?: { coreOperationSlots?: OperationSlots };
  __JIESHU?: { inject?: { coreOperationSlots?: OperationSlots } };
}

declare global {
  interface Window {
    /** Shared by independently bundled core/adaptor runtimes on one page. */
    __JIESHU_CORE_INTENTS?: OperationSlots;
  }
}

function sharedSlots(): OperationSlots {
  const runtimeWindow = window as unknown as IntentRuntimeWindow;
  const slots =
    runtimeWindow.__JIESHU_INJECT?.coreOperationSlots ??
    (runtimeWindow.__POWERED_BY_JIESHU__ ? runtimeWindow.__JIESHU?.inject?.coreOperationSlots : undefined) ??
    runtimeWindow.__JIESHU_CORE_INTENTS ??
    (Object.create(null) as OperationSlots);
  runtimeWindow.__JIESHU_CORE_INTENTS = slots;
  runtimeWindow.__JIESHU_INJECT = { ...runtimeWindow.__JIESHU_INJECT, coreOperationSlots: slots };
  return slots;
}

function createSlot(revision: number): OperationSlot {
  let cancel!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    cancel = resolve;
  });
  return { revision, cancelled, cancel };
}

function asIntent(id: string, slot: OperationSlot): OperationIntent {
  return { id, revision: slot.revision, cancelled: slot.cancelled };
}

/** Mark a public operation as the newest intent for one application id. */
export function beginOperation(id: string): OperationIntent {
  const slots = sharedSlots();
  const previous = slots[id];
  previous?.cancel();
  const slot = createSlot((previous?.revision ?? 0) + 1);
  slots[id] = slot;
  return asIntent(id, slot);
}

/** Observe the current intent without superseding it (used by idle preload). */
export function observeOperation(id: string): OperationIntent {
  const slots = sharedSlots();
  const slot = (slots[id] ||= createSlot(0));
  return asIntent(id, slot);
}

export function isOperationCurrent(intent: OperationIntent): boolean {
  const slot = sharedSlots()[intent.id];
  return Boolean(slot && slot.revision === intent.revision && slot.cancelled === intent.cancelled);
}
