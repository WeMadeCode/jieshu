/** A listener forwarded from a sandbox document to the host document. */
export interface DocumentListenerEntry {
  type: string;
  callback: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
}

interface WindowPropertySnapshot {
  value: unknown;
  wasOwnProperty: boolean;
}

interface WindowPropertyOverride {
  readonly owner: EventCleanupTracker;
  readonly installedValue: unknown;
  previous: WindowPropertySnapshot;
}

type DynamicWindow = Window & Record<string, unknown>;
type WindowOverrideStacks = Map<string, WindowPropertyOverride[]>;

const sharedWindowOverrides = new WeakMap<Window, WindowOverrideStacks>();

function sameListener(left: DocumentListenerEntry, right: DocumentListenerEntry): boolean {
  const leftCapture = typeof left.options === 'boolean' ? left.options : left.options?.capture === true;
  const rightCapture = typeof right.options === 'boolean' ? right.options : right.options?.capture === true;
  return left.type === right.type && left.callback === right.callback && leftCapture === rightCapture;
}

function dynamicWindow(target: Window): DynamicWindow {
  return target as DynamicWindow;
}

function snapshotWindowProperty(targetWindow: Window, key: string): WindowPropertySnapshot {
  return {
    value: Reflect.get(targetWindow, key),
    wasOwnProperty: Object.prototype.hasOwnProperty.call(targetWindow, key),
  };
}

function restoreWindowProperty(targetWindow: Window, key: string, snapshot: WindowPropertySnapshot): void {
  const target = dynamicWindow(targetWindow);
  // Assignment is required for native on* accessors: it invokes their setter
  // and restores the browser's internal handler slot.
  target[key] = snapshot.value;
  if (!snapshot.wasOwnProperty) delete target[key];
}

function windowOverrideStacks(targetWindow: Window): WindowOverrideStacks {
  let stacks = sharedWindowOverrides.get(targetWindow);
  if (!stacks) {
    stacks = new Map();
    sharedWindowOverrides.set(targetWindow, stacks);
  }
  return stacks;
}

/**
 * Records effects that a sandbox forwards to host-owned objects. The tracker is
 * intentionally independent from Wujie so cleanup remains usable while the
 * sandbox itself is being torn down.
 */
export class EventCleanupTracker {
  private readonly mainDocumentListeners = new Set<DocumentListenerEntry>();
  private readonly windowProperties = new Map<Window, Set<string>>();

  public trackMainDocumentListener(entry: DocumentListenerEntry): void {
    if (!Array.from(this.mainDocumentListeners).some((candidate) => sameListener(candidate, entry))) {
      this.mainDocumentListeners.add(entry);
    }
  }

  public untrackMainDocumentListener(entry: DocumentListenerEntry): void {
    const trackedEntry = Array.from(this.mainDocumentListeners).find((candidate) => sameListener(candidate, entry));
    if (trackedEntry) this.mainDocumentListeners.delete(trackedEntry);
  }

  /** Install a host window on* value while preserving cross-sandbox ownership. */
  public setWindowOnEvent(targetWindow: Window, key: string, installedValue: unknown): void {
    const stacks = windowOverrideStacks(targetWindow);
    const stack = stacks.get(key) ?? [];
    const existingIndex = stack.findIndex((entry) => entry.owner === this);
    const existing = existingIndex === -1 ? undefined : stack[existingIndex];
    const isExistingTop = existingIndex === stack.length - 1;
    const currentValue = Reflect.get(targetWindow, key);
    const previous =
      existing && isExistingTop && Object.is(currentValue, existing.installedValue)
        ? existing.previous
        : snapshotWindowProperty(targetWindow, key);

    if (!Reflect.set(targetWindow, key, installedValue)) return;

    if (existing) {
      stack.splice(existingIndex, 1);
      // Removing a layer from the middle must let its successor restore the
      // value that existed before the removed owner, never that owner's bound
      // iframe handler.
      const successor = stack[existingIndex];
      if (successor) successor.previous = existing.previous;
    }
    stack.push({ owner: this, installedValue, previous });
    stacks.set(key, stack);

    let keys = this.windowProperties.get(targetWindow);
    if (!keys) {
      keys = new Set();
      this.windowProperties.set(targetWindow, keys);
    }
    keys.add(key);
  }

  public cleanupMainDocumentListeners(targetDocument: Document = window.document): void {
    for (const { type, callback, options } of this.mainDocumentListeners) {
      try {
        targetDocument.removeEventListener(type, callback, options);
      } catch {
        // Cleanup is best-effort; one hostile listener must not block the rest.
      }
    }
    this.mainDocumentListeners.clear();
  }

  public cleanupWindowOnEventOverrides(targetWindow: Window = window): void {
    const keys = this.windowProperties.get(targetWindow);
    const stacks = sharedWindowOverrides.get(targetWindow);
    if (!keys || !stacks) return;

    keys.forEach((key) => {
      const stack = stacks.get(key);
      if (!stack) return;
      const ownerIndex = stack.findIndex((entry) => entry.owner === this);
      if (ownerIndex === -1) return;
      const override = stack[ownerIndex];
      const wasTop = ownerIndex === stack.length - 1;
      let ownsCurrentValue = false;
      try {
        ownsCurrentValue = Object.is(Reflect.get(targetWindow, key), override.installedValue);
      } catch {
        // A hostile getter means ownership cannot be proven; never overwrite it.
      }

      stack.splice(ownerIndex, 1);
      const successor = stack[ownerIndex];
      if (successor) successor.previous = override.previous;

      if (wasTop && ownsCurrentValue) {
        try {
          restoreWindowProperty(targetWindow, key, override.previous);
        } catch {
          // Continue restoring other properties.
        }
      }

      if (stack.length) stacks.set(key, stack);
      else stacks.delete(key);
    });

    this.windowProperties.delete(targetWindow);
    if (!stacks.size) sharedWindowOverrides.delete(targetWindow);
  }

  public cleanupAll(targetWindow: Window = window): void {
    this.cleanupMainDocumentListeners(targetWindow.document);
    this.cleanupWindowOnEventOverrides(targetWindow);
  }
}
