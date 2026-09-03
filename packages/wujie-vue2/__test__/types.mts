import type { Properties as StandardCssProperties } from 'csstype';
import type { VueConstructor } from 'vue';
import type { DestroyHandler } from 'wujie-core';
import WujieVue, { type WujieVueInstance, type WujieVueProps, type WujieVueStyle } from 'wujie-vue2';

const component: VueConstructor<WujieVueInstance> = WujieVue;

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

declare const standardCssProperties: StandardCssProperties;
const compatibleStyle: WujieVueStyle = standardCssProperties;
const customPropertyStyle: WujieVueStyle = { '--theme-color': 'rebeccapurple' };

WujieVue.setupApp(props);
WujieVue.preloadApp({ name: props.name, url: props.url });
WujieVue.bus.$emit('adapter:type-test', props.name);
WujieVue.clearAssetsCache('https://child.example.test/');

declare const instance: WujieVueInstance;
const refreshed: Promise<DestroyHandler | void> = instance.refresh();
const destroyed: Promise<void> = instance.destroy();
const refreshedApplication: Promise<DestroyHandler | void> = WujieVue.refreshApp(props);
const destroyedApplication: Promise<void> = WujieVue.destroyApp(props.name);

// @ts-expect-error name remains the required application identity.
const missingName: WujieVueProps = {};

void component;
void compatibleStyle;
void customPropertyStyle;
void refreshed;
void destroyed;
void refreshedApplication;
void destroyedApplication;
void missingName;
