import { defineConfig } from 'vite';

export default defineConfig({
  base: '/chatbot/',
  server: {
    proxy: {
      '/chatbot/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
