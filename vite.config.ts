import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // API_PORT lets a second dev client target another server instance.
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
});
