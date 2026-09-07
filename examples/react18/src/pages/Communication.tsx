import { useEffect, useState } from 'react';
import Button from 'antd/es/button';

const Communication = () => {
  const embedded = Boolean(window.__POWERED_BY_JIESHU__);
  const [received, setReceived] = useState('等待消息');

  useEffect(() => {
    const bus = window.$jieshu?.bus;
    const receive = (message: string) => setReceived(message);
    bus?.$on('react18-message', receive);
    return () => {
      bus?.$off('react18-message', receive);
    };
  }, []);

  return (
    <section>
      <h2>通信处理</h2>
      <h3>1、主应用通过 props 注入方法</h3>
      <p>调用 $jieshu.props.jump 切换主应用路由。</p>
      <div className="actions">
        <Button disabled={!embedded} onClick={() => window.$jieshu?.props?.jump?.('vue3')}>
          跳转 Vue3
        </Button>
        <Button disabled={!embedded} onClick={() => window.$jieshu?.props?.jump?.('angular12')}>
          跳转 Angular12
        </Button>
        <Button disabled={!embedded} onClick={() => window.$jieshu?.props?.jump?.('home')}>
          返回主应用首页
        </Button>
      </div>
      <h3>2、调用 window.parent 方法</h3>
      <Button disabled={!embedded} onClick={() => window.parent.alert('主应用 alert：来自 React18')}>
        调用主应用 alert
      </Button>
      <h3>3、事件总线发送与接收</h3>
      <div className="actions">
        <Button disabled={!embedded} onClick={() => window.$jieshu?.bus.$emit('click', '来自 React18 的消息')}>
          发送消息给主应用
        </Button>
        <Button
          disabled={!embedded}
          onClick={() => window.$jieshu?.bus.$emit('react18-message', 'React18 事件接收成功')}
        >
          发送测试消息
        </Button>
      </div>
      <p>
        收到消息：<output data-testid="received-message">{received}</output>
      </p>
      {!embedded && <p className="hint">从主应用的 React18 菜单进入，即可体验通信。</p>}
    </section>
  );
};

export default Communication;
