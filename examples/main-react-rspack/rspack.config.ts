import { fileURLToPath } from 'node:url';

import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import { ReactRefreshRspackPlugin } from '@rspack/plugin-react-refresh';

const localPackage = (name: string) => fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url));

export default defineConfig((_env, argv) => {
  const isDevelopment = argv.mode === 'development';
  const publicPath = isDevelopment ? '/' : './';

  return {
    entry: './src/main.tsx',
    devtool: isDevelopment ? 'cheap-module-source-map' : false,
    module: {
      rules: [
        {
          test: /\.(?:js|mjs|jsx|ts|tsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'builtin:swc-loader',
            options: {
              detectSyntax: 'auto',
              jsc: {
                transform: {
                  react: {
                    development: isDevelopment,
                    refresh: isDevelopment,
                    runtime: 'automatic',
                  },
                },
              },
            },
          },
        },
        {
          test: /\.css$/,
          type: 'css/auto',
        },
      ],
    },
    output: {
      clean: true,
      cssFilename: isDevelopment ? 'assets/[name].css' : 'assets/[name]-[contenthash:8].css',
      filename: isDevelopment ? 'assets/[name].js' : 'assets/[name]-[contenthash:8].js',
      publicPath,
    },
    plugins: [
      new rspack.DefinePlugin({
        __BASE_URL__: JSON.stringify(publicPath),
        __PRODUCTION__: JSON.stringify(!isDevelopment),
      }),
      new rspack.HtmlRspackPlugin({ favicon: './favicon.ico', template: './index.html' }),
      isDevelopment && new ReactRefreshRspackPlugin(),
    ],
    resolve: {
      alias: {
        react: localPackage('react'),
        'react-dom': localPackage('react-dom'),
      },
      extensions: ['.tsx', '.ts', '.jsx', '.js'],
    },
    watchOptions: {
      poll: 1_000,
    },
    devServer: {
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      historyApiFallback: true,
      host: '0.0.0.0',
      port: 7800,
      static: false,
    },
  };
});
