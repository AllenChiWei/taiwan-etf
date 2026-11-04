/* 可轉債：統計看板、市場溫度計歷史、待發行與籌備中、依產業整理、篩選器與全部清單。
 *
 * 資料是櫃買中心的行情表＋資訊看板＋發行資料（scripts/fetch_cb.py），統計在 lib/cb.ts。
 * 看板的格式照使用者給的 XQ 範例（價格區間、累計比例、PR75／PR90、轉換價值與溢價率），
 * 差別是價格口徑：官方免費資料沒有委買價，用收市價、沒成交用參考價，畫面上講清楚。
 *
 * 點任一檔可轉債 → 標的公司的個股抽屜（營收、財報、籌碼），最上面加這一檔債的細節、
 * 走勢圖與站上新聞／重大訊息裡跟這家公司有關的幾則。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchCb, fetchCbMarket, fetchCbSeries } from '../api/extras';
import { fetchNews } from '../api/news';
import {
  cbStats, byIndustry, filterBonds, outPct, yi, ytp, ytm, putDate, convertible, daysBetween,
  marketRows, rankInHistory, loadCbFavs, saveCbFavs,
  BUCKETS, HIGH_BUCKETS, CB_SORTS, CB_PRESETS, MARKET_METRICS, ANY,
  type CbData, type CbBond, type CbSort, type CbStats, type CbFilter, type CbMarket, type CbSeriesPoint, type Range,
} from '../lib/cb';
import type { NewsData } from '../lib/news';
import { relativeTime } from '../lib/news';
import { EmptyState } from '../components/EmptyState';
import { StockSheet } from '../components/StockSheet';
import { Section, Cell } from '../components/StockBoard';

const n1 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f1 = (v: number | null) => (v === null ? '—' : n1.format(v));
const f2 = (v: number | null) => (v === null ? '—' : n2.format(v));
const pct = (v: number | null) => (v === null ? '—' : `${n1.format(v)}%`);
const md = (d: string | null) => (d ? `${d.slice(0, 4)}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '—');

function Chip({ active, onClick, children, title }: {
  active: boolean; onClick: () => void; children: React.ReactNode; title?: string;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} title={title}
            className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
              active ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
      {children}
    </button>
  );
}

/* ── 折線圖（溫度計歷史、單檔走勢共用） ──────────────────── */

interface Pt { d: string; v: number }

function Line({ pts, unit, guide, height = 120 }: { pts: Pt[]; unit: string; guide?: number; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = height;
  if (pts.length < 2) return <p className="py-6 text-center text-[12px] text-muted">資料還不夠畫走勢。</p>;
  const vals = pts.map(p => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (guide !== undefined && guide >= lo - (hi - lo) && guide <= hi + (hi - lo)) { lo = Math.min(lo, guide); hi = Math.max(hi, guide); }
  const span = hi - lo || 1;
  lo -= span * 0.06;
  hi += span * 0.06;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => (1 - (v - lo) / (hi - lo)) * H;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const h = hover === null ? null : pts[hover];
  const fmt = (v: number) => `${n1.format(v)}${unit}`;
  return (
    <div className="relative mt-2">
      <div className="flex justify-between text-[10.5px] tabular-nums text-faint">
        <span>{h ? `${md(h.d)}：${fmt(h.v)}` : `高 ${fmt(Math.max(...vals))}`}</span>
        <span>{h ? '' : `低 ${fmt(Math.min(...vals))}`}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="走勢圖"
           className="mt-0.5 w-full touch-none" style={{ height: H }}
           onPointerMove={e => {
             const r = e.currentTarget.getBoundingClientRect();
             const i = Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1));
             setHover(Math.max(0, Math.min(pts.length - 1, i)));
           }}
           onPointerLeave={() => setHover(null)}>
        {guide !== undefined && guide >= lo && guide <= hi && (
          <line x1="0" x2={W} y1={y(guide)} y2={y(guide)} stroke="currentColor" className="text-muted"
                strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        )}
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" className="text-accent"
              vectorEffect="non-scaling-stroke" />
        {h && (
          <line x1={x(hover!)} x2={x(hover!)} y1="0" y2={H} stroke="currentColor" className="text-faint"
                strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="flex justify-between text-[10.5px] tabular-nums text-faint">
        <span>{md(pts[0].d)}</span>
        <span>{md(pts[pts.length - 1].d)}</span>
      </div>
    </div>
  );
}

/* ── 統計看板（照 XQ 範例的格式） ─────────────────────────── */

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line px-3 py-1.5 first:border-t-0">
      <span className={`text-[12.5px] ${strong ? 'font-bold text-ink' : 'text-muted'}`}>{label}</span>
      <span className={`font-mono tabular-nums ${strong ? 'text-[15px] font-bold text-ink' : 'text-[13px] text-ink'}`}>
        {value}
      </span>
    </div>
  );
}

function StatsBoard({ s, onBucket }: { s: CbStats; onBucket: (id: string) => void }) {
  const max = Math.max(1, ...s.buckets.map(b => b.count));
  return (
    <>
      {/* 區間表：手機上可以橫向滑，頁面本身不會被撐寬 */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[520px] text-center text-[12.5px] tabular-nums">
          <thead className="bg-sunken text-muted">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">價格區間</th>
              {s.buckets.map(b => <th key={b.bucket.id} className="px-2 py-1.5 font-semibold">{b.bucket.label}</th>)}
              <th className="px-2 py-1.5 font-semibold">總數</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td className="px-2 py-1.5 text-left text-muted">檔數</td>
              {s.buckets.map(b => (
                <td key={b.bucket.id} className="px-2 py-1.5">
                  <button type="button" onClick={() => onBucket(b.bucket.id)}
                          className="font-mono font-bold text-ink hover:text-accent hover:underline">
                    {b.count}
                  </button>
                </td>
              ))}
              <td className="px-2 py-1.5 font-mono font-bold text-ink" rowSpan={2}>{s.valid}</td>
            </tr>
            <tr className="border-t border-line">
              <td className="px-2 py-1.5 text-left text-muted">累計比例</td>
              {s.buckets.map(b => <td key={b.bucket.id} className="px-2 py-1.5 font-mono text-ink">{pct(b.cum)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-line bg-bg">
          <Row label="平均價格" value={f1(s.avgPx)} strong />
          <Row label="PR75 最高價" value={f1(s.pr75)} />
          <Row label="PR90 高高價" value={f1(s.pr90)} />
          {s.high.map(h => (
            <Row key={h.bucket.id} label={`價格 ${h.bucket.label} 檔數（比例）`}
                 value={`${h.count}（${pct(h.share)}）`} />
          ))}
          <Row label="平均轉換價值" value={f1(s.avgCv)} strong />
          <Row label="平均轉換溢價率" value={pct(s.avgPrem)} strong />
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-bg">
          <Row label="轉換價值 ≥ 100 時的平均溢價率" value={pct(s.avgPremItm)} strong />
          <Row label="轉換價值 ≥ 100 檔數" value={String(s.cvGe100)} />
          <Row label="轉換價值 ≥ 120 檔數" value={String(s.cvGe120)} />
          <Row label="溢價率 > 0% 檔數" value={String(s.premGt0)} />
          <Row label="溢價率 ≥ 50% 檔數" value={String(s.premGe50)} />
          <Row label="溢價率 ≥ 100% 檔數" value={String(s.premGe100)} />
        </div>
      </div>

      {/* 價格區間分布長條圖 */}
      <div className="mt-4">
        <h3 className="text-[12.5px] font-bold text-ink">價格區間分布</h3>
        <div className="mt-2 flex h-44 items-end gap-2 border-b border-line px-1 sm:gap-4">
          {s.buckets.map(b => (
            <button key={b.bucket.id} type="button" onClick={() => onBucket(b.bucket.id)}
                    aria-label={`${b.bucket.label}：${b.count} 檔`}
                    className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              <span className="mb-1 font-mono text-[12px] font-bold tabular-nums text-ink">{b.count}</span>
              <span className="w-full max-w-14 rounded-t bg-accent group-hover:opacity-80"
                    style={{ height: `${(b.count / max) * 82}%` }} />
            </button>
          ))}
        </div>
        <div className="flex gap-2 px-1 sm:gap-4">
          {s.buckets.map(b => (
            // 手機上一格只有 50px 寬，「100~105」放不下：在 ~ 後面允許換行，不要截成「100~1…」
            <span key={b.bucket.id} className="min-w-0 flex-1 pt-1 text-center text-[11px] leading-tight text-muted">
              {b.bucket.label.replace('~', '~​')}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── 市場溫度計歷史 ───────────────────────────────────────── */

const SPANS = [{ id: 1, label: '1 年' }, { id: 3, label: '3 年' }, { id: 0, label: '全部' }] as const;

function MarketHistory({ market }: { market: CbMarket }) {
  const [metric, setMetric] = useState(MARKET_METRICS[0].id);
  const [years, setYears] = useState<number>(3);
  const rows = useMemo(() => marketRows(market), [market]);
  const m = MARKET_METRICS.find(x => x.id === metric) ?? MARKET_METRICS[0];
  const all = useMemo(() => rows.map(x => ({ d: x.d, v: m.get(x.r) })).filter((p): p is Pt => p.v !== null), [rows, m]);
  if (!all.length) return null;
  const last = all[all.length - 1];
  const cut = years ? new Date(Date.parse(`${last.d}T00:00:00Z`) - years * 365.25 * 86_400_000).toISOString().slice(0, 10) : '';
  const pts = all.filter(p => p.d >= cut);
  // 一天一點太密，手機上畫不出差別：超過 600 點就每 n 天取一點（最後一點一定留）
  const step = Math.max(1, Math.ceil(pts.length / 600));
  const thin = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const rank = rankInHistory(all.map(p => p.v), last.v);
  return (
    <Section title="市場溫度計（歷史）" hint={`${md(all[0].d)} 起，每天一點`}>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {MARKET_METRICS.map(x => <Chip key={x.id} active={x.id === metric} onClick={() => setMetric(x.id)}>{x.label}</Chip>)}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-mono text-[20px] font-bold tabular-nums text-ink">{n1.format(last.v)}{m.unit}</span>
          <span className="ml-2 text-[12px] text-muted">{md(last.d)}</span>
        </div>
        {rank !== null && (
          <span className="text-[12px] text-muted">
            比 2017 年以來 <b className="text-ink">{n1.format(rank)}%</b> 的日子高
          </span>
        )}
      </div>
      <div className="mt-1 flex gap-1.5">
        {SPANS.map(s => <Chip key={s.id} active={years === s.id} onClick={() => setYears(s.id)}>{s.label}</Chip>)}
      </div>
      <Line pts={thin} unit={m.unit} height={140} />
      <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
        歷史用櫃買資訊看板每天的參考價與標的股價算（資訊看板 2017 年 3 月起才有檔案），跟上面看板的「全部（沒成交用參考價）」同一個口徑。
        「價格 ≥ 120 比例」高、溢價率低，代表可轉債整體跟著股票漲；比例低、低價債多，是市場冷的時候。
      </p>
    </Section>
  );
}

/* ── 篩選器 ───────────────────────────────────────────────── */

function RangeInput({ label, r, onChange, unit }: { label: string; r: Range; onChange: (r: Range) => void; unit?: string }) {
  const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
  const cls = 'h-8 w-16 rounded-lg border border-line bg-bg px-2 text-[12.5px] tabular-nums text-ink';
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted">
      <span className="w-[4.5rem] shrink-0">{label}</span>
      <input inputMode="decimal" aria-label={`${label}下限`} placeholder="下限" className={cls}
             value={r.min ?? ''} onChange={e => onChange({ ...r, min: num(e.target.value) })} />
      <span>～</span>
      <input inputMode="decimal" aria-label={`${label}上限`} placeholder="上限" className={cls}
             value={r.max ?? ''} onChange={e => onChange({ ...r, max: num(e.target.value) })} />
      {unit && <span>{unit}</span>}
    </label>
  );
}

type Cond = Required<Pick<CbFilter, 'px' | 'prem' | 'cv' | 'out' | 'ytp'>> & {
  putWithin: number | null; issuedWithin: number | null; guarantee: string | null;
  convertibleOnly: boolean; minVol: number | null; favOnly: boolean;
};

const EMPTY: Cond = {
  px: ANY, prem: ANY, cv: ANY, out: ANY, ytp: ANY, putWithin: null, issuedWithin: null,
  guarantee: null, convertibleOnly: false, minVol: null, favOnly: false,
};

function condCount(c: Cond): number {
  const r = (x: Range) => (x.min !== null || x.max !== null ? 1 : 0);
  return r(c.px) + r(c.prem) + r(c.cv) + r(c.out) + r(c.ytp) + (c.putWithin !== null ? 1 : 0)
    + (c.issuedWithin !== null ? 1 : 0) + (c.guarantee ? 1 : 0) + (c.convertibleOnly ? 1 : 0)
    + (c.minVol !== null ? 1 : 0) + (c.favOnly ? 1 : 0);
}

/* ── 點一檔之後：債的細節、走勢、公司新聞 ─────────────────── */

function BondDetail({ b, news, asOf, fav, onFav }: {
  b: CbBond; news: NewsData | null | undefined; asOf: string; fav: boolean; onFav: () => void;
}) {
  const [series, setSeries] = useState<CbSeriesPoint[] | null | undefined>(undefined);
  const [chart, setChart] = useState<'px' | 'prem' | 'sp'>('px');
  useEffect(() => {
    const ac = new AbortController();
    setSeries(undefined);
    fetchCbSeries(b.c, ac.signal).then(d => { if (!ac.signal.aborted) setSeries(d); });
    return () => ac.abort();
  }, [b.c]);
  const items = news ? news.news.filter(x => x.all.includes(b.s) || x.codes.includes(b.s)).slice(0, 8) : [];
  const filings = news ? news.filings.filter(f => f.code === b.s).slice(0, 8) : [];
  const pts: Pt[] = (series ?? [])
    .map(p => ({ d: p[0], v: chart === 'px' ? p[1] : chart === 'sp' ? p[2] : p[3] }))
    .filter((p): p is Pt => p.v !== null);
  const pd = putDate(b);
  return (
    <>
      <Section title={`${b.c} ${b.n}`} hint={`${b.close === null ? '今天沒成交，價格是參考價' : '收市價'}${b.exch ? '　交換債' : ''}`}>
        <button type="button" onClick={onFav} aria-pressed={fav}
                className="mt-2 h-8 rounded-lg bg-sunken px-3 text-[12.5px] font-semibold text-muted hover:text-ink">
          {fav ? '★ 已收藏（行事曆「只看我的」會列出它的賣回與到期）' : '☆ 收藏這檔'}
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cell label="可轉債價格" value={f2(b.px)}
                tone={b.chg ? (b.chg > 0 ? 'text-up' : 'text-down') : undefined}
                sub={b.chg ? `${b.chg > 0 ? '+' : ''}${f2(b.chg)}` : undefined} />
          <Cell label="轉換價" value={f2(b.cp)} sub={b.cpEff ? `生效 ${md(b.cpEff)}` : undefined} />
          <Cell label="標的股價" value={f2(b.sp)} />
          <Cell label="轉換價值" value={f1(b.cv)} />
          <Cell label="溢價率" value={pct(b.prem)} />
          <Cell label="賣回殖利率" value={pct(ytp(b, asOf))}
                sub={pd && pd >= asOf ? `${md(pd)} 以 ${f2(b.putP)} 賣回` : '沒有尚未到期的賣回權'} />
          <Cell label="到期殖利率" value={pct(ytm(b, asOf))} sub="假設到期以 100 償還" />
          <Cell label="餘額／發行" value={yi(b.out)} sub={`${pct(outPct(b))}，原始 ${yi(b.tot)}`} />
          <Cell label="轉換期間" value={md(b.convS)} sub={`至 ${md(b.convE)}${convertible(b, asOf) ? '・可轉換' : ''}`} />
          <Cell label="到期日" value={md(b.mat)} sub={`發行 ${md(b.issue)}　${b.g ?? ''}`} />
          {b.callS && <Cell label="強制贖回" value={md(b.callS)} sub={`價格 ${f2(b.callP)}`} />}
          {b.vol !== null && <Cell label="今日成交" value={`${b.vol} 張`} sub={yi(b.val)} />}
          {b.coupon ? <Cell label="票面利率" value={`${b.coupon}%`} /> : null}
        </div>
        <p className="mt-2 text-[11.5px] text-faint">
          轉換價是櫃買資訊看板的「下次生效日之後」的轉換價；生效日還沒到時，今天適用的可能仍是舊的。
          殖利率不到 30 天的不算（年化後會失真）。
        </p>
      </Section>

      <Section title="走勢" hint={series?.length ? `${md(series[0][0])} 起` : undefined}>
        <div className="mt-2 flex gap-1.5">
          <Chip active={chart === 'px'} onClick={() => setChart('px')}>可轉債價格</Chip>
          <Chip active={chart === 'prem'} onClick={() => setChart('prem')}>溢價率</Chip>
          <Chip active={chart === 'sp'} onClick={() => setChart('sp')}>標的股價</Chip>
        </div>
        {series === undefined
          ? <p className="py-6 text-center text-[12px] text-muted">載入走勢中…</p>
          : <Line pts={pts} unit={chart === 'prem' ? '%' : ''} guide={chart === 'px' ? 100 : chart === 'prem' ? 0 : undefined} />}
        <p className="mt-1 text-[11px] text-faint">每天一點，取自櫃買資訊看板的參考價與標的股價。</p>
      </Section>

      <Section title={`${b.sn || b.s} 近期新聞與公告`} hint="站上收錄的最近幾天">
        {news === undefined && <p className="mt-2 text-[12.5px] text-muted">載入新聞中…</p>}
        {news !== undefined && !items.length && !filings.length && (
          <p className="mt-2 text-[12.5px] text-muted">站上最近幾天的新聞與重大訊息沒有這家公司。</p>
        )}
        {filings.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {filings.map((f, i) => (
              <li key={`f${i}`} className="text-[13px] leading-snug">
                <span className="mr-1.5 rounded bg-sunken px-1.5 py-0.5 text-[10.5px] font-semibold text-muted">重訊</span>
                <a href={f.u} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-accent hover:underline">
                  {f.subject}
                </a>
                <span className="ml-1.5 text-[11px] text-faint">{relativeTime(f.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {items.map((x, i) => (
              <li key={`n${i}`} className="text-[13px] leading-snug">
                <a href={x.u} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-accent hover:underline">
                  {x.t}
                </a>
                <span className="ml-1.5 text-[11px] text-faint">{x.s}・{relativeTime(x.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          <a href={`https://www.cnyes.com/twstock/${b.s}`} target="_blank" rel="noopener noreferrer"
             className="text-accent hover:underline">鉅亨網 {b.s} 個股新聞 ↗</a>
          <a href={`https://mopsov.twse.com.tw/mops/web/t05st01?firstin=1&co_id=${b.s}`} target="_blank"
             rel="noopener noreferrer" className="text-accent hover:underline">公開資訊觀測站重大訊息 ↗</a>
        </div>
      </Section>
    </>
  );
}

/* ── 頁面 ─────────────────────────────────────────────────── */

export function CbPage() {
  const [data, setData] = useState<CbData | null | undefined>(undefined);
  const [market, setMarket] = useState<CbMarket | null>(null);
  const [news, setNews] = useState<NewsData | null | undefined>(undefined);
  const [onlyTraded, setOnlyTraded] = useState(false);
  const [q, setQ] = useState('');
  const [bucket, setBucket] = useState<string | null>(null);
  const [ind, setInd] = useState<string | null>(null);
  const [sort, setSort] = useState<CbSort>('vol');
  const [desc, setDesc] = useState(true);
  const [cond, setCond] = useState<Cond>(EMPTY);
  const [preset, setPreset] = useState<string | null>(null);
  const [showCond, setShowCond] = useState(false);
  const [limit, setLimit] = useState(60);
  const [pick, setPick] = useState<CbBond | null>(null);
  const [favs, setFavs] = useState<Set<string>>(() => loadCbFavs());

  useEffect(() => {
    const ac = new AbortController();
    fetchCb(ac.signal).then(d => { if (!ac.signal.aborted) setData(d); }).catch(() => setData(null));
    fetchCbMarket(ac.signal).then(d => { if (!ac.signal.aborted) setMarket(d); }).catch(() => {});
    return () => ac.abort();
  }, []);

  // 新聞只在點開某一檔時才抓（約幾百 KB），沒點的人不用下載
  useEffect(() => {
    if (!pick || news !== undefined) return;
    fetchNews().then(d => setNews(d)).catch(() => setNews(null));
  }, [pick, news]);

  const asOf = data?.meta.date ?? '';
  const stats = useMemo(() => (data ? cbStats(data.bonds, onlyTraded) : null), [data, onlyTraded]);
  const inds = useMemo(() => (data ? byIndustry(data.bonds, data.upcoming, data.meta.date) : []), [data]);
  const rows = useMemo(() => (data ? filterBonds(data.bonds, {
    q, bucket, ind, onlyTraded, sort, desc, asOf,
    px: cond.px, prem: cond.prem, cv: cond.cv, out: cond.out, ytp: cond.ytp,
    putWithin: cond.putWithin, issuedWithin: cond.issuedWithin, guarantee: cond.guarantee,
    convertibleOnly: cond.convertibleOnly, minVol: cond.minVol, favs: cond.favOnly ? favs : null,
  }) : []), [data, q, bucket, ind, onlyTraded, sort, desc, asOf, cond, favs]);

  if (data === undefined) return <p className="py-12 text-center text-[13px] text-muted">載入可轉債資料中…</p>;
  if (data === null || !stats) {
    return <EmptyState title="還沒有可轉債資料" hint="可轉債資料在每次部署時從櫃買中心整理，來源暫時無法連線時會是空的。" />;
  }

  const goList = (patch: () => void) => {
    patch();
    setLimit(60);
    document.getElementById('cb-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const bucketLabel = [...BUCKETS, ...HIGH_BUCKETS].find(b => b.id === bucket)?.label;
  const setC = (patch: Partial<Cond>) => { setCond(c => ({ ...c, ...patch })); setPreset(null); setLimit(60); };
  const applyPreset = (id: string) => {
    if (preset === id) { setCond(EMPTY); setPreset(null); return; }
    const p = CB_PRESETS.find(x => x.id === id)!;
    const f = p.f;
    setCond({
      ...EMPTY, px: f.px ?? ANY, prem: f.prem ?? ANY, cv: f.cv ?? ANY, out: f.out ?? ANY, ytp: f.ytp ?? ANY,
      putWithin: f.putWithin ?? null, issuedWithin: f.issuedWithin ?? null, convertibleOnly: Boolean(f.convertibleOnly),
    });
    if (f.sort) { setSort(f.sort); setDesc(Boolean(f.desc)); }
    setPreset(id);
    setLimit(60);
  };
  const toggleFav = (code: string) => setFavs(prev => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    saveCbFavs(next);
    return next;
  });
  const SortHead = ({ id, label }: { id: CbSort; label: string }) => {
    const on = sort === id;
    return (
      <button type="button" aria-label={`依${label}排序`} aria-pressed={on}
              onClick={() => {
                if (on) setDesc(v => !v);
                else { setSort(id); setDesc(CB_SORTS.find(x => x.id === id)!.desc); }
                setLimit(60);
              }}
              className={`whitespace-nowrap hover:text-ink ${on ? 'text-accent' : ''}`}>
        {label}{on ? (desc ? ' ▼' : ' ▲') : ''}
      </button>
    );
  };
  const nCond = condCount(cond);
  const sel = 'h-8 rounded-lg border border-line bg-bg px-2 text-[12.5px] text-ink';
  const planned = data.planned ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4">
      <header>
        <h1 className="text-lg font-bold text-ink">可轉債</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          資料日期 {md(data.meta.date)}　共 {data.meta.count} 檔，今天有成交 {data.meta.traded} 檔
          　轉換價取自 {md(data.meta.board)} 的櫃買資訊看板
        </p>
      </header>

      <Section title="統計看板" hint={onlyTraded ? `有效樣本 ${stats.valid}（只算今天有成交）` : `有效樣本 ${stats.valid}（沒成交的用參考價）`}>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip active={!onlyTraded} onClick={() => setOnlyTraded(false)}>全部（沒成交用參考價）</Chip>
          <Chip active={onlyTraded} onClick={() => setOnlyTraded(true)}>只算今天有成交</Chip>
        </div>
        <StatsBoard s={stats} onBucket={id => goList(() => setBucket(id))} />
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          價格：當天有成交用收市價，沒成交用櫃買的參考價（官方免費資料沒有委買價，所以跟看盤軟體的「委買價」統計不是同一個數字）。
          轉換價值 ＝ 100 × 標的股價 ÷ 轉換價；溢價率 ＝ 可轉債價格 ÷ 轉換價值 − 1。點區間的數字或長條可以直接看那一區的清單。
        </p>
      </Section>

      {market && <MarketHistory market={market} />}

      <Section title="待發行" hint={`${data.upcoming.length} 檔　發行日或上櫃日在 ${md(data.meta.date)} 之後`}>
        {data.upcoming.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">目前沒有排定發行的公開募集可轉債。</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12.5px] tabular-nums">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-2 font-semibold">可轉債</th>
                  <th className="py-1 pr-2 font-semibold">產業</th>
                  <th className="py-1 pr-2 font-semibold">上櫃日</th>
                  <th className="py-1 pr-2 text-right font-semibold">發行額</th>
                  <th className="py-1 pr-2 text-right font-semibold">轉換價</th>
                  <th className="py-1 pr-2 font-semibold">年期・擔保</th>
                </tr>
              </thead>
              <tbody>
                {data.upcoming.map(u => (
                  <tr key={u.c || u.n} className="border-t border-line">
                    <td className="py-1.5 pr-2"><span className="font-mono text-muted">{u.c}</span> <span className="font-semibold text-ink">{u.n}</span></td>
                    <td className="py-1.5 pr-2 text-muted">{u.ind}</td>
                    <td className="py-1.5 pr-2">{md(u.list || u.issue)}</td>
                    <td className="py-1.5 pr-2 text-right">{yi(u.amt)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{f2(u.cp)}</td>
                    <td className="py-1.5 pr-2 text-muted">{u.y ? `${u.y} 年` : '—'}・{u.g}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-faint">
          來源是櫃買中心的發行資料，只列已排定發行日的公開募集。私募可轉債不在櫃買交易，不列。
        </p>
      </Section>

      <Section title="籌備中" hint={`${planned.length} 則　重大訊息提到發行可轉債、之後還沒發新債的`}>
        {planned.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">
            還沒有收錄到。這份從 2026/11/4 開始每天從重大訊息累積（交易所的重大訊息端點只給當天的），會越來越完整。
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {planned.map((p, i) => (
              <li key={i} className="text-[13px] leading-snug">
                <span className="font-mono text-[12px] text-muted">{p.s}</span>
                <span className="ml-1.5 font-semibold text-ink">{p.name}</span>
                <span className="ml-1.5 text-[11px] text-faint">{p.ind}・{md(p.d)}</span>
                <a href={p.u} target="_blank" rel="noopener noreferrer"
                   className="mt-0.5 block text-[12.5px] text-muted hover:text-accent hover:underline">{p.subject}</a>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11.5px] text-faint">
          董事會決議、申報生效、訂定發行條件這類公告都會出現；同一家公司之後發了新債就會從這裡移到上面或清單裡。
        </p>
      </Section>

      <Section title="發行公司依產業" hint="近 180 天新發行＋待發行多的排前面；點產業看清單">
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {inds.map(r => (
            <button key={r.ind} type="button" onClick={() => goList(() => setInd(r.ind))}
                    className={`rounded-lg border px-3 py-2 text-left hover:border-accent ${ind === r.ind ? 'border-accent' : 'border-line'} bg-bg`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-bold text-ink">{r.ind}</span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-muted">
                  {r.issuers} 家・{r.bonds} 檔
                  {r.recent > 0 && <span className="ml-1.5 font-semibold text-accent">近期 {r.recent}</span>}
                  {r.upcoming > 0 && <span className="ml-1.5 font-semibold text-up">待發 {r.upcoming}</span>}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-faint">
                餘額 {yi(r.outstanding)}　{r.names.map(x => x.sn).join('、')}
              </div>
            </button>
          ))}
        </div>
      </Section>

      <section id="cb-list" className="mt-3 scroll-mt-16 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-ink">可轉債篩選器</h2>
          <span className="text-[11.5px] text-faint">{rows.length} 檔</span>
        </div>

        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {CB_PRESETS.map(p => (
            <Chip key={p.id} active={preset === p.id} onClick={() => applyPreset(p.id)} title={p.hint}>{p.label}</Chip>
          ))}
        </div>
        {preset && <p className="mt-1 text-[11.5px] text-muted">{CB_PRESETS.find(p => p.id === preset)!.hint}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={q} onChange={e => { setQ(e.target.value); setLimit(60); }}
                 placeholder="代號或名稱" aria-label="搜尋可轉債"
                 className="h-8 w-32 rounded-lg border border-line bg-bg px-2.5 text-[13px] text-ink" />
          <select value={sort} aria-label="排序" className={sel}
                  onChange={e => { const s = e.target.value as CbSort; setSort(s); setDesc(CB_SORTS.find(x => x.id === s)!.desc); }}>
            {CB_SORTS.map(s => <option key={s.id} value={s.id}>依{s.label}</option>)}
          </select>
          <Chip active={desc} onClick={() => setDesc(v => !v)}>{desc ? '高→低' : '低→高'}</Chip>
          <Chip active={showCond || nCond > 0} onClick={() => setShowCond(v => !v)}>
            條件{nCond ? `（${nCond}）` : ''} {showCond ? '▴' : '▾'}
          </Chip>
          <Chip active={cond.favOnly} onClick={() => setC({ favOnly: !cond.favOnly })}>★ 收藏（{favs.size}）</Chip>
          <Chip active={onlyTraded} onClick={() => setOnlyTraded(v => !v)}>今天有成交</Chip>
          {bucketLabel && <Chip active onClick={() => setBucket(null)}>價格 {bucketLabel} ✕</Chip>}
          {ind && <Chip active onClick={() => setInd(null)}>{ind} ✕</Chip>}
          {(nCond > 0 || bucket || ind || q) && (
            <button type="button" className="text-[12px] text-accent hover:underline"
                    onClick={() => { setCond(EMPTY); setPreset(null); setBucket(null); setInd(null); setQ(''); }}>
              清除全部
            </button>
          )}
        </div>

        {showCond && (
          <div className="mt-2 grid gap-2 rounded-lg border border-line bg-bg p-3 sm:grid-cols-2">
            <RangeInput label="價格" r={cond.px} onChange={r => setC({ px: r })} />
            <RangeInput label="溢價率" r={cond.prem} onChange={r => setC({ prem: r })} unit="%" />
            <RangeInput label="轉換價值" r={cond.cv} onChange={r => setC({ cv: r })} />
            <RangeInput label="賣回殖利率" r={cond.ytp} onChange={r => setC({ ytp: r })} unit="%" />
            <RangeInput label="餘額比例" r={cond.out} onChange={r => setC({ out: r })} unit="%" />
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="w-[4.5rem] shrink-0">距賣回</span>
              <select className={sel} value={cond.putWithin ?? ''} aria-label="距賣回日"
                      onChange={e => setC({ putWithin: e.target.value ? Number(e.target.value) : null })}>
                <option value="">不限</option><option value="90">3 個月內</option>
                <option value="180">半年內</option><option value="365">1 年內</option><option value="730">2 年內</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="w-[4.5rem] shrink-0">發行</span>
              <select className={sel} value={cond.issuedWithin ?? ''} aria-label="發行多久內"
                      onChange={e => setC({ issuedWithin: e.target.value ? Number(e.target.value) : null })}>
                <option value="">不限</option><option value="30">30 天內</option>
                <option value="90">90 天內</option><option value="365">1 年內</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="w-[4.5rem] shrink-0">擔保</span>
              <select className={sel} value={cond.guarantee ?? ''} aria-label="擔保"
                      onChange={e => setC({ guarantee: e.target.value || null })}>
                <option value="">不限</option><option value="有擔保">有擔保</option><option value="無擔保">無擔保</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="w-[4.5rem] shrink-0">成交量 ≥</span>
              <input inputMode="numeric" aria-label="成交量至少" placeholder="張"
                     className="h-8 w-20 rounded-lg border border-line bg-surface px-2 text-[12.5px] tabular-nums text-ink"
                     value={cond.minVol ?? ''}
                     onChange={e => setC({ minVol: e.target.value.trim() && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : null })} />
              <span>張</span>
            </label>
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <input type="checkbox" checked={cond.convertibleOnly} onChange={e => setC({ convertibleOnly: e.target.checked })} />
              只看已進入轉換期間
            </label>
          </div>
        )}

        {/* 可點的欄位標題：點一下用那一欄排序，再點一次反過來。手機上只有兩欄，標題改成一排按鈕 */}
        <div className="mt-3 flex border-b border-line pb-1 pl-7 text-[11.5px] font-semibold text-muted">
          <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 sm:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))]">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <SortHead id="code" label="代號" />
              <span className="sm:hidden contents">
                <SortHead id="prem" label="溢價率" />
                <SortHead id="cv" label="轉換價值" />
                <SortHead id="ytp" label="賣回殖利率" />
                <SortHead id="outPct" label="餘額比例" />
                <SortHead id="vol" label="成交量" />
              </span>
            </div>
            <div className="text-right"><SortHead id="px" label="價格" /></div>
            <div className="hidden text-right sm:block"><SortHead id="prem" label="溢價率" /></div>
            <div className="hidden text-right sm:block"><SortHead id="cv" label="轉換價值" /></div>
            <div className="hidden text-right sm:block"><SortHead id="ytp" label="賣回殖利率" /></div>
            <div className="hidden text-right sm:block"><SortHead id="outPct" label="餘額比例" /></div>
          </div>
        </div>

        <div className="divide-y divide-line">
          {rows.slice(0, limit).map(b => {
            const y = ytp(b, asOf);
            const pd = putDate(b);
            return (
              <div key={b.c} className="flex items-stretch">
                <button type="button" aria-label={favs.has(b.c) ? `取消收藏 ${b.n}` : `收藏 ${b.n}`}
                        onClick={() => toggleFav(b.c)}
                        className={`w-7 shrink-0 text-[15px] ${favs.has(b.c) ? 'text-accent' : 'text-faint hover:text-muted'}`}>
                  {favs.has(b.c) ? '★' : '☆'}
                </button>
                <button type="button" onClick={() => setPick(b)}
                        className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2 text-left hover:bg-sunken/60
                                   sm:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))]">
                  <div className="min-w-0">
                    <span className="font-mono text-[12px] text-muted">{b.c}</span>
                    <span className="ml-1.5 text-[13.5px] font-semibold text-ink">{b.n}</span>
                    <div className="truncate text-[11px] text-faint">
                      {b.ind}{pd && pd >= asOf ? `　賣回 ${md(pd)}（${daysBetween(asOf, pd)} 天）` : ''}　到期 {md(b.mat)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono text-[14px] font-bold tabular-nums ${b.close === null ? 'text-muted' : 'text-ink'}`}>
                      {f2(b.px)}
                    </div>
                    <div className="text-[10.5px] text-faint">{b.close === null ? '參考價' : `${b.vol ?? 0} 張`}</div>
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-x-3 text-[11.5px] tabular-nums text-muted sm:col-span-1 sm:block sm:text-right">
                    <span className="sm:hidden">溢價 </span><span className="font-mono font-semibold text-ink">{pct(b.prem)}</span>
                    <span className="hidden text-[10.5px] text-faint sm:block">溢價率</span>
                    <span className="sm:hidden">轉換價值 <span className="font-mono text-ink">{f1(b.cv)}</span></span>
                    {y !== null && <span className="sm:hidden">賣回殖利率 <span className="font-mono text-ink">{pct(y)}</span></span>}
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="font-mono text-[12.5px] tabular-nums text-ink">{f1(b.cv)}</div>
                    <div className="text-[10.5px] text-faint">轉換價值</div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="font-mono text-[12.5px] tabular-nums text-ink">{pct(y)}</div>
                    <div className="text-[10.5px] text-faint">賣回殖利率</div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="font-mono text-[12.5px] tabular-nums text-ink">{pct(outPct(b))}</div>
                    <div className="text-[10.5px] text-faint">餘額比例</div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
        {rows.length > limit && (
          <button type="button" onClick={() => setLimit(l => l + 100)}
                  className="mt-2 h-9 w-full rounded-lg bg-sunken text-[12.5px] font-semibold text-muted hover:text-ink">
            再顯示 {Math.min(100, rows.length - limit)} 檔（還有 {rows.length - limit} 檔）
          </button>
        )}
        {rows.length === 0 && <p className="py-6 text-center text-[12.5px] text-muted">沒有符合條件的可轉債。</p>}
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
          賣回殖利率＝用現在的價格買進、在最近一次賣回日以賣回價賣回的年化報酬；距離不到 30 天的不算。
          收藏存在這台裝置的瀏覽器裡，行事曆的「只看我的」也會用到。
        </p>
      </section>

      <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
        資料來源：{data.meta.source}。更新時間 {data.meta.updated}。轉換價、賣回、贖回由發行公司輸入櫃買資訊看板，
        以公司公告為準。餘額是上月底的數字。
      </p>

      <StockSheet code={pick?.s ?? null} name={pick?.sn} onClose={() => setPick(null)}
                  extra={pick ? <BondDetail b={pick} news={news} asOf={asOf} fav={favs.has(pick.c)}
                                            onFav={() => toggleFav(pick.c)} /> : null} />
    </div>
  );
}
