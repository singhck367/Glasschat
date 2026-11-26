import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    watch: {
      ignored: ['**/android/**', '**/dist/**', '**/*.apk']
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/download-apk': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/download-ipa': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/ios-manifest.plist': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/ios-install.mobileconfig': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true
      }
    }
  }
});

