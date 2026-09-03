export type ProxyTarget = Window | Document | ShadowRoot | Location;
type CallableRecord = CallableFunction & Record<string, unknown>;

const safariDocumentAllIsCallable = typeof document.all === "function" && typeof document.all === "undefined";
const callableCache = new WeakMap<CallableFunction, boolean>();
const boundedCache = new WeakMap<CallableFunction, boolean>();
const constructableCache = new WeakMap<CallableFunction, boolean>();
const targetBindingCaches = new WeakMap<ProxyTarget, WeakMap<CallableFunction, CallableFunction>>();

export function isFunction(value: unknown): value is (...args: Array<unknown>) => unknown {
  return typeof value === "function";
}

export function isCallable(value: unknown): value is CallableFunction {
  if (typeof value !== "function") return false;
  if (callableCache.has(value)) return true;

  const callable = safariDocumentAllIsCallable
    ? typeof value === "function" && typeof value !== "undefined"
    : typeof value === "function";
  if (callable) callableCache.set(value, true);
  return callable;
}

export function isBoundedFunction(fn: CallableFunction): boolean {
  const cached = boundedCache.get(fn);
  if (cached !== undefined) return cached;

  const bounded = fn.name.indexOf("bound ") === 0 && !fn.hasOwnProperty("prototype");
  boundedCache.set(fn, bounded);
  return bounded;
}

export function isConstructable(fn: CallableFunction): boolean {
  const hasPrototypeMethods =
    fn.prototype && fn.prototype.constructor === fn && Object.getOwnPropertyNames(fn.prototype).length > 1;
  if (hasPrototypeMethods) return true;

  const cached = constructableCache.get(fn);
  if (cached !== undefined) return cached;

  const source = fn.toString();
  const constructable = /^function\b\s[A-Z].*/.test(source) || /^class\b/.test(source);
  constructableCache.set(fn, constructable);
  return constructable;
}

function getBindingCache(target: ProxyTarget): WeakMap<CallableFunction, CallableFunction> {
  const cached = targetBindingCaches.get(target);
  if (cached) return cached;

  const created = new WeakMap<CallableFunction, CallableFunction>();
  targetBindingCaches.set(target, created);
  return created;
}

export function checkProxyFunction(target: ProxyTarget, value: unknown): void {
  if (!isCallable(value) || isBoundedFunction(value) || isConstructable(value)) return;

  const bindings = getBindingCache(target);
  if (!bindings.has(value)) bindings.set(value, value);
}

function copyCallableProperties(source: CallableFunction, destination: CallableRecord): void {
  const sourceRecord = source as CallableRecord;
  for (const key in source) destination[key] = sourceRecord[key];

  if (
    Object.prototype.hasOwnProperty.call(source, "prototype") &&
    !Object.prototype.hasOwnProperty.call(destination, "prototype")
  ) {
    Object.defineProperty(destination, "prototype", {
      value: sourceRecord.prototype,
      enumerable: false,
      writable: true,
    });
  }
}

export function getTargetValue(target: ProxyTarget, property: PropertyKey): unknown {
  const value: unknown = Reflect.get(target, property);
  const bindings = targetBindingCaches.get(target);
  if (isCallable(value) && bindings?.has(value)) return bindings.get(value);
  if (!isCallable(value) || isBoundedFunction(value) || isConstructable(value)) return value;

  const bound = Function.prototype.bind.call(value, target) as CallableRecord;
  getBindingCache(target).set(value, bound);
  copyCallableProperties(value, bound);
  return bound;
}
