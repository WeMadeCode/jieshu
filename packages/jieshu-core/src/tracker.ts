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
  readonly installed: WindowPropertySnapshot;
  previous: WindowPropertySnapshot;
}

type WindowOverrideStacks = Map<string, WindowPropertyOverride[]>;

// All core copies touching the same window must use the same protocol and stack,
// including copies loaded in another same-origin realm.
const windowOverridesKey = Symbol.for('jieshu.window-event-overrides.v1');

declare global {
  interface Window {
    [windowOverridesKey]?: WindowOverrideStacks;
  }
}

function sameListener(left: DocumentListenerEntry, right: DocumentListenerEntry): boolean {
  const leftCapture = typeof left.options === 'boolean' ? left.options : left.options?.capture === true;
  const rightCapture = typeof right.options === 'boolean' ? right.options : right.options?.capture === true;
  return left.type === right.type && left.callback === right.callback && leftCapture === rightCapture;
}

const snapshotWindowProperty = (targetWindow: Window, key: string) => {
  const value: unknown = Reflect.get(targetWindow, key);
  return {
    value,
    wasOwnProperty: Reflect.getOwnPropertyDescriptor(targetWindow, key) !== undefined,
  };
};

const sameWindowProperty = (left: WindowPropertySnapshot, right: WindowPropertySnapshot) => {
  return Object.is(left.value, right.value) && left.wasOwnProperty === right.wasOwnProperty;
};

const restoreWindowProperty = (targetWindow: Window, key: string, snapshot: WindowPropertySnapshot) => {
  // Assignment is required for native on* accessors: it invokes their setter
  // and restores the browser's internal handler slot.
  if (!Reflect.set(targetWindow, key, snapshot.value)) {
    return;
  }
  if (!snapshot.wasOwnProperty) {
    Reflect.deleteProperty(targetWindow, key);
  }
};

const windowOverrideStacks = (targetWindow: Window) => {
  let stacks = targetWindow[windowOverridesKey];
  if (!stacks) {
    stacks = new Map();
    Object.defineProperty(targetWindow, windowOverridesKey, { configurable: true, value: stacks });
  }
  return stacks;
};

const releaseEmptyWindowOverrideStacks = (targetWindow: Window, stacks: WindowOverrideStacks) => {
  if (!stacks.size && targetWindow[windowOverridesKey] === stacks) {
    Reflect.deleteProperty(targetWindow, windowOverridesKey);
  }
};

/**
 * Records effects that a sandbox forwards to host-owned objects. The tracker is
 * intentionally independent from Jieshu so cleanup remains usable while the
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
  public setWindowOnEvent = (targetWindow: Window, key: string, installedValue: unknown) => {
    const current = snapshotWindowProperty(targetWindow, key);
    const stacks = windowOverrideStacks(targetWindow);
    let stack = stacks.get(key) ?? [];
    const top = stack[stack.length - 1];
    if (top && !sameWindowProperty(current, top.installed)) {
      // The host took ownership since the last tracked write. Older layers can
      // no longer be restored; the host's current value becomes the new base.
      stack = [];
    }
    const existingIndex = stack.findIndex((entry) => entry.owner === this);
    const existing = existingIndex === -1 ? undefined : stack[existingIndex];
    const isExistingTop = existingIndex === stack.length - 1;
    const previous = existing && isExistingTop ? existing.previous : current;

    let installed: WindowPropertySnapshot;
    try {
      if (!Reflect.set(targetWindow, key, installedValue)) {
        releaseEmptyWindowOverrideStacks(targetWindow, stacks);
        return;
      }
      // Native on* setters can normalize values (for example, a number to null).
      installed = snapshotWindowProperty(targetWindow, key);
    } catch (error) {
      releaseEmptyWindowOverrideStacks(targetWindow, stacks);
      throw error;
    }

    if (existing) {
      stack.splice(existingIndex, 1);
      // Removing a layer from the middle must let its successor restore the
      // value that existed before the removed owner, never that owner's bound
      // iframe handler.
      const successor = stack[existingIndex];
      if (successor) {
        successor.previous = existing.previous;
      }
    }
    stack.push({ owner: this, installed, previous });
    stacks.set(key, stack);

    let keys = this.windowProperties.get(targetWindow);
    if (!keys) {
      keys = new Set();
      this.windowProperties.set(targetWindow, keys);
    }
    keys.add(key);
  };

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

  public cleanupWindowOnEventOverrides = (targetWindow: Window = window) => {
    const keys = this.windowProperties.get(targetWindow);
    const stacks = targetWindow[windowOverridesKey];
    if (!keys || !stacks) {
      this.windowProperties.delete(targetWindow);
      return;
    }

    keys.forEach((key) => {
      const stack = stacks.get(key);
      if (!stack) {
        return;
      }
      const ownerIndex = stack.findIndex((entry) => entry.owner === this);
      if (ownerIndex === -1) {
        return;
      }
      const override = stack[ownerIndex];
      const wasTop = ownerIndex === stack.length - 1;
      let ownsCurrentValue = false;
      try {
        ownsCurrentValue = sameWindowProperty(snapshotWindowProperty(targetWindow, key), override.installed);
      } catch {
        // A hostile getter means ownership cannot be proven; never overwrite it.
      }

      stack.splice(ownerIndex, 1);
      const successor = stack[ownerIndex];
      if (successor) {
        successor.previous = override.previous;
      }

      if (wasTop && ownsCurrentValue) {
        try {
          restoreWindowProperty(targetWindow, key, override.previous);
        } catch {
          // Continue restoring other properties.
        }
      }

      if (stack.length) {
        stacks.set(key, stack);
      } else {
        stacks.delete(key);
      }
    });

    this.windowProperties.delete(targetWindow);
    releaseEmptyWindowOverrideStacks(targetWindow, stacks);
  };

  public cleanupAll(targetWindow: Window = window): void {
    this.cleanupMainDocumentListeners(targetWindow.document);
    this.cleanupWindowOnEventOverrides(targetWindow);
  }
}
