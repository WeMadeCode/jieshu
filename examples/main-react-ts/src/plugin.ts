interface WujieRuntimeWindow extends Window {
  __WUJIE: {
    id: string;
  };
}

function getAppId(appWindow: Window): string {
  return (appWindow as WujieRuntimeWindow).__WUJIE.id;
}

const plugins = [
  {
    htmlLoader: (code: string): string => {
      console.log('html-loader');
      return code;
    },
    jsBeforeLoaders: [
      {
        callback(appWindow: Window): void {
          console.log('js-before-loader-callback', getAppId(appWindow));
        },
      },
    ],
    jsLoader: (code: string, url: string): string => {
      console.log('js-loader', url);
      return code;
    },
    jsAfterLoaders: [
      {
        callback(appWindow: Window): void {
          console.log('js-after-loader-callback', getAppId(appWindow));
        },
      },
    ],
    cssBeforeLoaders: [
      { src: 'https://vfiles.gtimg.cn/wuji_dashboard/xy/test_wuji_damy/HDaBURp7.css' },
      { content: 'img{width: 300px}' },
    ],
    cssLoader: (code: string, url: string): string => {
      console.log('css-loader', url, `${code.slice(0, 50)}...`);
      return code;
    },
    cssAfterLoaders: [
      { src: 'https://vfiles.gtimg.cn/wuji_dashboard/xy/test_wuji_damy/FQsK8IN6.css' },
      { content: 'img{height: 300px}' },
    ],
  },
];

export default plugins;
