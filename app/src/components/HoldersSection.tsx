/* 個股頁：持有這檔股票的 ETF（股票反查 ETF，2026-10-26）。計算在 lib/holders.ts。
 *
 * 要講清楚的限制：非主動式的 ETF 只有公會月報「前十大」，權重排在十名以外的持有查不到；
 * 主動式（有每日持股的那幾檔）才是完整持股。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchActive, fetchTop10 } from '../api/extras';
import { fetchDataset } from '../api/etfs';
import { holdersOf } from '../lib/holders';
import type { ActiveData } from '../lib/active';
import type { Top10Data } from '../lib/top10';

const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ACT_TONE: Record<string, string> = { 新增: 'text-up', 加碼: 'text-up', 減碼: 'text-down', 剔除: 'text-down' };

export function HoldersSection({ code }: { code: string }) {
  const [src, setSrc] = useState<{ a: ActiveData | null; m: Top10Data | null; names: Record<string, string> } | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      fetchActive(ac.signal).catch(() => null),
      fetchTop10(ac.signal).catch(() => null),
      fetchDataset(ac.signal).then(d => Object.fromEntries(d.etfs.map(e => [e.code, e.name]))).catch(() => ({})),
    ]).then(([a, m, names]) => { if (!ac.signal.aborted) setSrc({ a, m, names }); });
    return () => ac.abort();
  }, []);

  const rows = useMemo(() => (src ? holdersOf(code, src.m, src.a, src.names) : []), [src, code]);
  if (!src) return null;
  const shown = all ? rows : rows.slice(0, 12);
  const daily = rows.filter(r => r.kind === 'daily').length;

  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-bold text-ink">持有這檔的 ETF</h2>
        <span className="text-[11.5px] text-faint">
          {rows.length ? `${rows.length} 檔（主動式每日持股 ${daily} 檔、其他為月報前十大）` : '查無'}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] text-muted">
          沒有 ETF 把它列在前十大持股，追蹤中的主動式 ETF 也沒有持有。
        </p>
      ) : (
        <ul className="mt-1.5">
          {shown.map(r => (
            <li key={r.etf} className="grid grid-cols-[1fr_auto] items-baseline gap-2 border-b border-line/60 py-1.5 last:border-0">
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-ink">
                  <span className="font-mono text-[12px] text-muted">{r.etf}</span> {r.name}
                </span>
                <span className="block text-[10.5px] text-faint">
                  {r.kind === 'daily' ? `每日持股 · ${r.asof}` : `月報前十大 · ${r.asof}`}
                  {r.last && (
                    <> · 最近 <span className={ACT_TONE[r.last.kind] ?? ''}>{r.last.kind}</span> {r.last.d}</>
                  )}
                </span>
              </span>
              <span className="text-right font-mono text-[13.5px] font-bold tabular-nums text-ink">
                {r.weight == null ? '—' : `${nf2.format(r.weight)}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 12 && (
        <button type="button" onClick={() => setAll(v => !v)} className="mt-1.5 text-[12.5px] font-semibold text-accent">
          {all ? '收起' : `顯示全部 ${rows.length} 檔`}
        </button>
      )}
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
        權重＝佔該 ETF 淨值的比例。非主動式 ETF 的來源是投信投顧公會月報，只公布前十大，排在十名以外的持有不會出現；
        主動式 ETF 是投信每日公告的完整持股。
      </p>
    </section>
  );
}
