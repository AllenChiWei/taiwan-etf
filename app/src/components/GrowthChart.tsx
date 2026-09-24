/* 資產成長圖：投入本金（面積）與總價值（線）疊在一起。
   跟 PerformanceChart 一樣手寫 SVG —— 兩條線一個面積，不值得為它背一個圖表庫。

   刻意只畫兩個量：本金與總價值。兩者之間那塊面積就是損益，
   不必再多一條線去說同一件事。

   座標用容器的實際像素寬度，不是固定 1000 單位再縮放：固定寬度在手機上會縮成
   三分之一，字剩 7px、圖只有 80px 高；而左邊的刻度欄寬是寫死的，金額到「億」
   就切掉前幾位（20.59億 只剩 .59億），到「兆」整排不見 —— 使用者回報的
   「金額太大圖就消失」就是這個。現在刻度欄寬依最長的標籤算。 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface GrowthPoint {
  label: string;
  invested: number;
  value: number;
}

interface Props {
  points: GrowthPoint[];
  height?: number;
  /** 格式化數字用；由呼叫端決定要不要加千分位、單位 */
  format: (v: number) => string;
}

export function GrowthChart({ points, height = 240, format }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => { if (el.clientWidth > 0) setW(el.clientWidth); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = height;
  const FONT = 11;

  const hi = useMemo(
    () => Math.max(1, ...points.map(p => Math.max(p.invested, p.value))),
    [points]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => hi * f);
  // 刻度欄寬：最長的標籤 × 字寬。中文字與數字寬度不同，數字約 0.6 個字高、中文 1 個
  const labelWidth = Math.max(...yTicks.map(v => [...format(v)]
    .reduce((w, ch) => w + (ch.charCodeAt(0) < 128 ? 0.62 : 1) * FONT, 0)));
  const PAD = { top: 10, right: 8, bottom: 20, left: Math.ceil(labelWidth) + 8 };

  const x = (i: number) =>
    PAD.left + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + (1 - v / hi) * (H - PAD.top - PAD.bottom);

  const line = (pick: (p: GrowthPoint) => number) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join('');

  if (points.length < 2) {
    return <p className="py-10 text-center text-sm text-muted">資料不足，畫不出曲線。</p>;
  }

  const baseline = y(0);
  const investedArea = `${line(p => p.invested)}L${x(points.length - 1).toFixed(1)},${baseline}L${x(0).toFixed(1)},${baseline}Z`;

  // 只標首尾與中間三個位置，手機寬度下再多就糊成一團
  const xTicks = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  const active = hover === null ? points.length - 1 : hover;
  const cur = points[active];

  return (
    <div className="mt-2" ref={box}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block w-full touch-pan-y"
        role="img"
        aria-label="資產成長圖"
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const r = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(
            ((rel - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={0} width={W - PAD.left - PAD.right} height={H} />
          </clipPath>
        </defs>

        {yTicks.map(v => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)}
                  className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end"
                  className="fill-faint" fontSize={FONT}>{format(v)}</text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>
          <path d={investedArea} className="fill-accent" opacity={0.14} />
          <path d={line(p => p.invested)} fill="none" className="stroke-accent"
                strokeWidth={2} strokeDasharray="6 5" />
          <path d={line(p => p.value)} fill="none" stroke="#e06c00" strokeWidth={2.5}
                strokeLinejoin="round" />
        </g>

        {xTicks.map(i => (
          <text key={i} x={x(i)} y={H - 4}
                textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                className="fill-faint" fontSize={FONT}>{points[i].label}</text>
        ))}

        <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={H - PAD.bottom}
              className="stroke-muted" strokeWidth={1} opacity={0.5} />
        <circle cx={x(active)} cy={y(cur.value)} r={4} fill="#e06c00" />
        <circle cx={x(active)} cy={y(cur.invested)} r={3.5} className="fill-accent" />
      </svg>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1
                      text-[12px] text-muted">
        <span className="font-semibold text-ink">{cur.label}</span>
        <span className="flex items-center gap-1.5">
          {/* 圖例要跟線一樣是虛線，否則兩條線在圖上分不出誰是誰 */}
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-accent" />
          投入 {format(cur.invested)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: '#e06c00' }} />
          價值 {format(cur.value)}
        </span>
        <span className={cur.value >= cur.invested ? 'font-semibold text-up' : 'font-semibold text-down'}>
          {cur.value >= cur.invested ? '+' : '−'}{format(Math.abs(cur.value - cur.invested))}
        </span>
      </div>
    </div>
  );
}
