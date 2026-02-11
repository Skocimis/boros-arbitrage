import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/indexer': {
        target: 'http://159.89.24.172',
        rewrite: (path) => path.replace(/^\/indexer/, ''),
      },
      '/boros-api': {
        target: 'https://api.boros.finance',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/boros-api/, '/core'),
      },
    },
  },
})
