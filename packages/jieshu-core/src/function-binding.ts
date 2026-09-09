export type ProxyTarget = Window | Document | ShadowRoot | Location;

const boundedCache = new WeakMap<CallableFunction, boolean>();
const constructableCache = new WeakMap<CallableFunction, boolean>();
const targetBindingCaches = new WeakMap<ProxyTarget, WeakMap<CallableFunction, CallableFunction>>();

export const isFunction = (value: unknown): value is (...args: Array<unknown>) => unknown => {
  return typeof value === 'function';
};

export const isCallable = (value: unknown): value is CallableFunction => {
  // typeof also excludes document.all's HTMLDDA value and accepts other realms.
  return typeof value === 'function';
};

export const isBoundedFunction = (fn: CallableFunction) => {
  const cached = boundedCache.get(fn);
  if (cached !== undefined) {
    return cached;
  }

  const bounded = fn.name.startsWith('bound ') && Reflect.getOwnPropertyDescriptor(fn, 'prototype') === undefined;
  boundedCache.set(fn, bounded);
  return bounded;
};

export const isConstructable = (fn: CallableFunction) => {
  const hasPrototypeMethods =
    fn.prototype && fn.prototype.constructor === fn && Object.getOwnPropertyNames(fn.prototype).length > 1;
  if (hasPrototypeMethods) {
    return true;
  }

  const cached = constructableCache.get(fn);
  if (cached !== undefined) {
    return cached;
  }

  const source = fn.toString();
  const constructable = /^function\b\s[A-Z].*/.test(source) || /^class\b/.test(source);
  constructableCache.set(fn, constructable);
  return constructable;
};

const getBindingCache = (target: ProxyTarget) => {
  const cached = targetBindingCaches.get(target);
  if (cached) {
    return cached;
  }

  const created = new WeakMap<CallableFunction, CallableFunction>();
  targetBindingCaches.set(target, created);
  return created;
};

export const checkProxyFunction = (target: ProxyTarget, value: unknown) => {
  if (!isCallable(value) || isBoundedFunction(value) || isConstructable(value)) {
    return;
  }

  const bindings = getBindingCache(target);
  if (!bindings.has(value)) {
    bindings.set(value, value);
  }
};

const copyCallableProperties = (source: CallableFunction, destination: CallableFunction) => {
  for (const key in source) {
    if (!Reflect.set(destination, key, Reflect.get(source, key))) {
      throw new TypeError(`Cannot copy callable property: ${key}`);
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(source, 'prototype') &&
    !Object.prototype.hasOwnProperty.call(destination, 'prototype')
  ) {
    Object.defineProperty(destination, 'prototype', {
      value: source.prototype,
      enumerable: false,
      writable: true,
    });
  }
};

export const getTargetValue = (target: ProxyTarget, property: PropertyKey) => {
  const value: unknown = Reflect.get(target, property);
  if (!isCallable(value)) {
    return value;
  }
  const cached = targetBindingCaches.get(target)?.get(value);
  if (cached !== undefined) {
    return cached;
  }
  if (isBoundedFunction(value) || isConstructable(value)) {
    return value;
  }

  const bound: CallableFunction = Function.prototype.bind.call(value, target);
  getBindingCache(target).set(value, bound);
  copyCallableProperties(value, bound);
  return bound;
};
