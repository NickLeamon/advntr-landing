import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from /app/ on the same host as the static marketing site. The
// rewrites in ../vercel.json route /i/:id and /join/:id here; assets are
// absolute (/app/assets/...) so they resolve no matter which path the
// page was reached at.
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
    sourcemap: false,
  },
});
