/* 建置時才生效的小外掛。
 *
 * 放在獨立檔案而不是塞進 vite.config.ts，是為了讓 buildCsp() 能被 tests/ 直接
 * 匯入測試 —— 它是這裡唯一有邏輯的部分。
 */

import { createHash } from 'node:crypto';
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
  // FinMind：個股財務分析在瀏覽器直接抓那一檔的財報（見 src/api/finmind.ts）
  "connect-src 'self' https://api.finmindtrade.com",
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

/* ── 曾經在這裡：dropPlaintextSeries ──────────────────────────
 *
 * 那個外掛會把 dist/data/series 底下未加密的 .json 刪光，用來保證本機 build
 * 不會把 FinLab 的付費序列打包出去。兩個市場的曲線都改用 FinMind（公開資料）
 * 之後，它要刪的東西正好變成**唯一該留下的東西** —— 留著等於每次 build 都把
 * 曲線刪光，所以整個拿掉。
 *
 * 要接回來的話：它的實作在 git 歷史裡（搜 twetf-drop-plaintext-series），
 * 記得只掃真正加密的那個市場，不要整個 series 一起掃。
 */


/**
 * 建置時寫出 version.json（{"id": 這次建置的代號}）。
 *
 * 開著的分頁（尤其是手機加到主畫面、一直掛在背景的）會一直跑舊的程式，重新部署
 * 之後要使用者自己按重新整理才看得到新東西。前端的 useAutoUpdate 會拿自己內建的
 * __BUILD_ID__ 跟這個檔案比，不一樣就重新整理。每天的資料更新也會重新建置，所以
 * 使用者一天大概會被自動重新整理一次 —— 資料本來就換新了，這正是想要的。
 */
export function buildVersion(id: string): Plugin {
  return {
    name: 'twetf-build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id }) });
    },
  };
}
