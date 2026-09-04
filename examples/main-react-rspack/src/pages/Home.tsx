import { UnorderedListOutlined } from '@ant-design/icons';
import Button from 'antd/es/button';
import Switch from 'antd/es/switch';
import Tooltip from 'antd/es/tooltip';

import hostMap from '../hostMap';

export default function Home() {
  const preloadEnabled = window.localStorage.getItem('preload') !== 'false';

  const saveAndReload = (checked: boolean): void => {
    window.localStorage.setItem('preload', String(checked));
    window.setTimeout(() => window.location.reload(), 1000);
  };

  return (
    <div className="home">
      <div className="tool">
        <Button
          type="primary"
          className="tool-placeholder"
          aria-hidden="true"
          tabIndex={-1}
          icon={<UnorderedListOutlined />}
        />
        <div className="button-list">
          <Tooltip title="预加载 + 预执行">
            <Switch
              className="switch button-gap"
              checkedChildren="预加载开"
              unCheckedChildren="预加载关"
              defaultChecked={preloadEnabled}
              onChange={saveAndReload}
            />
          </Tooltip>
          <Tooltip title="主应用为 history 模式">
            <a href={hostMap('//localhost:8000/')} target="_blank" className="docs button-gap" rel="noreferrer">
              vue 主应用
            </a>
          </Tooltip>
          <a href="https://github.com/WeMadeCode/jieshu" target="_blank" className="docs button-gap" rel="noreferrer">
            仓库
          </a>
          <a href={hostMap('//localhost:5173/doc/')} target="_blank" className="docs button-gap" rel="noreferrer">
            文档
          </a>
        </div>
      </div>
      <h1 className="header">
        <img
          alt="界枢"
          className="brand-logo"
          src="https://vfiles.gtimg.cn/wuji_dashboard/xy/test_wuji_damy/XC5WMbxE.svg"
        />
        <span className="brand">界枢</span>
      </h1>
      <h2 className="subtitle">—极致的微前端框架</h2>

      <div className="detail-content">
        <section className="item">
          <div className="title">极速 🚀</div>
          <ul>
            <li>极致预加载提速</li>
            <li>应用秒开无白屏</li>
            <li>应用丝滑般切换</li>
          </ul>
        </section>
        <section className="item">
          <div className="title">强大 💪</div>
          <ul>
            <li>多应用同时激活在线</li>
            <li>应用级别保活</li>
            <li>去中心化的通信</li>
          </ul>
        </section>
        <section className="item">
          <div className="title">简单 🤞</div>
          <ul>
            <li>更小的体积</li>
            <li>精简的 API</li>
            <li>开箱即用</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
