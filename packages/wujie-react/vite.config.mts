import { fileURLToPath } from 'node:url';

import { createLibraryConfig } from '../../build/vite-library.mts';

export default createLibraryConfig({
  entry: fileURLToPath(new URL('./index.tsx', import.meta.url)),
  globalName: 'WujieReact',
  esmExternal: ['react', 'wujie-core'],
  umdExternal: ['react'],
  umdGlobals: { react: 'React' },
  umdAliases: {
    'wujie-core': fileURLToPath(new URL('../wujie-core/src/index.ts', import.meta.url)),
  },
  umdExports: 'default',
});
