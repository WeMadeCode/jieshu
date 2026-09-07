import { createElement, createRef, memo, type ComponentPropsWithRef, type ReactNode } from 'react';
import JieshuReact, { type JieshuReactRef } from '@cloud/jieshu-react';

const ref = createRef<JieshuReactRef>();
const props: ComponentPropsWithRef<typeof JieshuReact> = { name: 'react17-consumer', ref };
const element: ReactNode = <JieshuReact {...props} />;
const created: ReactNode = createElement(JieshuReact, props);
const Memoized = memo(JieshuReact);
const memoized: ReactNode = <Memoized {...props} />;
const callbackRef: ReactNode = (
  <JieshuReact
    name="callback-ref"
    ref={(instance) => {
      void instance?.refresh();
      void instance?.destroy();
    }}
  />
);

// @ts-expect-error JSX must still require the application name.
const missingName = <JieshuReact />;
// @ts-expect-error The forwarded ref exposes application methods, not a DOM element.
const invalidRef = <JieshuReact name="invalid-ref" ref={createRef<HTMLDivElement>()} />;

void element;
void created;
void memoized;
void callbackRef;
void missingName;
void invalidRef;
