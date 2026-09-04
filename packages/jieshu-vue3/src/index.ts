import type { App, ComponentPublicInstance, CSSProperties, DefineComponent } from 'vue';
import { bus, clearAssetsCache, destroyApp, preloadApp, refreshApp, setupApp } from '@cloud/jieshu-core';
import type { DestroyHandler, StartOptions } from '@cloud/jieshu-core';

import component from './JieshuVue.vue';

export type JieshuVueProps = Omit<StartOptions, 'el'> & {
  width?: string;
  height?: string;
  style?: CSSProperties;
};

export interface JieshuVueExposed {
  refresh(): Promise<DestroyHandler | void>;
  destroy(): Promise<void>;
}

export type JieshuVueInstance = ComponentPublicInstance<JieshuVueProps> & JieshuVueExposed;

export interface JieshuVueStatics {
  bus: typeof bus;
  setupApp: typeof setupApp;
  preloadApp: typeof preloadApp;
  destroyApp: typeof destroyApp;
  refreshApp: typeof refreshApp;
  clearAssetsCache: typeof clearAssetsCache;
  install(app: App): void;
}

export type JieshuVueComponent = DefineComponent<JieshuVueProps> &
  JieshuVueStatics & {
    new (): JieshuVueInstance;
  };

const JieshuVue = component as unknown as JieshuVueComponent;
JieshuVue.bus = bus;
JieshuVue.setupApp = setupApp;
JieshuVue.preloadApp = preloadApp;
JieshuVue.destroyApp = destroyApp;
JieshuVue.refreshApp = refreshApp;
JieshuVue.clearAssetsCache = clearAssetsCache;
JieshuVue.install = (app: App): void => {
  app.component('JieshuVue', component);
};

export default JieshuVue;
