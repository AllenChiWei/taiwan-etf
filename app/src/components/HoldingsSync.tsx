/* 配息試算：跨裝置的「我的持股」（2026-10-05 建立；10-06 改成網站上就能儲存）。
 *
 * 持股平常存在各裝置自己的 localStorage（twetf.holdings、twetf.accounts）。這裡加上「私人持股」：
 *   ☁ 載入私人持股：直接讀 GitHub 上最新的加密檔（lib/ghSync.ts），用私人頁密碼解密 → 取代這台的持股。
 *   ☁ 儲存到私人持股：把這台的持股加密後直接寫回 GitHub，其他裝置按「載入」就拿到（不用等網站部署）。
 *   ⚙ 同步設定：第一次儲存前，貼上自己申請的 GitHub fine-grained 權杖（只限 taiwan-etf 倉庫、Contents 讀寫）；
 *               權杖用私人頁密碼加密後存成 token.enc，其他裝置解鎖後自動取用，只要設定一次。
 *   📋 複製持股資料：備用（貼給 Claude 用 holdings_export.py 發布，效果相同）。
 * 這台沒有持股、而私人持股有資料時自動載入；已有持股時一律先確認才取代或覆蓋。
 * twetf.holdings.synced 記住這台最後一次載入／儲存的版本時間，私人持股比較新時提示。 */

import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault } from '../lib/vault';
import { ghRead, ghWrite } from '../lib/ghSync';

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

/** 私人持股：GitHub 上的最新版優先；讀不到（例如 API 次數用完）就用網站上已部署的那份 */
async function readRemote(): Promise<Remote | null> {
  try {
    const f = await ghRead('holdings.enc');
    if (f) return clean(await holdingsVault.decryptJson<Payload>(f.bytes));
  } catch { /* 改用部署的版本 */ }
  try { return clean(await holdingsVault.fetchJson<Payload>('holdings.enc')); } catch { return null; }
}

async function readToken(): Promise<string | null> {
  try {
    const f = await ghRead('token.enc');
    if (!f) return null;
    const t = await holdingsVault.decryptJson<{ token?: string }>(f.bytes);
    return typeof t.token === 'string' && t.token ? t.token : null;
  } catch { return null; }
}

export function HoldingsSync({ entries, accounts, onLoad }: {
  entries: readonly SyncEntry[];
  accounts: readonly string[];
  onLoad: (holdings: SyncEntry[], accounts: string[]) => void;
}) {
  const [priv, setPriv] = useState<'none' | 'locked' | 'ready'>('none');
  const [remote, setRemote] = useState<Remote | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'load' | 'save' | null>(null);
  const [setup, setSetup] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [msg, setMsg] = useState('');
  const [synced, setSyncedState] = useState(getSynced);

  const text = JSON.stringify({ v: 1, accounts, holdings: entries });

  const apply = (r: Remote) => {
    onLoad(r.holdings, r.accounts);
    setSynced(r.generated); setSyncedState(r.generated);
    setMsg(`已載入私人持股（${r.holdings.length} 檔，更新於 ${r.generated || '—'}）。`);
  };

  useEffect(() => {
    let cancelled = false;
    holdingsVault.loadManifest().then(async m => {
      if (!m || cancelled) return;
      if (!(await holdingsVault.restore(m))) { if (!cancelled) setPriv('locked'); return; }
      if (cancelled) return;
      setPriv('ready');
      const [r, t] = await Promise.all([readRemote(), readToken()]);
      if (cancelled) return;
      setRemote(r);
      setToken(t);
      if (r && r.holdings.length && entries.length === 0) apply(r);       // 這台還沒有持股：直接載入
    }).catch(() => { /* 沒有私人持股就不顯示 */ });
    return () => { cancelled = true; };
    // 只在進頁面時檢查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startLoad = async () => {
    setMsg(''); setBusy(true);
    try {
      const r = await readRemote();
      setRemote(r);
      if (!r || !r.holdings.length) { setMsg('私人持股是空的。'); return; }
      if (entries.length === 0) apply(r); else setConfirm('load');
    } finally { setBusy(false); }
  };

  const startSave = async () => {
    setMsg('');
    if (!token) { setSetup(true); setMsg('第一次儲存前要先設定同步權杖（只要一次）。'); return; }
    setBusy(true);
    try { setRemote(await readRemote()); setConfirm('save'); } finally { setBusy(false); }
  };

  const doSave = async () => {
    if (!token) return;
    setBusy(true); setMsg('');
    try {
      const generated = nowStamp();
      const bytes = await holdingsVault.encryptJson({ v: 1, generated, accounts, holdings: entries });
      await ghWrite('holdings.enc', bytes, token, `資料：我的持股（網站儲存，${entries.length} 檔，已加密）`);
      setSynced(generated); setSyncedState(generated);
      setRemote({ holdings: [...entries], accounts: [...accounts], generated });
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
        {priv === 'ready' && (
          <>
            <button type="button" onClick={startLoad} disabled={busy} className={btn}>☁ 載入私人持股</button>
            <button type="button" onClick={startSave} disabled={busy || entries.length === 0} className={btn}>☁ 儲存到私人持股</button>
            <button type="button" onClick={() => { setSetup(v => !v); setMsg(''); }} className="h-9 rounded-lg px-1.5 text-muted hover:text-ink">⚙ 同步設定</button>
          </>
        )}
        {priv === 'locked' && (
          <span className="text-faint">私人持股需先到 <Link to="/me" className="font-semibold text-accent hover:underline">🔒 私人</Link> 解鎖</span>
        )}
        <button type="button" onClick={copy} disabled={entries.length === 0}
                className="h-9 rounded-lg px-1.5 text-muted hover:text-ink disabled:opacity-40">📋 複製</button>
        {copyState === 'copied' && <span className="text-faint">已複製（{entries.length} 檔）</span>}
      </div>

      {priv === 'ready' && remote && (
        <p className={`text-[11px] ${newer ? 'font-semibold text-up' : 'text-faint'}`}>
          私人持股 {remote.holdings.length} 檔，更新於 {remote.generated || '—'}
          {newer ? '：比這台的持股新，按「☁ 載入私人持股」更新' : (synced ? '：這台已是最新' : '')}。
        </p>
      )}

      {setup && priv === 'ready' && (
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
