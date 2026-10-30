/* 個股估值：估值卡、本益比／淨值比河流圖、預估本益比（營收推估＋自己輸入 EPS）。
 *
 * 資料在打開個股時才由瀏覽器向 FinMind 抓（api/finmind.ts 的 fetchValuation，兩個請求），
 * 計算全在 lib/valuation.ts。河流圖手寫 SVG，跟 PerformanceChart 一樣不引圖表庫。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchValuation } from '../api/finmind';
import {
  joinValuation, lastYears, stats, zone, river, revenueEstimate, implied, defaultKey,
  BAND_PCTS, FINANCIAL, CYCLICAL,
  type ValPoint, type ValKey, type Stats, type RiverPoint,
} from '../lib/valuation';
import type { Month } from '../lib/stock';
import { Section, Cell, Chip, nf2 } from './StockBoard';
import { NumberInput } from './NumberInput';

const YEARS = [3, 5, 10] as const;
const KEY_LABEL: Record<ValKey, string> = { per: '本益比', pbr: '淨值比' };

// 河流四段：低（藍）到高（橘）。用半透明，深淺主題都看得清楚
const FILLS = ['rgba(59,130,246,0.24)', 'rgba(59,130,246,0.11)', 'rgba(245,158,11,0.11)', 'rgba(245,158,11,0.24)'];
const ZONE_TONE = { low: 'text-accent', mid: 'text-ink', high: 'text-[#d97706]' } as const;

const x2 = (v: number | null | undefined, unit = '') => (v == null || !Number.isFinite(v) ? '—' : `${nf2.format(v)}${unit}`);
const px = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString('zh-TW') : nf2.format(v));
const ordinal = (p: number | null) => (p === null ? '—' : `第 ${Math.round(p)} 百分位`);

function RiverChart({ points, multiples, keyName }: { points: RiverPoint[]; multiples: number[]; keyName: ValKey }) {
  const [hover, setHover] = useState<number | null>(null);
  // 依容器實際寬度畫（不用固定 viewBox 縮放），手機上字才不會縮到看不見
  const [W, setW] = useState(800);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = Math.round(Math.min(340, Math.max(230, W * 0.42)));
  const PAD = { top: 10, right: W < 500 ? 62 : 82, bottom: 22, left: W < 500 ? 38 : 48 };
  const closes = points.map(p => p.close);
  const nums = points.flatMap(p => [p.close, ...p.bands.filter((v): v is number => v !== null)]);
  if (points.length < 2 || !nums.length) return null;
  // 景氣循環股的河流在獲利高峰會衝到股價好幾倍（長榮 2022 年），整張圖被壓扁；
  // 上下限最多到收盤價範圍的 2 倍／一半，超出的河流裁掉
  let lo = Math.max(Math.min(...nums), Math.min(...closes) * 0.5);
  let hi = Math.min(Math.max(...nums), Math.max(...closes) * 2);
  const pad = (hi - lo) * 0.05 || 1; lo = Math.max(0, lo - pad); hi += pad;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  /** 兩條線之間的色帶；任一邊缺值就斷開（那幾個月 EPS ≤ 0）。 */
  const area = (a: number, b: number) => {
    let d = ''; let seg: number[] = [];
    const flush = () => {
      if (seg.length > 1) {
        d += seg.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(points[i].bands[b]!).toFixed(1)}`).join('');
        d += [...seg].reverse().map(i => `L${x(i).toFixed(1)},${y(points[i].bands[a]!).toFixed(1)}`).join('') + 'Z';
      }
      seg = [];
    };
    points.forEach((p, i) => (p.bands[a] !== null && p.bands[b] !== null ? seg.push(i) : flush()));
    flush();
    return d;
  };
  const line = (get: (p: RiverPoint) => number | null) => {
    let d = ''; let pen = false;
    points.forEach((p, i) => {
      const v = get(p);
      if (v === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
    });
    return d;
  };
  const ticks = [0, 1, 2, 3, 4].map(k => lo + ((hi - lo) * k) / 4);
  const last = points[points.length - 1];
  // 右側倍數標籤：太擠的往上下推開
  const labels: { y: number; text: string }[] = [];
  multiples.forEach((m, k) => {
    const v = last.bands[k];
    if (v === null || v < lo || v > hi) return;
    labels.push({ y: y(v), text: W < 500 ? `${m.toFixed(1)}倍` : `${BAND_PCTS[k]}%｜${m.toFixed(1)}倍` });
  });
  for (let k = 1; k < labels.length; k++) {
    if (labels[k - 1].y - labels[k].y < 13) labels[k].y = labels[k - 1].y - 13;
  }
  const h = hover === null ? null : Math.max(0, Math.min(points.length - 1, hover));
  const hp = h === null ? last : points[h];
  const xl = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <div className="mt-2" ref={box}>
      <div className="flex flex-wrap gap-x-3 text-[11.5px] tabular-nums text-muted">
        <span className="font-semibold text-ink">{hp.date}</span>
        <span>收盤 <b className="text-ink">{px(hp.close)}</b></span>
        {hp.bands.map((v, k) => (
          <span key={k}>{BAND_PCTS[k]}% {v === null ? '—' : px(v)}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full touch-pan-y" role="img"
           aria-label={`${KEY_LABEL[keyName]}河流圖`}
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const r = e.currentTarget.getBoundingClientRect();
             const t = (((e.clientX - r.left) / r.width) * W - PAD.left) / (W - PAD.left - PAD.right);
             setHover(Math.round(t * (points.length - 1)));
           }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--c-border)" opacity="0.5" />
            <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="11"
                  fill="var(--c-faint)">{t >= 100 ? Math.round(t).toLocaleString('zh-TW') : nf2.format(t)}</text>
          </g>
        ))}
        {xl.map(i => (
          <text key={i} x={x(i)} y={H - 8} fontSize="11" fill="var(--c-faint)"
                textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{points[i].date.slice(0, 7)}</text>
        ))}
        <clipPath id={`rv-clip-${keyName}`}>
          <rect x={PAD.left} y={PAD.top} width={W - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom} />
        </clipPath>
        <g clipPath={`url(#rv-clip-${keyName})`}>
          {FILLS.map((f, k) => <path key={k} d={area(k, k + 1)} fill={f} />)}
          {multiples.map((_, k) => (
            <path key={k} d={line(p => p.bands[k])} fill="none" stroke="var(--c-border-strong)"
                  strokeWidth={k === 2 ? 1.4 : 1} strokeDasharray={k === 2 ? undefined : '3 3'} />
          ))}
        </g>
        <path d={line(p => p.close)} fill="none" stroke="var(--c-ink)" strokeWidth="2" strokeLinejoin="round" />
        {labels.map((l, k) => (
          <text key={k} x={W - PAD.right + 4} y={l.y} dominantBaseline="middle" fontSize="10.5"
                fill="var(--c-muted)">{l.text}</text>
        ))}
        {h !== null && (
          <>
            <line x1={x(h)} x2={x(h)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--c-border-strong)" />
            <circle cx={x(h)} cy={y(points[h].close)} r="3.5" fill="var(--c-ink)" stroke="var(--c-surface)" strokeWidth="1.5" />
          </>
        )}
      </svg>
      <p className="mt-1 text-[11px] leading-relaxed text-faint">
        河流 = 當月{keyName === 'per' ? '近四季 EPS' : '每股淨值'} × 這段期間{KEY_LABEL[keyName]}的第 10／25／50／75／90 百分位倍數。
        黑線在藍色區＝歷史偏低、橘色區＝歷史偏高。
      </p>
    </div>
  );
}

/** 預估本益比的一列：EPS → 本益比、百分位、各百分位倍數對應的股價。 */
function EstimateRow({ title, note, eps, price, hist, pe }: {
  title: string; note: string; eps: number; price: number; hist: ValPoint[]; pe: Stats;
}) {
  const r = implied(price, eps, hist, 'per', pe);
  if (!r) return null;
  const z = zone(r.pct);
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-[12.5px] font-semibold text-ink">{title}</span>
        <span className="text-[11px] text-faint">{note}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[13px] tabular-nums">
        <span>EPS <b className="font-mono text-ink">{x2(eps, ' 元')}</b></span>
        <span>預估本益比 <b className="font-mono text-ink">{x2(r.multiple, ' 倍')}</b></span>
        <span className={z.tone ? ZONE_TONE[z.tone] : 'text-faint'}>{ordinal(r.pct)}・{z.label}</span>
      </div>
      <div className="mt-1 grid grid-cols-5 gap-1 text-center text-[11px] tabular-nums">
        {r.prices.map((v, k) => (
          <div key={k} className="rounded bg-sunken px-1 py-1">
            <div className="text-faint">{BAND_PCTS[k]}%</div>
            <div className="text-faint">{pe.bands![k].toFixed(1)}倍</div>
            <div className="font-mono font-semibold text-ink">{px(v)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ValuationBoard({ code, industry, months }: { code: string; industry?: string; months: Month[] }) {
  const [state, setState] = useState<{ points: ValPoint[] | null; error: string | null }>({ points: null, error: null });
  const [years, setYears] = useState<(typeof YEARS)[number]>(5);
  const [key, setKey] = useState<ValKey | null>(null);
  const [myEps, setMyEps] = useState(NaN);

  useEffect(() => {
    const ac = new AbortController();
    setState({ points: null, error: null }); setKey(null); setMyEps(NaN);
    fetchValuation(code, ac.signal)
      .then(d => {
        if (ac.signal.aborted) return;
        const points = joinValuation(d.per, d.price);
        setState({ points, error: points.length ? null : 'FinMind 沒有這一檔的本益比資料（ETF、存託憑證、新上市的沒有）' });
      })
      .catch((e: Error) => { if (!ac.signal.aborted) setState({ points: null, error: e.message }); });
    return () => ac.abort();
  }, [code]);

  const view = useMemo(() => {
    const all = state.points;
    if (!all?.length) return null;
    const hist = lastYears(all, years);
    const latest = all[all.length - 1];
    const span = Number(latest.date.slice(0, 4)) - Number(all[0].date.slice(0, 4));
    return { hist, latest, span, pe: stats(hist, 'per'), pb: stats(hist, 'pbr') };
  }, [state.points, years]);

  const k: ValKey = key ?? defaultKey(industry, view?.latest);
  const rv = useMemo(() => {
    if (!view) return null;
    const s = k === 'per' ? view.pe : view.pb;
    return s.bands ? river(view.hist, k, s.bands) : null;
  }, [view, k]);
  const est = view ? revenueEstimate(months, view.latest.eps) : null;

  return (
    <Section title="估值：本益比與淨值比" hint="交易所每日本益比（近四季 EPS）· FinMind">
      {!state.points && !state.error && <p className="py-8 text-center text-[13px] text-muted">載入估值資料中…</p>}
      {state.error && <p className="py-6 text-center text-[13px] text-muted">{state.error}</p>}

      {view && (() => {
        const { latest, pe, pb, hist, span } = view;
        const s = k === 'per' ? pe : pb;
        const zPe = zone(pe.pct); const zPb = zone(pb.pct);
        const loss = latest.per === null;
        return (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {(['per', 'pbr'] as const).map(x => (
                <Chip key={x} active={k === x} onClick={() => setKey(x)}>{KEY_LABEL[x]}河流</Chip>
              ))}
              <span className="mx-1 h-5 w-px bg-line" />
              {YEARS.map(y => (
                <Chip key={y} active={years === y} onClick={() => setYears(y)}>近 {y} 年</Chip>
              ))}
              {span < years && <span className="text-[11px] text-faint">（資料只有 {span} 年多）</span>}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Cell label="本益比" value={loss ? '虧損' : x2(latest.per, ' 倍')}
                    tone={zPe.tone ? ZONE_TONE[zPe.tone] : undefined}
                    sub={loss ? '近四季 EPS ≤ 0' : `近 ${years} 年${ordinal(pe.pct)}・${zPe.label}`} />
              <Cell label="淨值比" value={x2(latest.pbr, ' 倍')}
                    tone={zPb.tone ? ZONE_TONE[zPb.tone] : undefined}
                    sub={`近 ${years} 年${ordinal(pb.pct)}・${zPb.label}`} />
              <Cell label="殖利率" value={x2(latest.yld, '%')} sub={`收盤 ${px(latest.close)}（${latest.date}）`} />
              <Cell label="近四季 EPS" value={latest.eps === null ? '—' : x2(latest.eps, ' 元')}
                    sub={latest.bps === null ? undefined : `每股淨值 ${x2(latest.bps, ' 元')}`} />
            </div>

            {industry && FINANCIAL.has(industry) && (
              <p className="mt-2 text-[12px] text-muted">金融股獲利受提存與投資損益影響大，以淨值比判斷為主。</p>
            )}
            {industry && CYCLICAL.has(industry) && (
              <p className="mt-2 text-[12px] text-muted">
                景氣循環產業：獲利高峰時本益比最低、看起來最便宜，景氣谷底反而本益比很高 —— 這類股票以淨值比為主，本益比只當參考。
              </p>
            )}
            {loss && <p className="mt-2 text-[12px] text-muted">近四季虧損，本益比沒有意義，改看淨值比。</p>}

            {rv ? <RiverChart points={rv} multiples={s.bands!} keyName={k} />
              : <p className="py-6 text-center text-[13px] text-muted">有效天數太少（{s.n} 天），畫不出{KEY_LABEL[k]}河流。</p>}

            <h3 className="mt-4 text-[13px] font-bold text-ink">預估本益比</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
              用預估的未來四季 EPS 算本益比，跟近 {years} 年的本益比分布比；下方五格是各百分位倍數 × 這個 EPS 對應的股價。
            </p>
            {!pe.bands ? (
              <p className="mt-2 text-[12.5px] text-muted">本益比歷史不足或近期虧損，無法推估。</p>
            ) : (
              <div className="mt-2 space-y-2">
                {est ? (
                  <EstimateRow
                    title="營收推估（推估值，僅供參考）"
                    note={`${est.months[0]}～${est.months[est.months.length - 1]} 營收年增 ${est.growth >= 0 ? '+' : ''}${nf2.format(est.growth)}%`}
                    eps={est.eps} price={latest.close} hist={hist} pe={pe} />
                ) : (
                  <p className="text-[12.5px] text-muted">沒有月營收年增率可用，無法用營收推估。</p>
                )}
                {est && (
                  <p className="text-[11px] leading-relaxed text-faint">
                    假設淨利率不變：近四季 EPS {x2(latest.eps, ' 元')} × 近 {est.months.length} 個月營收成長。
                    毛利率變動、業外損益、匯兌、一次性收益都不在裡面；營收大起大落的公司誤差很大。
                  </p>
                )}
                <div className="rounded-lg border border-line bg-bg px-3 py-2">
                  <label className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-ink">
                    自己輸入未來四季 EPS
                    <span className="w-36">
                      <NumberInput value={myEps} onChange={setMyEps} step={0.1} decimal suffix="元"
                                   aria-label="自己預估的未來四季 EPS"
                                   className="h-9 w-full rounded-lg border border-line bg-surface px-2 text-base text-ink" />
                    </span>
                  </label>
                </div>
                {myEps > 0 && (
                  <EstimateRow title="你的預估" note="自己輸入" eps={myEps} price={latest.close} hist={hist} pe={pe} />
                )}
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              百分位是跟這檔股票自己的歷史比，不是跟同業比；成長期改變或產業結構改變時，過去的區間不一定適用。
            </p>
          </>
        );
      })()}
    </Section>
  );
}
