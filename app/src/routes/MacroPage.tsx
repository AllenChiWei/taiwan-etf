/* 美國總經：通膨、就業、成長、利率、能源，外加殖利率曲線。
 *
 * 資料是 FRED 與 EIA 的美國政府機關原始數列（scripts/fetch_macro.py），換算在
 * lib/macro.ts。這一頁只負責呈現：每張卡片是「最新值、跟上一期比、一年前、走勢」。
 *
 * 顏色：數字本身不上色（失業率上升不是「漲」）；變化量照站上的紅漲綠跌慣例，
 * 只表示方向，不表示好壞 —— 這一點寫在頁尾。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchMacro } from '../api/extras';
import {
  buildIndicators, lastYears, thinWeekly, latest, yearAgo, curveInverted, FREQ_LABEL,
  type MacroData, type Indicator, type Point, type MacroCurve, type Freq,
} from '../lib/macro';
import { EmptyState } from '../components/EmptyState';

const RANGES = [
  { id: 1, label: '1 年' }, { id: 5, label: '5 年' },
  { id: 10, label: '10 年' }, { id: 20, label: '20 年' },
] as const;

const GROUPS: Indicator['group'][] = ['通膨', '就業', '成長', '利率', '能源'];

function fmt(v: number, digits: number): string {
  return v.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function signed(v: number, digits: number): string {
  const s = fmt(Math.abs(v), digits);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

/** 期別的寫法跟頻率走：月資料寫「2026/8」、季資料寫「2026 Q2」、日週資料寫完整日期。 */
function period(d: string, freq: Freq): string {
  const y = d.slice(0, 4);
  const m = Number(d.slice(5, 7));
  if (freq === 'M') return `${y}/${m}`;
  if (freq === 'Q') return `${y} Q${Math.floor((m - 1) / 3) + 1}`;
  return `${y}/${m}/${Number(d.slice(8, 10))}`;
}

/* ── 折線 ─────────────────────────────────────────────────── */

function MacroLine({ pts, guides, digits, freq }: {
  pts: Point[]; guides: number[]; digits: number; freq: Freq;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 96;
  if (pts.length < 2) return null;
  const vals = pts.map(p => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  // 參考線在附近時把它納進值域（通膨 2% 目標），離太遠就不畫，免得把走勢壓扁
  for (const g of guides) {
    const span = hi - lo || 1;
    if (g >= lo - span * 0.5 && g <= hi + span * 0.5) { lo = Math.min(lo, g); hi = Math.max(hi, g); }
  }
  const span = hi - lo || 1;
  lo -= span * 0.06;
  hi += span * 0.06;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => (1 - (v - lo) / (hi - lo)) * H;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const shown = guides.filter(g => g >= lo && g <= hi);
  const h = hover === null ? null : pts[hover];

  return (
    <div className="relative mt-2">
      <div className="flex justify-between text-[10.5px] tabular-nums text-faint">
        <span>{h ? `${period(h.d, freq)}：${fmt(h.v, digits)}` : `高 ${fmt(Math.max(...vals), digits)}`}</span>
        <span>{h ? '' : `低 ${fmt(Math.min(...vals), digits)}`}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
           aria-label="走勢圖" className="mt-0.5 h-24 w-full touch-none"
           onPointerMove={e => {
             const r = e.currentTarget.getBoundingClientRect();
             const i = Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1));
             setHover(Math.max(0, Math.min(pts.length - 1, i)));
           }}
           onPointerLeave={() => setHover(null)}>
        {shown.map(g => (
          <line key={g} x1="0" x2={W} y1={y(g)} y2={y(g)} stroke="currentColor"
                className="text-muted" strokeWidth="1" strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke" />
        ))}
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6"
              className="text-accent" vectorEffect="non-scaling-stroke" />
        {h && (
          <line x1={x(hover!)} x2={x(hover!)} y1="0" y2={H} stroke="currentColor"
                className="text-faint" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="flex justify-between text-[10.5px] tabular-nums text-faint">
        <span>{period(pts[0].d, freq)}</span>
        <span>{period(pts[pts.length - 1].d, freq)}</span>
      </div>
    </div>
  );
}

/* ── 指標卡 ───────────────────────────────────────────────── */

function IndicatorCard({ ind, years }: { ind: Indicator; years: number }) {
  const shown = useMemo(() => thinWeekly(lastYears(ind.pts, years)), [ind, years]);
  const now = latest(ind.pts);
  const ago = yearAgo(ind.pts);
  if (!now) return null;
  // 用顯示出來的位數判斷：0.04 顯示成 +0.0 時不該是紅色
  const shownDelta = now.delta === null ? 0 : Number(now.delta.toFixed(ind.digits));
  const tone = shownDelta === 0 ? 'text-muted' : shownDelta > 0 ? 'text-up' : 'text-down';
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold text-ink">{ind.title}</h3>
        <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[10.5px] font-semibold text-muted">
          {ind.src}・{FREQ_LABEL[ind.freq]}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[22px] font-bold tabular-nums text-ink">
          {fmt(now.last.v, ind.digits)}
        </span>
        <span className="text-[12px] text-muted">{ind.unit}</span>
        <span className="text-[11.5px] text-faint">{period(now.last.d, ind.freq)}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] tabular-nums">
        {now.delta !== null && (
          <span className={tone}>較前期 {signed(shownDelta, ind.digits)}</span>
        )}
        {ago && <span className="text-faint">一年前 {fmt(ago.v, ind.digits)}</span>}
      </div>
      <MacroLine pts={shown} guides={ind.guides} digits={ind.digits} freq={ind.freq} />
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{ind.note}</p>
    </div>
  );
}

/* ── 殖利率曲線 ───────────────────────────────────────────── */

function CurveCard({ curve }: { curve: MacroCurve }) {
  const W = 320;
  const H = 150;
  const lines = [
    { key: 'y1' as const, label: '一年前', cls: 'text-faint', dash: '2 3' },
    { key: 'm1' as const, label: '一個月前', cls: 'text-muted', dash: '5 3' },
    { key: 'now' as const, label: '最新', cls: 'text-accent', dash: undefined },
  ];
  const all = lines.flatMap(l => curve[l.key]).filter((v): v is number => v != null);
  if (!all.length) return null;
  const lo = Math.floor(Math.min(...all) * 4) / 4 - 0.25;
  const hi = Math.ceil(Math.max(...all) * 4) / 4 + 0.25;
  const n = curve.tenors.length;
  const x = (i: number) => 24 + (i / (n - 1)) * (W - 32);
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 16);
  const path = (vals: (number | null)[]) => {
    let d = '';
    vals.forEach((v, i) => {
      if (v == null) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };
  const inv = curveInverted(curve);
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold text-ink">美國公債殖利率曲線</h3>
        <span className="text-[11.5px] text-faint">{curve.dates.now ?? ''}・Fed H.15</span>
      </div>
      {inv !== null && (
        <p className="mt-1 text-[12px] text-muted">
          10 年期 {inv ? '低於' : '高於'} 3 個月期：
          <strong className={inv ? 'text-up' : 'text-ink'}>{inv ? '倒掛' : '正斜率（沒有倒掛）'}</strong>
        </p>
      )}
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label="殖利率曲線"
           className="mt-2 w-full">
        {ticks.map(t => (
          <g key={t}>
            <line x1="24" x2={W - 8} y1={y(t)} y2={y(t)} stroke="currentColor"
                  className="text-line" strokeWidth="0.6" />
            <text x="0" y={y(t) + 3} fontSize="8" fill="currentColor" className="text-faint">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        {lines.map(l => (
          <path key={l.key} d={path(curve[l.key])} fill="none" stroke="currentColor"
                strokeWidth={l.key === 'now' ? 2 : 1.3} strokeDasharray={l.dash}
                className={l.cls} />
        ))}
        {curve.now.map((v, i) => v != null && (
          <circle key={i} cx={x(i)} cy={y(v)} r="2" fill="currentColor" className="text-accent" />
        ))}
        {curve.tenors.map((t, i) => (
          <text key={t} x={x(i)} y={H + 12} fontSize="8" textAnchor="middle"
                fill="currentColor" className="text-muted">{t}</text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
        {lines.slice().reverse().map(l => (
          <span key={l.key} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true">
              <line x1="0" x2="18" y1="3" y2="3" stroke="currentColor" strokeWidth="2"
                    strokeDasharray={l.dash} className={l.cls} />
            </svg>
            <span className="text-muted">{l.label}</span>
            <span className="text-faint">{curve.dates[l.key] ?? ''}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-right text-[11.5px] tabular-nums">
          <thead>
            <tr className="text-faint">
              <th className="py-1 text-left font-semibold">殖利率（%）</th>
              {curve.tenors.map(t => <th key={t} className="py-1 font-semibold">{t}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.slice().reverse().map(l => (
              <tr key={l.key} className="border-t border-line/60">
                <td className="py-1 text-left text-muted">{l.label}</td>
                {curve[l.key].map((v, i) => (
                  <td key={i} className={l.key === 'now' ? 'font-semibold text-ink' : 'text-muted'}>
                    {v == null ? '—' : v.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── 頁面 ─────────────────────────────────────────────────── */

export function MacroPage() {
  const [data, setData] = useState<MacroData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [years, setYears] = useState<number>(5);

  useEffect(() => {
    const ac = new AbortController();
    fetchMacro(ac.signal)
      .then(d => {
        if (ac.signal.aborted) return;
        setData(d);
        setState(d ? 'ready' : 'missing');
      })
      .catch(() => { if (!ac.signal.aborted) setState('missing'); });
    return () => ac.abort();
  }, []);

  const indicators = useMemo(() => (data ? buildIndicators(data) : []), [data]);

  if (state === 'loading') {
    return <p className="py-16 text-center text-[13px] text-muted">載入總經資料中…</p>;
  }
  if (state === 'missing' || !data) {
    return <EmptyState title="還沒有總經資料"
                       hint="總經數據在每次部署時抓取，來源暫時無法連線時會是空的。" icon="📊" />;
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-ink">美國總經</h1>
          <p className="text-[12px] text-muted">通膨、就業、成長、利率與能源・資料更新 {data.meta.updated}</p>
        </div>
        <div role="tablist" aria-label="走勢期間" className="flex gap-1 rounded-lg bg-sunken p-1">
          {RANGES.map(r => (
            <button key={r.id} type="button" role="tab" aria-selected={years === r.id}
                    onClick={() => setYears(r.id)}
                    className={`h-8 rounded-md px-3 text-[12.5px] font-semibold transition-colors ${
                      years === r.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {GROUPS.map(g => {
        const list = indicators.filter(i => i.group === g);
        if (!list.length && !(g === '利率' && data.curve)) return null;
        return (
          <section key={g} className="mt-5">
            <h2 className="mb-2 text-sm font-bold text-ink">{g}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g === '利率' && data.curve && <CurveCard curve={data.curve} />}
              {list.map(i => <IndicatorCard key={i.key} ind={i} years={years} />)}
            </div>
          </section>
        );
      })}

      <p className="mt-5 mb-2 text-[11.5px] leading-relaxed text-faint">
        來源：{data.meta.source}；原油庫存取自美國能源資訊署（EIA）。全部為美國聯邦政府機關發佈之公開資料，
        經 FRED 彙整。「較前期」的紅綠只表示數字上升或下降，不代表好壞。
        日資料的走勢圖以每週最後一個交易日繪製。本頁僅供參考，不構成投資建議。
        {data.meta.errors.length > 0 && ` 這次有 ${data.meta.errors.length} 條數列沒抓到，會在下次部署時補上。`}
      </p>
    </>
  );
}
