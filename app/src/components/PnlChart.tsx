/* 對帳單的累計損益圖：好幾條線共用一條日期軸，單位是元。
 *
 * 跟 PerformanceChart 一樣手寫 SVG。那張圖把每條線正規化成「起點 = 100」，
 * 這裡不行 —— 三種交易方式比的是賺了幾塊錢，不是報酬率（對帳單沒有本金）。
 * 下方可以疊一張回撤圖：累計損益距離之前最高點多遠。 */

import { useMemo, useState } from 'react';
import { drawdownSeries } from '../lib/futures';

export interface PnlLine {
  key: string;
  label: string;
  color: string;
  values: number[];
  /** 合計那條畫粗一點 */
  bold?: boolean;
}

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const money = (v: number) => `${v >= 0 ? '+' : '−'}${nf0.format(Math.abs(v))}`;

/** 金額刻度：萬元以上用「萬」，比較好讀。 */
function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return `${v < 0 ? '−' : ''}${nf0.format(Math.round(a / 10000))}萬`;
  return `${v < 0 ? '−' : ''}${nf0.format(a)}`;
}

/** 0 一定在刻度上，其餘五等分。 */
function range(lines: number[][]): [number, number] {
  let lo = 0, hi = 0;
  for (const vs of lines) for (const v of vs) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === hi) hi = lo + 1;
  const pad = (hi - lo) * 0.05;
  return [lo < 0 ? lo - pad : lo, hi + pad];
}

export function PnlChart({ dates, lines, showDrawdown = false }: {
  dates: string[];
  lines: PnlLine[];
  showDrawdown?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = 280;
  const DH = showDrawdown ? 110 : 0;
  const PAD = { top: 12, right: 12, bottom: 24, left: 56 };
  const innerW = W - PAD.left - PAD.right;

  const [lo, hi] = useMemo(() => range(lines.map(l => l.values)), [lines]);
  const dd = useMemo(
    () => (showDrawdown ? lines.map(l => drawdownSeries(l.values)) : []),
    [lines, showDrawdown]);
  const ddLo = useMemo(() => Math.min(-1, ...dd.flat()), [dd]);

  const x = (i: number) => PAD.left + (dates.length <= 1 ? 0 : (i / (dates.length - 1)) * innerW);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const yd = (v: number) => H + 8 + (v / ddLo) * (DH - 20);

  const path = (vs: number[], fy: (v: number) => number) =>
    vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${fy(v).toFixed(1)}`).join('');

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let k = 0; k <= 4; k++) out.push(lo + ((hi - lo) * k) / 4);
    return out;
  }, [lo, hi]);

  // X 軸：首、尾，加上每年的第一個交易日（跨年時）
  const xLabels = useMemo(() => {
    if (!dates.length) return [] as number[];
    const idx = new Set<number>([0, dates.length - 1]);
    for (let i = 1; i < dates.length; i++) {
      if (dates[i].slice(0, 4) !== dates[i - 1].slice(0, 4)) idx.add(i);
    }
    if (idx.size === 2 && dates.length > 2) idx.add(Math.floor((dates.length - 1) / 2));
    // 太靠近的標籤會疊在一起，留間距夠的
    const sorted = [...idx].sort((a, b) => a - b);
    const keep: number[] = [];
    for (const i of sorted) {
      if (!keep.length || x(i) - x(keep[keep.length - 1]) > 90 || i === dates.length - 1) {
        if (keep.length && i === dates.length - 1 && x(i) - x(keep[keep.length - 1]) <= 90) keep.pop();
        keep.push(i);
      }
    }
    return keep;
  }, [dates]); // eslint-disable-line react-hooks/exhaustive-deps

  if (dates.length < 2 || !lines.length) {
    return (
      <div className="mt-2 grid h-[160px] place-items-center rounded-lg bg-bg text-[12.5px] text-muted">
        交易日太少，畫不出曲線
      </div>
    );
  }

  const hi2 = hover === null ? null : Math.max(0, Math.min(dates.length - 1, hover));
  const totalH = H + DH;

  return (
    <div className="mt-2">
      {/* 手機上不縮到看不見字：最窄 640px，超過就左右滑 */}
      <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${totalH}`} className="h-auto w-full min-w-[640px] touch-pan-y"
           role="img" aria-label={`累計損益曲線：${lines.map(l => l.label).join('、')}`}
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const r = e.currentTarget.getBoundingClientRect();
             const px = ((e.clientX - r.left) / r.width) * W;
             setHover(Math.round(((px - PAD.left) / innerW) * (dates.length - 1)));
           }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
                  stroke="var(--c-border)" strokeWidth="1" opacity="0.5" />
            <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle"
                  fontSize="12" fill="var(--c-faint)">{short(t)}</text>
          </g>
        ))}
        {lo < 0 && (
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)}
                stroke="var(--c-border-strong)" strokeDasharray="4 4" strokeWidth="1" />
        )}
        {xLabels.map(i => (
          <text key={i} x={x(i)} y={H - 6}
                textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
                fontSize="12" fill="var(--c-faint)">{dates[i]}</text>
        ))}
        {lines.map(l => (
          <path key={l.key} d={path(l.values, y)} fill="none" stroke={l.color}
                strokeWidth={l.bold ? 2.6 : 1.8} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {showDrawdown && (
          <g>
            <text x={PAD.left} y={H + 4} fontSize="12" fill="var(--c-faint)">回撤（距前高）</text>
            <line x1={PAD.left} x2={W - PAD.right} y1={yd(0)} y2={yd(0)}
                  stroke="var(--c-border)" strokeWidth="1" />
            <text x={PAD.left - 6} y={yd(ddLo)} textAnchor="end" dominantBaseline="middle"
                  fontSize="12" fill="var(--c-faint)">{short(ddLo)}</text>
            {dd.map((vs, k) => (
              <path key={lines[k].key} d={path(vs, yd)} fill="none" stroke={lines[k].color}
                    strokeWidth={lines[k].bold ? 2 : 1.4} opacity="0.85" />
            ))}
          </g>
        )}

        {hi2 !== null && (
          <>
            <line x1={x(hi2)} x2={x(hi2)} y1={PAD.top} y2={totalH - 4}
                  stroke="var(--c-border-strong)" strokeWidth="1" />
            {lines.map(l => (
              <circle key={l.key} cx={x(hi2)} cy={y(l.values[hi2])} r="4"
                      fill={l.color} stroke="var(--c-surface)" strokeWidth="1.5" />
            ))}
          </>
        )}
      </svg>
      </div>

      {/* 圖例兼讀值：沒有 hover 時是期末累計，有 hover 時是那一天 */}
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12.5px]">
        {lines.map(l => {
          const v = l.values[hi2 ?? l.values.length - 1];
          return (
            <li key={l.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: l.color }} />
              <span className={l.bold ? 'font-bold text-ink' : 'text-ink'}>{l.label}</span>
              <span className={`font-mono tabular-nums ${v >= 0 ? 'text-up' : 'text-down'}`}>
                {money(v)}
              </span>
            </li>
          );
        })}
        <li className="ml-auto font-mono tabular-nums text-faint">
          {hi2 === null ? `${dates[0]} ～ ${dates[dates.length - 1]}` : dates[hi2]}
        </li>
      </ul>
    </div>
  );
}
