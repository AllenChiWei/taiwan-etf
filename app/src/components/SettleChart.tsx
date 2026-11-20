/* 結算價預測的 13:00～13:30 小圖：加權指數（細線）與「站在當時看的預測結算價」（粗線）。
   跟 GrowthChart 一樣手寫 SVG、用容器實際寬度畫。橫軸固定 13:00～13:30，
   13:25～13:30 收盤集合競價不取樣，畫成淡色底。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CLOSE_SEC, SLOT_LAST, secLabel, type CurvePoint } from '../lib/settle';

const X0 = 13 * 3600, X1 = CLOSE_SEC;
const PRED = '#e06c00';
const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SettleChart({ curve, height = 170 }: { curve: CurvePoint[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(360);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => { if (el.clientWidth > 0) setW(el.clientWidth); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [lo, hi] = useMemo(() => {
    let a = Infinity, b = -Infinity;
    for (const c of curve) { a = Math.min(a, c.v, c.p); b = Math.max(b, c.v, c.p); }
    const pad = Math.max(5, (b - a) * 0.08);
    return b - a < 20 ? [(a + b) / 2 - 10 - pad, (a + b) / 2 + 10 + pad] : [a - pad, b + pad];
  }, [curve]);

  if (curve.length < 2) return null;

  const H = height, FONT = 11;
  const PAD = { top: 8, right: 8, bottom: 18, left: 46 };
  const x = (s: number) => PAD.left + ((s - X0) / (X1 - X0)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const path = (pick: (c: CurvePoint) => number) =>
    curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.sec).toFixed(1)},${y(pick(c)).toFixed(1)}`).join('');
  const yTicks = [0, 0.5, 1].map(f => lo + (hi - lo) * f);
  const active = hover ?? curve.length - 1;
  const cur = curve[active];

  return (
    <div className="mt-2" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full touch-pan-y" role="img"
           aria-label="13:00 到 13:30 加權指數與預測結算價"
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const r = e.currentTarget.getBoundingClientRect();
             const s = X0 + (((e.clientX - r.left) / r.width) * W - PAD.left) / (W - PAD.left - PAD.right) * (X1 - X0);
             let best = 0;
             for (let i = 1; i < curve.length; i++) if (Math.abs(curve[i].sec - s) < Math.abs(curve[best].sec - s)) best = i;
             setHover(best);
           }}>
        <rect x={x(SLOT_LAST)} y={PAD.top} width={x(X1) - x(SLOT_LAST)} height={H - PAD.top - PAD.bottom}
              className="fill-line" opacity={0.5} />
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 5} y={y(v) + 4} textAnchor="end" className="fill-faint" fontSize={FONT}>{nf0.format(v)}</text>
          </g>
        ))}
        {[X0, X0 + 600, X0 + 1200, SLOT_LAST, X1].map(s => (
          <text key={s} x={x(s)} y={H - 4} textAnchor={s === X0 ? 'start' : s === X1 ? 'end' : 'middle'}
                className="fill-faint" fontSize={FONT}>{secLabel(s).slice(0, 5)}</text>
        ))}
        <path d={path(c => c.v)} fill="none" className="stroke-muted" strokeWidth={1.2} strokeLinejoin="round" />
        <path d={path(c => c.p)} fill="none" stroke={PRED} strokeWidth={2.5} strokeLinejoin="round" />
        <line x1={x(cur.sec)} x2={x(cur.sec)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-muted" strokeWidth={1} opacity={0.5} />
        <circle cx={x(cur.sec)} cy={y(cur.v)} r={3} className="fill-muted" />
        <circle cx={x(cur.sec)} cy={y(cur.p)} r={3.5} fill={PRED} />
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="font-mono font-semibold text-ink">{secLabel(cur.sec)}</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-muted" />指數 <span className="font-mono tabular-nums">{nf2.format(cur.v)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ background: PRED }} />預測結算價 <span className="font-mono font-semibold tabular-nums text-ink">{nf0.format(cur.p)}</span>
        </span>
      </div>
    </div>
  );
}
