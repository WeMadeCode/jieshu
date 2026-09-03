import 'antd/dist/reset.css';
import './index.css';

import { createRoot } from 'react-dom/client';
import App from './App';
import credentialsFetch from './fetch';
import hostMap from './hostMap';
import lifecycles from './lifecycle';
import plugins from './plugin';
import JieshuReact from './jieshuReact';

const { setupApp, preloadApp, bus } = JieshuReact;
const degrade =
  window.localStorage.getItem('degrade') === 'true' ||
  typeof Proxy === 'undefined' ||
  typeof CustomElementRegistry === 'undefined';
const attrs = __PRODUCTION__ ? { src: new URL(__BASE_URL__, window.location.href).href } : {};

bus.$on<[message: string]>('click', (message) => window.alert(message));

setupApp({
  name: 'react16',
  url: hostMap('//localhost:7600/'),
  attrs,
  exec: true,
  fetch: credentialsFetch,
  plugins,
  prefix: { 'prefix-dialog': '/dialog', 'prefix-location': '/location' },
  degrade,
  ...lifecycles,
});

setupApp({
  name: 'react17',
  url: hostMap('//localhost:7100/'),
  attrs,
  exec: true,
  alive: true,
  fetch: credentialsFetch,
  degrade,
  ...lifecycles,
});

setupApp({
  name: 'vue2',
  url: hostMap('//localhost:7200/'),
  attrs,
  exec: true,
  fetch: credentialsFetch,
  degrade,
  ...lifecycles,
});

setupApp({
  name: 'vue3',
  url: hostMap('//localhost:7300/'),
  attrs,
  exec: true,
  alive: true,
  plugins: [{ cssExcludes: ['https://stackpath.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css'] }],
  fetch: (input, init) => {
    const requestUrl = typeof input === 'string' ? input : input.url;
    return requestUrl.includes(hostMap('//localhost:7300/'))
      ? credentialsFetch(input, init)
      : window.fetch(input, init);
  },
  degrade,
  ...lifecycles,
});

setupApp({
  name: 'angular12',
  url: hostMap('//localhost:7400/'),
  attrs,
  exec: true,
  fetch: credentialsFetch,
  degrade,
  ...lifecycles,
});

setupApp({
  name: 'vite',
  url: hostMap('//localhost:7500/'),
  attrs,
  exec: true,
  fetch: credentialsFetch,
  degrade,
  ...lifecycles,
});

if (window.localStorage.getItem('preload') !== 'false') {
  preloadApp({ name: 'react16' });
  preloadApp({ name: 'react17' });
  preloadApp({ name: 'vue2' });
  preloadApp({ name: 'angular12' });

  if (typeof Proxy !== 'undefined') {
    preloadApp({ name: 'vue3' });
    preloadApp({ name: 'vite' });
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found');
}

createRoot(rootElement).render(<App />);
