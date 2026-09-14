/* 受保護資料的解鎖與解密。
 *
 * 為什麼是加密而不是「輸入密碼才顯示」：這是靜態網站，JS 是明碼、資料檔用網址就抓得到，
 * 前端的密碼檢查擋不住任何人。真正有效的是把檔案加密 —— 沒有密碼就只是一堆亂數。
 *
 * 金鑰用 PBKDF2-SHA256 從密碼導出（參數寫在 data/secure.json），驗證方式是解開一小段
 * 已知明文的 check 區塊，不必先下載幾百 KB 的資料才知道密碼對不對。
 *
 * 工作階段把「導出的金鑰」而不是密碼存進 localStorage，並帶一個到期時間；這樣即使
 * 有人翻出 localStorage 也拿不到原始密碼（那可能被重複用在別處）。
 */

const KEY_STORAGE = 'twetf.unlock';

export interface SecureManifest {
  v: number;
  kdf: string;
  iterations: number;
  salt: string;
  check: string;
  ttlHours: number;
  /** 內容在加密前先 gzip 過 —— 密文是亂數，HTTP 壓縮對它無效 */
  compressed?: boolean;
}

interface StoredSession {
  key: string;       // base64 的原始金鑰
  salt: string;      // 綁定當時的 salt：密碼換過就對不上，自動失效
  expires: number;
}

const b64ToBytes = (s: string) =>
  Uint8Array.from(atob(s), c => c.charCodeAt(0));

const bytesToB64 = (b: Uint8Array) => {
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s);
};

let manifestPromise: Promise<SecureManifest> | null = null;
let activeKey: CryptoKey | null = null;
let activeSalt: string | null = null;

export function loadManifest(baseUrl: string): Promise<SecureManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${baseUrl}data/secure.json`)
      .then(r => {
        if (!r.ok) throw new Error(`取得解鎖設定失敗（HTTP ${r.status}）`);
        return r.json() as Promise<SecureManifest>;
      })
      .then(m => { payloadCompressed = Boolean(m.compressed); return m; })
      .catch(err => { manifestPromise = null; throw err; });
  }
  return manifestPromise;
}

async function importKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['decrypt']);
}

async function deriveRaw(password: string, m: SecureManifest): Promise<ArrayBuffer> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(m.salt), iterations: m.iterations },
    base, 256);
}

/** 用 check 區塊驗證金鑰。解得開就是密碼正確。 */
async function verify(key: CryptoKey, m: SecureManifest): Promise<boolean> {
  const blob = b64ToBytes(m.check);
  try {
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: blob.slice(0, 12) }, key, blob.slice(12));
    return true;
  } catch {
    return false;
  }
}

function saveSession(raw: ArrayBuffer, m: SecureManifest) {
  const s: StoredSession = {
    key: bytesToB64(new Uint8Array(raw)),
    salt: m.salt,
    expires: Date.now() + m.ttlHours * 3600_000,
  };
  try { localStorage.setItem(KEY_STORAGE, JSON.stringify(s)); } catch { /* 無痕模式 */ }
}

/** 從 localStorage 復原工作階段。過期、salt 不符（密碼已更換）都會失效。 */
export async function restoreSession(m: SecureManifest): Promise<boolean> {
  if (activeKey && activeSalt === m.salt) return true;
  let s: StoredSession | null = null;
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    s = raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch { return false; }

  if (!s || s.salt !== m.salt || s.expires < Date.now()) {
    lock();
    return false;
  }
  const key = await importKey(b64ToBytes(s.key).buffer as ArrayBuffer);
  if (!(await verify(key, m))) { lock(); return false; }
  activeKey = key;
  activeSalt = m.salt;
  return true;
}

/** 輸入密碼解鎖。回傳是否成功。 */
export async function unlock(password: string, m: SecureManifest): Promise<boolean> {
  const raw = await deriveRaw(password, m);
  const key = await importKey(raw);
  if (!(await verify(key, m))) return false;
  activeKey = key;
  activeSalt = m.salt;
  saveSession(raw, m);
  return true;
}

export function lock(): void {
  activeKey = null;
  activeSalt = null;
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* 忽略 */ }
}

export const isUnlocked = () => activeKey !== null;

let payloadCompressed = false;

/** 解密一個 .enc 檔（格式為 IV(12) || 密文）。內容若壓縮過會一併解開。 */
export async function decryptJson<T>(buf: ArrayBuffer): Promise<T> {
  if (!activeKey) throw new Error('尚未解鎖');
  const bytes = new Uint8Array(buf);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) }, activeKey, bytes.slice(12));

  if (!payloadCompressed) return JSON.parse(new TextDecoder().decode(plain)) as T;

  // DecompressionStream 在 Chrome 80+/Safari 16.4+/Firefox 113+ 都有
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('這個瀏覽器不支援 gzip 解壓縮，請更新瀏覽器');
  }
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  return JSON.parse(text) as T;
}

/** 工作階段還剩多久（毫秒）。未解鎖回傳 0。 */
export function sessionRemaining(): number {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    if (!raw) return 0;
    const s = JSON.parse(raw) as StoredSession;
    return Math.max(0, s.expires - Date.now());
  } catch {
    return 0;
  }
}
