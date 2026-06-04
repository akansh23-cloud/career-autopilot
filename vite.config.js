import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API path prefixes handled by the Express backend. During `vite` dev these are
// proxied to the backend on :3000 so cookies/session/OAuth work same-origin-style.
const API_PREFIXES = ['/auth', '/ai', '/jobs', '/contacts', '/opportunities', '/profile', '/apply', '/health', '/support', '/dashboard'];

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PREFIXES.map((p) => [p, { target: 'http://localhost:3000', changeOrigin: true }])
    ),
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
