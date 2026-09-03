export type SandboxLifecycleState = 'created' | 'active' | 'mounted' | 'inactive' | 'destroying' | 'destroyed';

type Cleanup = () => void;
type ScheduledTask = () => unknown;
export type SandboxDynamicResourceCancellationReason = 'unmount' | 'destroy';

type PromiseOutcome<Value> = { status: 'fulfilled'; value: Value } | { status: 'rejected'; reason: unknown };

function observe<Value>(promise: Promise<Value>): Promise<PromiseOutcome<Value>> {
  return promise.then<PromiseOutcome<Value>, PromiseOutcome<Value>>(
    (value): PromiseOutcome<Value> => ({ status: 'fulfilled', value }),
    (reason: unknown): PromiseOutcome<Value> => ({ status: 'rejected', reason }),
  );
}

export interface OrderedPromiseHandlers<Value> {
  fulfilled(value: Value): void;
  rejected(reason: unknown): void;
  cancelled?(reason: SandboxDynamicResourceCancellationReason): void;
}

interface SequenceEntry {
  cancel(reason: SandboxDynamicResourceCancellationReason): void;
}

/**
 * Serializes promise continuations without coupling unrelated owners.
 *
 * The promise itself may represent a network request that cannot be aborted.
 * Cancelling the sequence nevertheless settles its ordering barrier immediately,
 * releases queued resources, and prevents late results from reaching callbacks.
 */
export class SandboxPromiseSequence {
  private revision = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly entries = new Set<SequenceEntry>();

  public enqueue<Value>(promise: Promise<Value>, handlers: OrderedPromiseHandlers<Value>): void {
    const revision = this.revision;
    const outcome = observe(promise);
    let resolveCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    let pending = true;
    let entry!: SequenceEntry;

    const finish = (): void => {
      if (!pending) return;
      pending = false;
      this.entries.delete(entry);
    };
    entry = {
      cancel: (reason): void => {
        if (!pending) return;
        finish();
        try {
          handlers.cancelled?.(reason);
        } catch {
          // Cancellation is best-effort; one hostile callback must not retain
          // the rest of the sequence behind an obsolete resource.
        } finally {
          resolveCancellation();
        }
      },
    };
    this.entries.add(entry);

    const execute = async (): Promise<void> => {
      if (revision !== this.revision || !pending) {
        entry.cancel('destroy');
        return;
      }

      const result = await Promise.race([
        outcome.then((value) => ({ kind: 'outcome' as const, value })),
        cancellation.then(() => ({ kind: 'cancelled' as const })),
      ]);
      if (result.kind === 'cancelled' || revision !== this.revision || !pending) return;

      try {
        if (result.value.status === 'fulfilled') handlers.fulfilled(result.value.value);
        else handlers.rejected(result.value.reason);
      } finally {
        finish();
      }
    };

    const completion = this.tail.then(execute);
    // A callback failure belongs to that resource only; it must not poison the
    // ordering tail and block all later dynamic scripts from this sandbox.
    this.tail = completion.catch(() => undefined);
  }

  public cancel(reason: SandboxDynamicResourceCancellationReason = 'destroy'): void {
    this.revision += 1;
    const entries = [...this.entries];
    this.entries.clear();
    entries.forEach((entry) => entry.cancel(reason));
    // New work belongs to a fresh lifecycle generation and must not wait for
    // an old request whose underlying promise may never settle.
    this.tail = Promise.resolve();
  }
}

const dynamicScriptSequences = new WeakMap<object, SandboxPromiseSequence>();
type DynamicResourceCancellation = (reason: SandboxDynamicResourceCancellationReason) => void;
const dynamicResourceCancellations = new WeakMap<object, Set<DynamicResourceCancellation>>();

/** @internal Dynamic scripts are ordered per concrete sandbox instance. */
export function scheduleSandboxDynamicScript<Value>(
  sandbox: object,
  promise: Promise<Value>,
  handlers: OrderedPromiseHandlers<Value>,
): void {
  let sequence = dynamicScriptSequences.get(sandbox);
  if (!sequence) {
    sequence = new SandboxPromiseSequence();
    dynamicScriptSequences.set(sandbox, sequence);
  }
  sequence.enqueue(promise, handlers);
}

/** Register a pending dynamic DOM resource in one concrete sandbox generation. */
export function registerSandboxDynamicResource(sandbox: object, cancellation: DynamicResourceCancellation): () => void {
  let cancellations = dynamicResourceCancellations.get(sandbox);
  if (!cancellations) {
    cancellations = new Set();
    dynamicResourceCancellations.set(sandbox, cancellations);
  }
  cancellations.add(cancellation);
  return (): void => {
    const activeCancellations = dynamicResourceCancellations.get(sandbox);
    activeCancellations?.delete(cancellation);
    if (activeCancellations && !activeCancellations.size) dynamicResourceCancellations.delete(sandbox);
  };
}

/** @internal Release one sandbox's complete pending dynamic-resource generation. */
export function cancelSandboxDynamicResources(
  sandbox: object,
  reason: SandboxDynamicResourceCancellationReason = 'destroy',
): void {
  const sequence = dynamicScriptSequences.get(sandbox);
  if (sequence) {
    dynamicScriptSequences.delete(sandbox);
    sequence.cancel(reason);
  }

  const cancellations = dynamicResourceCancellations.get(sandbox);
  if (!cancellations) return;
  dynamicResourceCancellations.delete(sandbox);
  [...cancellations].forEach((cancellation) => {
    try {
      cancellation(reason);
    } catch {
      // One hostile DOM event handler must not retain the remaining resources.
    }
  });
}

/** @internal Backward-compatible name retained for direct internal consumers. */
export function cancelSandboxDynamicScripts(
  sandbox: object,
  reason: SandboxDynamicResourceCancellationReason = 'destroy',
): void {
  cancelSandboxDynamicResources(sandbox, reason);
}

/**
 * Keeps lifecycle state transitions in one place. Public Wujie flags remain the
 * compatibility surface; this state is used to make teardown transitions
 * explicit and independently testable.
 */
export class SandboxLifecycleController {
  private state: SandboxLifecycleState = 'created';

  public getCurrent(): SandboxLifecycleState {
    return this.state;
  }

  public activate(): boolean {
    if (this.state === 'destroying' || this.state === 'destroyed') return false;
    this.state = 'active';
    return true;
  }

  public mount(): boolean {
    if (this.state !== 'active' && this.state !== 'inactive') return false;
    this.state = 'mounted';
    return true;
  }

  public deactivate(): boolean {
    if (this.state === 'destroying' || this.state === 'destroyed') return false;
    this.state = 'inactive';
    return true;
  }

  public beginDestroy(): boolean {
    if (this.state === 'destroying' || this.state === 'destroyed') return false;
    this.state = 'destroying';
    return true;
  }

  public finishDestroy(): void {
    this.state = 'destroyed';
  }
}

/**
 * Ordered, best-effort teardown registry. One hostile DOM implementation or
 * user-owned hook must not prevent unrelated resources from being released.
 */
export class SandboxCleanupRegistry {
  private readonly cleanups: Cleanup[] = [];

  public register(cleanup: Cleanup): this {
    this.cleanups.push(cleanup);
    return this;
  }

  public cleanupAll(): void {
    this.cleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        // Teardown is intentionally best-effort so later resources are released.
      }
    });
    this.cleanups.length = 0;
  }
}

/**
 * Serial script scheduler backed by Wujie's public execQueue. Injected scripts
 * still advance that array themselves, while queue construction and fiber
 * scheduling are centralized here.
 */
export class SandboxScriptScheduler {
  private cancelled = false;
  private completeRun?: () => void;
  private failRun?: (cause: unknown) => void;
  private resolveStopped!: () => void;
  public readonly stopped = new Promise<void>((resolve) => {
    this.resolveStopped = resolve;
  });

  constructor(
    private readonly queue: ScheduledTask[],
    private readonly fiber: boolean,
    private readonly scheduleIdle: (task: ScheduledTask) => unknown,
    private readonly canExecute: () => boolean = () => true,
  ) {}

  public schedule(task: ScheduledTask): void {
    if (this.cancelled) return;
    this.queue.push(() => this.executeQueued(task));
  }

  public scheduleAfter<Value>(promise: Promise<Value>, task: (value: Value) => unknown): void {
    if (this.cancelled) return;
    // Attach both handlers immediately. A script request may reject while it
    // is waiting behind an earlier script; observing it now prevents a stray
    // unhandled-rejection event, and advancing on failure keeps the queue live.
    const outcome = observe(promise);
    this.queue.push(() =>
      outcome.then((result) =>
        result.status === 'fulfilled' ? this.executeQueued(() => task(result.value)) : this.advance(),
      ),
    );
  }

  public executeAfter<Value>(promise: Promise<Value>, task: (value: Value) => unknown): void {
    if (this.cancelled) return;
    observe(promise).then((result) => {
      if (result.status === 'fulfilled' && this.canExecute()) this.execute(() => task(result.value));
    });
  }

  public advance(): void {
    if (this.cancelled) return;
    this.queue.shift()?.();
  }

  public run(): Promise<void> {
    if (this.cancelled) return Promise.resolve();
    const completion = new Promise<void>((resolve, reject) => {
      this.completeRun = resolve;
      this.failRun = reject;
      this.queue.push(() => {
        this.completeRun = undefined;
        this.failRun = undefined;
        resolve();
        this.advance();
      });
    });
    this.advance();
    return completion;
  }

  /** Settle a pending run even when an inserted native script never loads. */
  public cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.queue.length = 0;
    const complete = this.completeRun;
    this.completeRun = undefined;
    this.failRun = undefined;
    this.resolveStopped();
    complete?.();
  }

  private fail(cause: unknown): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.queue.length = 0;
    const reject = this.failRun;
    this.completeRun = undefined;
    this.failRun = undefined;
    this.resolveStopped();
    reject?.(cause);
  }

  private executeTask(task: ScheduledTask): unknown {
    try {
      const result = task();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch((cause: unknown) => this.fail(cause));
      }
      return result;
    } catch (cause: unknown) {
      this.fail(cause);
      return undefined;
    }
  }

  private execute(task: ScheduledTask): unknown {
    if (this.cancelled) return undefined;
    if (!this.fiber) return this.canExecute() ? this.executeTask(task) : undefined;
    return this.scheduleIdle(() => {
      if (!this.cancelled && this.canExecute()) this.executeTask(task);
    });
  }

  private executeQueued(task: ScheduledTask): unknown {
    if (this.cancelled) return undefined;
    if (!this.canExecute()) return this.advance();
    if (!this.fiber) return this.executeTask(task);
    return this.scheduleIdle(() => {
      if (this.cancelled) return;
      if (this.canExecute()) this.executeTask(task);
      else this.advance();
    });
  }
}

export interface ScriptGroups<Script extends { async?: boolean; defer?: boolean }> {
  sync: Script[];
  async: Script[];
  defer: Script[];
}

export function groupScripts<Script extends { async?: boolean; defer?: boolean }>(
  scripts: Script[],
): ScriptGroups<Script> {
  return scripts.reduce<ScriptGroups<Script>>(
    (groups, script) => {
      // HTML gives async precedence when both boolean attributes exist; defer
      // is ignored for classic and module scripts in that case.
      if (script.async) groups.async.push(script);
      else if (script.defer) groups.defer.push(script);
      else groups.sync.push(script);
      return groups;
    },
    { sync: [], async: [], defer: [] },
  );
}
