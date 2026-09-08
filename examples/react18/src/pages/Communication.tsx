import { useEffect, useState } from 'react';
import Button from 'antd/es/button';
import Input from 'antd/es/input';

const Communication = () => {
  const embedded = Boolean(window.__POWERED_BY_JIESHU__);
  const [received, setReceived] = useState('等待消息');
  const [receivedCount, setReceivedCount] = useState(0);
  const [reply, setReply] = useState('来自 React18 的回传消息');

  useEffect(() => {
    const bus = window.$jieshu?.bus;
    const receive = (message: string) => {
      setReceived(message);
      setReceivedCount((count) => count + 1);
    };
    bus?.$on('react18-message', receive);
    return () => {
      bus?.$off('react18-message', receive);
    };
  }, []);

  return (
    <section className="communication-page">
      <h2>通信处理</h2>
      <p className="communication-intro">查看主应用传入的数据，或从当前子应用发起通信。</p>
      <div className="communication-grid">
        <div className="communication-block">
          <span className="communication-direction">主应用 → 子应用</span>
          <h3>接收消息</h3>
          <div className="communication-value">
            <span>Props 注入值</span>
            <output data-testid="injected-message">{window.$jieshu?.props?.message ?? '当前主应用未传入消息'}</output>
          </div>
          <div className="communication-value">
            <div className="communication-value-label">
              <span>事件总线消息</span>
              <span className="communication-count">
                已接收 <output data-testid="received-count">{receivedCount}</output> 次
              </span>
            </div>
            <output data-testid="received-message">{received}</output>
          </div>
          <Button
            disabled={!embedded}
            onClick={() => window.$jieshu?.bus.$emit('react18-message', 'React18 事件接收成功')}
          >
            发送测试消息
          </Button>
          <p className="hint">离开本页再返回，一次发送应只增加一次接收。</p>
        </div>
        <div className="communication-block">
          <span className="communication-direction">子应用 → 主应用</span>
          <h3>回传消息</h3>
          <div className="communication-compose">
            <Input aria-label="子应用回传消息" value={reply} onChange={(event) => setReply(event.target.value)} />
            <Button
              type="primary"
              disabled={!window.$jieshu?.props?.report}
              onClick={() => window.$jieshu?.props?.report?.(reply)}
            >
              回传消息给主应用
            </Button>
          </div>
          <p className="hint">通过 props 回调，在上方主应用控制区查看结果。</p>
          <div className="communication-alternatives">
            <span>其他通信方式</span>
            <div className="actions">
              <Button disabled={!embedded} onClick={() => window.$jieshu?.bus.$emit('click', '来自 React18 的消息')}>
                发送消息给主应用
              </Button>
              <Button disabled={!embedded} onClick={() => window.parent.alert('主应用 alert：来自 React18')}>
                调用主应用 alert
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="communication-navigation">
        <div>
          <h3>主应用导航</h3>
          <p className="hint">通过主应用传入的 jump 方法切换应用。</p>
        </div>
        <div className="actions">
          <Button disabled={!embedded} onClick={() => window.$jieshu?.props?.jump?.('vue3')}>
            跳转 Vue3
          </Button>
          <Button disabled={!embedded} onClick={() => window.$jieshu?.props?.jump?.('react17')}>
            跳转 React17
          </Button>
          <Button disabled={!embedded} onClick={() => window.$jieshu?.props?.jump?.('home')}>
            返回主应用首页
          </Button>
        </div>
      </div>
      {!embedded && <p className="hint">从主应用的 React18 菜单进入，即可体验通信。</p>}
    </section>
  );
};

export default Communication;
