import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const pkgPath = resolve(__dirname, '../package.json');
const version = existsSync(pkgPath)
  ? JSON.parse(readFileSync(pkgPath, 'utf-8')).version
  : process.env.APP_VERSION || 'dev';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`v${version}`),
  },
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/oauth2': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
