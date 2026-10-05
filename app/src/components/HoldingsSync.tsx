/* 配息試算：跨裝置的「我的持股」（2026-10-05 使用者要求：手機、電腦不要各輸入一次）。
 *
 * 持股平常存在各裝置自己的 localStorage（twetf.holdings、twetf.accounts）。這裡多兩件事：
 *   1. 複製持股資料：把這台裝置的持股與帳戶變成一段文字，貼給 Claude。
 *   2. 載入我的持股（私人）：Claude 把那段資料存成 D:\ai\DashBoard_AI\my_holdings.json，
 *      holdings_export.py 用 v18 同一組密碼加密後放到 data/holdings/；解鎖過私人頁就能載入，
 *      所有裝置讀同一份。這台沒有持股時自動載入；已有持股時先確認才取代。
 * 載入後照樣寫回 localStorage，行事曆「只看我的」等用到持股的地方都跟著更新。 */

import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault } from '../lib/vault';

export interface SyncEntry { code: string; shares: number; m?: 'us'; acct?: string }
interface Payload { v?: number; accounts?: unknown; holdings?: unknown; updated?: string }

const holdingsVault = new Vault(`${import.meta.env.BASE_URL}data/holdings/`, 'twetf.v18.unlock');

function clean(p: Payload): { holdings: SyncEntry[]; accounts: string[] } {
  const holdings = (Array.isArray(p.holdings) ? p.holdings : []).filter((x): x is SyncEntry =>
    typeof x === 'object' && x !== null && typeof (x as SyncEntry).code === 'string'
    && Number.isFinite((x as SyncEntry).shares) && (x as SyncEntry).shares > 0);
  const accounts = (Array.isArray(p.accounts) ? p.accounts : []).filter((x): x is string => typeof x === 'string' && !!x.trim());
  return { holdings, accounts };
}

export function HoldingsSync({ entries, accounts, onLoad }: {
  entries: readonly SyncEntry[];
  accounts: readonly string[];
  onLoad: (holdings: SyncEntry[], accounts: string[]) => void;
}) {
  const [priv, setPriv] = useState<'none' | 'locked' | 'ready'>('none');
  const [updated, setUpdated] = useState('');
  const [pending, setPending] = useState<{ holdings: SyncEntry[]; accounts: string[] } | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [msg, setMsg] = useState('');

  const text = JSON.stringify({ v: 1, accounts, holdings: entries });

  const fetchPriv = () => holdingsVault.fetchJson<Payload>('holdings.enc').then(clean);

  useEffect(() => {
    let cancelled = false;
    holdingsVault.loadManifest().then(async m => {
      if (!m || cancelled) return;
      setUpdated(m.updated ?? '');
      if (!(await holdingsVault.restore(m))) { if (!cancelled) setPriv('locked'); return; }
      if (cancelled) return;
      setPriv('ready');
      if (entries.length === 0) {                       // 這台還沒有持股：直接載入
        const d = await fetchPriv();
        if (!cancelled && d.holdings.length) { onLoad(d.holdings, d.accounts); setMsg(`已載入私人持股（${d.holdings.length} 檔）。`); }
      }
    }).catch(() => { /* 沒有私人持股檔就不顯示 */ });
    return () => { cancelled = true; };
    // 只在進頁面時檢查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = () => {
    setMsg('');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => setCopyState('copied')).catch(() => setCopyState('manual'));
    } else setCopyState('manual');
  };

  const loadPriv = () => {
    setMsg('');
    fetchPriv().then(d => {
      if (!d.holdings.length) { setMsg('私人持股是空的。'); return; }
      if (entries.length === 0) { onLoad(d.holdings, d.accounts); setMsg(`已載入私人持股（${d.holdings.length} 檔）。`); }
      else setPending(d);
    }).catch(e => setMsg(`載入失敗：${e instanceof Error ? e.message : String(e)}`));
  };

  const btn = 'h-9 rounded-lg px-1.5 font-semibold text-accent hover:underline';
  return (
    <div className="mt-2 border-t border-line pt-2 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted">我的持股</span>
        {priv === 'ready' && <button type="button" onClick={loadPriv} className={btn}>☁ 載入私人持股</button>}
        {priv === 'locked' && (
          <span className="text-faint">私人持股需先到 <Link to="/me" className="font-semibold text-accent hover:underline">🔒 私人</Link> 解鎖</span>
        )}
        <button type="button" onClick={copy} disabled={entries.length === 0} className={`${btn} disabled:opacity-40`}>
          📋 複製持股資料
        </button>
        {copyState === 'copied' && <span className="text-faint">已複製（{entries.length} 檔），貼給 Claude 即可</span>}
      </div>
      {updated && priv !== 'none' && <p className="text-[11px] text-faint">私人持股更新於 {updated}；手機、電腦讀同一份。</p>}
      {copyState === 'manual' && (
        <div className="mt-1">
          <p className="text-[11px] text-faint">無法自動複製，請長按下面的文字全選後複製：</p>
          <textarea readOnly value={text} rows={3} onFocus={e => e.currentTarget.select()}
                    className="mt-1 w-full rounded-lg border border-line bg-bg p-2 font-mono text-[11px] text-ink" />
        </div>
      )}
      {pending && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-ink">要用私人持股（{pending.holdings.length} 檔、{pending.accounts.length || 1} 個帳戶）取代這台裝置目前的 {entries.length} 檔嗎？</span>
          <button type="button" className="h-9 rounded-lg px-1.5 font-semibold text-up"
                  onClick={() => { onLoad(pending.holdings, pending.accounts); setMsg(`已載入私人持股（${pending.holdings.length} 檔）。`); setPending(null); }}>
            確定取代
          </button>
          <button type="button" className="h-9 rounded-lg px-1.5 font-semibold text-muted" onClick={() => setPending(null)}>取消</button>
        </div>
      )}
      {msg && <p className="text-[11.5px] text-muted">{msg}</p>}
    </div>
  );
}
