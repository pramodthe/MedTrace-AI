import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// The /session route talks to the CopilotKit runtime, which is a separate Express process
// (`npm run dev:transcription` starts it on 4000). Proxying keeps the browser same-origin.
const copilotProxy = {
  '/api/copilotkit': {
    target: process.env.COPILOTKIT_URL ?? 'http://localhost:4000',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {port: 3000, proxy: copilotProxy},
  preview: {proxy: copilotProxy},
});
