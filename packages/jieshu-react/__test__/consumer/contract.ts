import JieshuReact, {
  type JieshuReactComponent,
  type JieshuReactProps,
  type JieshuReactRef,
  type JieshuReactStatics,
} from '@cloud/jieshu-react';

const lifecycle = (childWindow: Window): void => {
  void childWindow.location.href;
};
const props: JieshuReactProps = {
  name: 'typed-react-consumer',
  url: 'https://example.test/child/',
  html: '<html></html>',
  width: '100%',
  height: '480px',
  style: { minHeight: 320 },
  loading: document.createElement('span'),
  replace: (code) => code,
  fetch: async () => new Response(),
  props: { token: 'typed' },
  attrs: { title: 'execution' },
  sync: true,
  prefix: { '/old': '/new' },
  fiber: true,
  alive: true,
  plugins: [{ cssLoader: (code) => code }],
  iframeAddEventListeners: ['hashchange'],
  iframeOnEvents: ['load'],
  beforeLoad: lifecycle,
  beforeMount: lifecycle,
  afterMount: lifecycle,
  beforeUnmount: lifecycle,
  afterUnmount: lifecycle,
  activated: lifecycle,
  deactivated: lifecycle,
  loadError: (_url, error): void => {
    void error.message;
  },
};

const component: JieshuReactComponent = JieshuReact;
const statics: JieshuReactStatics = JieshuReact;
const rendered = component({
  ...props,
  ref(instance): void {
    void instance?.refresh();
    void instance?.destroy();
  },
});
const imperativeRef: JieshuReactRef = {
  refresh: async () => undefined,
  destroy: async () => undefined,
};

statics.bus.$emit('typed-react-consumer-ready');
statics.setupApp(props);
statics.preloadApp(props);
const refreshedApplication = statics.refreshApp(props);
const destroyedApplication = statics.destroyApp(props.name);
statics.clearAssetsCache('https://example.test/asset.js');

// @ts-expect-error name remains the required application identity.
const missingName: JieshuReactProps = {};

void rendered;
void imperativeRef;
void refreshedApplication;
void destroyedApplication;
void missingName;
