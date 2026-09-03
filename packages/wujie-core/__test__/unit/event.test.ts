const warn = jest.fn();
const error = jest.fn();

jest.mock("../../src/utils", () => {
  return { warn, error };
});

const wujieEvent = require("../../src/event");
const { EventBus } = wujieEvent;

describe("event bus test", () => {
  test("bus event on and off", () => {
    const bus = new EventBus("test-on-and-emit");
    const mockFn = jest.fn();
    bus.$on("test", mockFn);
    bus.$emit("test");
    expect(mockFn).toHaveBeenCalled();
    expect(mockFn).toHaveBeenCalledTimes(1);
    bus.$off("test", mockFn);
    bus.$emit("test");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledTimes(1);
    bus.$clear();
  });

  test("bus event on repeat", () => {
    const bus = new EventBus("test-on-repeat");
    const mockFn = jest.fn();
    const mockTmpFn = jest.fn();
    bus.$on("test", mockFn);
    bus.$on("test", mockFn);
    bus.$on("test", mockTmpFn);
    bus.$emit("test");
    bus.$emit("tmp");
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockTmpFn).toHaveBeenCalledTimes(1);
    bus.$clear();
  });

  test("bus event on when emit arguments", () => {
    const bus = new EventBus("test-emit-arguments");
    const args = ["arg1", "arg2"];
    const mockFn = jest.fn();
    bus.$on("test", mockFn);
    bus.$emit("test", ...args);
    expect(mockFn).toHaveBeenCalledWith(...args);
    bus.$clear();
  });

  test("bus event off empty", () => {
    const bus = new EventBus("test-off-empty");
    bus.$off("test", () => {});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("bus event onAll and emit arguments", () => {
    const bus = new EventBus("test-on-all");
    const args = ["arg1", "arg2"];
    const events = ["event1", "event2"];
    const mockFn = jest.fn();
    bus.$onAll(mockFn);
    events.forEach((event, index) => {
      bus.$emit(event, ...args);
      expect(mockFn).toHaveBeenCalledWith(event, ...args);
      expect(mockFn).toHaveBeenCalledTimes(index + 1);
    });
    bus.$clear();
  });

  test("bus event offAll when onAll", () => {
    const bus = new EventBus("test-off-all");
    const mockFn = jest.fn();
    bus.$onAll(mockFn);
    bus.$emit("test");
    expect(mockFn).toHaveBeenCalledTimes(1);
    bus.$offAll(mockFn);
    bus.$emit("test");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledTimes(1);
    bus.$clear();
  });

  test("bus event on and onAll concurrent", () => {
    const bus = new EventBus("test-on-and-onAll");
    const mockOnFn = jest.fn();
    const mockOnAllFn = jest.fn();
    bus.$on("test", mockOnFn);
    bus.$onAll(mockOnAllFn);
    bus.$emit("test");
    expect(mockOnFn).toHaveBeenCalled();
    expect(mockOnAllFn).toHaveBeenCalled();
    bus.$clear();
  });

  test("bus event once", () => {
    const bus = new EventBus("test-once");
    const mockFn = jest.fn();
    bus.$once("test", mockFn);
    bus.$emit("test");
    expect(mockFn).toHaveBeenCalled();
    expect(mockFn).toHaveBeenCalledTimes(1);
    bus.$emit("test");
    expect(mockFn).toHaveBeenCalledTimes(1);
    bus.$clear();
  });

  test("bus event clear", () => {
    const bus = new EventBus("test-clear");
    const mockOnFn = jest.fn();
    const mockOnAllFn = jest.fn();
    bus.$on("test", mockOnFn);
    bus.$onAll(mockOnAllFn);
    bus.$emit("test");
    expect(mockOnFn).toHaveBeenCalledTimes(1);
    expect(mockOnAllFn).toHaveBeenCalledTimes(1);
    bus.$clear();
    bus.$emit("test");
    expect(mockOnFn).toHaveBeenCalledTimes(1);
    expect(mockOnAllFn).toHaveBeenCalledTimes(1);
    bus.$clear();
  });

  test("bus event clear when renew", () => {
    let bus = new EventBus("test-clear-renew");
    const mockOnFn = jest.fn();
    bus.$on("test", mockOnFn);
    bus.$emit("test");
    expect(mockOnFn).toHaveBeenCalledTimes(1);
    bus = new EventBus("test-clear-renew");
    bus.$emit("test");
    expect(mockOnFn).toHaveBeenCalledTimes(1);
    bus.$clear();
  });

  test("bus event on an onAll when cross instance", () => {
    const bus = new EventBus("test-on-and-onAll-cross");
    const tmp = new EventBus("test-on-and-onAll-cross-tmp");
    const mockOnFn = jest.fn();
    const mockOnAllFn = jest.fn();
    bus.$on("test", mockOnFn);
    bus.$onAll(mockOnAllFn);
    tmp.$emit("test");
    expect(mockOnFn).toHaveBeenCalledTimes(1);
    expect(mockOnAllFn).toHaveBeenCalledTimes(1);
    bus.$clear();
    tmp.$clear();
  });

  test("constructing the same id clears old listeners but keeps a shared registry entry", () => {
    const firstBus = new EventBus("test-same-id");
    const oldListener = jest.fn();
    const newListener = jest.fn();
    firstBus.$on("test", oldListener);

    const secondBus = new EventBus("test-same-id");
    secondBus.$emit("test");
    expect(oldListener).not.toHaveBeenCalled();

    firstBus.$on("test", newListener);
    secondBus.$emit("test");
    expect(newListener).toHaveBeenCalledTimes(1);
    secondBus.$destroy();
  });

  test("listener changes during emit only affect the next emission", () => {
    const bus = new EventBus("test-emit-snapshot");
    const lateListener = jest.fn();
    const removedListener = jest.fn();
    const changingListener = jest.fn(() => {
      bus.$off("test", removedListener);
      bus.$on("test", lateListener);
    });
    bus.$on("test", changingListener);
    bus.$on("test", removedListener);

    bus.$emit("test");
    expect(removedListener).toHaveBeenCalledTimes(1);
    expect(lateListener).not.toHaveBeenCalled();

    bus.$emit("test");
    expect(removedListener).toHaveBeenCalledTimes(1);
    expect(lateListener).toHaveBeenCalledTimes(1);
    bus.$destroy();
  });

  test("recursive emit takes a fresh snapshot and preserves call order", () => {
    const bus = new EventBus("test-recursive-emit");
    const calls: string[] = [];
    const firstListener = jest.fn((value: string) => {
      calls.push(`first:${value}`);
      if (value === "outer") bus.$emit("test", "inner");
    });
    const secondListener = jest.fn((value: string) => calls.push(`second:${value}`));
    bus.$on("test", firstListener);
    bus.$on("test", secondListener);

    bus.$emit("test", "outer");
    expect(calls).toEqual(["first:outer", "first:inner", "second:inner", "second:outer"]);
    bus.$destroy();
  });

  test("once unregisters before invoking so recursive emit cannot call it twice", () => {
    const bus = new EventBus("test-recursive-once");
    const listener = jest.fn(() => bus.$emit("test"));
    bus.$once("test", listener);

    bus.$emit("test");
    expect(listener).toHaveBeenCalledTimes(1);
    bus.$destroy();
  });

  test("a thrown listener is reported and aborts the remaining snapshot", () => {
    const bus = new EventBus("test-listener-error");
    const thrownError = new Error("listener failed");
    const laterListener = jest.fn();
    const allListener = jest.fn();
    bus.$on("test", () => {
      throw thrownError;
    });
    bus.$on("test", laterListener);
    bus.$onAll(allListener);

    expect(() => bus.$emit("test")).not.toThrow();
    expect(error).toHaveBeenCalledWith(thrownError);
    expect(laterListener).not.toHaveBeenCalled();
    expect(allListener).not.toHaveBeenCalled();
    bus.$destroy();
  });
});
