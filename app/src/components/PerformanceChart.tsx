/* 績效比較圖。手寫 SVG 而不是引入圖表庫 ——
   折線加座標軸只要百來行，換來的是不必為了一張圖多背 100 KB 的 bundle。 */

import { useMemo, useState } from 'react';
import type { AlignedResult } from '../lib/series';
import { extent } from '../lib/series';
import { CATEGORY_COLORS } from '../lib/palette';

/* 線的顏色與配息圖共用一份色表（lib/palette.ts），刻意避開紅綠。 */
export const lineColor = (i: number) => CATEGORY_COLORS[i % CATEGORY_COLORS.length];

interface Props {
  result: AlignedResult;
  height?: number;
  /** 依代號給色（與勾選清單的色點一致）；沒給就依序號 */
  colorOf?: (code: string, i: number) => string;
}

export function PerformanceChart({ result, height = 300, colorOf }: Props) {
  const { dates, series } = result;
  const [hover, setHover] = useState<number | null>(null);
  /** 下方圖例：預設依期間報酬由高到低，可切回加入順序 */
  const [ranked, setRanked] = useState(true);
  const color = (code: string, i: number) => (colorOf ? colorOf(code, i) : lineColor(i));
  const legend = useMemo(() => {
    const list = series.map((s, i) => ({ s, i }));
    if (!ranked) return list;
    return [...list].sort((a, b) => (b.s.totalReturn ?? -Infinity) - (a.s.totalReturn ?? -Infinity));
  }, [series, ranked]);

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
          <path key={series[i].code} d={d} fill="none" stroke={color(series[i].code, i)}
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
                        fill={color(s.code, i)} stroke="var(--c-surface)" strokeWidth="1.5" />
              );
            })}
          </>
        )}
      </svg>

      {/* 圖例兼讀值：沒有 hover 時顯示期末報酬，有 hover 時顯示該日。
          預設依期末報酬由高到低排名（hover 時順序不跳，免得游標移動時清單一直重排） */}
      <div className="mt-1 flex items-center justify-between gap-2 px-1">
        <span className="text-[11.5px] text-faint">
          {hoverIdx === null ? '期間報酬' : `${dates[hoverIdx]} 的累積報酬`}
        </span>
        <button type="button" onClick={() => setRanked(v => !v)} aria-pressed={ranked}
                className="text-[11.5px] font-semibold text-accent">
          {ranked ? '依報酬高→低 ↓' : '依勾選順序'}
        </button>
      </div>
      <ol className="mt-0.5 grid grid-cols-1 gap-x-4 px-1 text-[13px] sm:grid-cols-2">
        {legend.map(({ s, i }, rank) => {
          const v = hoverIdx === null ? s.totalReturn : (s.points[hoverIdx] ?? null);
          const shown = hoverIdx === null ? v : (v === null ? null : v - 100);
          return (
            <li key={s.code} className="flex items-center gap-1.5 border-b border-line/50 py-1">
              {ranked && <span className="w-4 shrink-0 text-right font-mono text-[11px] text-faint">{rank + 1}</span>}
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: color(s.code, i) }} />
              <span className="font-mono font-semibold text-ink">{s.code}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{s.label !== s.code ? s.label : ''}</span>
              <span className={`tabular shrink-0 font-mono font-semibold ${
                shown === null ? 'text-faint' : shown > 0 ? 'text-up' : shown < 0 ? 'text-down' : 'text-muted'}`}>
                {shown === null ? '—' : `${shown >= 0 ? '+' : ''}${shown.toFixed(1)}%`}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
