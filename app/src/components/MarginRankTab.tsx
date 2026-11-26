import { useEffect, useMemo, useState } from 'react';
import { fetchMarginState } from '../api/market';
import { fetchPe, fetchStockIndex } from '../api/stocks';
import type { PeData } from '../lib/cheap';
import { joinMarginRank, marginIndustryCounts, screenMarginRank } from '../lib/marginRank';
import type { StockIndex } from '../lib/stock';
import { Chip } from './StockBoard';
import { EmptyState } from './EmptyState';
import { StockSheet } from './StockSheet';

const THRESHOLDS = [130, 140, 150] as const;
const TURNOVER_FLOORS = [
  { label: '500 萬', value: 5_000_000 },
  { label: '1,000 萬', value: 10_000_000 },
  { label: '3,000 萬', value: 30_000_000 },
  { label: '不限', value: 0 },
];
const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });

export function MarginRankTab() {
  const [margin, setMargin] = useState<Awaited<ReturnType<typeof fetchMarginState>>>(null);
  const [index, setIndex] = useState<StockIndex | null>(null);
  const [pe, setPe] = useState<PeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState<number>(130);
  const [floor, setFloor] = useState(10_000_000);
  const [sheet, setSheet] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    Promise.allSettled([fetchMarginState(), fetchStockIndex(ac.signal), fetchPe(ac.signal)])
      .then(([m, i, p]) => {
        if (ac.signal.aborted) return;
        setMargin(m.status === 'fulfilled' ? m.value : null);
        setIndex(i.status === 'fulfilled' ? i.value : null);
        setPe(p.status === 'fulfilled' ? p.value : null);
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, []);

  const joined = useMemo(() => margin
    ? joinMarginRank(margin.m, index?.stocks ?? [], pe?.rows ?? []) : [], [margin, index, pe]);
  const rows = useMemo(() => screenMarginRank(joined, threshold, floor), [joined, threshold, floor]);
  const industries = useMemo(() => marginIndustryCounts(rows), [rows]);
  const hasNames = Boolean(index || pe);

  if (loading) return <p className="py-12 text-center text-[13px] text-muted">載入個股維持率榜中…</p>;
  if (!margin) return <EmptyState title="維持率資料暫時讀不到"
    hint="個股維持率檔案可能尚未由部署產生，請稍後再試。" icon="📊" />;

  return <>
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold text-ink">個股融資維持率榜</h2>
        <span className="text-[11.5px] text-faint">維持率資料日 {margin.d}{pe?.meta.date ? ` · 行情日 ${pe.meta.date}` : ''} · 符合 {nf0.format(rows.length)} 檔</span>
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
        依融資平均成本公式推算，假設融資自備四成；不是券商公布的個人整戶維持率。此值不代表個別帳戶是否收到追繳通知。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12px] text-muted">門檻</span>
        {THRESHOLDS.map(t => <Chip key={t} active={threshold === t} onClick={() => setThreshold(t)}>低於 {t}%</Chip>)}
        <span className="ml-2 mr-1 text-[12px] text-muted">最低日成交額</span>
        {TURNOVER_FLOORS.map(o => <Chip key={o.value} active={floor === o.value} onClick={() => setFloor(o.value)}>{o.label}</Chip>)}
      </div>
      {!hasNames && <p className="mt-2 text-[12px] text-muted">個股名稱與成交額資料暫時讀不到，請稍後再試。</p>}
      {hasNames && !pe && <p className="mt-2 text-[12px] text-muted">成交額資料暫時讀不到；無成交額資料的個股不會列入榜單。</p>}
    </section>

    {rows.length > 0 && <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold text-ink">產業分布</h3>
        <span className="text-[11px] text-faint">依目前門檻與成交額篩選</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {industries.slice(0, 8).map(x => <div key={x.industry} className="rounded-lg border border-line bg-bg px-3 py-2">
          <div className="truncate text-[11.5px] text-muted">{x.industry}</div>
          <div className="mt-0.5 font-mono text-[15px] font-bold tabular-nums text-ink">{nf0.format(x.count)} 檔</div>
        </div>)}
      </div>
    </section>}

    <section className="mt-3 min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold text-ink">維持率低於 {threshold}%</h3>
        <span className="text-[11px] text-faint">成交額門檻：{floor ? `至少 ${nf0.format(floor)} 元` : '不限'} · 依維持率由低至高</span>
      </div>
      {!hasNames ? <p className="py-8 text-center text-[12.5px] text-muted">個股清單與成交額資料暫時讀不到。</p>
        : rows.length === 0 ? <p className="py-8 text-center text-[12.5px] text-muted">目前沒有符合條件的個股。</p>
          : <div className="mt-2 overflow-x-auto">
            {/* 手機只留代號／名稱、維持率、收盤（維持率是這張表的重點，不能被擠到要橫捲才看得到；Claude 驗收時調整） */}
            <table className="w-full text-left text-[12.5px] sm:min-w-[650px]">
              <thead className="text-[11px] text-muted"><tr className="border-b border-line">
                <th className="px-2 py-2">代號／名稱</th>
                <th className="px-2 py-2 text-right">維持率</th><th className="px-2 py-2 text-right">收盤</th>
                <th className="hidden px-2 py-2 sm:table-cell">市場</th><th className="hidden px-2 py-2 sm:table-cell">產業</th>
                <th className="hidden px-2 py-2 text-right sm:table-cell">成交額</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map(r => <tr key={r.code} className="hover:bg-sunken/50">
                  <td className="px-2 py-2"><button type="button" onClick={() => setSheet(r.code)} className="text-left hover:text-accent">
                    <span className="font-mono font-bold text-ink">{r.code}</span><span className="ml-2 text-muted">{r.name}</span>
                  </button></td>
                  <td className="px-2 py-2 text-right font-mono font-bold tabular-nums text-ink">{r.ratio.toFixed(1)}%</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-muted">{r.price === null ? '—' : r.price.toFixed(2)}</td>
                  <td className="hidden px-2 py-2 text-muted sm:table-cell">{r.market}</td>
                  <td className="hidden max-w-[180px] truncate px-2 py-2 text-muted sm:table-cell">{r.industry}</td>
                  <td className="hidden px-2 py-2 text-right font-mono tabular-nums text-muted sm:table-cell">{r.turnover === null ? '—' : nf0.format(r.turnover)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>}
    </section>
    <p className="mt-3 px-1 text-[11px] leading-relaxed text-faint">成交額與收盤價來自交易所行情；缺少成交額資料的標的不列入。融資平均成本會受當沖、買進後賣出及資料缺漏影響，實際個人部位可能不同。僅供市場觀察，不構成投資建議。</p>
    <StockSheet code={sheet} onClose={() => setSheet(null)} />
  </>;
}
