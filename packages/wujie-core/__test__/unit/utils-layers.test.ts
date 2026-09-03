import {
  checkProxyFunction,
  defaultGetPublicPath,
  getAbsolutePath,
  getTargetValue,
  isConstructable,
} from "../../src/utils";

type CallableWithMetadata = CallableFunction & { metadata?: string };

describe("utils compatibility layers", () => {
  test("getTargetValue caches one bound callable per target and copies metadata", () => {
    const target = document.implementation.createHTMLDocument("binding-target");
    const method: CallableWithMetadata = function (this: Document): Document {
      return this;
    };
    method.metadata = "kept";
    Reflect.set(target, "readOwner", method);

    const first = getTargetValue(target, "readOwner") as CallableWithMetadata;
    const second = getTargetValue(target, "readOwner") as CallableWithMetadata;
    const otherTarget = document.implementation.createHTMLDocument("other-binding-target");
    Reflect.set(otherTarget, "readOwner", method);
    const other = getTargetValue(otherTarget, "readOwner") as CallableWithMetadata;

    expect(first).toBe(second);
    expect(other).not.toBe(first);
    expect(first()).toBe(target);
    expect(other()).toBe(otherTarget);
    expect(first.metadata).toBe("kept");
  });

  test("checkProxyFunction preserves explicitly assigned callback identity", () => {
    const target = document.implementation.createHTMLDocument("callback-target");
    const callback = (): string => "callback";
    Reflect.set(target, "callback", callback);
    checkProxyFunction(target, callback);

    expect(getTargetValue(target, "callback")).toBe(callback);
  });

  test("constructors stay unbound while URL helpers retain edge behavior", () => {
    class Widget {}
    const target = document.implementation.createHTMLDocument("constructor-target");
    Reflect.set(target, "Widget", Widget);

    expect(isConstructable(Widget)).toBe(true);
    expect(getTargetValue(target, "Widget")).toBe(Widget);
    expect(getAbsolutePath("#section", "https://example.test/base", true)).toBe("#section");
    expect(getAbsolutePath("../asset.js", "https://example.test/app/page")).toBe("https://example.test/asset.js");
    expect(defaultGetPublicPath("https://example.test/app/index.html")).toBe("https://example.test/app/");
  });
});
