<template>
  <div ref="wujieContainer" :style="{ width, height, ...style }"></div>
</template>

<script lang="ts">
import { defineComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CSSProperties, PropType } from 'vue';
import { bus, createAppController } from 'wujie-core';
import type { DestroyHandler, StartOptions } from 'wujie-core';

interface OptionalProp<T> {
  readonly type: PropType<T>;
  readonly default: undefined;
}

function optionalProp<T>(type: PropType<T>): OptionalProp<T> {
  return { type, default: undefined };
}

const DOM_ELEMENT_TYPE = (typeof HTMLElement === 'undefined' ? Object : HTMLElement) as PropType<HTMLElement>;

const componentProps = {
  name: { type: String, default: '' },
  url: { type: String, default: '' },
  html: optionalProp<string>(String),
  width: { type: String, default: '' },
  height: { type: String, default: '' },
  style: optionalProp<CSSProperties>(Object as PropType<CSSProperties>),
  loading: optionalProp<HTMLElement>(DOM_ELEMENT_TYPE),
  replace: optionalProp<NonNullable<StartOptions['replace']>>(
    Function as PropType<NonNullable<StartOptions['replace']>>,
  ),
  fetch: optionalProp<NonNullable<StartOptions['fetch']>>(Function as PropType<NonNullable<StartOptions['fetch']>>),
  props: optionalProp<NonNullable<StartOptions['props']>>(Object as PropType<NonNullable<StartOptions['props']>>),
  attrs: optionalProp<NonNullable<StartOptions['attrs']>>(Object as PropType<NonNullable<StartOptions['attrs']>>),
  degradeAttrs: optionalProp<NonNullable<StartOptions['degradeAttrs']>>(
    Object as PropType<NonNullable<StartOptions['degradeAttrs']>>,
  ),
  sync: optionalProp<boolean>(Boolean),
  prefix: optionalProp<NonNullable<StartOptions['prefix']>>(Object as PropType<NonNullable<StartOptions['prefix']>>),
  fiber: optionalProp<boolean>(Boolean),
  alive: optionalProp<boolean>(Boolean),
  degrade: optionalProp<boolean>(Boolean),
  plugins: optionalProp<NonNullable<StartOptions['plugins']>>(
    Array as unknown as PropType<NonNullable<StartOptions['plugins']>>,
  ),
  iframeAddEventListeners: optionalProp<NonNullable<StartOptions['iframeAddEventListeners']>>(
    Array as unknown as PropType<NonNullable<StartOptions['iframeAddEventListeners']>>,
  ),
  iframeOnEvents: optionalProp<NonNullable<StartOptions['iframeOnEvents']>>(
    Array as unknown as PropType<NonNullable<StartOptions['iframeOnEvents']>>,
  ),
  beforeLoad: optionalProp<NonNullable<StartOptions['beforeLoad']>>(
    Function as PropType<NonNullable<StartOptions['beforeLoad']>>,
  ),
  beforeMount: optionalProp<NonNullable<StartOptions['beforeMount']>>(
    Function as PropType<NonNullable<StartOptions['beforeMount']>>,
  ),
  afterMount: optionalProp<NonNullable<StartOptions['afterMount']>>(
    Function as PropType<NonNullable<StartOptions['afterMount']>>,
  ),
  beforeUnmount: optionalProp<NonNullable<StartOptions['beforeUnmount']>>(
    Function as PropType<NonNullable<StartOptions['beforeUnmount']>>,
  ),
  afterUnmount: optionalProp<NonNullable<StartOptions['afterUnmount']>>(
    Function as PropType<NonNullable<StartOptions['afterUnmount']>>,
  ),
  activated: optionalProp<NonNullable<StartOptions['activated']>>(
    Function as PropType<NonNullable<StartOptions['activated']>>,
  ),
  deactivated: optionalProp<NonNullable<StartOptions['deactivated']>>(
    Function as PropType<NonNullable<StartOptions['deactivated']>>,
  ),
  loadError: optionalProp<NonNullable<StartOptions['loadError']>>(
    Function as PropType<NonNullable<StartOptions['loadError']>>,
  ),
} as const;

type ResolvedComponentProps = Readonly<{
  [Key in keyof typeof componentProps]: Key extends 'name' | 'url' | 'width' | 'height'
    ? string
    : Key extends keyof import('./index').WujieVueProps
      ? import('./index').WujieVueProps[Key]
      : never;
}>;

function optionsFromProps(props: ResolvedComponentProps, container: HTMLElement | null): StartOptions {
  if (!container) throw new Error('WujieVue cannot start before its container is mounted');

  return {
    name: props.name,
    url: props.url,
    html: props.html,
    el: container,
    loading: props.loading,
    replace: props.replace,
    fetch: props.fetch,
    props: props.props,
    attrs: props.attrs,
    degradeAttrs: props.degradeAttrs,
    sync: props.sync,
    prefix: props.prefix,
    fiber: props.fiber,
    alive: props.alive,
    degrade: props.degrade,
    plugins: props.plugins,
    iframeAddEventListeners: props.iframeAddEventListeners,
    iframeOnEvents: props.iframeOnEvents,
    beforeLoad: props.beforeLoad,
    beforeMount: props.beforeMount,
    afterMount: props.afterMount,
    beforeUnmount: props.beforeUnmount,
    afterUnmount: props.afterUnmount,
    activated: props.activated,
    deactivated: props.deactivated,
    loadError: props.loadError,
  };
}

function reportAutomaticFailure(error: unknown): void {
  console.error('[wujie-vue3] failed to start application', error);
}

export default defineComponent({
  name: 'WujieVue',
  props: componentProps,

  setup(props, { emit }) {
    const wujieContainer = ref<HTMLElement | null>(null);
    const controller = createAppController();
    let mounted = false;

    const currentOptions = (): StartOptions => optionsFromProps(props, wujieContainer.value);
    const refresh = (): Promise<DestroyHandler | void> => {
      try {
        return controller.refresh(currentOptions());
      } catch (error: unknown) {
        return Promise.reject(error);
      }
    };
    const destroy = (): Promise<void> => controller.destroy(props.name);
    const forwardBusEvent = (eventName: string, ...payload: unknown[]): void => {
      Reflect.apply(emit, undefined, [eventName, ...payload]);
    };

    const startAutomatically = (): Promise<void | DestroyHandler> => {
      let operation: Promise<void | DestroyHandler>;
      try {
        operation = controller.start(currentOptions());
      } catch (error: unknown) {
        operation = Promise.reject(error);
      }
      return operation.catch((error: unknown): void => reportAutomaticFailure(error));
    };

    watch([() => props.name, () => props.url], (): void => {
      if (mounted) void startAutomatically();
    });

    onMounted((): void => {
      mounted = true;
      bus.$onAll(forwardBusEvent);
      void startAutomatically();
    });

    onBeforeUnmount((): void => {
      mounted = false;
      bus.$offAll(forwardBusEvent);
      controller.dispose();
    });

    return { wujieContainer, refresh, destroy };
  },
});
</script>
