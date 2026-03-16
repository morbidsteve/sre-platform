import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'https://dashboard.apps.sre.example.com',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
