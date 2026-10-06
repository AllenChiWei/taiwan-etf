/* 私人入口（#/me）：v18、QB 看板、對帳單分析放在同一頁。密碼與 v18／QB 相同（共用解鎖工作階段）。
 * 上方選單只有「🔒 私人」一個入口（2026-10-05 使用者要求看得到），不寫進更新日誌。頁面本身只是連結；各頁的資料都在本機加密後才上傳。 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Vault, type VaultManifest } from '../lib/vault';
import { loadV18IfUnlocked, v18Vault, type V18Data } from '../lib/v18';
import type { EquityData } from '../lib/accountEquity';
import { EquitySection } from '../components/EquitySection';
import { QbFlow } from '../components/QbFlow';
import { useVaultExpiry } from '../hooks/useVaultExpiry';
import { SESSION_HOURS } from '../lib/vault';

const qbVault = new Vault(`${import.meta.env.BASE_URL}data/qb/`, 'twetf.v18.unlock');
// 元大實盤權益：DashBoard_AI\equity_export.py 用同一把密碼、同一個 salt 加密
const equityVault = new Vault(`${import.meta.env.BASE_URL}data/equity/`, 'twetf.v18.unlock');
async function loadEquityIfUnlocked(): Promise<EquityData | null> {
  try {
    const m = await equityVault.loadManifest();
    if (!m || (!equityVault.unlocked && !(await equityVault.restore(m)))) return null;
    return await equityVault.fetchJson<EquityData>('equity.enc');
  } catch {
    return null;
  }
}
const pct = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;

export function MePage() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'locked' | 'ready' | 'missing'>('loading');
  const [v18, setV18] = useState<V18Data | null>(null);
  const [qb, setQb] = useState<VaultManifest | null>(null);
  const [equity, setEquity] = useState<EquityData | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const loadAll = async () => {
    setV18(await loadV18IfUnlocked());
    setQb(await qbVault.loadManifest().catch(() => null));
    setEquity(await loadEquityIfUnlocked());
    setState('ready');
  };

  useEffect(() => {
    v18Vault.loadManifest().then(async m => {
      if (!m) { setState('missing'); return; }
      setManifest(m);
      if (v18Vault.unlocked || await v18Vault.restore(m)) await loadAll(); else setState('locked');
    }).catch(() => setState('missing'));
  }, []);
  useEffect(() => { if (state === 'locked') ref.current?.focus(); }, [state]);
  const kick = useCallback(() => { setState('locked'); setV18(null); setEquity(null); }, []);
  useVaultExpiry(v18Vault, state === 'ready', kick);

  if (state === 'loading') return <p className="py-16 text-center text-[13px] text-muted">載入中…</p>;
  if (state === 'missing') return <p className="py-16 text-center text-[13px] text-muted">還沒有資料。</p>;
  if (state === 'locked' && manifest) {
    return (
      <form className="mx-auto mt-10 max-w-sm rounded-xl border border-line bg-surface p-5"
            onSubmit={async e => {
              e.preventDefault();
              setBusy(true); setErr(null);
              const ok = await v18Vault.unlock(pw, manifest);
              setBusy(false);
              if (ok) await loadAll(); else setErr('密碼不正確');
            }}>
        <h1 className="text-sm font-bold text-ink">我的工具</h1>
        <p className="mt-1 text-[12px] text-muted">這一頁需要密碼（與 v18、QB 相同）。</p>
        <input ref={ref} type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password"
               className="mt-3 h-10 w-full rounded-lg border border-line bg-bg px-3 text-[14px] text-ink" placeholder="密碼" />
        {err && <p className="mt-2 text-[12px] text-down">{err}</p>}
        <button type="submit" disabled={busy || !pw}
                className="mt-3 h-10 w-full rounded-lg bg-accent text-[13px] font-semibold text-accent-ink disabled:opacity-50">
          {busy ? '解鎖中…' : '解鎖'}
        </button>
      </form>
    );
  }

  const card = 'block rounded-xl border border-line bg-surface p-4 hover:bg-hover';
  return (
    <div className="mt-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-base font-bold text-ink">我的工具</h1>
        <button type="button" onClick={() => { v18Vault.lock(); setState('locked'); setV18(null); setEquity(null); }}
                className="h-7 rounded-lg bg-sunken px-3 text-[12px] text-muted hover:text-ink">上鎖</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/v18" className={card}>
          <div className="text-sm font-bold text-ink">v18 策略</div>
          {v18 ? (
            <p className="mt-1 text-[12.5px] text-muted">
              資料截至 {v18.asof}　·　今年 <span className={v18.stats.ytd >= 0 ? 'text-up' : 'text-down'}>{pct(v18.stats.ytd)}</span>
              {'　·　'}持股 {v18.holdings.length} 檔　·　{v18.regime.bull ? '可做多' : '全數空倉'}
              {v18.actions.length > 0 && <span className="font-semibold text-ink">　·　明日動作 {v18.actions.length} 筆</span>}
            </p>
          ) : <p className="mt-1 text-[12.5px] text-muted">績效、持股、選股名單</p>}
        </Link>
        <Link to="/QB" className={card}>
          <div className="text-sm font-bold text-ink">QB 策略層評價看板</div>
          <p className="mt-1 text-[12.5px] text-muted">
            A → B → C（評價前、QB 評價後、自動槓桿）比較、每年／每月明細、單一策略曲線、v18＋QB 組合；
            看板上方可切換策略池（原本 Export／Export＋Activate）{qb?.updated ? `　·　資料 ${qb.updated}` : ''}
          </p>
        </Link>
        <Link to="/QBF" className={card}>
          <div className="text-sm font-bold text-ink">QB 流程比較（A → B → C → 複利）</div>
          <p className="mt-1 text-[12.5px] text-muted">
            三個策略池（原本／合併／盲測）切換；A 評價前 → B 評價後 → C 自動槓桿（集成／海龜）→ 複利，同風險或原始規模、每年報酬
          </p>
        </Link>
        <Link to="/futures" className={card}>
          <div className="text-sm font-bold text-ink">對帳單分析</div>
          <p className="mt-1 text-[12.5px] text-muted">程式／主觀／選擇權分開看，檔案只在瀏覽器裡解析、不上傳</p>
        </Link>
        <Link to="/chips" className={card}>
          <div className="text-sm font-bold text-ink">選擇權賣方決策卡</div>
          <p className="mt-1 text-[12.5px] text-muted">在籌碼頁：預期波動 ÷ 實際波動、建議履約價（公開頁面）</p>
        </Link>
      </div>
      {equity && <EquitySection data={equity} />}
      <QbFlow />
      <p className="mt-3 text-[11.5px] text-faint">解鎖一次後 v18、QB 也不用再輸入密碼；{SESSION_HOURS} 小時後自動上鎖，需要重新輸入。</p>
    </div>
  );
}
