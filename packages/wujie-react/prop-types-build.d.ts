declare module "prop-types" {
  interface Validator<Value> {
    (
      props: Record<string, unknown>,
      propName: string,
      componentName: string,
      location: string,
      propFullName: string
    ): Error | null;
    isRequired: Validator<Exclude<Value, null | undefined>>;
  }

  interface Requireable<Value> extends Validator<Value | null | undefined> {}

  const string: Requireable<string>;
  const bool: Requireable<boolean>;
  const object: Requireable<object>;
  const func: Requireable<(...parameters: unknown[]) => unknown>;
  const array: Requireable<unknown[]>;
  const element: Requireable<object>;
  function arrayOf<Value>(validator: Validator<Value>): Requireable<Value[]>;
}
