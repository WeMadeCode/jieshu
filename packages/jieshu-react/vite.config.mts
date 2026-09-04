import { fileURLToPath } from 'node:url';

import { createLibraryConfig } from '../../build/vite-library.mts';

export default createLibraryConfig({
  entry: fileURLToPath(new URL('./src/index.tsx', import.meta.url)),
  globalName: 'JieshuReact',
  esmExternal: ['react', '@cloud/jieshu-core'],
  umdExternal: ['react'],
  umdGlobals: { react: 'React' },
  umdAliases: {
    '@cloud/jieshu-core': fileURLToPath(new URL('../jieshu-core/src/index.ts', import.meta.url)),
  },
  umdExports: 'default',
});
