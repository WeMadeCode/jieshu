import type { App, ComponentPublicInstance, CSSProperties, DefineComponent } from 'vue';
import { bus, clearAssetsCache, destroyApp, preloadApp, refreshApp, setupApp } from 'wujie-core';
import type { DestroyHandler, StartOptions } from 'wujie-core';
export type WujieVueProps = Omit<StartOptions, 'el'> & {
    width?: string;
    height?: string;
    style?: CSSProperties;
};
export interface WujieVueExposed {
    refresh(): Promise<DestroyHandler | void>;
    destroy(): Promise<void>;
}
export type WujieVueInstance = ComponentPublicInstance<WujieVueProps> & WujieVueExposed;
export interface WujieVueStatics {
    bus: typeof bus;
    setupApp: typeof setupApp;
    preloadApp: typeof preloadApp;
    destroyApp: typeof destroyApp;
    refreshApp: typeof refreshApp;
    clearAssetsCache: typeof clearAssetsCache;
    install(app: App): void;
}
export type WujieVueComponent = DefineComponent<WujieVueProps> & WujieVueStatics & {
    new (): WujieVueInstance;
};
declare const WujieVue: WujieVueComponent;
export default WujieVue;
