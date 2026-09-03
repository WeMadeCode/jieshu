import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    cors: true,
    host: '0.0.0.0',
    port: 7800,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 7800,
    strictPort: true,
  },
});
