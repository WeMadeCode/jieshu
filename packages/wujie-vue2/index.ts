import Vue from 'vue';
import type { CreateElement, PropOptions, PropType, VueConstructor, VNode, VNodeData } from 'vue';
import type { AppController, DestroyHandler, StartOptions } from 'wujie-core';
import { bus, clearAssetsCache, createAppController, destroyApp, preloadApp, refreshApp, setupApp } from 'wujie-core';

type WujieStyleValue = string | number | undefined;
type StandardStyleProperty = {
  [Property in keyof CSSStyleDeclaration]: CSSStyleDeclaration[Property] extends string ? Property : never;
}[keyof CSSStyleDeclaration];
type StandardStyle = Partial<Record<Extract<StandardStyleProperty, string>, WujieStyleValue>>;
type FlexibleStyle = Record<string, WujieStyleValue>;

export type WujieVueStyle = StandardStyle | FlexibleStyle;

export type WujieVueProps = Omit<StartOptions, 'el' | 'url'> &
  Partial<Pick<StartOptions, 'url'>> & {
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

type DefinedStartOption<Key extends keyof StartOptions> = NonNullable<StartOptions[Key]>;
type StopIdentityWatch = () => void;

interface AdapterState {
  appController: AppController;
  stopIdentityWatch: StopIdentityWatch | null;
}

interface AdapterMethods extends WujieVueExposed {
  forwardBusEvent(eventName: string, ...payload: unknown[]): void;
  startAutomatically(): Promise<DestroyHandler | void>;
}

type AdapterInstance = Vue & Readonly<WujieVueProps> & AdapterState & AdapterMethods;

const DOM_ELEMENT_TYPE: PropType<HTMLElement> =
  typeof HTMLElement === 'undefined' ? (Object as PropType<HTMLElement>) : HTMLElement;

function prop<Value>(type: PropType<Value>, defaultValue?: Value): PropOptions<Value> {
  return { type, default: defaultValue };
}

const componentProps = {
  width: prop<string>(String, ''),
  height: prop<string>(String, ''),
  // Kept as a prop for compatibility with the existing wrapper API.
  style: prop<WujieVueStyle>(Object),
  name: prop<string>(String, ''),
  url: prop<string>(String, ''),
  html: prop<DefinedStartOption<'html'>>(String),
  loading: prop<DefinedStartOption<'loading'>>(DOM_ELEMENT_TYPE),
  replace: prop<DefinedStartOption<'replace'>>(Function),
  fetch: prop<DefinedStartOption<'fetch'>>(Function),
  props: prop<DefinedStartOption<'props'>>(Object),
  attrs: prop<DefinedStartOption<'attrs'>>(Object),
  degradeAttrs: prop<DefinedStartOption<'degradeAttrs'>>(Object),
  sync: prop<DefinedStartOption<'sync'>>(Boolean),
  prefix: prop<DefinedStartOption<'prefix'>>(Object),
  fiber: prop<DefinedStartOption<'fiber'>>(Boolean),
  alive: prop<DefinedStartOption<'alive'>>(Boolean),
  degrade: prop<DefinedStartOption<'degrade'>>(Boolean),
  plugins: prop<DefinedStartOption<'plugins'>>(Array),
  iframeAddEventListeners: prop<DefinedStartOption<'iframeAddEventListeners'>>(Array),
  iframeOnEvents: prop<DefinedStartOption<'iframeOnEvents'>>(Array),
  beforeLoad: prop<DefinedStartOption<'beforeLoad'>>(Function),
  beforeMount: prop<DefinedStartOption<'beforeMount'>>(Function),
  afterMount: prop<DefinedStartOption<'afterMount'>>(Function),
  beforeUnmount: prop<DefinedStartOption<'beforeUnmount'>>(Function),
  afterUnmount: prop<DefinedStartOption<'afterUnmount'>>(Function),
  activated: prop<DefinedStartOption<'activated'>>(Function),
  deactivated: prop<DefinedStartOption<'deactivated'>>(Function),
  loadError: prop<DefinedStartOption<'loadError'>>(Function),
};

function optionsFromInstance(instance: AdapterInstance): StartOptions {
  const container = instance.$refs['wujieContainer'];
  if (!container) throw new Error('WujieVue cannot start before its container is mounted');

  return {
    name: instance.name,
    url: instance.url,
    html: instance.html,
    // The ref belongs to the div returned by this component's render method.
    el: container as HTMLElement,
    loading: instance.loading,
    replace: instance.replace,
    fetch: instance.fetch,
    props: instance.props,
    attrs: instance.attrs,
    degradeAttrs: instance.degradeAttrs,
    sync: instance.sync,
    prefix: instance.prefix,
    fiber: instance.fiber,
    alive: instance.alive,
    degrade: instance.degrade,
    plugins: instance.plugins,
    iframeAddEventListeners: instance.iframeAddEventListeners,
    iframeOnEvents: instance.iframeOnEvents,
    beforeLoad: instance.beforeLoad,
    beforeMount: instance.beforeMount,
    afterMount: instance.afterMount,
    beforeUnmount: instance.beforeUnmount,
    afterUnmount: instance.afterUnmount,
    activated: instance.activated,
    deactivated: instance.deactivated,
    loadError: instance.loadError,
  };
}

const component = Vue.extend<AdapterState, AdapterMethods, Record<string, never>, WujieVueProps>({
  name: 'WujieVue',
  props: componentProps,

  beforeCreate(): void {
    Object.defineProperties(this, {
      appController: { value: createAppController() },
      stopIdentityWatch: { value: null, writable: true },
    });
  },

  mounted(): void {
    bus.$onAll(this.forwardBusEvent);
    void this.startAutomatically();
    this.stopIdentityWatch = this.$watch(
      (): readonly [string, string | undefined] => [this.name, this.url],
      (): void => {
        void this.startAutomatically();
      },
    );
  },

  beforeDestroy(): void {
    this.stopIdentityWatch?.();
    bus.$offAll(this.forwardBusEvent);
    this.appController.dispose();
  },

  methods: {
    forwardBusEvent(eventName: string, ...payload: unknown[]): void {
      this.$emit(eventName, ...payload);
    },

    startAutomatically(): Promise<DestroyHandler | void> {
      let operation: Promise<DestroyHandler | void>;
      try {
        operation = this.appController.start(optionsFromInstance(this));
      } catch (cause: unknown) {
        operation = Promise.reject(cause);
      }
      return operation.catch((cause: unknown): void => {
        console.error('[wujie-vue2] failed to start application', cause);
      });
    },

    refresh(): Promise<DestroyHandler | void> {
      try {
        return this.appController.refresh(optionsFromInstance(this));
      } catch (cause: unknown) {
        return Promise.reject(cause);
      }
    },

    destroy(): Promise<void> {
      return this.appController.destroy(this.name);
    },
  },

  render(createElement: CreateElement): VNode {
    const compatibleStyle = (this.style ?? {}) as unknown as Record<string, WujieStyleValue>;
    const mergedStyle: Record<string, WujieStyleValue> = {
      width: this.width,
      height: this.height,
      ...compatibleStyle,
    };
    return createElement('div', {
      ref: 'wujieContainer',
      style: mergedStyle as unknown as VNodeData['style'],
    });
  },
});

const WujieVue = component as unknown as VueConstructor<WujieVueInstance> & WujieVueStatics;
WujieVue.bus = bus;
WujieVue.setupApp = setupApp;
WujieVue.preloadApp = preloadApp;
WujieVue.destroyApp = destroyApp;
WujieVue.refreshApp = refreshApp;
WujieVue.clearAssetsCache = clearAssetsCache;
WujieVue.install = (VueConstructor: VueConstructor): void => {
  VueConstructor.component('WujieVue', component);
};

export default WujieVue;
