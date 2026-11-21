/* 隔日漲跌幅的通道推移圖：每一天「前一天收盤時估的」95%／99% 通道（淡色帶），疊上實際的盤中高低（直線）
 * 與收盤（細線）；突破通道的日子打點。最右邊是明天的預估。手寫 SVG，用容器實際寬度（同 GrowthChart）。 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { channelStats, pointBreach, type NextPoint } from '../lib/nextday';

const RANGES = [60, 120, 250, 500];
const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const REG = { n: '一般', w: '跨週末', h: '連假後' } as const;

export function NextDayChannel({ series }: { series: NextPoint[] }) {
  const [n, setN] = useState(120);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(360);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => { if (el.clientWidth > 0) setW(el.clientWidth); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => series.slice(-(n + 1)), [series, n]);
  const st = useMemo(() => channelStats(pts), [pts]);
  const [lo, hi] = useMemo(() => {
    let a = Infinity, b = -Infinity;
    for (const p of pts) {
      a = Math.min(a, p.d99, p.l ?? Infinity);
      b = Math.max(b, p.u99, p.h ?? -Infinity);
    }
    const pad = (b - a) * 0.04;
    return [a - pad, b + pad];
  }, [pts]);

  if (pts.length < 2) return null;
  const H = 240, FONT = 11;
  const PAD = { top: 8, right: 8, bottom: 18, left: 46 };
  const x = (i: number) => PAD.left + (i / (pts.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const band = (up: keyof NextPoint, dn: keyof NextPoint) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[up] as number).toFixed(1)}`).join('')
    + [...pts].reverse().map((p, k) => `L${x(pts.length - 1 - k).toFixed(1)},${y(p[dn] as number).toFixed(1)}`).join('') + 'Z';
  const closeLine = pts.map((p, i) => (p.c === undefined ? '' : `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`)).join('');
  const barW = Math.max(1, Math.min(3, (W - PAD.left - PAD.right) / pts.length * 0.6));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + (hi - lo) * f);
  const xTicks = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
  const fmtDay = (d: string) => (n >= 250 ? d.slice(2, 7).replace('-', '/') : d.slice(5).replace('-', '/'));
  const active = hover ?? pts.length - 1;
  const cur = pts[active];
  const br = pointBreach(cur);
  const expect = (p: number) => nf0.format(st.days * p);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="text-[12px] font-semibold text-ink">期間</span>
        {RANGES.filter(r => r < series.length).map(r => (
          <button key={r} type="button" aria-pressed={n === r} onClick={() => { setN(r); setHover(null); }}
                  className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold ${n === r ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}>
            {r} 天
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11.5px] text-muted">
        這 {st.days} 天：盤中最高突破 95% 上緣 <b className="text-ink">{st.up95}</b> 次、最低跌破下緣 <b className="text-ink">{st.dn95}</b> 次（應各約 {expect(0.05)} 次）；
        99% 通道 <b className="text-ink">{st.up99}</b>／<b className="text-ink">{st.dn99}</b> 次（應各約 {expect(0.01)} 次）。
      </p>
      <div ref={box} className="mt-1">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full touch-pan-y" role="img"
             aria-label="隔日漲跌幅通道推移圖"
             onMouseLeave={() => setHover(null)}
             onMouseMove={e => {
               const r = e.currentTarget.getBoundingClientRect();
               const rel = ((e.clientX - r.left) / r.width) * W;
               const i = Math.round(((rel - PAD.left) / (W - PAD.left - PAD.right)) * (pts.length - 1));
               setHover(Math.max(0, Math.min(pts.length - 1, i)));
             }}>
          {yTicks.map(v => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
              <text x={PAD.left - 5} y={y(v) + 4} textAnchor="end" className="fill-faint" fontSize={FONT}>{nf0.format(v)}</text>
            </g>
          ))}
          <path d={band('u99', 'd99')} className="fill-accent" opacity={0.12} />
          <path d={band('u95', 'd95')} className="fill-accent" opacity={0.2} />
          {pts.map((p, i) => {
            if (p.h === undefined || p.l === undefined) return null;
            const b = pointBreach(p);
            const cls = b ? (b.side === 'up' ? 'stroke-up' : 'stroke-down') : 'stroke-muted';
            return <line key={p.d} x1={x(i)} x2={x(i)} y1={y(p.h)} y2={y(p.l)} className={cls}
                         strokeWidth={b ? barW + 0.6 : barW} opacity={b ? 1 : 0.55} />;
          })}
          <path d={closeLine} fill="none" className="stroke-ink" strokeWidth={1} opacity={0.75} />
          {pts.map((p, i) => {
            const b = pointBreach(p);
            if (!b) return null;
            const v = b.side === 'up' ? p.h! : p.l!;
            return <circle key={`b${p.d}`} cx={x(i)} cy={y(v)} r={b.level === 99 ? 3.5 : 2.4}
                           className={b.side === 'up' ? 'fill-up' : 'fill-down'} />;
          })}
          {/* 明天：通道的最後一段用虛線框起來 */}
          {pts[pts.length - 1].f && (
            <g>
              <line x1={x(pts.length - 1)} x2={x(pts.length - 1)} y1={y(pts[pts.length - 1].u99)} y2={y(pts[pts.length - 1].d99)}
                    className="stroke-accent" strokeWidth={2} strokeDasharray="3 2" />
              <text x={x(pts.length - 1) - 3} y={y(pts[pts.length - 1].u99) - 3} textAnchor="end" className="fill-accent" fontSize={FONT}>明天</text>
            </g>
          )}
          {xTicks.map(i => (
            <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}
                  className="fill-faint" fontSize={FONT}>{fmtDay(pts[i].d)}</text>
          ))}
          <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-muted" strokeWidth={1} opacity={0.4} />
        </svg>
      </div>
      <div className="mt-1 rounded-lg bg-sunken/60 px-2.5 py-1.5 text-[11.5px] text-muted">
        <span className="font-semibold text-ink">{cur.d.slice(5).replace('-', '/')}</span>
        <span className="ml-1 text-faint">{cur.f ? '明天預估' : REG[cur.r]}</span>
        {' · '}前收 <span className="font-mono">{nf0.format(cur.b)}</span>
        {cur.h !== undefined && <>{' · '}高 <span className="font-mono text-up">{nf0.format(cur.h)}</span> 低 <span className="font-mono text-down">{nf0.format(cur.l!)}</span> 收 <span className="font-mono text-ink">{nf0.format(cur.c!)}</span></>}
        <br />95% <span className="font-mono">{nf0.format(cur.d95)}～{nf0.format(cur.u95)}</span>
        {' · '}99% <span className="font-mono">{nf0.format(cur.d99)}～{nf0.format(cur.u99)}</span>
        {br && <b className="ml-1 text-ink">{br.side === 'up' ? '突破' : '跌破'} {br.level}%</b>}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-faint">
        深色帶＝95% 通道、淺色帶＝99% 通道，都是「前一天收盤時」只用當時以前的資料估的；直線是當天盤中高低（紅＝突破上緣、綠＝跌破下緣），
        細線是收盤。滑過圖看每一天的數字。
      </p>
    </div>
  );
}
