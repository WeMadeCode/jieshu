import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/demo-main-vue/' : '/',
  plugins: [vue()],
  server: {
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    open: true,
    port: 8000,
  },
}));
