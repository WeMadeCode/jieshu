import { useState, version } from 'react';

const App = () => {
  const [count, setCount] = useState(0);
  const embedded = Boolean(window.__POWERED_BY_JIESHU__);

  return (
    <main className="react18-app">
      <header>
        <span className="stack">Vite + TypeScript + React {version}</span>
        <h1>React18 子应用</h1>
        <p>{embedded ? '当前运行在界枢微前端环境中' : '当前为独立运行模式'}</p>
      </header>

      <section aria-labelledby="state-title">
        <h2 id="state-title">组件状态</h2>
        <p>使用 React 18 createRoot 渲染，体验组件状态更新。</p>
        <div className="actions">
          <button onClick={() => setCount((value) => value + 1)}>计数：{count}</button>
          <button className="secondary" onClick={() => setCount(0)}>
            重置
          </button>
        </div>
      </section>

      <section aria-labelledby="communication-title">
        <h2 id="communication-title">主子应用通信</h2>
        <p>通过界枢事件总线发送消息，或调用主应用传入的跳转方法。</p>
        <div className="actions">
          <button disabled={!embedded} onClick={() => window.$jieshu?.bus.$emit('click', '来自 React18 的消息')}>
            发送消息给主应用
          </button>
          <button className="secondary" disabled={!embedded} onClick={() => window.$jieshu?.props?.jump?.('home')}>
            返回主应用首页
          </button>
        </div>
        {!embedded && <p className="hint">从主应用的 React18 菜单进入，即可体验通信。</p>}
      </section>
    </main>
  );
};
export default App;
