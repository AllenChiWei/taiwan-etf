import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { buildVersion, cspMeta } from './vite-plugins.ts';

// GitHub Pages 把網站放在 /taiwan-etf/ 之下，所以資產路徑需要這個前綴。
// 換主機（例如 Phase 2 搬到 Cloudflare 的根網域）時把 base 改回 '/' 即可。
const base = process.env.VITE_BASE ?? '/taiwan-etf/';

// 這次建置的代號：CI 上用 commit，本機用時間。前端跟 version.json 比對，不同就是有新版。
const buildId = (process.env.GITHUB_SHA ?? '').slice(0, 12) || `local-${Date.now()}`;

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), cspMeta(), buildVersion(buildId)],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  build: {
    outDir: 'dist',
    // 正式產物不出 source map。repo 是公開的，所以不是為了藏原始碼，
    // 而是每次部署少傳一份跟瀏覽者無關的檔案。開發模式的 map 不受影響。
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
