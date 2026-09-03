// vue.config.js

/**
 * @type {import('@vue/cli-service').ProjectOptions}
 */
module.exports = {
  publicPath: './',
  configureWebpack: {
    watchOptions: {
      ignored: /node_modules/,
      poll: 1000,
    },
  },
  devServer: {
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    port: '7300',
  },
};
