import {
  cancelSandboxDynamicResources,
  cancelSandboxDynamicScripts,
  groupScripts,
  registerSandboxDynamicResource,
  scheduleSandboxDynamicScript,
  SandboxCleanupRegistry,
  SandboxLifecycleController,
  SandboxPromiseSequence,
  SandboxScriptScheduler,
} from "../../src/sandbox-runtime";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe("SandboxPromiseSequence", () => {
  test("preserves promise continuation order within one sandbox", async () => {
    const first = deferred<string>();
    const calls: string[] = [];
    const sequence = new SandboxPromiseSequence();

    sequence.enqueue(first.promise, {
      fulfilled: (value) => calls.push(value),
      rejected: () => undefined,
    });
    sequence.enqueue(Promise.resolve("second"), {
      fulfilled: (value) => calls.push(value),
      rejected: () => undefined,
    });

    await flushPromises();
    expect(calls).toEqual([]);

    first.resolve("first");
    await flushPromises();
    expect(calls).toEqual(["first", "second"]);
  });

  test("isolates sandboxes and resets a cancelled generation without waiting for stale work", async () => {
    const staleRequest = deferred<string>();
    const ownerA = {};
    const ownerB = {};
    const calls: string[] = [];
    const cancelled = jest.fn();

    scheduleSandboxDynamicScript(ownerA, staleRequest.promise, {
      fulfilled: (value) => calls.push(value),
      rejected: () => undefined,
      cancelled,
    });
    scheduleSandboxDynamicScript(ownerA, Promise.resolve("queued-a"), {
      fulfilled: (value) => calls.push(value),
      rejected: () => undefined,
      cancelled,
    });
    scheduleSandboxDynamicScript(ownerB, Promise.resolve("ready-b"), {
      fulfilled: (value) => calls.push(value),
      rejected: () => undefined,
    });

    await flushPromises();
    expect(calls).toEqual(["ready-b"]);

    cancelSandboxDynamicScripts(ownerA);
    scheduleSandboxDynamicScript(ownerA, Promise.resolve("replacement-a"), {
      fulfilled: (value) => calls.push(value),
      rejected: () => undefined,
    });
    await flushPromises();

    expect(cancelled).toHaveBeenCalledTimes(2);
    expect(cancelled).toHaveBeenNthCalledWith(1, "destroy");
    expect(cancelled).toHaveBeenNthCalledWith(2, "destroy");
    expect(calls).toEqual(["ready-b", "replacement-a"]);

    staleRequest.resolve("stale-a");
    await flushPromises();
    expect(calls).toEqual(["ready-b", "replacement-a"]);
  });

  test("notifies registered resources on unmount and allows completed resources to unregister", () => {
    const owner = {};
    const pending = jest.fn();
    const completed = jest.fn();
    registerSandboxDynamicResource(owner, pending);
    const unregister = registerSandboxDynamicResource(owner, completed);
    unregister();

    cancelSandboxDynamicResources(owner, "unmount");

    expect(pending).toHaveBeenCalledWith("unmount");
    expect(completed).not.toHaveBeenCalled();
  });
});

describe("SandboxLifecycleController", () => {
  test("records activation, mount, deactivation and destruction transitions", () => {
    const lifecycle = new SandboxLifecycleController();

    expect(lifecycle.getCurrent()).toBe("created");
    expect(lifecycle.activate()).toBe(true);
    expect(lifecycle.mount()).toBe(true);
    expect(lifecycle.deactivate()).toBe(true);
    expect(lifecycle.beginDestroy()).toBe(true);
    lifecycle.finishDestroy();

    expect(lifecycle.getCurrent()).toBe("destroyed");
  });

  test("destroying and destroyed sandboxes cannot be reactivated", () => {
    const lifecycle = new SandboxLifecycleController();

    expect(lifecycle.beginDestroy()).toBe(true);
    expect(lifecycle.beginDestroy()).toBe(false);
    expect(lifecycle.activate()).toBe(false);
    expect(lifecycle.deactivate()).toBe(false);
    lifecycle.finishDestroy();
    expect(lifecycle.activate()).toBe(false);
  });
});

describe("SandboxCleanupRegistry", () => {
  test("runs all resources in registration order and is idempotent", () => {
    const order: string[] = [];
    const cleanup = new SandboxCleanupRegistry()
      .register(() => order.push("styles"))
      .register(() => {
        order.push("hostile-resource");
        throw new Error("cleanup failed");
      })
      .register(() => order.push("iframe"));

    expect(() => cleanup.cleanupAll()).not.toThrow();
    cleanup.cleanupAll();

    expect(order).toEqual(["styles", "hostile-resource", "iframe"]);
  });
});

describe("SandboxScriptScheduler", () => {
  test("registers completion before starting a synchronously self-advancing queue", async () => {
    const queue: Array<() => unknown> = [];
    const order: string[] = [];
    const scheduler = new SandboxScriptScheduler(queue, false, (task) => task());

    scheduler.schedule(() => {
      order.push("first");
      scheduler.advance();
    });
    scheduler.schedule(() => {
      order.push("second");
      scheduler.advance();
    });

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(order).toEqual(["first", "second"]);
    expect(queue).toHaveLength(0);
  });

  test("cancels pending work after destruction and still drains the serial queue", async () => {
    const queue: Array<() => unknown> = [];
    const executed = jest.fn();
    let active = false;
    const scheduler = new SandboxScriptScheduler(
      queue,
      false,
      (task) => task(),
      () => active
    );

    scheduler.schedule(executed);

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(executed).not.toHaveBeenCalled();
    expect(queue).toHaveLength(0);
  });

  test("explicit cancellation settles a run blocked by a native external script", async () => {
    const queue: Array<() => unknown> = [];
    const scheduler = new SandboxScriptScheduler(queue, false, (task) => task());

    scheduler.schedule(() => undefined);
    const completion = scheduler.run();
    scheduler.cancel();

    await expect(completion).resolves.toBeUndefined();
    expect(queue).toHaveLength(0);
  });

  test("rejects the run when a later queued task throws", async () => {
    const queue: Array<() => unknown> = [];
    const failure = new Error("mount failed");
    const scheduler = new SandboxScriptScheduler(queue, false, (task) => task());

    scheduler.schedule(() => scheduler.advance());
    scheduler.schedule(() => {
      throw failure;
    });

    await expect(scheduler.run()).rejects.toBe(failure);
    expect(queue).toHaveLength(0);
  });

  test("rechecks cancellation when fiber work leaves the idle queue", async () => {
    const queue: Array<() => unknown> = [];
    const idleQueue: Array<() => unknown> = [];
    const executed = jest.fn();
    let active = true;
    const scheduler = new SandboxScriptScheduler(
      queue,
      true,
      (task) => idleQueue.push(task),
      () => active
    );

    scheduler.schedule(executed);
    const completion = scheduler.run();
    active = false;
    idleQueue.shift()?.();

    await expect(completion).resolves.toBeUndefined();
    expect(executed).not.toHaveBeenCalled();
  });

  test("cancel prevents already-dispatched fiber work from running", async () => {
    const queue: Array<() => unknown> = [];
    const idleQueue: Array<() => unknown> = [];
    const executed = jest.fn();
    const scheduler = new SandboxScriptScheduler(queue, true, (task) => idleQueue.push(task));

    scheduler.schedule(executed);
    const completion = scheduler.run();
    expect(idleQueue).toHaveLength(1);

    scheduler.cancel();
    idleQueue.shift()?.();

    await expect(completion).resolves.toBeUndefined();
    expect(executed).not.toHaveBeenCalled();
    expect(queue).toHaveLength(0);
  });

  test("advances past a rejected serial script without executing it", async () => {
    const queue: Array<() => unknown> = [];
    const executed = jest.fn();
    const scheduler = new SandboxScriptScheduler(queue, false, (task) => task());
    const afterFailure = jest.fn(() => scheduler.advance());

    scheduler.scheduleAfter(Promise.reject(new Error("network failed")), executed);
    scheduler.schedule(afterFailure);

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(executed).not.toHaveBeenCalled();
    expect(afterFailure).toHaveBeenCalledTimes(1);
    expect(queue).toHaveLength(0);
  });

  test("observes a rejected async script and does not execute it", async () => {
    const queue: Array<() => unknown> = [];
    const executed = jest.fn();
    const scheduler = new SandboxScriptScheduler(queue, false, (task) => task());

    scheduler.executeAfter(Promise.reject(new Error("network failed")), executed);
    await Promise.resolve();
    await Promise.resolve();

    expect(executed).not.toHaveBeenCalled();
  });

  test("rechecks cancellation before detached fiber work executes", async () => {
    const queue: Array<() => unknown> = [];
    const idleQueue: Array<() => unknown> = [];
    const executed = jest.fn();
    let active = true;
    const scheduler = new SandboxScriptScheduler(
      queue,
      true,
      (task) => idleQueue.push(task),
      () => active
    );

    scheduler.executeAfter(Promise.resolve("async"), executed);
    await Promise.resolve();
    await Promise.resolve();
    expect(idleQueue).toHaveLength(1);

    active = false;
    idleQueue.shift()?.();
    expect(executed).not.toHaveBeenCalled();
  });

  test("a detached async task cannot revive after a later activation revision", async () => {
    const queue: Array<() => unknown> = [];
    const pending = deferred<string>();
    const executed = jest.fn();
    let active = true;
    let revision = 1;
    const ownedRevision = revision;
    const scheduler = new SandboxScriptScheduler(
      queue,
      false,
      (task) => task(),
      () => active && revision === ownedRevision
    );

    scheduler.executeAfter(pending.promise, executed);
    await scheduler.run();
    active = false;
    revision += 1;
    active = true;
    revision += 1;
    pending.resolve("stale");
    await Promise.resolve();
    await Promise.resolve();

    expect(executed).not.toHaveBeenCalled();
  });

  test("groups async ahead of defer when both attributes are present", () => {
    interface TestScript {
      name: string;
      async?: boolean;
      defer?: boolean;
    }
    const sync: TestScript = { name: "sync" };
    const async: TestScript = { name: "async", async: true };
    const defer: TestScript = { name: "defer", defer: true };
    const deferAndAsync: TestScript = { name: "defer-async", defer: true, async: true };

    expect(groupScripts([sync, async, defer, deferAndAsync])).toEqual({
      sync: [sync],
      async: [async, deferAndAsync],
      defer: [defer],
    });
  });
});
