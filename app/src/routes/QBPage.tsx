/* QB 策略層評價看板（#/QB，與 v18 共用同一組密碼）。
 *
 * 資料由使用者自己的電腦產生（D:\ai\QuantBrainsAIO\Release\_rebuild\research\qb_dashboard.py），
 * qb_publish.py 用 v18 的同一個 salt 與密碼加密後才推上來；網站只拿得到密文。
 * 因為 salt 相同、localStorage 鍵也相同（'twetf.v18.unlock'），在 v18 頁解鎖過這裡就不用再輸入，反之亦然。
 * 看板本體在 lib/qbDashboard.ts（本機 HTML 也用同一份），ECharts 只在這一頁才載入。
 * 刻意不放進上方選單、也不寫進更新日誌。 */

import { useEffect, useRef, useState } from 'react';
import { Vault, type VaultManifest } from '../lib/vault';

const vault = new Vault(`${import.meta.env.BASE_URL}data/qb/`, 'twetf.v18.unlock');

function Locked({ manifest, onUnlock }: { manifest: VaultManifest; onUnlock: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <form className="mx-auto mt-10 max-w-sm rounded-xl border border-line bg-surface p-5"
          onSubmit={async e => {
            e.preventDefault();
            setBusy(true); setErr(null);
            const ok = await vault.unlock(pw, manifest);
            setBusy(false);
            if (ok) onUnlock(); else setErr('密碼不正確');
          }}>
      <h1 className="text-sm font-bold text-ink">QB 策略層評價</h1>
      <p className="mt-1 text-[12px] text-muted">這一頁需要密碼（與 v18 相同）。</p>
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

export function QBPage() {
  const [manifest, setManifest] = useState<VaultManifest | null>(null);
  const [state, setState] = useState<'loading' | 'missing' | 'locked' | 'ready' | 'error'>('loading');
  const [msg, setMsg] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<unknown>(null);

  const load = async () => {
    try {
      setState('loading');
      setData(await vault.fetchJson<unknown>('base.enc'));
      setState('ready');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  };

  useEffect(() => {
    vault.loadManifest().then(async m => {
      if (!m) { setState('missing'); return; }
      setManifest(m);
      if (await vault.restore(m)) await load(); else setState('locked');
    }).catch(e => { setMsg(String(e)); setState('error'); });
  }, []);

  // 資料到了才載入 ECharts 與看板程式（兩者都只在這一頁用到）
  useEffect(() => {
    if (state !== 'ready' || !data || !host.current) return;
    let unmount: (() => void) | null = null;
    let cancelled = false;
    Promise.all([import('echarts'), import('../lib/qbDashboard')]).then(([echarts, mod]) => {
      if (cancelled || !host.current) return;
      unmount = mod.mountQbDashboard(host.current, data, echarts,
        (key: string) => vault.fetchJson<number[][]>(`w_${key}.enc`),
        // v18 ＋ QB 組合（另一檔；舊資料沒有這檔就不顯示該區塊）
        () => vault.fetchJson<unknown>('blend.enc').catch(() => null));
    }).catch(e => { setMsg(String(e)); setState('error'); });
    return () => { cancelled = true; unmount?.(); };
  }, [state, data]);

  if (state === 'loading') return <p className="py-16 text-center text-[13px] text-muted">載入中…</p>;
  if (state === 'missing') return <p className="py-16 text-center text-[13px] text-muted">還沒有資料。</p>;
  if (state === 'locked' && manifest) return <Locked manifest={manifest} onUnlock={load} />;
  if (state === 'error') return <p className="py-16 text-center text-[13px] text-down">載入失敗：{msg}</p>;
  return (
    <div className="mt-4">
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => { vault.lock(); setData(null); setState('locked'); }}
                className="h-7 rounded-lg bg-sunken px-3 text-[12px] text-muted hover:text-ink">上鎖</button>
      </div>
      <div ref={host} />
    </div>
  );
}
