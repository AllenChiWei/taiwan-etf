/* 配息試算：跨裝置的「我的持股」（2026-10-05 建立；10-06 改成網站上就能儲存）。
 *
 * 持股平常存在各裝置自己的 localStorage（twetf.holdings、twetf.accounts）。這裡加上「私人持股」：
 *   ☁ 載入私人持股：直接讀 GitHub 上最新的加密檔（lib/ghSync.ts），用私人頁密碼解密 → 取代這台的持股。
 *   ☁ 儲存到私人持股：把這台的持股加密後直接寫回 GitHub，其他裝置按「載入」就拿到（不用等網站部署）。
 *   ⚙ 同步設定：第一次儲存前，貼上自己申請的 GitHub fine-grained 權杖（只限 taiwan-etf 倉庫、Contents 讀寫）；
 *               權杖用私人頁密碼加密後存成 token.enc，其他裝置解鎖後自動取用，只要設定一次。
 *   📋 複製持股資料：備用（貼給 Claude 用 holdings_export.py 發布，效果相同）。
 * 載入／儲存／同步設定每次進頁面都要當場輸入私人頁密碼（2026-10-06 使用者要求：不能因為這台解鎖過私人頁就能載入）；
 * 密碼只在記憶體驗證、不寫工作階段，離開頁面就清掉。已有持股時一律先確認才取代或覆蓋。
 * twetf.holdings.synced 記住這台最後一次載入／儲存的版本時間，私人持股比較新時提示。 */

import { useEffect, useState } from 'react';
import { Vault, type VaultManifest } from '../lib/vault';
import { ghRead, ghWrite, rawRead } from '../lib/ghSync';

export interface SyncEntry { code: string; shares: number; m?: 'us'; acct?: string }
interface Payload { v?: number; accounts?: unknown; holdings?: unknown; generated?: string }
interface Remote { holdings: SyncEntry[]; accounts: string[]; generated: string }

const holdingsVault = new Vault(`${import.meta.env.BASE_URL}data/holdings/`, 'twetf.v18.unlock');
const SYNCED_KEY = 'twetf.holdings.synced';

function clean(p: Payload): Remote {
  const holdings = (Array.isArray(p.holdings) ? p.holdings : []).filter((x): x is SyncEntry =>
    typeof x === 'object' && x !== null && typeof (x as SyncEntry).code === 'string'
    && Number.isFinite((x as SyncEntry).shares) && (x as SyncEntry).shares > 0);
  const accounts = (Array.isArray(p.accounts) ? p.accounts : []).filter((x): x is string => typeof x === 'string' && !!x.trim());
  return { holdings, accounts, generated: typeof p.generated === 'string' ? p.generated : '' };
}

const getSynced = () => { try { return localStorage.getItem(SYNCED_KEY) ?? ''; } catch { return ''; } };
const setSynced = (v: string) => { try { localStorage.setItem(SYNCED_KEY, v); } catch { /* 無痕模式 */ } };

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* 2026-10-07 修正：GitHub API 未登入時每個 IP 每小時只有 60 次（同一個家用網路共用），用完時讀不到權杖，
 * 畫面誤以為「還沒設定」而要求重貼權杖、載入也退回舊版。改成：
 *   權杖：API → raw.githubusercontent.com（不算 API 次數）→ 網站部署的那份；分清楚「沒有設定」與「暫時讀不到」。
 *   持股：有權杖就用權杖讀（每小時 5,000 次、一定是最新）；否則 API → raw → 部署版，並標明可能不是最新。 */
type Src = 'api' | 'raw' | 'site';

async function readRemote(token: string | null): Promise<{ r: Remote | null; src: Src | null }> {
  try {
    const f = await ghRead('holdings.enc', token ?? undefined);
    if (f) return { r: clean(await holdingsVault.decryptJson<Payload>(f.bytes)), src: 'api' };
  } catch { /* 改用備援 */ }
  try {
    const b = await rawRead('holdings.enc');
    if (b) return { r: clean(await holdingsVault.decryptJson<Payload>(b)), src: 'raw' };
  } catch { /* 改用部署的版本 */ }
  try { return { r: clean(await holdingsVault.fetchJson<Payload>('holdings.enc')), src: 'site' }; } catch { return { r: null, src: null }; }
}

async function readToken(): Promise<{ token: string | null; state: 'ok' | 'none' | 'error' }> {
  const pick = async (b: Uint8Array) => {
    const t = await holdingsVault.decryptJson<{ token?: string }>(b);
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
    const t = await holdingsVault.fetchJson<{ token?: string }>('token.enc');
    if (typeof t.token === 'string' && t.token) return { token: t.token, state: 'ok' };
  } catch { /* 都讀不到 */ }
  return { token: null, state: failed ? 'error' : 'none' };
}

export function HoldingsSync({ entries, accounts, onLoad }: {
  entries: readonly SyncEntry[];
  accounts: readonly string[];
  onLoad: (holdings: SyncEntry[], accounts: string[]) => void;
}) {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  /** 等待輸入密碼的動作 */
  const [ask, setAsk] = useState<'load' | 'save' | 'setup' | null>(null);
  const [pw, setPw] = useState('');
  const [remote, setRemote] = useState<Remote | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenState, setTokenState] = useState<'ok' | 'none' | 'error'>('none');
  const [src, setSrc] = useState<Src | null>(null);
  const [confirm, setConfirm] = useState<'load' | 'save' | null>(null);
  const [setup, setSetup] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [msg, setMsg] = useState('');
  const [synced, setSyncedState] = useState(getSynced);

  const text = JSON.stringify({ v: 1, accounts, holdings: entries });

  const apply = (r: Remote, s: Src | null = src) => {
    onLoad(r.holdings, r.accounts);
    setSynced(r.generated); setSyncedState(r.generated);
    setMsg(`已載入私人持股（${r.holdings.length} 檔，更新於 ${r.generated || '—'}）。`
      + (s && s !== 'api' ? 'GitHub 暫時限制讀取次數，這次讀到的是備援版本，可能不是最新；過幾分鐘再載入一次較保險。' : ''));
  };

  useEffect(() => {
    let cancelled = false;
    holdingsVault.forget();
    holdingsVault.loadManifest().then(m => { if (!cancelled) setManifest(m); }).catch(() => { /* 沒有私人持股就不顯示 */ });
    return () => { cancelled = true; holdingsVault.forget(); };
  }, []);

  /** 需要密碼的動作：已輸入過就直接做，否則先問密碼 */
  const guarded = (what: 'load' | 'save' | 'setup') => {
    setMsg('');
    if (unlocked) { run(what); return; }
    setAsk(what); setPw('');
  };

  const submitPw = async () => {
    if (!manifest || !pw) return;
    setBusy(true);
    try {
      if (!(await holdingsVault.unlockTransient(pw, manifest))) { setMsg('密碼不對。'); return; }
      setUnlocked(true); setPw('');
      const tk = await readToken();
      const { r, src: s } = await readRemote(tk.token);
      setRemote(r); setToken(tk.token); setTokenState(tk.state); setSrc(s);
      const what = ask; setAsk(null);
      if (what) await run(what, r, tk.token, tk.state, s);
    } finally { setBusy(false); }
  };

  const run = async (what: 'load' | 'save' | 'setup', r: Remote | null = remote, t: string | null = token,
                     ts: 'ok' | 'none' | 'error' = tokenState, s: Src | null = src) => {
    if (what === 'setup') { setSetup(v => !v); return; }
    if (what === 'load') {
      if (!r || !r.holdings.length) { setMsg('私人持股是空的，或暫時讀不到（GitHub 限制讀取次數），請過幾分鐘再試。'); return; }
      if (entries.length === 0) apply(r, s); else setConfirm('load');
      return;
    }
    if (!t && ts === 'error') { setMsg('暫時讀不到已存的同步權杖（GitHub 限制讀取次數），請過幾分鐘再按「儲存」；權杖已經設定好，不用重新貼。'); return; }
    if (!t) { setSetup(true); setMsg('第一次儲存前要先設定同步權杖（只要一次）。'); return; }
    setConfirm('save');
  };

  const doSave = async () => {
    if (!token) return;
    setBusy(true); setMsg('');
    try {
      const generated = nowStamp();
      const bytes = await holdingsVault.encryptJson({ v: 1, generated, accounts, holdings: entries });
      await ghWrite('holdings.enc', bytes, token, `資料：我的持股（網站儲存，${entries.length} 檔，已加密）`);
      setSynced(generated); setSyncedState(generated);
      setRemote({ holdings: [...entries], accounts: [...accounts], generated }); setSrc('api');
      setMsg(`已儲存到私人持股（${entries.length} 檔）。其他裝置到配息頁按「☁ 載入私人持股」即可。`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); setConfirm(null); }
  };

  const saveToken = async () => {
    const t = draft.trim();
    if (!t) return;
    setBusy(true); setMsg('');
    try {
      const bytes = await holdingsVault.encryptJson({ token: t, saved: nowStamp() });
      await ghWrite('token.enc', bytes, t, '資料：私人持股同步設定（權杖已用私人頁密碼加密）');
      setToken(t); setSetup(false); setDraft('');
      setMsg('同步設定完成。其他裝置解鎖後也能直接儲存，不用再設定。');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const copy = () => {
    setMsg('');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => setCopyState('copied')).catch(() => setCopyState('manual'));
    } else setCopyState('manual');
  };

  const btn = 'h-9 rounded-lg px-1.5 font-semibold text-accent hover:underline disabled:opacity-40';
  const newer = !!(remote?.generated && remote.generated !== synced);
  return (
    <div className="mt-2 border-t border-line pt-2 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted">我的持股</span>
        {manifest && (
          <>
            <button type="button" onClick={() => guarded('load')} disabled={busy} className={btn}>☁ 載入私人持股</button>
            <button type="button" onClick={() => guarded('save')} disabled={busy || entries.length === 0} className={btn}>☁ 儲存到私人持股</button>
            <button type="button" onClick={() => guarded('setup')} disabled={busy} className="h-9 rounded-lg px-1.5 text-muted hover:text-ink">⚙ 同步設定</button>
          </>
        )}
        <button type="button" onClick={copy} disabled={entries.length === 0}
                className="h-9 rounded-lg px-1.5 text-muted hover:text-ink disabled:opacity-40">📋 複製</button>
        {copyState === 'copied' && <span className="text-faint">已複製（{entries.length} 檔）</span>}
      </div>

      {ask && manifest && (
        <form className="mt-1 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void submitPw(); }}>
          <span className="text-muted">輸入私人頁密碼：</span>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus autoComplete="current-password"
                 aria-label="私人頁密碼" className="h-9 w-40 min-w-0 rounded-lg border border-line bg-bg px-2 text-[13px] text-ink" />
          <button type="submit" disabled={busy || !pw} className={btn}>確定</button>
          <button type="button" onClick={() => { setAsk(null); setPw(''); }} className="h-9 rounded-lg px-1.5 font-semibold text-muted">取消</button>
        </form>
      )}

      {unlocked && remote && (
        <p className={`text-[11px] ${newer ? 'font-semibold text-up' : 'text-faint'}`}>
          私人持股 {remote.holdings.length} 檔，更新於 {remote.generated || '—'}
          {newer ? '：比這台的持股新，按「☁ 載入私人持股」更新' : (synced ? '：這台已是最新' : '')}。
        </p>
      )}

      {setup && unlocked && (
        <div className="mt-1 rounded-lg border border-line p-2">
          <p className="text-[11.5px] text-muted">
            {token ? '已設定同步權杖。要更換時貼上新的權杖：' : '貼上你在 GitHub 申請的權杖（只限 taiwan-etf 倉庫、Contents 讀寫）。會用私人頁密碼加密後存放，只要設定一次：'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input type="password" value={draft} onChange={e => setDraft(e.target.value)} autoComplete="off" spellCheck={false}
                   placeholder="github_pat_…" aria-label="GitHub 權杖"
                   className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 font-mono text-[12px] text-ink" />
            <button type="button" onClick={saveToken} disabled={busy || !draft.trim()} className={btn}>儲存設定</button>
          </div>
        </div>
      )}

      {confirm === 'load' && remote && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-ink">用私人持股（{remote.holdings.length} 檔，{remote.generated || '—'}）取代這台目前的 {entries.length} 檔？</span>
          <button type="button" className="h-9 rounded-lg px-1.5 font-semibold text-up" onClick={() => { apply(remote); setConfirm(null); }}>確定取代</button>
          <button type="button" className="h-9 rounded-lg px-1.5 font-semibold text-muted" onClick={() => setConfirm(null)}>取消</button>
        </div>
      )}
      {confirm === 'save' && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-ink">
            用這台的 {entries.length} 檔覆蓋私人持股{remote ? `（目前 ${remote.holdings.length} 檔，${remote.generated || '—'}）` : ''}？
            {newer ? ' 注意：私人持股比這台新，覆蓋後那份就不見了。' : ''}
          </span>
          <button type="button" className="h-9 rounded-lg px-1.5 font-semibold text-up" disabled={busy} onClick={doSave}>確定儲存</button>
          <button type="button" className="h-9 rounded-lg px-1.5 font-semibold text-muted" onClick={() => setConfirm(null)}>取消</button>
        </div>
      )}

      {copyState === 'manual' && (
        <div className="mt-1">
          <p className="text-[11px] text-faint">無法自動複製，請長按下面的文字全選後複製：</p>
          <textarea readOnly value={text} rows={3} onFocus={e => e.currentTarget.select()}
                    className="mt-1 w-full rounded-lg border border-line bg-bg p-2 font-mono text-[11px] text-ink" />
        </div>
      )}
      {busy && <p className="text-[11.5px] text-muted">處理中…</p>}
      {msg && <p className="text-[11.5px] text-muted">{msg}</p>}
    </div>
  );
}
