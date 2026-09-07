import { version } from 'react';
import Tag from 'antd/es/tag';
import Button from 'antd/es/button';
import antdVersion from 'antd/es/version';

const Home = () => (
  <section>
    <h2>React18 示例</h2>
    <p className="stack">Vite + TypeScript + React {version}</p>
    <p>
      当前 React 版本 <Tag color="blue">{version}</Tag>
    </p>
    <p>
      当前 Ant Design 版本 <Tag color="geekblue">{antdVersion}</Tag>
    </p>
    <p>{window.__POWERED_BY_JIESHU__ ? '当前运行在界枢微前端环境中' : '当前为独立运行模式'}</p>
    <p>参考 React17 示例：弹窗、路由同步、应用通信和状态保活。</p>
    <Button href="https://github.com/WeMadeCode/jieshu/tree/master/examples/react18" target="_blank" rel="noreferrer">
      仓库地址
    </Button>
  </section>
);

export default Home;
