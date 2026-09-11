import { useState } from 'react';
import JieshuReact from '@cloud/jieshu-react';
import './Online.css';

const websites = [
  { name: 'Ant Design', url: 'https://ant.design/components/drawer-cn/' },
  { name: 'React', url: 'https://react.dev/' },
  { name: 'Webpack', url: 'https://webpack.js.org/' },
  { name: 'Vuetify', url: 'https://vuetifyjs.com/en/' },
  { name: 'Naive UI', url: 'https://www.naiveui.com/zh-CN/os-theme/components/button' },
];

// 针对DocZip的适配
const previewPlugins = [
  {
    cssAfterLoaders: [
      {
        // 独立站点常在入口节点隐藏溢出；嵌入较矮的预览区后需要允许滚动。
        content: 'html, body, body > #root, body > #app { overflow: auto !important; }',
      },
    ],
  },
];

const Online = () => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputUrl, setInputUrl] = useState(websites[0].url);
  const [jieshuUrl, setJieshuUrl] = useState(websites[0].url);
  const [validationMessage, setValidationMessage] = useState('');
  const [loading] = useState(() => {
    const element = document.createElement('div');
    element.className = 'online-loading';
    element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="30" viewBox="0 0 24 30" aria-label="加载中">
  <rect x="0" y="13" width="4" height="5" fill="#f16b5f">
    <animate attributeName="height" values="5;21;5" begin="0s" dur="0.6s" repeatCount="indefinite" />
    <animate attributeName="y" values="13;5;13" begin="0s" dur="0.6s" repeatCount="indefinite" />
  </rect>
  <rect x="10" y="13" width="4" height="5" fill="#f16b5f">
    <animate attributeName="height" values="5;21;5" begin="0.15s" dur="0.6s" repeatCount="indefinite" />
    <animate attributeName="y" values="13;5;13" begin="0.15s" dur="0.6s" repeatCount="indefinite" />
  </rect>
  <rect x="20" y="13" width="4" height="5" fill="#f16b5f">
    <animate attributeName="height" values="5;21;5" begin="0.3s" dur="0.6s" repeatCount="indefinite" />
    <animate attributeName="y" values="13;5;13" begin="0.3s" dur="0.6s" repeatCount="indefinite" />
  </rect>
</svg>`;
    return element;
  });

  const openWebsite = (url: string, index = -1) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url.trim());
    } catch {
      setValidationMessage('请输入完整、有效的 HTTPS 地址。');
      return;
    }
    if (parsedUrl.protocol !== 'https:') {
      setValidationMessage('在线体验仅支持 HTTPS 地址。');
      return;
    }
    setInputUrl(parsedUrl.href);
    setJieshuUrl(parsedUrl.href);
    setSelectedIndex(index);
    setValidationMessage('');
  };

  return (
    <main className="online-page">
      <section className="online-intro">
        <h1>
          <span>开箱即用</span>，用最简单的方式体验界枢
        </h1>
        <form
          className="url-form"
          onSubmit={(event) => {
            event.preventDefault();
            openWebsite(inputUrl);
          }}
        >
          <label className="sr-only" htmlFor="online-url">
            需要加载的网站地址
          </label>
          <input
            id="online-url"
            value={inputUrl}
            onChange={(event) => setInputUrl(event.target.value)}
            type="url"
            inputMode="url"
            placeholder="https://example.com/"
            required
          />
          <button type="submit">Magic</button>
        </form>
        <p className="help">请输入一个允许跨域访问的 HTTPS 网站。部分网站会因自身安全策略而无法加载。</p>
        {validationMessage && (
          <p className="validation-message" role="alert">
            {validationMessage}
          </p>
        )}
        <div className="quick-links" aria-label="快速选择网站">
          <span>快速前往：</span>
          {websites.map((website, index) => (
            <button
              key={website.url}
              type="button"
              className={selectedIndex === index ? 'selected' : ''}
              onClick={() => openWebsite(website.url, index)}
            >
              {website.name}
            </button>
          ))}
        </div>
      </section>
      <section className="preview" aria-label="界枢在线体验预览">
        <JieshuReact
          key={jieshuUrl}
          width="100%"
          height="100%"
          name={jieshuUrl}
          url={jieshuUrl}
          loading={loading}
          plugins={previewPlugins}
          alive
        />
      </section>
    </main>
  );
};

export default Online;
