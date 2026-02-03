import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/indexer': {
        target: 'http://localhost:3001',
        rewrite: (path) => path.replace(/^\/indexer/, ''),
      },
    },
  },
})
