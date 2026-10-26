/* 月領試算＋分享圖卡（2026-10-26）。計算在 lib/monthlyIncome.ts。
 *
 * 圖卡用 canvas 畫（1080×1350，IG／FB 直式），手機支援 Web Share 就直接分享，否則下載 PNG。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchEtfDividends, fetchYields } from '../api/extras';
import { fetchDataset } from '../api/etfs';
import { DEFAULT_CODES, incomeRow, type IncomeRow } from '../lib/monthlyIncome';
import type { EtfDividendData, YieldData } from '../lib/dividend';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wan = (v: number) => `${nf0.format(Math.round(v / 1e4))} 萬`;

export function MonthlyIncome() {
  const [src, setSrc] = useState<{ d: EtfDividendData; y: YieldData; etfs: { code: string; name: string; freq: string }[]; asof: string } | null>(null);
  const [monthly, setMonthly] = useState(10000);
  const [codes, setCodes] = useState<string[]>(DEFAULT_CODES);
  const [add, setAdd] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([fetchEtfDividends(ac.signal), fetchYields(ac.signal), fetchDataset(ac.signal)]).then(([d, y, ds]) => {
      if (!ac.signal.aborted && d && y) {
        setSrc({ d, y, etfs: ds.etfs.map(e => ({ code: e.code, name: e.name, freq: e.freq })), asof: ds.meta.yieldAsof ?? ds.meta.updated });
      }
    }).catch(() => {});
    return () => ac.abort();
  }, []);

  const rows = useMemo<IncomeRow[]>(() => {
    if (!src) return [];
    const by = new Map(src.etfs.map(e => [e.code, e]));
    return codes.map(c => {
      const e = by.get(c);
      return e ? incomeRow(c, e.name, e.freq, src.d.dividends[c], src.y.yields[c]?.price, monthly) : null;
    }).filter((r): r is IncomeRow => r !== null).sort((a, b) => a.capital - b.capital);
  }, [src, codes, monthly]);

  if (!src) return null;
  const addCode = () => {
    const c = add.trim().toUpperCase();
    if (!c) return;
    if (!src.etfs.some(e => e.code === c)) { setMsg(`找不到 ${c}`); return; }
    if (!src.d.dividends[c]) { setMsg(`${c} 還沒有配息紀錄`); return; }
    setCodes(cs => (cs.includes(c) ? cs : [...cs, c]));
    setAdd('');
    setMsg('');
  };

  return (
    <section className="mb-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-bold text-ink">月領試算：每月想領多少，要買幾張？</h2>
        <span className="text-[11.5px] text-faint">近一年實際配息 · {src.asof} 收盤價</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-[12.5px] text-muted">每月想領</label>
        {[5000, 10000, 20000, 30000, 50000].map(v => (
          <button key={v} type="button" onClick={() => setMonthly(v)}
                  className={`h-8 rounded-lg px-2.5 text-[12.5px] font-semibold ${monthly === v ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
            {nf0.format(v)}
          </button>
        ))}
        <input type="number" min={1000} step={1000} value={monthly} onChange={e => setMonthly(Math.max(0, Number(e.target.value) || 0))}
               aria-label="每月想領（元）" className="h-8 w-24 rounded-lg border border-line bg-bg px-2 text-[13px] text-ink" />
      </div>

      <ul className="mt-2.5">
        {rows.map(r => (
          <li key={r.code} className="grid grid-cols-[1fr_auto] items-baseline gap-2 border-b border-line/60 py-1.5 last:border-0">
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-ink">
                <span className="font-mono text-[12px] text-muted">{r.code}</span> {r.name}
                <button type="button" aria-label={`移除 ${r.code}`} onClick={() => setCodes(cs => cs.filter(c => c !== r.code))}
                        className="ml-1.5 text-[11px] text-faint hover:text-down">✕</button>
              </span>
              <span className="block text-[10.5px] text-faint">
                {r.freq} · 殖利率 {nf2.format(r.yieldPct)}%
                {r.estimated && <span className="whitespace-nowrap text-accent">（只配過 {r.paid} 次，年化推估）</span>} · 每次約 {nf0.format(r.perPayment)} 元 ·{' '}
                {r.nhi ? <span className="whitespace-nowrap text-up">扣健保年約 {nf0.format(r.nhiYear)} 元</span> : <span className="whitespace-nowrap">不扣健保</span>}
              </span>
            </span>
            <span className="text-right">
              <span className="block font-mono text-[14px] font-bold tabular-nums text-ink">{nf0.format(r.lots)} 張</span>
              <span className="block font-mono text-[11px] tabular-nums text-faint">本金 {wan(r.capital)}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={add} onChange={e => setAdd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCode(); }}
               placeholder="加入代號，例如 00918" aria-label="加入 ETF 代號"
               className="h-8 w-40 rounded-lg border border-line bg-bg px-2 text-[13px] text-ink" />
        <button type="button" onClick={addCode} className="h-8 rounded-lg bg-sunken px-3 text-[12.5px] font-semibold text-muted hover:text-ink">加入</button>
        <button type="button" disabled={!rows.length} onClick={() => void shareCard(rows, monthly, src.asof).then(setMsg)}
                className="ml-auto h-8 rounded-lg bg-accent px-3 text-[12.5px] font-semibold text-accent-ink disabled:opacity-50">
          產生分享圖卡
        </button>
        {msg && <span className="text-[11.5px] text-muted">{msg}</span>}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
        年配息＝最近一年實際配發（季配取最近 4 次、月配 12 次），不是「最近一次 × 次數」——今年配息成長快的會被高估。上市未滿一年的用已配發的平均每次 × 一年次數推估。
        單筆股利達 2 萬元扣 2.11% 二代健保補充保費；未計股利所得稅。配息會變動、也可能來自本金，過去不代表未來，非投資建議。
      </p>
    </section>
  );
}

/** 畫分享圖卡（1080×1350），能分享就分享、否則下載；回傳結果訊息 */
async function shareCard(rows: IncomeRow[], monthly: number, asof: string): Promise<string> {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return '這個瀏覽器不支援畫圖';
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0e1422'); grad.addColorStop(1, '#1c2742');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const font = (w: number, s: number) => `${w} ${s}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
  g.fillStyle = '#9fb0cc'; g.font = font(600, 44); g.fillText('每個月想領', 80, 150);
  g.fillStyle = '#ffc83d'; g.font = font(800, 120); g.fillText(`${nf0.format(monthly)} 元`, 80, 280);
  g.fillStyle = '#f5f7fa'; g.font = font(800, 64); g.fillText('要買幾張？', 80, 380);
  const list = rows.slice(0, 6);                   // 7 列會壓到底部說明
  const max = Math.max(...list.map(r => r.capital));
  list.forEach((r, i) => {
    const y = 470 + i * 112;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath(); g.roundRect(60, y, W - 120, 96, 20); g.fill();
    g.fillStyle = i === 0 ? '#ffc83d' : '#f5f7fa'; g.font = font(800, 40); g.fillText(r.code, 90, y + 50);
    g.fillStyle = '#9fb0cc'; g.font = font(500, 26); g.fillText(`${r.name.slice(0, 10)}・${r.freq}`, 90, y + 84);
    const bw = 300 * (r.capital / max);
    g.fillStyle = i === 0 ? '#ffc83d' : '#2dd4bf'; g.beginPath(); g.roundRect(430, y + 30, Math.max(bw, 8), 36, 12); g.fill();
    g.fillStyle = '#f5f7fa'; g.font = font(800, 38); g.textAlign = 'right';
    g.fillText(`${nf0.format(r.lots)} 張`, W - 90, y + 50);
    g.fillStyle = '#9fb0cc'; g.font = font(500, 26); g.fillText(`本金 ${wan(r.capital)}`, W - 90, y + 84);
    g.textAlign = 'left';
  });
  g.fillStyle = '#7d8aa3'; g.font = font(500, 24);
  g.fillText(`近一年實際配息 × ${asof} 收盤價｜單筆股利 ≥ 2 萬扣二代健保 2.11%`, 80, H - 110);
  g.fillText('職業賭徒日誌 allenchiwei.github.io/taiwan-etf｜公開資料整理，非投資建議', 80, H - 70);
  const blob: Blob | null = await new Promise(res => c.toBlob(res, 'image/png'));
  if (!blob) return '產生圖片失敗';
  const file = new File([blob], `月領${monthly}要幾張.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try { await nav.share({ files: [file], title: `每月領 ${nf0.format(monthly)} 元要買幾張` }); return '已分享'; } catch { return '已取消分享'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return '已下載圖卡';
}
