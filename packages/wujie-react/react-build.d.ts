declare module "react" {
  namespace React {
    interface CSSProperties {
      [property: string]: string | number | undefined;
    }

    interface MutableRefObject<Value> {
      current: Value;
    }

    type Ref<Value> = ((instance: Value | null) => void) | MutableRefObject<Value | null> | null;

    interface RefAttributes<Value> {
      ref?: Ref<Value>;
    }

    interface ReactElement {
      readonly type: unknown;
      readonly props: unknown;
      readonly key: string | number | null;
    }

    interface NamedExoticComponent<Props> {
      (props: Props): ReactElement | null;
      displayName?: string;
    }

    interface ForwardRefExoticComponent<Props> extends NamedExoticComponent<Props> {
      defaultProps?: Partial<Props>;
    }

    function createElement(
      type: string,
      props: {
        ref?: Ref<HTMLElement> | MutableRefObject<HTMLDivElement | null>;
        style?: CSSProperties;
      }
    ): ReactElement;

    function forwardRef<Instance, Props>(
      render: (props: Props, ref: Ref<Instance> | undefined) => ReactElement | null
    ): ForwardRefExoticComponent<Props & RefAttributes<Instance>>;

    function memo<Props>(component: NamedExoticComponent<Props>): NamedExoticComponent<Props>;

    function useRef<Value>(initialValue: Value): MutableRefObject<Value>;

    function useCallback<Callback extends (...parameters: never[]) => unknown>(
      callback: Callback,
      dependencies: readonly unknown[]
    ): Callback;

    function useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void;

    function useLayoutEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void;

    function useImperativeHandle<Instance>(
      ref: Ref<Instance> | undefined,
      create: () => Instance,
      dependencies?: readonly unknown[]
    ): void;
  }

  export = React;
}
