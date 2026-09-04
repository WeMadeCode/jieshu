import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';

import { createLibraryConfig } from '../../build/vite-library.mts';

export default createLibraryConfig({
  entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
  plugins: [vue()],
  globalName: 'JieshuVue',
  esmExternal: ['vue', '@cloud/jieshu-core'],
  umdExternal: ['vue'],
  umdGlobals: { vue: 'Vue' },
  umdAliases: {
    '@cloud/jieshu-core': fileURLToPath(new URL('../jieshu-core/src/index.ts', import.meta.url)),
  },
  umdExports: 'default',
});
