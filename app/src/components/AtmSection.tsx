/* 週選價平和：最新數字、週一到週五的平均、近期明細。
 *
 * 兩個選項不是裝飾，是這份資料能不能被讀懂的關鍵：
 *
 * **分組基準**。「週三的價平和」有兩種問法 —— 週三收盤那一筆，或週三早上開盤前
 * 看到的那一筆（＝前一交易日收盤）。預設用盤前，因為那才是開盤前會看的數字。
 *
 * **排除到期當日**。到期那天的價平和趨近 0（實測週三系列在週三平均 15，隔天
 * 換倉後 1350）。不排除的話，那一格的平均講的是「快到期的權利金」，
 * 與其他四格不是同一件事。
 */

import { useEffect, useMemo, useState } from 'react';
import { fetchAtm } from '../api/atm';
import {
  weekdayAverages, latestOf, recentOf, weekdayOf,
  SERIES_LABEL, WEEKDAY_LABEL,
  type AtmData, type AtmRow, type Basis, type Series,
} from '../lib/atm';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });

const SERIES: Series[] = ['wed', 'fri'];

const BASIS_OPTIONS: Array<{ id: Basis; label: string; hint: string }> = [
  { id: 'preopen', label: '開盤前', hint: '當天早上看到的數字（前一交易日收盤）' },
  { id: 'data', label: '收盤日', hint: '當天收盤本身的數字' },
];

function Chip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
        active ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

function LatestCard({ row }: { row: AtmRow | null }) {
  if (!row) return null;
  const wd = weekdayOf(row.d);
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <div className="text-[11.5px] text-muted">
        {SERIES_LABEL[row.s]}　{row.c}
      </div>
      <div className="mt-0.5 font-mono text-[19px] font-bold tabular-nums text-ink">
        {nf1.format(row.sum)}
      </div>
      <div className="mt-0.5 text-[11px] text-faint">
        {row.d}{wd === null ? '' : `（${WEEKDAY_LABEL[wd].slice(1)}）`}收盤
        {' · '}價平 {nf0.format(row.k)}
        {' · '}剩 {row.dte} 天
      </div>
      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-faint">
        C {nf1.format(row.call)} / P {nf1.format(row.put)}
        {row.thin ? ' ⚠配對少' : ''}
      </div>
    </div>
  );
}

export function AtmSection() {
  const [data, setData] = useState<AtmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [basis, setBasis] = useState<Basis>('preopen');
  const [excludeExpiry, setExcludeExpiry] = useState(true);
  const [excludeThin, setExcludeThin] = useState(false);
  const [detail, setDetail] = useState<Series>('wed');

  useEffect(() => {
    const ac = new AbortController();
    fetchAtm(ac.signal)
      .then(d => { if (!ac.signal.aborted) setData(d); })
      .catch(() => { if (!ac.signal.aborted) setData(null); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, []);

  // 篩選條件對「平均」「最新」「明細」都用同一份，三處數字才會互相對得上
  const filters = useMemo(() => ({
    wed: { series: 'wed' as Series, basis, excludeExpiry, excludeThin },
    fri: { series: 'fri' as Series, basis, excludeExpiry, excludeThin },
  }), [basis, excludeExpiry, excludeThin]);

  const stats = useMemo(() => {
    if (!data) return null;
    return {
      wed: weekdayAverages(data.rows, filters.wed),
      fri: weekdayAverages(data.rows, filters.fri),
    };
  }, [data, filters]);

  if (loading || !data || !stats) return null;   // 沒有這份資料就整區不出現

  const recent = recentOf(data.rows, filters[detail], 8);

  return (
    <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold text-ink">週選價平和</h2>
        <span className="text-[11.5px] text-faint">
          {data.meta.days} 個交易日 · 最新 {data.meta.latest}
        </span>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {SERIES.map(s => (
          <LatestCard key={s} row={latestOf(data.rows, filters[s])} />
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {BASIS_OPTIONS.map(o => (
          <Chip key={o.id} active={basis === o.id} onClick={() => setBasis(o.id)}>
            {o.label}
          </Chip>
        ))}
        <Chip active={excludeExpiry} onClick={() => setExcludeExpiry(v => !v)}>
          排除到期當日
        </Chip>
        <Chip active={excludeThin} onClick={() => setExcludeThin(v => !v)}>
          排除配對少
        </Chip>
      </div>
      <p className="mt-1 text-[11px] text-faint">
        {BASIS_OPTIONS.find(o => o.id === basis)?.hint}
      </p>

      {/* 週一到週五 × 兩個系列。手機上六欄會太窄，所以標籤列單獨一行、
          數字用等寬字，兩列對齊比較好讀 */}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-[12px]">
          <thead>
            <tr className="text-muted">
              <th className="py-1 text-left font-semibold">系列</th>
              {WEEKDAY_LABEL.map(w => (
                <th key={w} className="py-1 text-right font-semibold">{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SERIES.map(s => (
              <tr key={s} className="border-t border-line/60">
                <td className="py-1.5 text-[12px] text-ink">{SERIES_LABEL[s]}</td>
                {stats[s].map(st => (
                  <td key={st.wd} className="py-1.5 text-right">
                    <span className="block font-mono text-[13px] font-bold tabular-nums text-ink">
                      {st.avg === null ? '—' : nf0.format(st.avg)}
                    </span>
                    <span className="block font-mono text-[10.5px] tabular-nums text-faint">
                      {st.n ? `n=${st.n}` : ''}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-1.5">
        <span className="text-[12px] font-semibold text-ink">近期明細</span>
        {SERIES.map(s => (
          <Chip key={s} active={detail === s} onClick={() => setDetail(s)}>
            {SERIES_LABEL[s]}
          </Chip>
        ))}
      </div>

      <ul className="mt-1.5">
        {recent.map(r => {
          const wd = weekdayOf(r.d);
          return (
            <li key={`${r.d}-${r.s}`}
                className="grid grid-cols-[1fr_auto] items-baseline gap-2
                           border-b border-line/60 py-1 last:border-0">
              <span className="min-w-0">
                <span className="font-mono text-[12.5px] text-ink">{r.d}</span>
                <span className="ml-1 text-[11.5px] text-muted">
                  {wd === null ? '' : WEEKDAY_LABEL[wd]}
                </span>
                <span className="mt-0.5 block text-[11px] text-faint">
                  {r.c}　到期 {r.e}　剩 {r.dte} 天　價平 {nf0.format(r.k)}
                  {r.thin ? '　⚠配對少' : ''}
                </span>
              </span>
              <span className="text-right">
                <span className="block font-mono text-[13.5px] font-bold tabular-nums text-ink">
                  {nf1.format(r.sum)}
                </span>
                <span className="block font-mono text-[10.5px] tabular-nums text-faint">
                  C {nf1.format(r.call)} / P {nf1.format(r.put)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        價平履約價取 |Call−Put| 最小者，價平和為該履約價的 Call＋Put，採一般交易時段
        收盤價（無成交時用結算價）。週三系列含月選 —— 月選到期那一週沒有週選合約。
        遇連假時到期日會移位（例如中秋那週的週五合約落在星期二），所以分類看的是
        合約系列而不是到期日的星期。{data.meta.source}。
      </p>
    </section>
  );
}
