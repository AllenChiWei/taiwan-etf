/* 年配息的來源佔比：甜甜圈圖 + 排名清單。
 *
 * 回答的是「這一年能領的錢主要是哪一檔帶來的」。月曆看的是時間分布，這裡看的是
 * 來源集中度 —— 同一筆年配息，來自一檔還是來自八檔，風險完全不同。
 *
 * 圖是內嵌 SVG，幾何在 lib/dividend.ts 的 donutSlices()（純函式、有測試）。
 * 顏色沿用月曆那一套「由代號決定」的配色，兩張圖才對得起來。
 */

import { donutSlices, type HoldingProjection } from '../lib/dividend';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });

export function DividendPie({ rows, total, colorOf }: {
  /** 已依年配息由大到小排好 */
  rows: HoldingProjection[];
  total: number;
  colorOf: (code: string) => string;
}) {
  const slices = donutSlices(rows.map(r => r.annual));
  if (slices.length === 0) return null;

  const top = rows[slices[0].i];
  const topPct = slices[0].pct;

  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-bold text-ink">年配息來源</h2>
        <span className="text-[11.5px] text-faint">
          {top.code} 佔 {nf1.format(topPct)}%
        </span>
      </div>

      <div className="mt-2 grid items-center gap-3 sm:grid-cols-[168px_1fr]">
        <div className="mx-auto w-[168px]">
          <svg viewBox="0 0 100 100" role="img"
               aria-label={`年配息來源佔比，最大的是 ${top.code} ${top.name}，佔 ${nf1.format(topPct)}%`}>
            {slices.map(s => (
              s.full
                // 只有一檔有配息時 arc 的起終點重合，畫不出扇形，改用圓環
                ? <circle key={s.i} cx="50" cy="50" r="34" fill="none"
                          strokeWidth="16" stroke={colorOf(rows[s.i].code)} />
                : <path key={s.i} d={s.d} fill={colorOf(rows[s.i].code)} />
            ))}
            {/* 中間留白處放總額，圖與數字不必分開看 */}
            <text x="50" y="47" textAnchor="middle"
                  className="fill-muted text-[7px]">一年可領</text>
            <text x="50" y="58" textAnchor="middle"
                  className="fill-ink text-[11px] font-bold">
              {nf0.format(Math.round(total))}
            </text>
          </svg>
        </div>

        <ol className="min-w-0">
          {slices.map((s, rank) => {
            const r = rows[s.i];
            return (
              <li key={r.code}
                  className="grid grid-cols-[1.3em_1fr_auto] items-baseline gap-2
                             border-b border-line/60 py-1 last:border-0">
                <span className="font-mono text-[11px] text-faint">{rank + 1}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: colorOf(r.code) }} />
                  <span className="font-mono text-[12.5px] font-bold text-ink">{r.code}</span>
                  <span className="truncate text-[12px] text-muted">{r.name}</span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-[12.5px] font-semibold
                                   tabular-nums text-ink">
                    {nf1.format(s.pct)}%
                  </span>
                  <span className="block font-mono text-[10.5px] tabular-nums text-faint">
                    {nf0.format(Math.round(r.annual))} 元
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <p className="mt-2 text-[11px] text-faint">
        依預估年配息金額計算。沒有配息紀錄的持股不會出現在圖上 —— 它們在圖上會是
        有顏色但沒有意義的一片。
      </p>
    </section>
  );
}
