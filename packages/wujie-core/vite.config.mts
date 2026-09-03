import { fileURLToPath } from 'node:url';

import { createLibraryConfig } from '../../build/vite-library.mts';

export default createLibraryConfig({
  entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
  globalName: 'wujie',
});
