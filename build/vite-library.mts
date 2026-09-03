import { dirname } from 'node:path';

import { defineConfig, type AliasOptions } from 'vite';

type LibraryBuildMode = 'esm' | 'esm-compat' | 'umd';

interface LibraryBuildOptions {
  entry: string;
  globalName: string;
  esmExternal?: string[];
  umdExternal?: string[];
  umdGlobals?: Record<string, string>;
  umdAliases?: AliasOptions;
  umdExports?: 'default' | 'named';
}

export function createLibraryConfig(options: LibraryBuildOptions) {
  return defineConfig(({ mode }) => {
    if (mode !== 'esm' && mode !== 'esm-compat' && mode !== 'umd') {
      throw new Error(`Unsupported library build mode: ${mode}`);
    }

    const buildMode: LibraryBuildMode = mode;
    const isUmd = buildMode === 'umd';
    const isCompatEsm = buildMode === 'esm-compat';

    return {
      resolve: {
        alias: isUmd ? options.umdAliases : undefined,
      },
      build: {
        target: 'es2018',
        outDir: isUmd ? 'lib' : isCompatEsm ? 'esm-compat' : 'esm',
        emptyOutDir: true,
        copyPublicDir: false,
        sourcemap: true,
        minify: isUmd ? 'oxc' : false,
        lib: {
          entry: options.entry,
          name: options.globalName,
          formats: [isUmd ? 'umd' : 'es'],
          fileName: () => (isUmd ? 'index.umd.js' : isCompatEsm ? 'index.js' : 'index.mjs'),
        },
        rolldownOptions: {
          external: isUmd ? options.umdExternal : options.esmExternal,
          output: isUmd
            ? {
                exports: options.umdExports ?? 'named',
                globals: options.umdGlobals,
              }
            : {
                entryFileNames: isCompatEsm ? '[name].js' : '[name].mjs',
                chunkFileNames: isCompatEsm ? '[name]-[hash].js' : '[name]-[hash].mjs',
                preserveModules: true,
                preserveModulesRoot: dirname(options.entry),
              },
        },
      },
    };
  });
}
