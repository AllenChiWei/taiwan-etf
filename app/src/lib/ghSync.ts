/* 私人持股的跨裝置同步：直接讀寫 GitHub 上的加密檔（2026-10-06 使用者要求「網站上改一次，各裝置都更新」）。
 *
 * 網站是靜態網頁（GitHub Pages），沒有後端；所以由瀏覽器自己呼叫 GitHub 的 Contents API：
 *   讀：公開倉庫不需要權杖（檔案本身是加密的），而且直接讀 main 分支，不用等網站重新部署。
 *   寫：需要使用者自己申請的 fine-grained 權杖（只限 taiwan-etf 倉庫、Contents 讀寫）。
 *       權杖本身也用私人頁密碼加密後存成 token.enc，所以只要在一台裝置設定一次、其他裝置解鎖就能用；
 *       權杖不經過任何第三方（也不經過 Claude）。
 * 檔案都在 app/public/data/holdings/：holdings.enc（持股）、budget.enc（支出預估，2026-11-01）、token.enc（寫入權杖）。 */

import type { Vault } from './vault';

const REPO = 'allenchiwei/taiwan-etf';
const BRANCH = 'main';
const DIR = 'app/public/data/holdings/';
const API = `https://api.github.com/repos/${REPO}/contents/${DIR}`;
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${DIR}`;

const b64ToBytes = (s: string) => Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0));
function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function headers(token?: string): HeadersInit {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** 讀一個檔；沒有這個檔回 null。 */
export async function ghRead(name: string, token?: string): Promise<{ bytes: Uint8Array; sha: string } | null> {
  const res = await fetch(`${API}${name}?ref=${BRANCH}&t=${Date.now()}`, { headers: headers(token), cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(ghError(res.status, '讀取'));
  const j = (await res.json()) as { content?: string; sha: string };
  return { bytes: b64ToBytes(j.content ?? ''), sha: j.sha };
}

/** 備援讀取：raw.githubusercontent.com 不算 API 次數（API 未登入每個 IP 每小時只有 60 次，同一個家用網路共用）。
 *  CDN 最多快取約 5 分鐘，所以只在 API 讀不到時用。沒有這個檔回 null。 */
export async function rawRead(name: string): Promise<Uint8Array | null> {
  const res = await fetch(`${RAW}${name}?t=${Date.now()}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`讀取失敗（raw HTTP ${res.status}）`);
  return new Uint8Array(await res.arrayBuffer());
}

/** 寫一個檔（不存在就建立）。 */
export async function ghWrite(name: string, bytes: Uint8Array, token: string, message: string): Promise<void> {
  const cur = await ghRead(name, token);
  const res = await fetch(`${API}${name}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: bytesToB64(bytes), branch: BRANCH, ...(cur ? { sha: cur.sha } : {}) }),
  });
  if (!res.ok) throw new Error(ghError(res.status, '寫入'));
}

function ghError(status: number, what: string): string {
  if (status === 401) return `${what}失敗：權杖無效或已過期（請到「⚙ 同步設定」重新設定）`;
  if (status === 403 || status === 429) return `${what}失敗：GitHub 暫時限制請求次數（或權杖沒有 Contents 寫入權限），請過幾分鐘再試`;
  if (status === 409) return `${what}失敗：同時有其他更新，請再按一次`;
  return `${what}失敗（GitHub HTTP ${status}）`;
}

/** 讀加密檔時實際拿到的來源：api 一定是最新；raw（CDN 約 5 分鐘快取）與 site（網站部署的那份）可能較舊。 */
export type Src = 'api' | 'raw' | 'site';

/* 2026-10-07：GitHub API 未登入時每個 IP 每小時只有 60 次（同一個家用網路共用），用完時讀不到。
 * 所以一律 API → raw.githubusercontent.com（不算 API 次數）→ 網站部署的那份；有權杖就用權杖讀（每小時 5,000 次）。
 * 檔案不存在（還沒存過）回 { data: null, src: 'api', missing: true }，跟「暫時讀不到」分開。 */
export async function readEncrypted<T>(vault: Vault, name: string, token?: string | null)
  : Promise<{ data: T | null; src: Src | null; missing?: boolean }> {
  try {
    const f = await ghRead(name, token ?? undefined);
    if (!f) return { data: null, src: 'api', missing: true };
    return { data: await vault.decryptJson<T>(f.bytes), src: 'api' };
  } catch { /* 改用備援 */ }
  try {
    const b = await rawRead(name);
    if (b) return { data: await vault.decryptJson<T>(b), src: 'raw' };
  } catch { /* 改用部署的版本 */ }
  try { return { data: await vault.fetchJson<T>(name), src: 'site' }; } catch { return { data: null, src: null }; }
}

/** 同步權杖（token.enc，用私人頁密碼加密）：分清楚「沒有設定」與「暫時讀不到」。 */
export async function readToken(vault: Vault): Promise<{ token: string | null; state: 'ok' | 'none' | 'error' }> {
  const pick = async (b: Uint8Array) => {
    const t = await vault.decryptJson<{ token?: string }>(b);
    return typeof t.token === 'string' && t.token ? t.token : null;
  };
  let failed = false;
  try {
    const f = await ghRead('token.enc');
    if (!f) return { token: null, state: 'none' };
    const t = await pick(f.bytes);
    if (t) return { token: t, state: 'ok' };
  } catch { failed = true; }
  try {
    const b = await rawRead('token.enc');
    if (b) { const t = await pick(b); if (t) return { token: t, state: 'ok' }; }
    else if (!failed) return { token: null, state: 'none' };
  } catch { failed = true; }
  try {
    const t = await vault.fetchJson<{ token?: string }>('token.enc');
    if (typeof t.token === 'string' && t.token) return { token: t.token, state: 'ok' };
  } catch { /* 都讀不到 */ }
  return { token: null, state: failed ? 'error' : 'none' };
}
