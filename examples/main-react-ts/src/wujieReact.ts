import type { ComponentType } from 'react';
import WujieReactRuntime, { type WujieReactProps, type WujieReactStatics } from 'wujie-react';

// wujie-react is developed against React 17 in this workspace. Its runtime is
// React-version agnostic, so expose the component call signature through this
// application's React 19 types while preserving all static APIs.
const WujieReact = WujieReactRuntime as unknown as ComponentType<WujieReactProps> & WujieReactStatics;

export default WujieReact;
