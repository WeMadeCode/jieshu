import * as React from "react";
import { bus, clearAssetsCache, destroyApp, preloadApp, refreshApp, setupApp, type DestroyHandler, type StartOptions } from "wujie";
export type WujieReactProps = Omit<StartOptions, "el"> & {
    width?: string;
    height?: string;
    style?: React.CSSProperties;
};
export interface WujieReactRef {
    refresh(): Promise<DestroyHandler | void>;
    destroy(): Promise<void>;
}
export type WujieReactPropTypes = Partial<Record<keyof WujieReactProps, unknown>>;
export interface WujieReactStatics {
    propTypes: WujieReactPropTypes;
    bus: typeof bus;
    setupApp: typeof setupApp;
    preloadApp: typeof preloadApp;
    destroyApp: typeof destroyApp;
    refreshApp: typeof refreshApp;
    clearAssetsCache: typeof clearAssetsCache;
}
export type WujieReactComponent = React.ForwardRefExoticComponent<WujieReactProps & React.RefAttributes<WujieReactRef>> & WujieReactStatics;
declare const WujieReact: WujieReactComponent;
export default WujieReact;
