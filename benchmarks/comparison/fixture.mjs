// Identical child program for both cores; only their public bridge names differ.
export const childProgram = () => {
  const bridge = window.$jieshu || window.$wujie;
  const props = bridge.props;
  const name = props.name;
  const state = {
    mounts: 0,
    unmounts: 0,
    count: 0,
    route: location.pathname + location.search,
    propsValue: props.marker,
    pongCount: 0,
    dynamicLoaded: false,
    dynamicStyleLoaded: false,
    ready: false,
  };
  window.__BENCH_CHILD_GLOBAL__ = name;
  const report = (type) => props.hostReport({ ...state, name, type });
  const ping = (payload) => {
    if (payload.name === name) {
      state.pongCount += 1;
      report('pong');
      bridge.bus.$emit('bench:pong', { name, value: payload.value });
    }
  };
  const onResize = () => report('resize');
  const onDocument = () => report('document-event');
  let payload;
  const mount = () => {
    state.mounts += 1;
    state.count = 0;
    state.ready = false;
    // A reproducible, moderate DOM + JS workload; no framework-specific UI library.
    payload = Array.from({ length: 4000 }, (_, index) => ({ index, label: `item-${index}-${name}` }));
    const root = document.getElementById('root');
    root.innerHTML =
      '<button id="counter">0</button><button id="navigate">route</button><div id="dynamic-target">dynamic</div>';
    const list = document.createElement('ul');
    for (let index = 0; index < 300; index += 1) {
      const item = document.createElement('li');
      item.className = 'bench-isolation-target';
      item.textContent = payload[index].label;
      list.appendChild(item);
    }
    root.appendChild(list);
    document.getElementById('counter').onclick = () => {
      state.count += 1;
      document.getElementById('counter').textContent = String(state.count);
      report('click');
    };
    document.getElementById('navigate').onclick = () => {
      history.pushState({ bench: name }, '', '/child/next?step=1');
      state.route = location.pathname + location.search;
      report('route');
    };
    bridge.bus.$on('bench:ping', ping);
    window.addEventListener('resize', onResize);
    document.addEventListener('bench-document', onDocument);
    report('mount');
    if (props.variant === 'dynamic') {
      const script = document.createElement('script');
      script.src = props.childOrigin + '/dynamic.js';
      script.onload = () => {
        state.dynamicLoaded = window.__BENCH_DYNAMIC__ === true;
        report('dynamic-script');
      };
      document.head.appendChild(script);
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = props.childOrigin + '/dynamic.css';
      style.onload = () => {
        state.dynamicStyleLoaded = true;
        report('dynamic-style');
      };
      document.head.appendChild(style);
    }
    const ready = document.createElement('div');
    ready.id = 'ready';
    ready.dataset.name = name;
    ready.textContent = name;
    root.appendChild(ready);
    state.ready = true;
    report('ready');
  };
  const unmount = async () => {
    report('unmount-start');
    if (props.variant === 'async-unmount') {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    bridge.bus.$off('bench:ping', ping);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('bench-document', onDocument);
    document.getElementById('root').replaceChildren();
    payload = undefined;
    state.unmounts += 1;
    state.ready = false;
    report('unmount');
  };
  if (window.$jieshu) {
    window.__JIESHU_MOUNT = mount;
    window.__JIESHU_UNMOUNT = unmount;
  } else {
    window.__WUJIE_MOUNT = mount;
    window.__WUJIE_UNMOUNT = unmount;
  }
};

export const installHarness = ({ framework, childOrigin }) => {
  const core = window.ComparisonCore;
  const events = [];
  const states = new Map();
  const handles = new Map();
  const hostReport = (event) => {
    // Never retain a child Window, DOM node or callback in the measurement harness.
    const snapshot = JSON.parse(JSON.stringify(event));
    events.push(snapshot);
    states.set(snapshot.name, snapshot);
  };
  const options = (name, extra = {}) => {
    const { variant = 'normal', props = {}, ...rest } = extra;
    const hooks = {};
    for (const type of [
      'beforeLoad',
      'beforeMount',
      'afterMount',
      'beforeUnmount',
      'afterUnmount',
      'activated',
      'deactivated',
      'loadError',
    ]) {
      hooks[type] = () => events.push({ name, type });
    }
    return {
      name,
      url: `${childOrigin}/child/?variant=${variant}`,
      el: '#app',
      fiber: false,
      alive: false,
      sync: false,
      ...hooks,
      ...rest,
      props: { name, variant, childOrigin, hostReport, ...props },
    };
  };
  const waitReady = async (name) => {
    const start = performance.now();
    while (!states.get(name)?.ready) {
      if (performance.now() - start > 5000) {
        throw new Error(`Timed out waiting for child ready: ${name}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const twoFrames = async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };
  const start = async (name, extra = {}) => {
    const resolved = options(name, extra);
    const started = performance.now();
    const handle = await core.startApp(resolved);
    const apiMs = performance.now() - started;
    handles.set(name, handle);
    await waitReady(name);
    const container = typeof resolved.el === 'string' ? document.querySelector(resolved.el) : resolved.el;
    const findReady = (root) => {
      const direct = root?.querySelector(`#ready[data-name="${name}"]`);
      if (direct) {
        return direct;
      }
      for (const element of root?.querySelectorAll('*') || []) {
        if (element.shadowRoot) {
          const nested = findReady(element.shadowRoot);
          if (nested) {
            return nested;
          }
        }
      }
      return undefined;
    };
    while (!findReady(container)?.checkVisibility()) {
      if (performance.now() - started > 6000) {
        throw new Error(`Timed out waiting for visible child DOM: ${name}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await twoFrames();
    return { apiMs, readyMs: performance.now() - started };
  };
  const destroy = async (name) => {
    await core.destroyApp(name);
    handles.delete(name);
  };
  window.bench = {
    core,
    framework,
    childOrigin,
    events,
    handles,
    options,
    start,
    destroy,
    waitReady,
    twoFrames,
    state: (name) => states.get(name),
    resetObservations: () => {
      events.length = 0;
      states.clear();
      handles.clear();
    },
  };
};
