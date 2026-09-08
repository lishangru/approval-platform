import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/site': 'http://localhost:3001',
      '/system': 'http://localhost:3001',
    },
  },
});
