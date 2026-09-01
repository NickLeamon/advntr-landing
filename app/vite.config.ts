import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * In production Vercel rewrites /i/:id and /join/:id to the app's
 * index.html (see ../vercel.json) while the browser URL stays /i/:id —
 * which is what the app parses the invite id out of. The dev server has no
 * such rewrite and serves everything under the /app/ base, so without this
 * `vite dev` 404s on the only URL the app is ever reached at, and dev
 * stops resembling production on the one thing that matters.
 *
 * Rewrites the request internally; the address bar is untouched.
 */
function inviteRewrite(): Plugin {
  return {
    name: 'advntr-invite-rewrite',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/(i|join)\/[^/?#]+\/?(\?.*)?$/.test(req.url)) {
          req.url = '/app/index.html';
        }
        next();
      });
    },
  };
}

// Served from /app/ on the same host as the static marketing site. Assets
// are absolute (/app/assets/...) so they resolve no matter which path the
// page was reached at.
export default defineConfig({
  plugins: [react(), inviteRewrite()],
  base: '/app/',
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
    sourcemap: false,
  },
});
