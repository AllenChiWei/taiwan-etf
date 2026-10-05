/* QB 策略層評價看板（#/QB，與 v18 共用同一組密碼）。
 *
 * 資料由使用者自己的電腦產生（D:\ai\QuantBrainsAIO\Release\_rebuild\research\qb_dashboard.py），
 * qb_publish.py 用 v18 的同一個 salt 與密碼加密後才推上來；網站只拿得到密文。
 * 因為 salt 相同、localStorage 鍵也相同（'twetf.v18.unlock'），在 v18 頁解鎖過這裡就不用再輸入，反之亦然。
 * 看板本體在 lib/qbDashboard.ts（本機 HTML 也用同一份），ECharts 只在這一頁才載入。
 * 入口在上方選單「🔒 私人」（#/me）。
 *
 * 2026-10-05：同一個元件也用在 #/QBA —— Export 第一層＋Activate 合併的獨立版本（資料在 data/qba/，
 * 由 QB_EXPORT_DIR／QB_OUT_DIR 切換後的 qb_dashboard.py 產生），兩份資料完全分開。 */

import { useEffect, useRef, useState } from 'react';
import { Vault, type VaultManifest } from '../lib/vault';

interface Variant { dir: string; title: string; note?: string }

function Locked({ vault, title, manifest, onUnlock }: { vault: Vault; title: string; manifest: VaultManifest; onUnlock: () => void }) {
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
      <h1 className="text-sm font-bold text-ink">{title}</h1>
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

function QbBoard({ v }: { v: Variant }) {
  const vault = useState(() => new Vault(`${import.meta.env.BASE_URL}data/${v.dir}/`, 'twetf.v18.unlock'))[0];
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
  }, [vault]);

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
        () => vault.fetchJson<unknown>('blend.enc').catch(() => null),
        { title: v.title, note: v.note });
    }).catch(e => { setMsg(String(e)); setState('error'); });
    return () => { cancelled = true; unmount?.(); };
  }, [state, data, vault, v]);

  if (state === 'loading') return <p className="py-16 text-center text-[13px] text-muted">載入中…</p>;
  if (state === 'missing') return <p className="py-16 text-center text-[13px] text-muted">還沒有資料。</p>;
  if (state === 'locked' && manifest) return <Locked vault={vault} title={v.title} manifest={manifest} onUnlock={load} />;
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

const QB: Variant = { dir: 'qb', title: 'QB 策略層評價看板' };
const QBA: Variant = {
  dir: 'qba',
  title: 'QB 策略層評價看板（Export＋Activate 合併版）',
  note: '資料：<b>Export 第一層＋Export\\Activate 的策略合在一起</b>（每個策略拆成多方 _L、空方 _S），'
    + '與 #/QB（只有 Export 第一層、不含 Activate）是兩份獨立的回測，可以對照看加入 Activate 後的差異。'
    + '<b>注意：Activate 是看過績效之後才挑出來的，含 Activate 的結果會比實際樂觀（選擇偏誤）</b>。'
    + '分數只用前一天收盤以前的資料；「QB 序位」「QB 分多空」照複製版 QB 規則逐日模擬。',
};

export function QBPage() { return <QbBoard key="qb" v={QB} />; }
export function QBAPage() { return <QbBoard key="qba" v={QBA} />; }
