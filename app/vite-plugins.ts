/* 建置時才生效的兩個小外掛。
 *
 * 放在獨立檔案而不是塞進 vite.config.ts，是為了讓 buildCsp() 能被 tests/ 直接
 * 匯入測試 —— 它是這兩件事裡唯一有邏輯的部分。
 */

import { createHash } from 'node:crypto';
import { readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/* ── CSP ─────────────────────────────────────────────────── */

/**
 * 內容安全政策的各項指示。
 *
 * 這個站不載入任何第三方資源（沒有 CDN、沒有外部字型），所以 'self' 之外
 * 只需要兩個例外：
 *
 * - 主題那段內嵌腳本：用它自己的 sha256 放行，不是 'unsafe-inline'。
 * - style-src 的 'unsafe-inline'：React 用 style={{...}} 寫行內樣式（籌碼與
 *   配息的顏色），那是屬性層級的樣式，風險遠低於可執行的腳本。
 *
 * frame-ancestors 與 report-uri 在 <meta> 裡會被忽略，所以這裡不放 ——
 * 寫了只會讓人以為有生效。
 */
const DIRECTIVES = [
  "default-src 'self'",
  'script-src %HASHES%',
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
];

/** 內嵌腳本的 CSP 雜湊來源值。 */
export function scriptHash(code: string): string {
  return `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`;
}

/**
 * 把 CSP 的 meta 插進 HTML，內嵌腳本用雜湊放行。
 *
 * 雜湊是**從 HTML 本身算出來的**，不是寫死一個值。寫死的話，改一個空白就會
 * 讓整頁的腳本被擋掉、畫面全白，而且在本機開發時看不出來（開發模式沒有 CSP）。
 */
export function buildCsp(html: string): string {
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]);
  const sources = ["'self'", ...inline.map(scriptHash)].join(' ');
  return DIRECTIVES.join('; ').replace('%HASHES%', sources);
}

/**
 * 只在建置時加 CSP。
 *
 * 開發模式刻意不加：Vite 會注入 HMR 與 React Refresh 的內嵌腳本，雜湊每次都不同，
 * 加了只會讓 npm run dev 壞掉 —— 那會讓人想直接把 CSP 拔掉。
 */
export function cspMeta(): Plugin {
  return {
    name: 'twetf-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const csp = buildCsp(html);
      return html.replace(
        '<head>',
        `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
    },
  };
}

/* ── 不要讓未加密的價格序列進到產物 ───────────────────────── */

/**
 * 把 dist 裡未加密的**美股** series 刪掉，只留 .enc。
 *
 * 台股那半改用 FinMind（公開資料）之後不再加密，所以不掃 —— 掃了會把正常的
 * 台股曲線整個刪光。
 *
 * public/ 底下的東西 Vite 會原樣複製，所以在本機（開發機上有明文序列）執行
 * npm run build，那份付費資料就會躺在 dist 裡。CI 有一道檢查會擋下來，但本機
 * 沒有 —— 手動部署一次就洩出去了。與其靠流程記得，不如讓產物根本不可能含它。
 */
export function dropPlaintextSeries(): Plugin {
  return {
    name: 'twetf-drop-plaintext-series',
    apply: 'build',
    closeBundle() {
      // 只掃美股：台股曲線改用 FinMind 之後是公開資料，本來就該以明文上線
      const root = join(process.cwd(), 'dist', 'data', 'series', 'us');
      if (!existsSync(root)) return;
      // 一定要遞迴：明文序列大部分在 series/tw/ 與 series/us/ 底下（各數百個檔），
      // 只掃最上層會漏掉那些 —— 也就是漏掉絕大部分的資料。
      // 這裡的判斷與 scripts/encrypt_data.py 一致：.json 是明文，.enc 才是成品。
      let removed = 0;
      const sweep = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) sweep(full);
          else if (name.endsWith('.json')) {
            rmSync(full);
            removed += 1;
          }
        }
      };
      sweep(root);
      if (removed > 0) {
        this.warn(`已從產物移除 ${removed} 個未加密的價格序列（data/series 底下的 .json）`);
      }
    },
  };
}
