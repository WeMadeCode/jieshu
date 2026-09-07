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
    <section>
      <h2>子应用保活</h2>
      <p>三个主应用均开启 alive。修改计数、切换到其他应用，再从 React18 菜单返回，路由和计数会被保留。</p>
      <p>浏览器刷新会重新创建实例，计数恢复为 10。</p>
      <div className="actions number-content">
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
      <p className="hint">跨应用计数测试前，先在 Vue3 中打开“状态”页面，让它注册 add 事件监听。</p>
    </section>
  );
};

export default State;
