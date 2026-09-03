const path = require('path');

module.exports = {
  // TypeScript compilation is the single source for ESM and declarations.
  // The UMD build consumes that generated JavaScript.
  entry: './esm/index.js',
  target: ['web', 'es2018'],
  output: {
    publicPath: '/',
    path: path.resolve(__dirname, './lib'),
    filename: 'index.js',
    library: 'WujieVue',
    libraryExport: 'default',
    libraryTarget: 'umd',
    globalObject: 'self',
    umdNamedDefine: true,
  },
  mode: 'production',
  externals: {
    vue: {
      root: 'Vue',
      commonjs: 'vue',
      commonjs2: 'vue',
      amd: 'vue',
    },
  },
  resolve: {
    extensions: ['.js'],
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /(node_modules|bower_components)/,
        use: {
          loader: 'babel-loader',
        },
      },
    ],
  },
};
