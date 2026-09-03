import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';

import { createLibraryConfig } from '../../build/vite-library.mts';

export default createLibraryConfig({
  entry: fileURLToPath(new URL('./index.ts', import.meta.url)),
  plugins: [vue()],
  globalName: 'WujieVue',
  esmExternal: ['vue', 'wujie-core'],
  umdExternal: ['vue'],
  umdGlobals: { vue: 'Vue' },
  umdAliases: {
    'wujie-core': fileURLToPath(new URL('../wujie-core/src/index.ts', import.meta.url)),
  },
  umdExports: 'default',
});
