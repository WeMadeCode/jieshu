import { useEffect, useState } from 'react';
import Button from 'antd/es/button';
import JieshuReact from '@cloud/jieshu-react';
import hostMap from '../hostMap';
import './PostMessage.css';

interface DemoMessage {
  type: string;
  message: string;
}

const postMessageToVue2 = (data: DemoMessage) => {
  const subWindow = document.querySelector<HTMLIFrameElement>('iframe[name="vue2"]')?.contentWindow;
  subWindow?.postMessage(JSON.stringify(data), '*');
};

const postMessageToIframe = (data: DemoMessage) => {
  const iframeWindow = document
    .querySelector('jieshu-app[data-jieshu-id="vue2"]')
    ?.shadowRoot?.querySelector('iframe')?.contentWindow;
  iframeWindow?.postMessage(JSON.stringify(data), '*');
};

const PostMessage = () => {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data !== 'string') {
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!data || typeof data !== 'object' || !('type' in data) || !('message' in data)) {
        return;
      }
      if (typeof data.type !== 'string' || typeof data.message !== 'string') {
        return;
      }
      const payload = { type: data.type, message: data.message };
      if (payload.type === 'main') {
        setMessage(payload.message);
      } else if (payload.type === 'vue2') {
        postMessageToVue2(payload);
      } else if (payload.type === 'vue3') {
        postMessageToIframe(payload);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <main className="postmessage-page">
      <h1>主应用</h1>
      <section className="postmessage-controls">
        <p aria-live="polite">接收的消息：{message}</p>
        <div className="postmessage-actions">
          <Button onClick={() => postMessageToVue2({ type: 'vue2', message: "hello, i'm main app" })}>
            发送消息给vue2子应用
          </Button>
          <Button onClick={() => postMessageToIframe({ type: 'vue3', message: "hello, i'm main app" })}>
            发送消息给vue2子应用的iframe
          </Button>
        </div>
      </section>
      <section className="postmessage-preview">
        <JieshuReact width="100%" height="100%" name="vue2" url={`${hostMap('//localhost:7200/')}#postmessage`} sync />
      </section>
    </main>
  );
};

export default PostMessage;
