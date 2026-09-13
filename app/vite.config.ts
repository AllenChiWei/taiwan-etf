import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages 把網站放在 /taiwan-etf/ 之下，所以資產路徑需要這個前綴。
// 換主機（例如 Phase 2 搬到 Cloudflare 的根網域）時把 base 改回 '/' 即可。
const base = process.env.VITE_BASE ?? '/taiwan-etf/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
