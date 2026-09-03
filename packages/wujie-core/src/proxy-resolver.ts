export interface ResolvedProperty {
  readonly resolved: true;
  readonly value: unknown;
}

export interface UnresolvedProperty {
  readonly resolved: false;
}

export type PropertyResolution = ResolvedProperty | UnresolvedProperty;
export type PropertyResolver<Context> = (context: Context, key: PropertyKey) => PropertyResolution;
export type PropertyDescriptorResolver<Context> = (
  context: Context,
  key: PropertyKey,
) => PropertyDescriptor | undefined;

const unresolvedProperty: UnresolvedProperty = { resolved: false };

export function resolvedProperty(value: unknown): ResolvedProperty {
  return { resolved: true, value };
}

export function unresolved(): UnresolvedProperty {
  return unresolvedProperty;
}

/** Compose small property resolvers while preserving the first matching rule. */
export function createResolverPipeline<Context>(
  resolvers: ReadonlyArray<PropertyResolver<Context>>,
): (context: Context, key: PropertyKey) => PropertyResolution {
  return (context, key) => {
    for (const resolver of resolvers) {
      const resolution = resolver(context, key);
      if (resolution.resolved) return resolution;
    }
    return unresolvedProperty;
  };
}

/** Compose descriptor sources used by non-Proxy fallbacks. */
export function createDescriptorPipeline<Context>(
  resolvers: ReadonlyArray<PropertyDescriptorResolver<Context>>,
): PropertyDescriptorResolver<Context> {
  return (context, key) => {
    for (const resolver of resolvers) {
      const descriptor = resolver(context, key);
      if (descriptor) return descriptor;
    }
    return undefined;
  };
}

export function defineResolvedProperties<Context>(
  target: object,
  keys: ReadonlyArray<PropertyKey>,
  context: Context,
  resolveDescriptor: PropertyDescriptorResolver<Context>,
): void {
  for (const key of keys) {
    const descriptor = resolveDescriptor(context, key);
    if (descriptor) Object.defineProperty(target, key, descriptor);
  }
}
