import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

function dependenciesMatch(previous, next) {
  return previous?.length === next?.length && previous.every((dependency, index) => Object.is(dependency, next[index]));
}

class HookHarness {
  constructor() {
    this.container = { nodeName: "DIV" };
    this.hooks = [];
    this.pendingEffects = [];
    this.cursor = 0;
  }

  forwardRef = (render) => {
    const component = (props, ref) => render(props, ref);
    return component;
  };

  memo = (component) => component;

  useRef = (initialValue) => {
    const index = this.cursor++;
    if (!this.hooks[index]) this.hooks[index] = { kind: "ref", current: initialValue };
    return this.hooks[index];
  };

  useCallback = (callback, dependencies) => {
    const index = this.cursor++;
    const previous = this.hooks[index];
    if (previous?.kind === "callback" && dependenciesMatch(previous.dependencies, dependencies)) {
      return previous.callback;
    }
    this.hooks[index] = { kind: "callback", callback, dependencies };
    return callback;
  };

  useImperativeHandle = (ref, create, dependencies = []) => {
    const index = this.cursor++;
    const previous = this.hooks[index];
    const unchanged = previous?.kind === "imperative" && dependenciesMatch(previous.dependencies, dependencies);
    const instance = unchanged ? previous.instance : create();
    this.hooks[index] = { kind: "imperative", dependencies, instance };
    if (typeof ref === "function") ref(instance);
    else if (ref) ref.current = instance;
  };

  useEffect = (effect, dependencies) => {
    const index = this.cursor++;
    const previous = this.hooks[index];
    const unchanged =
      dependencies !== undefined &&
      previous?.kind === "effect" &&
      dependenciesMatch(previous.dependencies, dependencies);
    if (unchanged) return;

    const next = {
      kind: "effect",
      dependencies,
      effect,
      cleanup: previous?.kind === "effect" ? previous.cleanup : undefined,
    };
    this.hooks[index] = next;
    this.pendingEffects.push(next);
  };

  createElement = (type, props) => {
    if (type === "div" && props.ref) props.ref.current = this.container;
    return { type, props, key: null };
  };

  render(component, props, ref) {
    this.cursor = 0;
    this.pendingEffects = [];
    const element = component(props, ref);
    this.pendingEffects.forEach((entry) => {
      entry.cleanup?.();
      entry.cleanup = entry.effect();
    });
    return element;
  }

  unmount() {
    this.hooks.forEach((entry) => {
      if (entry?.kind === "effect") entry.cleanup?.();
    });
  }
}

function createSyntheticModule(context, exports) {
  return new SyntheticModule(
    Object.keys(exports),
    function initialize() {
      Object.entries(exports).forEach(([name, value]) => this.setExport(name, value));
    },
    { context }
  );
}

const harness = new HookHarness();
const startCalls = [];
const refreshCalls = [];
const destroyCalls = [];
const controllers = [];
const bus = { $emit() {} };
const setupApp = () => undefined;
const preloadApp = () => Promise.resolve();
const destroyApp = () => Promise.resolve();
const refreshApp = () => Promise.resolve();
const clearAssetsCache = () => undefined;

function createAppController() {
  const controller = {
    disposeCalls: 0,
    start(options) {
      startCalls.push(options);
      return Promise.resolve();
    },
    refresh(options) {
      refreshCalls.push(options);
      return Promise.resolve();
    },
    destroy(name) {
      destroyCalls.push(name);
      return Promise.resolve();
    },
    dispose() {
      controller.disposeCalls += 1;
    },
  };
  controllers.push(controller);
  return controller;
}

const context = createContext({ console, Error, Object, Promise, window: {} });
const modules = new Map([
  [
    "react",
    createSyntheticModule(context, {
      createElement: harness.createElement,
      forwardRef: harness.forwardRef,
      memo: harness.memo,
      useCallback: harness.useCallback,
      useEffect: harness.useEffect,
      useImperativeHandle: harness.useImperativeHandle,
      useLayoutEffect: harness.useEffect,
      useRef: harness.useRef,
    }),
  ],
  [
    "wujie",
    createSyntheticModule(context, {
      bus,
      clearAssetsCache,
      createAppController,
      destroyApp,
      preloadApp,
      refreshApp,
      setupApp,
    }),
  ],
]);

const sourceUrl = new URL("../esm/index.js", import.meta.url);
const module = new SourceTextModule(await readFile(sourceUrl, "utf8"), {
  context,
  identifier: sourceUrl.href,
});
await module.link((specifier) => modules.get(specifier));
await module.evaluate();

const WujieReact = module.namespace.default;
const forwardedRef = { current: null };
const firstProps = { name: "first", url: "https://first.test/", width: "100%" };
const firstElement = harness.render(WujieReact, firstProps, forwardedRef);

assert.equal(firstElement.type, "div");
assert.equal(firstElement.props.ref.current, harness.container);
assert.equal(startCalls.length, 1);
assert.equal(startCalls[0].name, "first");
assert.equal(startCalls[0].el, harness.container);
assert.equal(typeof forwardedRef.current.refresh, "function");
assert.equal(typeof forwardedRef.current.destroy, "function");

harness.render(WujieReact, { ...firstProps, width: "50%" }, forwardedRef);
assert.equal(startCalls.length, 1, "non-identity props must not restart the application");

harness.render(WujieReact, { ...firstProps, name: "second", url: "https://second.test/" }, forwardedRef);
assert.equal(startCalls.length, 2);
assert.equal(startCalls[1].name, "second");

await forwardedRef.current.refresh();
assert.equal(refreshCalls.length, 1);
assert.equal(refreshCalls[0].name, "second");

await forwardedRef.current.destroy();
assert.deepEqual(destroyCalls, ["second"]);

assert.equal(WujieReact.bus, bus);
assert.equal(WujieReact.setupApp, setupApp);
assert.equal(WujieReact.preloadApp, preloadApp);
assert.equal(WujieReact.destroyApp, destroyApp);
assert.equal(WujieReact.refreshApp, refreshApp);
assert.equal(WujieReact.clearAssetsCache, clearAssetsCache);
assert.equal("propTypes" in WujieReact, false);

harness.unmount();
assert.equal(controllers.length, 1);
assert.equal(controllers[0].disposeCalls, 1);
