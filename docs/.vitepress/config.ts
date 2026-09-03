import { defineConfig, type HeadConfig } from 'vitepress';
import { version } from '../../packages/jieshu-core/package.json';
const base = '/doc/';
const ogDescription = '极致的微前端框架';
const ogTitle = '界枢';
const docsOrigin = process.env['JIESHU_DOCS_ORIGIN'];
const ogHead: HeadConfig[] = docsOrigin
  ? [
      ['meta', { property: 'og:image', content: new URL(`${base}jieshu.png`, docsOrigin).toString() }],
      ['meta', { property: 'og:url', content: new URL(base, docsOrigin).toString() }],
    ]
  : [];
const docSearchAppId = process.env['JIESHU_DOCSEARCH_APP_ID'];
const docSearchApiKey = process.env['JIESHU_DOCSEARCH_API_KEY'];
const docSearchIndexName = process.env['JIESHU_DOCSEARCH_INDEX_NAME'];
const algolia =
  docSearchAppId && docSearchApiKey && docSearchIndexName
    ? { appId: docSearchAppId, apiKey: docSearchApiKey, indexName: docSearchIndexName }
    : undefined;
const gtagId = process.env['JIESHU_GTAG_ID'];
const gtagHead: HeadConfig[] = gtagId
  ? [
      ['script', { async: '', src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gtagId)}` }],
      [
        'script',
        {},
        `window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', ${JSON.stringify(gtagId)});`,
      ],
    ]
  : [];

export default defineConfig({
  title: ogTitle,
  description: ogDescription,
  base,
  head: [
    ['link', { rel: 'icon', href: `${base}favicon.ico` }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: ogTitle }],
    ...ogHead,
    ...gtagHead,
  ],

  vue: {
    reactivityTransform: true,
  },
  lastUpdated: true,
  themeConfig: {
    logo: '/jieshu.svg',
    editLink: {
      pattern: 'https://github.com/WeMadeCode/jieshu/edit/master/docs/:path',
      text: '编辑本页',
    },
    lastUpdatedText: '最近更新时间',
    socialLinks: [{ icon: 'github', link: 'https://github.com/WeMadeCode/jieshu' }],
    ...(algolia ? { algolia } : {}),

    nav: [
      { text: '指南', link: '/guide/', activeMatch: '/guide/' },
      {
        text: 'API',
        link: '/api/bus',
        activeMatch: '/api/',
      },
      { text: '常见问题', link: '/question/', activeMatch: '/question/' },
      { text: '框架封装', link: '/pack/', activeMatch: '/pack/' },
      {
        text: `v${version}`,
        items: [
          {
            text: '更新日志',
            link: 'https://github.com/WeMadeCode/jieshu/commits/master/',
          },
        ],
      },
      {
        text: '示例',
        items: [
          {
            text: 'Vue主应用',
            link: 'https://github.com/WeMadeCode/jieshu/tree/master/examples/main-vue',
          },
          {
            text: 'React主应用',
            link: 'https://github.com/WeMadeCode/jieshu/tree/master/examples/main-react',
          },
        ],
      },
      { text: '在线体验界枢', link: '/jieshu/', activeMatch: '/jieshu/' },
      { text: 'fluth', link: 'https://fluthjs.github.io/fluth-doc/cn/index.html' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          collapsed: true,
          items: [
            {
              text: '介绍',
              link: '/guide/',
            },
            {
              text: '快速上手',
              link: '/guide/start',
            },
            {
              text: '创建项目',
              link: '/guide/install',
            },
          ],
        },
        {
          text: '指南',
          collapsed: false,
          items: [
            {
              text: '预加载',
              link: '/guide/preload',
            },
            {
              text: '运行模式',
              link: '/guide/mode',
            },
            {
              text: '路由同步',
              link: '/guide/sync',
            },
            {
              text: '路由跳转',
              link: '/guide/jump',
            },
            {
              text: '生命周期',
              link: '/guide/lifecycle',
            },
            {
              text: '通信系统',
              link: '/guide/communication',
            },
            {
              text: '插件系统',
              link: '/guide/plugin',
            },
            {
              text: '降级处理',
              link: '/guide/degrade',
            },
            {
              text: '应用嵌套',
              link: '/guide/nest',
            },
            {
              text: '应用共享',
              link: '/guide/share',
            },
            {
              text: '全局变量',
              link: '/guide/variable',
            },
          ],
        },
        {
          text: '项目实战',
          collapsed: true,
          items: [
            {
              text: 'vue主应用',
              link: 'https://github.com/WeMadeCode/jieshu/tree/master/examples/main-vue',
            },
            {
              text: 'react主应用',
              link: 'https://github.com/WeMadeCode/jieshu/tree/master/examples/main-react',
            },
          ],
        },
      ],
      '/api/': [
        {
          text: '主应用',
          collapsed: true,
          items: [
            {
              text: 'bus',
              link: '/api/bus',
            },
            {
              text: 'setupApp',
              link: '/api/setupApp',
            },
            {
              text: 'startApp',
              link: '/api/startApp',
            },
            {
              text: 'preloadApp',
              link: '/api/preloadApp',
            },
            {
              text: 'destroyApp',
              link: '/api/destroyApp',
            },
            {
              text: 'refreshApp',
              link: '/api/refreshApp',
            },
            {
              text: 'clearAssetsCache',
              link: '/api/clearAssetsCache',
            },
          ],
        },
        {
          text: '子应用',
          collapsed: true,
          items: [
            {
              text: 'jieshu',
              link: '/api/jieshu',
            },
          ],
        },
      ],
      '/question': [],
      '/pack/': [
        {
          text: '框架封装',
          collapsed: true,
          items: [
            {
              text: 'Vue组件封装',
              link: '/pack/',
            },
            {
              text: 'React组件封装',
              link: '/pack/react',
            },
          ],
        },
      ],
    },
  },
});
