import { UnorderedListOutlined } from "@ant-design/icons";
import Button from "antd/es/button";
import Switch from "antd/es/switch";
import Tooltip from "antd/es/tooltip";

export default function Home() {
  const preloadEnabled = window.localStorage.getItem("preload") !== "false";
  const degradeDisabled = typeof Proxy === "undefined" || typeof CustomElementRegistry === "undefined";
  const degradeEnabled = window.localStorage.getItem("degrade") === "true" || degradeDisabled;

  const saveAndReload = (key: "preload" | "degrade", checked: boolean): void => {
    window.localStorage.setItem(key, String(checked));
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
          <Tooltip title="主动降级，去除 shadow + proxy">
            <Switch
              className="switch button-gap"
              checkedChildren="降级开"
              unCheckedChildren="降级关"
              disabled={degradeDisabled}
              defaultChecked={degradeEnabled}
              onChange={(checked) => saveAndReload("degrade", checked)}
            />
          </Tooltip>
          <Tooltip title="预加载 + 预执行">
            <Switch
              className="switch button-gap"
              checkedChildren="预加载开"
              unCheckedChildren="预加载关"
              defaultChecked={preloadEnabled}
              onChange={(checked) => saveAndReload("preload", checked)}
            />
          </Tooltip>
          <Tooltip title="主应用为 history 模式">
            <a
              href="https://wujie-micro.github.io/demo-main-vue/"
              target="_blank"
              className="docs button-gap"
              rel="noreferrer"
            >
              vue 主应用
            </a>
          </Tooltip>
          <a href="https://github.com/Tencent/wujie" target="_blank" className="docs button-gap" rel="noreferrer">
            仓库
          </a>
          <a href="https://wujie-micro.github.io/doc/" target="_blank" className="docs button-gap" rel="noreferrer">
            文档
          </a>
        </div>
      </div>
      <h1 className="header">
        <img
          alt="无界"
          className="brand-logo"
          src="https://vfiles.gtimg.cn/wuji_dashboard/xy/test_wuji_damy/XC5WMbxE.svg"
        />
        <span className="brand">无界</span>
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
