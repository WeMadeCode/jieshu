import { dirname } from 'node:path';

import { defineConfig, type AliasOptions, type PluginOption } from 'vite';

type LibraryBuildMode = 'esm' | 'umd';

interface LibraryBuildOptions {
  entry: string;
  globalName: string;
  esmExternal?: string[];
  umdExternal?: string[];
  umdGlobals?: Record<string, string>;
  umdAliases?: AliasOptions;
  umdExports?: 'default' | 'named';
  plugins?: PluginOption[];
}

export function createLibraryConfig(options: LibraryBuildOptions) {
  return defineConfig(({ mode }) => {
    if (mode !== 'esm' && mode !== 'umd') {
      throw new Error(`Unsupported library build mode: ${mode}`);
    }

    const buildMode: LibraryBuildMode = mode;
    const isUmd = buildMode === 'umd';

    return {
      plugins: options.plugins,
      resolve: {
        alias: isUmd ? options.umdAliases : undefined,
      },
      build: {
        target: 'es2018',
        outDir: isUmd ? 'lib' : 'esm',
        emptyOutDir: true,
        copyPublicDir: false,
        sourcemap: true,
        minify: isUmd ? 'oxc' : false,
        lib: {
          entry: options.entry,
          name: options.globalName,
          formats: [isUmd ? 'umd' : 'es'],
          fileName: () => (isUmd ? 'index.umd.js' : 'index.mjs'),
        },
        rolldownOptions: {
          external: isUmd ? options.umdExternal : options.esmExternal,
          output: isUmd
            ? {
                exports: options.umdExports ?? 'named',
                globals: options.umdGlobals,
              }
            : {
                entryFileNames: '[name].mjs',
                chunkFileNames: '[name]-[hash].mjs',
                preserveModules: true,
                preserveModulesRoot: dirname(options.entry),
              },
        },
      },
    };
  });
}
