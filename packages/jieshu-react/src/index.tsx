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
} from 'jieshu-core';

export type JieshuReactProps = Omit<StartOptions, 'el'> & {
  width?: string;
  height?: string;
  style?: React.CSSProperties;
};

export interface JieshuReactRef {
  refresh(): Promise<DestroyHandler | void>;
  destroy(): Promise<void>;
}

interface ApplicationIdentity {
  name: string;
  url?: string;
}

export interface JieshuReactStatics {
  bus: typeof bus;
  setupApp: typeof setupApp;
  preloadApp: typeof preloadApp;
  destroyApp: typeof destroyApp;
  refreshApp: typeof refreshApp;
  clearAssetsCache: typeof clearAssetsCache;
}

export interface JieshuReactComponent extends JieshuReactStatics {
  (props: JieshuReactProps & React.RefAttributes<JieshuReactRef>): React.ReactElement | null;
  readonly $$typeof: symbol;
  displayName?: string;
}

function createStartOptions(componentProps: JieshuReactProps, container: HTMLDivElement): StartOptions {
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
    sync: componentProps.sync,
    prefix: componentProps.prefix,
    fiber: componentProps.fiber,
    alive: componentProps.alive,
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
  console.error('[jieshu-react] failed to start application', error);
}

const useOwnershipEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

const JieshuReactView = React.forwardRef<JieshuReactRef, JieshuReactProps>(
  function JieshuReact(componentProps, forwardedRef) {
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
        throw new Error('JieshuReact cannot start before its container is mounted');
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
      (): JieshuReactRef => ({
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
    return <div ref={containerRef} style={{ width, height, ...style }} />;
  },
);

JieshuReactView.displayName = 'JieshuReact';

const memoizedComponent = React.memo(JieshuReactView);
const componentStatics = memoizedComponent as unknown as JieshuReactStatics;
componentStatics.bus = bus;
componentStatics.setupApp = setupApp;
componentStatics.preloadApp = preloadApp;
componentStatics.destroyApp = destroyApp;
componentStatics.refreshApp = refreshApp;
componentStatics.clearAssetsCache = clearAssetsCache;

const JieshuReact = memoizedComponent as unknown as JieshuReactComponent;
JieshuReact.displayName = 'JieshuReact';

export default JieshuReact;
