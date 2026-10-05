/* 私人持股的跨裝置同步：直接讀寫 GitHub 上的加密檔（2026-10-06 使用者要求「網站上改一次，各裝置都更新」）。
 *
 * 網站是靜態網頁（GitHub Pages），沒有後端；所以由瀏覽器自己呼叫 GitHub 的 Contents API：
 *   讀：公開倉庫不需要權杖（檔案本身是加密的），而且直接讀 main 分支，不用等網站重新部署。
 *   寫：需要使用者自己申請的 fine-grained 權杖（只限 taiwan-etf 倉庫、Contents 讀寫）。
 *       權杖本身也用私人頁密碼加密後存成 token.enc，所以只要在一台裝置設定一次、其他裝置解鎖就能用；
 *       權杖不經過任何第三方（也不經過 Claude）。
 * 檔案都在 app/public/data/holdings/：holdings.enc（持股）、token.enc（寫入權杖）。 */

const REPO = 'allenchiwei/taiwan-etf';
const BRANCH = 'main';
const DIR = 'app/public/data/holdings/';
const API = `https://api.github.com/repos/${REPO}/contents/${DIR}`;

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
  if (status === 403) return `${what}失敗：權杖沒有這個倉庫的 Contents 寫入權限，或 GitHub 暫時限制請求次數`;
  if (status === 409) return `${what}失敗：同時有其他更新，請再按一次`;
  return `${what}失敗（GitHub HTTP ${status}）`;
}
