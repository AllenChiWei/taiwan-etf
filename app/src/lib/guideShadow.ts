/* QB 設定說明書（#/QBG）放進 Shadow DOM 前的轉換：說明書是獨立網頁，樣式用 :root／html／body，
 * Shadow DOM 裡要改成 :host 與 .gb-body。純函式，測試在 tests/guideShadow.test.ts。 */

/** 說明書 HTML → 可放進 Shadow DOM 的內容（樣式改寫成 :host 版本） */
export function toShadowHtml(html: string): string {
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) ?? ['', ''])[1]
    .replace(/:root:not\(\[data-theme="light"\]\)/g, ':host(:not([data-theme="light"]))')
    .replace(/:root\[data-theme="dark"\]/g, ':host([data-theme="dark"])')
    .replace(/:root/g, ':host')
    .replace(/(^|\n)\s*html\s*\{/g, '$1:host {')
    .replace(/(^|\n)\s*body\s*\{/g, '$1.gb-body {');
  const body = html
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/<link[^>]*>/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '');
  return `<style>:host{display:block}${css}</style><div class="gb-body">${body}</div>`;
}
