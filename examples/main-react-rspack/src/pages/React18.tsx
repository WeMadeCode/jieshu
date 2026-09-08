import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from 'antd/es/button';
import Input from 'antd/es/input';
import hostMap from '../hostMap';
import JieshuReact, { type JieshuReactRef } from '@cloud/jieshu-react';
import lifecycles from '../lifecycle';

const React18 = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const app = useRef<JieshuReactRef>(null);
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('来自 Rspack 主应用');
  const [reply, setReply] = useState('等待子应用回传');
  const [status, setStatus] = useState('子应用运行中');
  const path = location.pathname.startsWith('/react18-sub/') ? location.pathname.slice('/react18-sub'.length) : '';
  const syncRoute = () => {
    if (path) {
      JieshuReact.bus.$emit('react18-router-change', path);
    }
  };
  useEffect(() => {
    const ready = () => {
      if (path) {
        JieshuReact.bus.$emit('react18-router-change', path);
      }
    };
    JieshuReact.bus.$on('react18-router-ready', ready);
    ready();
    return () => {
      JieshuReact.bus.$off('react18-router-ready', ready);
    };
  }, [path]);

  const props = {
    route: path,
    message,
    report: (value: string) => setReply(value),
    jump: (name: string) => {
      void navigate(`/${name}`);
    },
  };

  const operate = async (action: 'refresh' | 'destroy') => {
    if (!app.current) {
      return;
    }
    setBusy(true);
    setStatus(action === 'refresh' ? '正在刷新子应用…' : '正在销毁子应用…');
    try {
      await app.current[action]();
      if (action === 'destroy') {
        setVisible(false);
      }
      setStatus(action === 'refresh' ? '刷新完成，子应用状态已重建' : '销毁完成，可点击重新挂载');
    } catch (error: unknown) {
      setStatus(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="react18-workspace">
      <section className="react18-controls" aria-label="React18 核心能力验证">
        <header className="react18-area-header">
          <div className="react18-area-title">
            <span className="react18-area-mark" aria-hidden="true">
              主
            </span>
            <div>
              <h2>主应用控制区</h2>
              <p>Rspack · 管理应用与跨应用通信</p>
            </div>
          </div>
          <span className={`react18-runtime-status${visible ? ' is-running' : ''}`}>
            {busy ? '操作中' : visible ? '子应用运行中' : '子应用已销毁'}
          </span>
        </header>
        <div className="react18-control-grid">
          <div className="react18-control-group">
            <h3>消息通信</h3>
            <div className="react18-message-compose">
              <Input aria-label="主应用消息" value={message} onChange={(event) => setMessage(event.target.value)} />
              <Button
                type="primary"
                disabled={!visible || busy}
                onClick={() => {
                  JieshuReact.bus.$emit('react18-message', message);
                  setStatus('消息已发送，请在子应用“通信”页查看');
                }}
              >
                发送消息给子应用
              </Button>
            </div>
            <p className="react18-control-hint">在子应用“通信”页接收消息；修改后刷新可更新 props。</p>
            <div className="react18-reply">
              <span>子应用回传</span>
              <output data-testid="react18-reply">{reply}</output>
            </div>
          </div>
          <div className="react18-control-group">
            <h3>生命周期</h3>
            <div className="react18-control-actions">
              <Button disabled={!visible || busy} onClick={() => void operate('refresh')}>
                刷新子应用
              </Button>
              <Button danger disabled={!visible || busy} onClick={() => void operate('destroy')}>
                销毁子应用
              </Button>
              <Button
                disabled={visible || busy}
                onClick={() => {
                  setVisible(true);
                  setStatus('正在重新挂载子应用…');
                }}
              >
                重新挂载
              </Button>
            </div>
            <p className="react18-control-hint">切换主应用保留状态；刷新或销毁后重建会重置状态。</p>
          </div>
        </div>
        <footer className="react18-control-status" role="status">
          <span>最近操作</span>
          {status}
        </footer>
      </section>
      <section className="react18-runtime" aria-label="子应用运行区">
        <header className="react18-area-header">
          <div className="react18-area-title">
            <span className="react18-area-mark" aria-hidden="true">
              子
            </span>
            <div>
              <h2>子应用运行区</h2>
              <p>React 18 · 应用内导航、交互与状态</p>
            </div>
          </div>
          <span className="react18-boundary-tag">独立应用边界</span>
        </header>
        {visible ? (
          <JieshuReact
            ref={app}
            width="100%"
            height="100%"
            name="react18"
            url={hostMap('//localhost:7900/') + path.slice(1)}
            alive
            sync={!path}
            props={props}
            afterMount={(appWindow) => {
              lifecycles.afterMount(appWindow);
              setStatus('子应用已挂载');
            }}
            activated={(appWindow) => {
              lifecycles.activated(appWindow);
              syncRoute();
            }}
          />
        ) : (
          <div className="react18-empty">
            <strong>子应用已销毁</strong>
            <p>在上方主应用控制区点击“重新挂载”恢复。</p>
          </div>
        )}
      </section>
    </div>
  );
};

export default React18;
