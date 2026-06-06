import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API path prefixes handled by the Express backend. During `vite` dev these are
// proxied to the backend on :3000 so cookies/session/OAuth work same-origin-style.
const API_PREFIXES = ['/auth', '/ai', '/jobs', '/contacts', '/opportunities', '/profile', '/apply', '/health', '/support', '/dashboard', '/api'];

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
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split heavy, independently-loadable libraries into their own chunks so
        // the initial app bundle is smaller and the browser can cache vendors
        // separately. The PDF/DOCX/export libs are only pulled in on the routes
        // that use them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
          if (id.includes('mammoth')) return 'vendor-mammoth';
          if (id.includes('jspdf')) return 'vendor-jspdf';
          if (id.includes('html2canvas')) return 'vendor-html2canvas';
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
});
