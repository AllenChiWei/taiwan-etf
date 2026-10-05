/* 獨立密碼的加密資料（例如 v18 策略頁）。做法與 lib/secure.ts 相同 —— 檔案在本機用
 * PBKDF2-SHA256 導出金鑰、AES-GCM 加密後才上傳，沒有密碼只拿得到亂數 —— 但每個保險箱有
 * 自己的 manifest 與 localStorage 鍵，所以收藏頁的密碼解不開這裡，反之亦然。
 * 不重寫 secure.ts：那邊是全站共用的單一工作階段，改成多實例會動到收藏與美股頁。 */

export interface VaultManifest {
  v: number;
  kdf: string;
  iterations: number;
  salt: string;
  check: string;
  ttlHours: number;
  compressed?: boolean;
  /** 資料產生時間（ISO），只是顯示用 */
  updated?: string;
}

interface StoredSession { key: string; salt: string; expires: number }

/** 私人頁（v18、QB、實盤權益）解鎖最多維持幾小時（2026-10-05 使用者要求 6 小時就要重新輸入；不論 manifest 的 ttlHours 設多少） */
export const SESSION_HOURS = 6;
const SESSION_MS = SESSION_HOURS * 3600_000;

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const bytesToB64 = (b: Uint8Array) => {
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s);
};

export class Vault {
  private key: CryptoKey | null = null;
  private manifest: VaultManifest | null = null;
  private readonly dir: string;
  private readonly storageKey: string;

  constructor(dir: string, storageKey: string) {
    this.dir = dir;
    this.storageKey = storageKey;
  }

  async loadManifest(): Promise<VaultManifest | null> {
    const res = await fetch(`${this.dir}secure.json`, { cache: 'no-cache' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`取得解鎖設定失敗（HTTP ${res.status}）`);
    this.manifest = (await res.json()) as VaultManifest;
    return this.manifest;
  }

  private async verify(key: CryptoKey, m: VaultManifest): Promise<boolean> {
    const blob = b64ToBytes(m.check);
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12) }, key, blob.slice(12));
      return true;
    } catch {
      return false;
    }
  }

  async restore(m: VaultManifest): Promise<boolean> {
    let s: StoredSession | null = null;
    try {
      const raw = localStorage.getItem(this.storageKey);
      s = raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch { return false; }
    // 過期，或是舊版留下的長效工作階段（剩餘時間超過 6 小時）→ 一律重新輸入密碼
    if (!s || s.salt !== m.salt || s.expires < Date.now() || s.expires - Date.now() > SESSION_MS + 60_000) { this.lock(); return false; }
    const key = await crypto.subtle.importKey('raw', b64ToBytes(s.key), 'AES-GCM', true, ['encrypt', 'decrypt']);
    if (!(await this.verify(key, m))) { this.lock(); return false; }
    this.key = key;
    this.everStored = true;
    this.until = s.expires;
    return true;
  }

  async unlock(password: string, m: VaultManifest): Promise<boolean> {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const raw = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(m.salt), iterations: m.iterations }, base, 256);
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
    if (!(await this.verify(key, m))) return false;
    this.key = key;
    this.until = Date.now() + Math.min(m.ttlHours * 3600_000, SESSION_MS);
    try {
      const s: StoredSession = { key: bytesToB64(new Uint8Array(raw)), salt: m.salt,
                                 expires: Date.now() + Math.min(m.ttlHours * 3600_000, SESSION_MS) };
      localStorage.setItem(this.storageKey, JSON.stringify(s));
      this.everStored = true;
    } catch { /* 無痕模式 */ }
    return true;
  }

  lock(): void {
    this.key = null;
    try { localStorage.removeItem(this.storageKey); } catch { /* 忽略 */ }
  }

  get unlocked(): boolean { return this.key !== null; }

  /** 工作階段是否已過期（看 localStorage；同一把鑰匙的其他頁面上鎖或過期都算）。過期就順便上鎖。 */
  expired(): boolean {
    if (!this.key) return false;
    let s: StoredSession | null = null;
    try { const raw = localStorage.getItem(this.storageKey); s = raw ? (JSON.parse(raw) as StoredSession) : null; } catch { return false; }
    // 記憶體裡的到期時間（無痕模式存不了 localStorage 時也照樣 6 小時踢出）
    const memExpired = Date.now() > this.until;
    if (!memExpired && s && s.expires >= Date.now()) return false;
    if (!memExpired && !s && !this.everStored) return false;      // 無痕模式：沒有存檔紀錄，只看記憶體
    this.lock();
    return true;
  }
  private everStored = false;
  private until = 0;

  /** 下載並解密一個 .enc 檔（IV(12) || 密文），manifest 標 compressed 時先 gunzip。 */
  async fetchJson<T>(file: string): Promise<T> {
    if (!this.key) throw new Error('尚未解鎖');
    const res = await fetch(`${this.dir}${file}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`取得資料失敗（HTTP ${res.status}）`);
    return this.decryptJson<T>(new Uint8Array(await res.arrayBuffer()));
  }

  /** 解密已取得的位元組（IV(12) || 密文）；例如從 GitHub API 直接讀回來的檔案（2026-10-06 私人持股同步）。 */
  async decryptJson<T>(bytes: Uint8Array): Promise<T> {
    if (!this.key) throw new Error('尚未解鎖');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, this.key, bytes.slice(12));
    if (!this.manifest?.compressed) return JSON.parse(new TextDecoder().decode(plain)) as T;
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text()) as T;
  }

  /** 加密成與上傳檔相同的格式（manifest 標 compressed 時先 gzip）：IV(12) || 密文。 */
  async encryptJson(obj: unknown): Promise<Uint8Array> {
    if (!this.key) throw new Error('尚未解鎖');
    let data = new TextEncoder().encode(JSON.stringify(obj));
    if (this.manifest?.compressed) {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, data));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv, 0);
    out.set(ct, 12);
    return out;
  }
}
