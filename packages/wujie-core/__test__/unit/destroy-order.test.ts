/**
 * 单元测试：sandbox.destroy() 同步移除 map、防重入，以及 destroyApp 异步契约。
 *
 * 修复刷新场景下 destroy 竞态：deleteWujieById 须在 await unmount 之前同步执行，
 * 确保 disconnectedCallback / startApp 通过 getWujieById 拿到 null。
 */

export {};

import Wujie from "../../src/sandbox";
import {
  addSandboxCacheWithWujie,
  getWujieById,
  idToSandboxCacheMap,
  sandboxTeardownById,
  waitForSandboxTeardown,
} from "../../src/common";
import { destroyApp } from "../../src/index";

function createMinimalDestroyableSandbox(id: string) {
  const iframe = window.document.createElement("iframe");
  window.document.body.appendChild(iframe);
  const iframeWindow: any = iframe.contentWindow;

  const inst: any = Object.create(Wujie.prototype);
  inst.id = id;
  inst.destroyed = false;
  inst.provide = null;
  inst.shadowRoot = null;
  inst.proxyLocation = null;
  inst.proxyRevoke = jest.fn();
  inst.iframe = iframe;
  inst.bus = { $destroy: jest.fn() };
  inst.eventCleanupTracker = { cleanupAll: jest.fn() };
  inst.styleSheetElements = [];
  inst.dynamicScriptElements = [];
  inst.fontStyleSheetElements = [];
  inst.deferredStyleObservers = [];
  inst.unmount = jest.fn().mockResolvedValue(undefined);

  if (iframeWindow) {
    iframeWindow.__WUJIE = { id };
    iframeWindow.$wujie = {};
  }

  return { inst, iframe };
}

describe("sandbox.destroy() 同步移除 map 与防重入", () => {
  beforeEach(() => {
    idToSandboxCacheMap.clear();
    sandboxTeardownById.clear();
  });

  test("destroy 应在 await unmount 之前同步从 map 移除 sandbox", async () => {
    const { inst } = createMinimalDestroyableSandbox("order-test");
    let unmountResolve: () => void;
    const unmountGate = new Promise<void>((resolve) => {
      unmountResolve = resolve;
    });

    addSandboxCacheWithWujie("order-test", inst);
    expect(getWujieById("order-test")).toBe(inst);

    inst.unmount = jest.fn().mockImplementation(() => {
      expect(getWujieById("order-test")).toBe(null);
      return unmountGate;
    });

    const destroyPromise = inst.destroy();
    expect(getWujieById("order-test")).toBe(null);

    unmountResolve!();
    await destroyPromise;
  });

  test("destroy 防重入：第二次调用不应重复执行 unmount", async () => {
    const { inst } = createMinimalDestroyableSandbox("reentry-test");
    addSandboxCacheWithWujie("reentry-test", inst);

    await inst.destroy();
    await inst.destroy();

    expect(inst.unmount).toHaveBeenCalledTimes(1);
    expect(inst.destroyed).toBe(true);
  });

  test("应在异步 unmount 和用户生命周期运行前登记 teardown tombstone", async () => {
    const { inst } = createMinimalDestroyableSandbox("tombstone-order-test");
    const unmount = jest.fn(async () => {
      expect(sandboxTeardownById.has("tombstone-order-test")).toBe(true);
    });
    inst.unmount = unmount;
    addSandboxCacheWithWujie("tombstone-order-test", inst);

    const destroyPromise = inst.destroy();

    expect(sandboxTeardownById.has("tombstone-order-test")).toBe(true);
    expect(unmount).toHaveBeenCalledTimes(1);
    await destroyPromise;
    expect(sandboxTeardownById.has("tombstone-order-test")).toBe(false);
  });

  test("并发 destroy 应共享同一个完成 Promise，而不是让后续调用提前完成", async () => {
    const { inst } = createMinimalDestroyableSandbox("concurrent-destroy-test");
    let finishUnmount!: () => void;
    inst.unmount = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishUnmount = resolve;
        })
    );

    const firstDestroy = inst.destroy();
    const secondDestroy = inst.destroy();

    expect(secondDestroy).toBe(firstDestroy);
    expect(inst.unmount).toHaveBeenCalledTimes(1);

    finishUnmount();
    await Promise.all([firstDestroy, secondDestroy]);
  });

  test("unmount 拒绝时仍应执行完整资源清理，并在结束后保留原拒绝", async () => {
    const { inst, iframe } = createMinimalDestroyableSandbox("failed-unmount-test");
    const unmountError = new Error("user unmount failed");
    const busDestroy = jest.fn(() => {
      throw new Error("hostile bus cleanup");
    });
    const proxyRevoke = jest.fn();
    const cleanupAll = jest.fn();
    inst.unmount = jest.fn().mockRejectedValue(unmountError);
    inst.bus = { $destroy: busDestroy };
    inst.proxyRevoke = proxyRevoke;
    inst.eventCleanupTracker = { cleanupAll };

    await expect(inst.destroy()).rejects.toBe(unmountError);

    expect(busDestroy).toHaveBeenCalledTimes(1);
    expect(proxyRevoke).toHaveBeenCalledTimes(1);
    expect(cleanupAll).toHaveBeenCalledTimes(1);
    expect(iframe.isConnected).toBe(false);
    expect(inst.lifecycleController.getCurrent()).toBe("destroyed");
  });

  test("有 setupApp options 时，destroy 同步段应只移除 wujie 实例、保留 options", async () => {
    const { inst } = createMinimalDestroyableSandbox("options-test");
    const options = { name: "options-test", url: "//example.com" };
    const { addSandboxCacheWithOptions, getOptionsById } = require("../../src/common");

    addSandboxCacheWithOptions("options-test", options);
    addSandboxCacheWithWujie("options-test", inst);

    const destroyPromise = inst.destroy();
    expect(getWujieById("options-test")).toBe(null);
    expect(getOptionsById("options-test")).toBe(options);

    await destroyPromise;
  });
});

describe("destroyApp", () => {
  beforeEach(() => {
    idToSandboxCacheMap.clear();
    sandboxTeardownById.clear();
  });

  test("应 await sandbox.destroy 完成后再返回", async () => {
    const { inst } = createMinimalDestroyableSandbox("async-destroy-app");
    let destroyFinished = false;

    addSandboxCacheWithWujie("async-destroy-app", inst);
    inst.destroy = jest.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      destroyFinished = true;
    });

    const promise = destroyApp("async-destroy-app");
    expect(destroyFinished).toBe(false);
    await promise;
    expect(destroyFinished).toBe(true);
    expect(inst.destroy).toHaveBeenCalledTimes(1);
  });

  test("map 中无 sandbox 时应安全返回", async () => {
    await expect(destroyApp("nonexistent")).resolves.toBeUndefined();
  });

  test("live map 已移除时并发 destroy 立即确认，但原 teardown 继续完成", async () => {
    const { inst } = createMinimalDestroyableSandbox("pending-teardown");
    let finishUnmount!: () => void;
    inst.unmount = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishUnmount = resolve;
        })
    );
    addSandboxCacheWithWujie("pending-teardown", inst);

    const firstDestroy = inst.destroy();
    await Promise.resolve();
    expect(getWujieById("pending-teardown")).toBeNull();
    expect(waitForSandboxTeardown("pending-teardown")).toBeDefined();

    let secondDestroyFinished = false;
    const secondDestroy = destroyApp("pending-teardown").then(() => {
      secondDestroyFinished = true;
    });
    await Promise.resolve();
    expect(secondDestroyFinished).toBe(true);
    expect(waitForSandboxTeardown("pending-teardown")).toBeDefined();

    finishUnmount();
    await Promise.all([firstDestroy, secondDestroy]);
    expect(secondDestroyFinished).toBe(true);
  });

  test("并发 public destroy 先确认已有 teardown，原调用仍观察失败", async () => {
    const { inst } = createMinimalDestroyableSandbox("failed-concurrent-destroy");
    const failure = new Error("unmount failed");
    let failUnmount!: () => void;
    inst.unmount = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          failUnmount = () => reject(failure);
        })
    );
    addSandboxCacheWithWujie("failed-concurrent-destroy", inst);

    const firstDestroy = destroyApp("failed-concurrent-destroy");
    const secondDestroy = destroyApp("failed-concurrent-destroy");
    failUnmount();

    await expect(secondDestroy).resolves.toBeUndefined();
    await expect(firstDestroy).rejects.toBe(failure);
  });
});
