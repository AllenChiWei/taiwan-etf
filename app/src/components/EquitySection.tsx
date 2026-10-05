/* 私人頁的「實盤權益」：元大期貨帳戶每日權益（已扣出入金的損益）。
 * 圖只有一個金額軸：累計損益線＋水下的回撤面積，滑過去看當天數字；下面是最近 10 天明細。 */

import { useMemo, useState } from 'react';
import { equityStats, type EquityData, type EquityRow } from '../lib/accountEquity';

const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const money = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf.format(Math.abs(v))}`;
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`;
const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted');

function Tile({ label, value, cls = 'text-ink', sub }: { label: string; value: string; cls?: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-sunken px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`font-mono text-[15px] font-bold tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

const W = 640, H = 200, PL = 8, PR = 8, PT = 10, PB = 18;

function Chart({ rows }: { rows: EquityRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const lo = Math.min(0, ...rows.map(r => Math.min(r.cum, r.dd)));
  const hi = Math.max(0, ...rows.map(r => r.cum));
  const span = hi - lo || 1;
  const x = (i: number) => PL + (rows.length === 1 ? 0.5 : i / (rows.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + ((hi - v) / span) * (H - PT - PB);
  const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.cum).toFixed(1)}`).join('');
  const dd = `M${x(0)},${y(0)}` + rows.map((r, i) => `L${x(i).toFixed(1)},${y(r.dd).toFixed(1)}`).join('')
    + `L${x(rows.length - 1)},${y(0)}Z`;
  const h = hover === null ? null : rows[hover];
  return (
    <div className="relative mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
           aria-label="累計損益與回撤（元）"
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const b = e.currentTarget.getBoundingClientRect();
             const px = ((e.clientX - b.left) / b.width) * W;
             const i = Math.round(((px - PL) / (W - PL - PR)) * (rows.length - 1));
             setHover(Math.max(0, Math.min(rows.length - 1, i)));
           }}>
        <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke="var(--c-border-strong)" strokeWidth="1" />
        <path d={dd} fill="var(--c-down)" opacity="0.18" />
        <path d={line} fill="none" stroke="var(--cat-1)" strokeWidth="2" strokeLinejoin="round" />
        <text x={PL} y={H - 4} fontSize="11" fill="var(--c-faint)">{rows[0].d}</text>
        <text x={W - PR} y={H - 4} fontSize="11" fill="var(--c-faint)" textAnchor="end">{rows[rows.length - 1].d}</text>
        {h && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} stroke="var(--c-border-strong)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(h.cum)} r="4.5" fill="var(--cat-1)" stroke="var(--c-surface)" strokeWidth="2" />
          </>
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 right-1 rounded-lg border border-line bg-surface px-2.5 py-1.5
                        text-[11.5px] shadow">
          <div className="font-semibold text-ink">{h.d}</div>
          <div>當日 <span className={`font-mono ${tone(h.pnl)}`}>{money(h.pnl)}</span></div>
          <div>累計 <span className={`font-mono ${tone(h.cum)}`}>{money(h.cum)}</span></div>
          <div>回撤 <span className="font-mono text-muted">{money(h.dd)}</span></div>
          {h.flow !== 0 && <div className="text-faint">出入金 {money(h.flow)}（不算損益）</div>}
        </div>
      )}
      <div className="mt-1 flex gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[var(--cat-1)]" />累計損益</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 bg-down opacity-30" />回撤</span>
      </div>
    </div>
  );
}

export function EquitySection({ data }: { data: EquityData }) {
  const s = useMemo(() => equityStats(data.rows), [data.rows]);
  const last = data.rows[data.rows.length - 1];
  if (!s || !last) return null;
  const recent = data.rows.slice(-10).reverse();
  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-bold text-ink">實盤權益（元大期貨）</h2>
        <span className="text-[11.5px] text-faint">資料截至 {data.asof}　·　損益已扣除出入金</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="權益總值" value={nf.format(last.tv)} sub={`未平倉 ${last.oi} 口　風險指標 ${last.risk}`} />
        <Tile label={`累計損益（${s.days} 天）`} value={money(s.cum)} cls={tone(s.cum)} sub={`時間加權 ${pct(s.twr)}`} />
        <Tile label="本月損益" value={money(s.month)} cls={tone(s.month)} sub={`最近一天 ${money(last.pnl)}`} />
        <Tile label="最大回撤" value={money(s.mdd)} cls="text-down"
              sub={`目前 ${money(s.dd)}${s.netOverMdd !== null ? `　淨利/MDD ${s.netOverMdd.toFixed(2)}` : ''}`} />
      </div>
      <Chart rows={data.rows} />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-[12px] tabular-nums">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="py-1 text-left font-semibold">日期</th>
              <th className="py-1 text-right font-semibold">權益總值</th>
              <th className="py-1 text-right font-semibold">當日損益</th>
              <th className="py-1 text-right font-semibold">未平損益</th>
              <th className="py-1 text-right font-semibold">出入金</th>
              <th className="py-1 text-right font-semibold">未平倉</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {recent.map(r => (
              <tr key={r.d} className="border-b border-line last:border-0">
                <td className="py-1 text-left font-sans">{r.d.slice(5)}</td>
                <td className="py-1 text-right text-ink">{nf.format(r.tv)}</td>
                <td className={`py-1 text-right ${tone(r.pnl)}`}>{money(r.pnl)}</td>
                <td className={`py-1 text-right ${tone(r.upl)}`}>{money(r.upl)}</td>
                <td className="py-1 text-right text-muted">{r.flow ? money(r.flow) : '—'}</td>
                <td className="py-1 text-right text-muted">{r.oi}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
