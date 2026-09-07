import '@vitejs/plugin-react/preamble';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import './index.css';

let root: Root | undefined;

const mount = () => {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('React18: root element #root was not found');
  }

  root ??= createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

const unmount = () => {
  root?.unmount();
  root = undefined;
};

if (window.__POWERED_BY_JIESHU__) {
  window.__JIESHU_MOUNT = mount;
  window.__JIESHU_UNMOUNT = unmount;
  // Vite 的 module 入口异步执行，注册生命周期后主动通知界枢挂载。
  window.__JIESHU?.mount();
} else {
  mount();
}

if (import.meta.hot) {
  import.meta.hot.dispose(unmount);
}
