import type { DestroyHandler, StartOptions } from "./contracts";

export interface AppRuntime {
  start(options: StartOptions): Promise<DestroyHandler | void>;
  refresh(options: StartOptions): Promise<DestroyHandler | void>;
  destroy(name: string): Promise<void>;
  release(name: string): Promise<void>;
  shouldPreserveOnDisconnect?(name: string): boolean;
}

export interface AppController {
  start(options: StartOptions): Promise<DestroyHandler | void>;
  refresh(options: StartOptions): Promise<DestroyHandler | void>;
  destroy(name: string): Promise<void>;
  dispose(): void;
}

interface OwnedApplication {
  readonly name: string;
  readonly revision: number;
  runtimeStarted: boolean;
  runtimeCompleted: boolean;
  preserveOnDisconnect: boolean;
}

/**
 * Coordinates one framework component's lifecycle by intent, not by a long
 * Promise chain. Destructive operations therefore interrupt a pending fetch
 * immediately, while stale starts clean up only their own returned sandbox.
 */
export class RuntimeAppController implements AppController {
  private disposed = false;
  private revision = 0;
  private readonly pendingNames = new Map<number, string>();
  private ownedApplication?: OwnedApplication;
  private releaseBarrier?: Promise<void>;

  public constructor(private readonly runtime: AppRuntime) {}

  public start(options: StartOptions): Promise<DestroyHandler | void> {
    const snapshot = { ...options };
    const { revision, previousAppsReleased } = this.begin(snapshot.name);
    return this.startAtRevision(snapshot, revision, previousAppsReleased);
  }

  public refresh(options: StartOptions): Promise<DestroyHandler | void> {
    const snapshot = { ...options };
    const { revision, previousAppsReleased } = this.begin(snapshot.name);
    return this.refreshAtRevision(snapshot, revision, previousAppsReleased);
  }

  public destroy(name: string): Promise<void> {
    this.revision += 1;
    if (this.ownedApplication?.name === name) this.ownedApplication = undefined;
    const completion = this.destroyRuntime(name);
    this.includeRelease(completion.catch((): void => undefined));
    return completion;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;
    this.ownedApplication = undefined;

    // Completed applications remain cacheable and are handled by the custom
    // element disconnect path. Only in-flight starts need active cancellation.
    new Set(this.pendingNames.values()).forEach((name) => {
      void this.destroyRuntime(name).catch((): void => undefined);
    });
  }

  private begin(name: string): { revision: number; previousAppsReleased?: Promise<void> } {
    const revision = ++this.revision;
    const previous = this.ownedApplication;
    let previousAppsReleased = this.releaseBarrier;
    // One framework component owns one container. If its identity changes
    // from either a pending or completed application, fully release that
    // owner before the replacement may touch the container. A not-yet-started
    // intermediate intent simply inherits the existing barrier, so A -> B -> C
    // cannot let C overtake A's asynchronous cleanup. Same-name operations are
    // cancelled atomically by core's per-id intent.
    if (previous && previous.name !== name && previous.runtimeStarted) {
      const releaseOperation =
        previous.runtimeCompleted && previous.preserveOnDisconnect
          ? this.releaseRuntime(previous.name).catch(() => this.destroyRuntime(previous.name))
          : this.destroyRuntime(previous.name);
      const release = releaseOperation.catch((): void => undefined);
      previousAppsReleased = this.includeRelease(release);
    }
    this.ownedApplication = {
      name,
      revision,
      runtimeStarted: false,
      runtimeCompleted: false,
      preserveOnDisconnect: false,
    };
    return { revision, previousAppsReleased };
  }

  private destroyRuntime(name: string): Promise<void> {
    try {
      return this.runtime.destroy(name);
    } catch (cause: unknown) {
      return Promise.reject(cause);
    }
  }

  private releaseRuntime(name: string): Promise<void> {
    try {
      return this.runtime.release(name);
    } catch (cause: unknown) {
      return Promise.reject(cause);
    }
  }

  private includeRelease(release: Promise<void>): Promise<void> {
    const previous = this.releaseBarrier;
    const barrier = previous ? Promise.all([previous, release]).then((): void => undefined) : release;
    this.releaseBarrier = barrier;
    const clear = (): void => {
      if (this.releaseBarrier === barrier) this.releaseBarrier = undefined;
    };
    void barrier.then(clear, clear);
    return barrier;
  }

  private isCurrent(revision: number): boolean {
    return !this.disposed && revision === this.revision;
  }

  private async startAtRevision(
    options: StartOptions,
    revision: number,
    previousAppsReleased?: Promise<void>
  ): Promise<DestroyHandler | void> {
    if (previousAppsReleased) await previousAppsReleased;
    if (!this.isCurrent(revision)) return;

    const owner = this.ownedApplication;
    if (!owner || owner.revision !== revision) return;
    owner.runtimeStarted = true;
    owner.preserveOnDisconnect = options.alive === true;
    this.pendingNames.set(revision, options.name);
    let destroy: DestroyHandler | void;
    try {
      destroy = await this.runtime.start(options);
      if (this.ownedApplication?.revision === revision) {
        this.ownedApplication.runtimeCompleted = true;
        this.ownedApplication.preserveOnDisconnect ||= this.runtime.shouldPreserveOnDisconnect?.(options.name) === true;
      }
    } catch (cause: unknown) {
      if (this.ownedApplication?.revision === revision) this.ownedApplication.runtimeStarted = false;
      throw cause;
    } finally {
      this.pendingNames.delete(revision);
    }

    if (!this.isCurrent(revision)) {
      if (destroy) await destroy();
      return;
    }
    return destroy;
  }

  private async refreshAtRevision(
    options: StartOptions,
    revision: number,
    previousAppsReleased?: Promise<void>
  ): Promise<DestroyHandler | void> {
    if (previousAppsReleased) await previousAppsReleased;
    if (!this.isCurrent(revision)) return;

    const owner = this.ownedApplication;
    if (!owner || owner.revision !== revision) return;
    owner.runtimeStarted = true;
    owner.preserveOnDisconnect = options.alive === true;
    this.pendingNames.set(revision, options.name);
    try {
      const destroy = await this.runtime.refresh(options);
      if (this.ownedApplication?.revision === revision) {
        this.ownedApplication.runtimeCompleted = true;
        this.ownedApplication.preserveOnDisconnect ||= this.runtime.shouldPreserveOnDisconnect?.(options.name) === true;
      }
      if (!this.isCurrent(revision)) {
        if (destroy) await destroy();
        return;
      }
      return destroy;
    } catch (cause: unknown) {
      if (this.ownedApplication?.revision === revision) this.ownedApplication.runtimeStarted = false;
      throw cause;
    } finally {
      this.pendingNames.delete(revision);
    }
  }
}
