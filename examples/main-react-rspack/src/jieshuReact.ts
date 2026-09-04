import type { ComponentType } from 'react';
import JieshuReactRuntime, { type JieshuReactProps, type JieshuReactStatics } from '@cloud/jieshu-react';

// @cloud/jieshu-react is developed against React 17 in this workspace. Its runtime is
// React-version agnostic, so expose the component call signature through this
// application's React 19 types while preserving all static APIs.
const JieshuReact = JieshuReactRuntime as unknown as ComponentType<JieshuReactProps> & JieshuReactStatics;

export default JieshuReact;
