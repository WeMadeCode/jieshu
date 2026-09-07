import * as React from 'react';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
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
} from '@cloud/jieshu-core';

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
  console.error('[@cloud/jieshu-react] failed to start application', error);
}

const useOwnershipEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const JieshuReactView = forwardRef<JieshuReactRef, JieshuReactProps>((componentProps, forwardedRef) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<AppController | null>(null);
  const propsRef = useRef(componentProps);
  const previousIdentityRef = useRef<ApplicationIdentity>({
    name: componentProps.name,
    url: componentProps.url,
  });
  propsRef.current = componentProps;

  const getController = useCallback((): AppController => {
    if (controllerRef.current === null) controllerRef.current = createAppController();
    return controllerRef.current;
  }, []);

  const getStartOptions = useCallback((): StartOptions => {
    const container = containerRef.current;
    if (container === null) {
      throw new Error('JieshuReact cannot start before its container is mounted');
    }
    return createStartOptions(propsRef.current, container);
  }, []);

  const startAutomatically = useCallback((): void => {
    let operation: Promise<DestroyHandler | void>;
    try {
      operation = getController().start(getStartOptions());
    } catch (error: unknown) {
      operation = Promise.reject(error);
    }
    void operation.catch(reportAutomaticFailure);
  }, [getController, getStartOptions]);

  useImperativeHandle(
    forwardedRef,
    (): JieshuReactRef => ({
      refresh: (): Promise<DestroyHandler | void> => {
        try {
          return getController().refresh(getStartOptions());
        } catch (error: unknown) {
          return Promise.reject(error);
        }
      },
      destroy: (): Promise<void> => getController().destroy(propsRef.current.name),
    }),
    [getController, getStartOptions],
  );

  useOwnershipEffect(() => {
    startAutomatically();
    return (): void => {
      const controller = controllerRef.current;
      controller?.dispose();
      controllerRef.current = null;
    };
  }, [startAutomatically]);

  useEffect(() => {
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
});

JieshuReactView.displayName = 'JieshuReact';

const JieshuReact: JieshuReactComponent = Object.assign(memo(JieshuReactView), {
  bus,
  setupApp,
  preloadApp,
  destroyApp,
  refreshApp,
  clearAssetsCache,
});
JieshuReact.displayName = 'JieshuReact';

export default JieshuReact;
