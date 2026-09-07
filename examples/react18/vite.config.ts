import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/demo-react18/' : '/',
  // preamble 已从入口模块导入，避免 HTML 内联 module 阻塞沙箱的脚本执行队列。
  plugins: react().map((plugin) => ({ ...plugin, transformIndexHtml: undefined })),
  build: {
    target: 'es2018',
  },
  server: {
    host: '0.0.0.0',
    port: 7900,
    strictPort: true,
    cors: true,
  },
}));
