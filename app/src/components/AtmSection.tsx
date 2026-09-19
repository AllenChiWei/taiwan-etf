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
  expectedRange, straddleOutcomes, summarise, weekdayNow,
  SERIES_LABEL, WEEKDAY_LABEL,
  type AtmData, type AtmRow, type Basis, type Series,
  type ExpectedRange, type StraddleOutcome, type OutcomeSummary,
  type WeekdayNow,
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

/** 本週預估區間：市場替這個合約定了多少波動。 */
function RangeCard({ r }: { r: ExpectedRange }) {
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] text-muted">{SERIES_LABEL[r.series]}</span>
        <span className="text-[11px] text-faint">{r.contract} · 剩 {r.dte} 天</span>
      </div>
      <div className="mt-0.5 font-mono text-[17px] font-bold tabular-nums text-ink">
        {nf0.format(r.low)} ～ {nf0.format(r.high)}
      </div>
      <div className="mt-0.5 text-[11px] text-faint">
        以 {r.day} 收盤 {nf0.format(r.index)} 為中心，
        上下 <span className="font-mono tabular-nums">{nf0.format(r.straddle)}</span> 點
        （{nf1.format(r.pct)}%）
      </div>
    </div>
  );
}

/** 一格：這個星期幾的現值，以及它跟過去中位數的落差。 */
function NowCell({ c }: { c: WeekdayNow }) {
  if (c.latest === null) {
    return <span className="block text-[13px] text-faint">—</span>;
  }
  return (
    <>
      <span className="block font-mono text-[13px] font-bold tabular-nums text-ink">
        {nf0.format(c.latest)}
      </span>
      {c.latestPct !== null && (
        <span className="block font-mono text-[10px] tabular-nums text-muted">
          {nf1.format(c.latestPct)}%
        </span>
      )}
      {c.median === null ? (
        <span className="block font-mono text-[10px] tabular-nums text-faint">
          n=0
        </span>
      ) : (
        <>
          {/* 「中」不加空白、字再小一號：390px 下五欄加起來只差幾 px，
              週五那欄就會被切掉 */}
          <span className="block whitespace-nowrap font-mono text-[9.5px] tabular-nums text-faint">
            中{nf0.format(c.median)}
          </span>
          <span className={`block font-mono text-[10.5px] font-semibold tabular-nums ${
            c.ratio! >= 1 ? 'text-up' : 'text-down'}`}>
            {c.ratio! >= 1 ? '+' : '−'}{nf0.format(Math.abs(c.ratio! - 1) * 100)}%
          </span>
        </>
      )}
    </>
  );
}

/** 事後驗收：定價 vs 實際走幅。 */
function OutcomeTable({ rows, sum }: { rows: StraddleOutcome[]; sum: OutcomeSummary }) {
  return (
    <>
      <p className="mt-1.5 text-[11.5px] text-muted">
        最近 {sum.n} 次到期：
        <strong className="text-ink">沒走出區間 {nf0.format(sum.insideRate * 100)}%</strong>
        {' · '}平均定價 {nf0.format(sum.avgStraddle)} 點、實際走
        <span className={sum.avgMoved > sum.avgStraddle ? 'text-up' : 'text-down'}>
          {' '}{nf0.format(sum.avgMoved)} 點
        </span>
        （{nf0.format(sum.avgRatio * 100)}%）
      </p>
      {/* 四欄。手機是 390px，五欄（觀察日／到期／定價／實際／結果）會把「結果」
          推出畫面外 —— 那正是最想看的一欄，所以日期合併成一格。 */}
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[300px] text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-faint">
              <th className="py-1 pr-2 font-medium">觀察 → 到期</th>
              <th className="py-1 pr-2 text-right font-medium">定價</th>
              <th className="py-1 pr-2 text-right font-medium">實際</th>
              <th className="py-1 text-right font-medium">結果</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(o => (
              <tr key={o.contract} className="border-t border-line/60">
                <td className="py-1 pr-2 font-mono text-[11.5px] tabular-nums text-muted">
                  {o.day.slice(5)} → {o.expiry.slice(5)}
                </td>
                <td className="py-1 pr-2 text-right font-mono tabular-nums text-ink">
                  {nf0.format(o.straddle)}
                </td>
                <td className={`py-1 pr-2 text-right font-mono tabular-nums ${
                  o.change >= 0 ? 'text-up' : 'text-down'}`}>
                  {o.change >= 0 ? '+' : ''}{nf0.format(o.change)}
                </td>
                <td className="py-1 whitespace-nowrap text-right text-[11.5px]">
                  {o.inside
                    ? <span className="text-muted">沒走出</span>
                    : <span className="font-semibold text-ink">走出去</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function AtmSection() {
  const [data, setData] = useState<AtmData | null>(null);
  const [loading, setLoading] = useState(true);
  const [basis, setBasis] = useState<Basis>('preopen');
  const [excludeExpiry, setExcludeExpiry] = useState(true);
  const [excludeThin, setExcludeThin] = useState(false);
  const [detail, setDetail] = useState<Series>('wed');
  // 拿來比的窗口。60 是「最近三個月的同一個星期幾」，180 是「最近九個月」——
  // 窗口越長越該看佔指數的百分比，因為指數水位會漂移。
  const [lookback, setLookback] = useState(60);

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

  // 預估區間與驗收只有在有指數收盤時才算得出來（atm.json 的 taiex）
  const taiex = data.taiex ?? {};
  const ranges = SERIES.map(s => expectedRange(data.rows, taiex, s))
    .filter((r): r is ExpectedRange => r !== null);
  const outcomes = straddleOutcomes(data.rows, taiex, detail, 8);
  const outcomeSum = summarise(outcomes);
  const nowRows = {
    wed: weekdayNow(data.rows, taiex, filters.wed, lookback),
    fri: weekdayNow(data.rows, taiex, filters.fri, lookback),
  };

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

      {ranges.length > 0 && (
        <div className="mt-3 rounded-lg border border-line bg-sunken/40 p-2.5">
          <h3 className="text-[12.5px] font-bold text-ink">預估區間</h3>
          <p className="mt-0.5 text-[11px] text-faint">
            價平和就是市場對「到到期為止會走多少」的定價：走得比它多，買方賺；
            走得比它少，賣方賺。以最新收盤指數為中心上下各一個價平和。
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {ranges.map(r => <RangeCard key={r.series} r={r} />)}
          </div>
        </div>
      )}

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

      {/* 每個星期幾一格：現在的數字、佔指數的百分比、過去同一個星期幾的中位數，
          以及兩者的落差。星期幾要分開看是因為剩餘天數差很多 —— 週一看週三合約
          剩兩天、週四看剩六天，權利金本來就差好幾倍。 */}
      <div className="mt-2 flex flex-wrap items-baseline gap-1.5">
        <span className="text-[12px] font-semibold text-ink">現在 vs 過去</span>
        {[60, 180].map(n => (
          <Chip key={n} active={lookback === n} onClick={() => setLookback(n)}>
            近 {n} 日
          </Chip>
        ))}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-faint">
        每格上面是最近一次那個星期幾的價平和（與佔指數的百分比），下面是過去同一個
        星期幾的中位數與落差。比中位數高代表市場現在替波動定了比較貴的價。
        窗口拉長時看百分比 —— 指數水位會漂移，同樣 1,000 點在四萬和四萬七不是同一件事。
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[300px] border-collapse text-[12px]">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-1 text-left font-semibold">到期</th>
              {WEEKDAY_LABEL.map(w => (
                <th key={w} className="py-1 text-right font-semibold">{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SERIES.map(s => (
              <tr key={s} className="border-t border-line/60 align-top">
                {/* 短標籤：整串「週三選擇權」會換行，把週五那欄擠出手機畫面 */}
                <td className="whitespace-nowrap py-1.5 pr-1 text-[12px] text-ink">
                  {s === 'wed' ? '週三' : '週五'}
                </td>
                {nowRows[s].map(c => (
                  <td key={c.wd} className="py-1.5 pl-0.5 text-right">
                    <NowCell c={c} />
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

      {outcomeSum && (
        <div className="mt-3 rounded-lg border border-line bg-sunken/40 p-2.5">
          <h3 className="text-[12.5px] font-bold text-ink">
            定價準不準（{SERIES_LABEL[detail]}）
          </h3>
          <p className="mt-0.5 text-[11px] text-faint">
            每個合約取<strong className="text-muted">第一次成為最近到期那天</strong>的
            價平和，跟它到期當天的指數收盤比。樣本只有十幾週，看方向就好，不要當勝率用。
          </p>
          <OutcomeTable rows={outcomes} sum={outcomeSum} />
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        價平履約價取 |Call−Put| 最小者，價平和為該履約價的 Call＋Put，採一般交易時段
        收盤價（無成交時用結算價）。週三系列含月選 —— 月選到期那一週沒有週選合約。
        遇連假時到期日會移位（例如中秋那週的週五合約落在星期二），所以分類看的是
        合約系列而不是到期日的星期。{data.meta.source}。
      </p>
    </section>
  );
}
