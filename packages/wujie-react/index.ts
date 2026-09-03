import * as React from 'react';
import {
  bus,
  clearAssetsCache,
  createAppController,
  destroyApp,
  preloadApp,
  refreshApp,
  setupApp,
  type AppController,
  type DestroyHandler,
  type StartOptions,
} from 'wujie';

export type WujieReactProps = Omit<StartOptions, 'el'> & {
  width?: string;
  height?: string;
  style?: React.CSSProperties;
};

export interface WujieReactRef {
  refresh(): Promise<DestroyHandler | void>;
  destroy(): Promise<void>;
}

interface ApplicationIdentity {
  name: string;
  url?: string;
}

export interface WujieReactStatics {
  bus: typeof bus;
  setupApp: typeof setupApp;
  preloadApp: typeof preloadApp;
  destroyApp: typeof destroyApp;
  refreshApp: typeof refreshApp;
  clearAssetsCache: typeof clearAssetsCache;
}

export interface WujieReactComponent extends WujieReactStatics {
  (props: WujieReactProps & React.RefAttributes<WujieReactRef>): React.ReactElement | null;
  readonly $$typeof: symbol;
  displayName?: string;
}

function createStartOptions(componentProps: WujieReactProps, container: HTMLDivElement): StartOptions {
  return {
    name: componentProps.name,
    url: componentProps.url,
    html: componentProps.html,
    el: container,
    loading: componentProps.loading,
    replace: componentProps.replace,
    fetch: componentProps.fetch,
    props: componentProps.props,
    attrs: componentProps.attrs,
    degradeAttrs: componentProps.degradeAttrs,
    sync: componentProps.sync,
    prefix: componentProps.prefix,
    fiber: componentProps.fiber,
    alive: componentProps.alive,
    degrade: componentProps.degrade,
    plugins: componentProps.plugins,
    iframeAddEventListeners: componentProps.iframeAddEventListeners,
    iframeOnEvents: componentProps.iframeOnEvents,
    beforeLoad: componentProps.beforeLoad,
    beforeMount: componentProps.beforeMount,
    afterMount: componentProps.afterMount,
    beforeUnmount: componentProps.beforeUnmount,
    afterUnmount: componentProps.afterUnmount,
    activated: componentProps.activated,
    deactivated: componentProps.deactivated,
    loadError: componentProps.loadError,
  };
}

function reportAutomaticFailure(error: unknown): void {
  console.error('[wujie-react] failed to start application', error);
}

const useOwnershipEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

const WujieReactView = React.forwardRef<WujieReactRef, WujieReactProps>(
  function WujieReact(componentProps, forwardedRef) {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const controllerRef = React.useRef<AppController | null>(null);
    const propsRef = React.useRef(componentProps);
    const previousIdentityRef = React.useRef<ApplicationIdentity>({
      name: componentProps.name,
      url: componentProps.url,
    });
    propsRef.current = componentProps;

    const getController = React.useCallback((): AppController => {
      if (controllerRef.current === null) controllerRef.current = createAppController();
      return controllerRef.current;
    }, []);

    const getStartOptions = React.useCallback((): StartOptions => {
      const container = containerRef.current;
      if (container === null) {
        throw new Error('WujieReact cannot start before its container is mounted');
      }
      return createStartOptions(propsRef.current, container);
    }, []);

    const startAutomatically = React.useCallback((): void => {
      let operation: Promise<DestroyHandler | void>;
      try {
        operation = getController().start(getStartOptions());
      } catch (error: unknown) {
        operation = Promise.reject(error);
      }
      void operation.catch(reportAutomaticFailure);
    }, [getController, getStartOptions]);

    const refresh = React.useCallback((): Promise<DestroyHandler | void> => {
      try {
        return getController().refresh(getStartOptions());
      } catch (error: unknown) {
        return Promise.reject(error);
      }
    }, [getController, getStartOptions]);

    const destroy = React.useCallback((): Promise<void> => {
      return getController().destroy(propsRef.current.name);
    }, [getController]);

    React.useImperativeHandle(
      forwardedRef,
      (): WujieReactRef => ({
        refresh,
        destroy,
      }),
      [destroy, refresh],
    );

    useOwnershipEffect(() => {
      startAutomatically();
      return (): void => {
        const controller = controllerRef.current;
        controller?.dispose();
        // dispose cannot replace this component's private ref; retain the guard for future re-entrant implementations.
        /* istanbul ignore else */
        if (controllerRef.current === controller) controllerRef.current = null;
      };
    }, [startAutomatically]);

    React.useEffect(() => {
      const previousIdentity = previousIdentityRef.current;
      const nextIdentity: ApplicationIdentity = {
        name: componentProps.name,
        url: componentProps.url,
      };
      previousIdentityRef.current = nextIdentity;

      if (nextIdentity.name !== previousIdentity.name || nextIdentity.url !== previousIdentity.url) {
        startAutomatically();
      }
    });

    const { width, height, style } = componentProps;
    return React.createElement('div', {
      ref: containerRef,
      style: { width, height, ...style },
    });
  },
);

WujieReactView.displayName = 'WujieReact';

const memoizedComponent = React.memo(WujieReactView);
const componentStatics = memoizedComponent as unknown as WujieReactStatics;
componentStatics.bus = bus;
componentStatics.setupApp = setupApp;
componentStatics.preloadApp = preloadApp;
componentStatics.destroyApp = destroyApp;
componentStatics.refreshApp = refreshApp;
componentStatics.clearAssetsCache = clearAssetsCache;

const WujieReact = memoizedComponent as unknown as WujieReactComponent;
WujieReact.displayName = 'WujieReact';

export default WujieReact;
