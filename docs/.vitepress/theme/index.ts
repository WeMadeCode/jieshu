import Theme from 'vitepress/theme';
import type { EnhanceAppContext } from 'vitepress/client';
import jieshuHome from './components/jieshu-home.vue';
import { h } from 'vue';
import './styles/vars.css';
import './styles/DocSearch.css';

const inBrowser = typeof window !== 'undefined';
export default {
  ...Theme,
  Layout() {
    return h(jieshuHome);
  },
  enhanceApp({ app }: EnhanceAppContext) {
    inBrowser &&
      import('jieshu-vue3').then((module) => {
        app.use(module.default);
      });
  },
};
