import { h, type App } from 'vue';
import type { DestroyHandler } from 'wujie';
import SourceWujieVue from '../index';
import WujieVue, { type WujieVueComponent, type WujieVueInstance, type WujieVueProps } from 'wujie-vue3';

declare const app: App;
declare const instance: WujieVueInstance;

const component: WujieVueComponent = WujieVue;
const sourceMatchesPublishedContract: typeof WujieVue = SourceWujieVue;
const publishedContractMatchesSource: typeof SourceWujieVue = WujieVue;

const props: WujieVueProps = {
  name: 'typed-child',
  url: 'https://child.example.test/',
  width: '100%',
  height: '480px',
  sync: true,
  style: { minHeight: '320px', zIndex: 1 },
  beforeMount: (appWindow): void => {
    void appWindow.location.href;
  },
};

app.use(component);
h(component, props);
WujieVue.setupApp(props);
WujieVue.preloadApp({ name: props.name, url: props.url });
WujieVue.bus.$emit('adapter:type-test', props.name);
WujieVue.clearAssetsCache('https://child.example.test/');

const refreshedInstance: Promise<DestroyHandler | void> = instance.refresh();
const destroyedInstance: Promise<void> = instance.destroy();
const refreshedApplication: Promise<DestroyHandler | void> = WujieVue.refreshApp(props);
const destroyedApplication: Promise<void> = WujieVue.destroyApp(props.name);

// @ts-expect-error name remains the required application identity.
const missingName: WujieVueProps = {};

void sourceMatchesPublishedContract;
void publishedContractMatchesSource;
void refreshedInstance;
void destroyedInstance;
void refreshedApplication;
void destroyedApplication;
void missingName;
