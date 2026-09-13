/* 績效比較圖。手寫 SVG 而不是引入圖表庫 ——
   折線加座標軸只要百來行，換來的是不必為了一張圖多背 100 KB 的 bundle。 */

import { useMemo, useState } from 'react';
import type { AlignedResult } from '../lib/series';
import { extent } from '../lib/series';

/* 線的顏色。刻意避開紅綠 —— 這張圖是多檔相互比較，紅綠在台股語境
   代表漲跌，用在這裡會被誤讀成「這條是跌的」。 */
const LINE_COLORS = [
  '#1f6feb', '#e06c00', '#7b4fd6', '#0f9b8e',
  '#c2185b', '#5d7a17', '#0277bd', '#8d6e63',
];

export const lineColor = (i: number) => LINE_COLORS[i % LINE_COLORS.length];

interface Props {
  result: AlignedResult;
  height?: number;
}

export function PerformanceChart({ result, height = 300 }: Props) {
  const { dates, series } = result;
  const [hover, setHover] = useState<number | null>(null);

  const W = 1000;                       // viewBox 寬度；實際寬度由 CSS 決定
  const H = height;
  const PAD = { top: 12, right: 12, bottom: 26, left: 46 };

  const [lo, hi] = useMemo(() => extent(series), [series]);

  const x = (i: number) =>
    PAD.left + (dates.length <= 1 ? 0 : (i / (dates.length - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) =>
    PAD.top + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);

  const paths = useMemo(() => series.map(s => {
    let d = '';
    let pen = false;
    s.points.forEach((p, i) => {
      if (p === null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`;
      pen = true;
    });
    return d;
  }), [series, lo, hi, dates.length, H]);

  // Y 軸刻度：固定五條，落在乾淨的位置
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let k = 0; k <= 4; k++) out.push(lo + ((hi - lo) * k) / 4);
    return out;
  }, [lo, hi]);

  // X 軸只標首尾與中間，日期太密會糊成一團
  const xLabels = dates.length
    ? [0, Math.floor((dates.length - 1) / 2), dates.length - 1]
    : [];

  if (!dates.length || !series.length) {
    return (
      <div className="grid h-[200px] place-items-center rounded-xl border border-line bg-surface text-sm text-muted">
        沒有足夠的重疊期間可以比較
      </div>
    );
  }

  const hoverIdx = hover === null ? null : Math.max(0, Math.min(dates.length - 1, hover));

  return (
    <div className="rounded-xl border border-line bg-surface p-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-pan-y"
        role="img"
        aria-label={`績效比較圖，${series.map(s => s.label).join('、')}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const t = (px - PAD.left) / (W - PAD.left - PAD.right);
          setHover(Math.round(t * (dates.length - 1)));
        }}
      >
        {/* 基準線：100 代表起點，穿越它就是正負報酬的分界 */}
        {100 >= lo && 100 <= hi && (
          <line x1={PAD.left} x2={W - PAD.right} y1={y(100)} y2={y(100)}
                stroke="var(--c-border-strong)" strokeDasharray="4 4" strokeWidth="1" />
        )}

        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
                  stroke="var(--c-border)" strokeWidth="1" opacity="0.5" />
            <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle"
                  fontSize="11" fill="var(--c-faint)">{t.toFixed(0)}</text>
          </g>
        ))}

        {xLabels.map(i => (
          <text key={i} x={x(i)} y={H - 8}
                textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
                fontSize="11" fill="var(--c-faint)">{dates[i]}</text>
        ))}

        {paths.map((d, i) => (
          <path key={series[i].code} d={d} fill="none" stroke={lineColor(i)}
                strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {hoverIdx !== null && (
          <>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={PAD.top} y2={H - PAD.bottom}
                  stroke="var(--c-border-strong)" strokeWidth="1" />
            {series.map((s, i) => {
              const p = s.points[hoverIdx];
              return p === null ? null : (
                <circle key={s.code} cx={x(hoverIdx)} cy={y(p)} r="3.5"
                        fill={lineColor(i)} stroke="var(--c-surface)" strokeWidth="1.5" />
              );
            })}
          </>
        )}
      </svg>

      {/* 圖例兼讀值：沒有 hover 時顯示期末報酬，有 hover 時顯示該日 */}
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[13px]">
        {series.map((s, i) => {
          const v = hoverIdx === null ? s.totalReturn : (s.points[hoverIdx] ?? null);
          const shown = hoverIdx === null ? v : (v === null ? null : v - 100);
          return (
            <li key={s.code} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: lineColor(i) }} />
              <span className="font-mono font-semibold text-ink">{s.code}</span>
              <span className="tabular font-mono text-muted">
                {shown === null ? '—' : `${shown >= 0 ? '+' : ''}${shown.toFixed(1)}%`}
              </span>
            </li>
          );
        })}
        {hoverIdx !== null && (
          <li className="tabular ml-auto font-mono text-faint">{dates[hoverIdx]}</li>
        )}
      </ul>
    </div>
  );
}
