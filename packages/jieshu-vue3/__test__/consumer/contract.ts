import { h, type App } from 'vue';
import type { DestroyHandler } from '@cloud/jieshu-core';
import JieshuVue, {
  type JieshuVueComponent,
  type JieshuVueInstance,
  type JieshuVueProps,
  type JieshuVueStatics,
} from '@cloud/jieshu-vue3';

declare const app: App;
declare const instance: JieshuVueInstance;

const lifecycle = (childWindow: Window): void => {
  void childWindow.location.href;
};
const props: JieshuVueProps = {
  name: 'typed-vue-consumer',
  url: 'https://example.test/child/',
  html: '<html></html>',
  width: '100%',
  height: '480px',
  style: { minHeight: '320px', zIndex: 1 },
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

const component: JieshuVueComponent = JieshuVue;
const statics: JieshuVueStatics = JieshuVue;
app.use(component);
h(component, props);
statics.setupApp(props);
statics.preloadApp(props);
statics.bus.$emit('adapter:type-test', props.name);
statics.clearAssetsCache('https://example.test/asset.js');

const refreshedInstance: Promise<DestroyHandler | void> = instance.refresh();
const destroyedInstance: Promise<void> = instance.destroy();
const refreshedApplication: Promise<DestroyHandler | void> = statics.refreshApp(props);
const destroyedApplication: Promise<void> = statics.destroyApp(props.name);

// @ts-expect-error name remains the required application identity.
const missingName: JieshuVueProps = {};

void refreshedInstance;
void destroyedInstance;
void refreshedApplication;
void destroyedApplication;
void missingName;
