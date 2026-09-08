import { useEffect, useState } from 'react';
import Button from 'antd/es/button';

const State = () => {
  const [count, setCount] = useState(10);
  const embedded = Boolean(window.__POWERED_BY_JIESHU__);

  useEffect(() => {
    const bus = window.$jieshu?.bus;
    const increment = () => setCount((value) => value + 1);
    bus?.$on('react18-add', increment);
    return () => {
      bus?.$off('react18-add', increment);
    };
  }, []);

  return (
    <section className="state-page">
      <h2>子应用保活</h2>
      <p className="state-intro">切换主应用再返回，计数和路由保持不变；刷新或重新挂载后，计数恢复为 10。</p>
      <div className="state-counter-panel">
        <div>
          <span className="state-counter-label">当前计数</span>
          <span className="hint">初始值 10</span>
        </div>
        <div className="actions number-content state-stepper">
          <Button aria-label="减少计数" onClick={() => setCount((value) => value - 1)}>
            -
          </Button>
          <output data-testid="state-count" className="number">
            {count}
          </output>
          <Button aria-label="增加计数" onClick={() => setCount((value) => value + 1)}>
            +
          </Button>
          <Button aria-label="重置" onClick={() => setCount(10)}>
            重置
          </Button>
        </div>
      </div>
      <div className="state-navigation">
        <h3>验证跨应用行为</h3>
        <div className="actions">
          <Button disabled={!embedded} onClick={() => window.$jieshu?.props?.jump?.('home')}>
            离开后测试保活
          </Button>
          <Button
            disabled={!embedded}
            onClick={() => {
              window.$jieshu?.bus.$emit('add');
              window.$jieshu?.props?.jump?.('vue3');
            }}
          >
            Vue3 state +1 并跳转
          </Button>
        </div>
        <p className="hint">跨应用计数前，先在 Vue3 的“状态”页注册 add 事件监听。</p>
      </div>
    </section>
  );
};

export default State;
