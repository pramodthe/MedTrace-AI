import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/copilotkit': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      '/api/copilotkit': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
