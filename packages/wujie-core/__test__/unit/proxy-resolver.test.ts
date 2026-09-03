import {
  createDescriptorPipeline,
  createResolverPipeline,
  defineResolvedProperties,
  resolvedProperty,
  unresolved,
} from "../../src/proxy-resolver";
import type { PropertyDescriptorResolver, PropertyResolver } from "../../src/proxy-resolver";

describe("proxy property resolver pipelines", () => {
  test("stops at the first resolved rule even when its value is undefined", () => {
    const fallback = jest.fn(() => resolvedProperty("fallback"));
    const first: PropertyResolver<{ enabled: boolean }> = (context, key) =>
      context.enabled && key === "known" ? resolvedProperty(undefined) : unresolved();
    const resolve = createResolverPipeline([first, fallback]);

    expect(resolve({ enabled: true }, "known")).toEqual({ resolved: true, value: undefined });
    expect(fallback).not.toHaveBeenCalled();
    expect(resolve({ enabled: false }, "known")).toEqual({ resolved: true, value: "fallback" });
  });

  test("descriptor pipeline preserves priority and resolves getters against live context", () => {
    const context = { value: "before" };
    const special: PropertyDescriptorResolver<typeof context> = (current, key) =>
      key === "value" ? { get: () => current.value } : undefined;
    const fallback: PropertyDescriptorResolver<typeof context> = () => ({ value: "fallback" });
    const target: Record<string, unknown> = {};

    defineResolvedProperties(target, ["value"], context, createDescriptorPipeline([special, fallback]));
    expect(target.value).toBe("before");

    context.value = "after";
    expect(target.value).toBe("after");
  });
});
