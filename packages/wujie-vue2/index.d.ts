import Vue from 'vue';
import type { VueConstructor } from 'vue';
import type { DestroyHandler, StartOptions } from 'wujie';
import { bus, clearAssetsCache, destroyApp, preloadApp, refreshApp, setupApp } from 'wujie';
type WujieStyleValue = string | number | undefined;
type StandardStyleProperty = {
    [Property in keyof CSSStyleDeclaration]: CSSStyleDeclaration[Property] extends string ? Property : never;
}[keyof CSSStyleDeclaration];
type StandardStyle = Partial<Record<Extract<StandardStyleProperty, string>, WujieStyleValue>>;
type FlexibleStyle = Record<string, WujieStyleValue>;
export type WujieVueStyle = StandardStyle | FlexibleStyle;
export type WujieVueProps = Omit<StartOptions, 'el' | 'url'> & Partial<Pick<StartOptions, 'url'>> & {
    width?: string;
    height?: string;
    style?: WujieVueStyle;
};
export interface WujieVueExposed {
    refresh(): Promise<DestroyHandler | void>;
    destroy(): Promise<void>;
}
export type WujieVueInstance = Vue & Readonly<WujieVueProps> & WujieVueExposed;
export interface WujieVueStatics {
    bus: typeof bus;
    setupApp: typeof setupApp;
    preloadApp: typeof preloadApp;
    destroyApp: typeof destroyApp;
    refreshApp: typeof refreshApp;
    clearAssetsCache: typeof clearAssetsCache;
    install(VueConstructor: VueConstructor): void;
}
declare const WujieVue: VueConstructor<WujieVueInstance> & WujieVueStatics;
export default WujieVue;
