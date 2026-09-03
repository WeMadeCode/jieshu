import Theme from 'vitepress/theme';
import type { EnhanceAppContext } from 'vitepress/client';
import wujieHome from './components/wujie-home.vue';
import { h } from 'vue';
import './styles/vars.css';
import './styles/DocSearch.css';

const inBrowser = typeof window !== 'undefined';
export default {
  ...Theme,
  Layout() {
    return h(wujieHome);
  },
  enhanceApp({ app }: EnhanceAppContext) {
    inBrowser &&
      import('wujie-vue3').then((module) => {
        app.use(module.default);
      });
  },
};
