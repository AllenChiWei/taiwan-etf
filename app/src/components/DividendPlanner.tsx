/* 持股配息試算：加入自己持有的 ETF 與張數，看每個月與整年能領多少。
 *
 * 持股清單存在 localStorage，重新整理不會不見 —— 這是使用者自己輸入的資料，
 * 每次都要重打的話等於沒做。 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEtfData } from '../context/AppContext';
import {
  projectHolding, buildPortfolio, MONTH_LABELS,
  type HoldingProjection,
} from '../lib/dividend';
import type { CalcIndex, CalcSeries } from '../lib/backtest';

const STORAGE_KEY = 'twetf.holdings';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });
/** 配息常是 0.138 這種三位數，用兩位會把交易所給的精度丟掉 */
const nf4 = (v: number) => v.toFixed(3).replace(/0$/, '');
const money = (v: number) => nf0.format(Math.round(v));

interface Entry { code: string; lots: number }

function loadHoldings(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is Entry =>
      typeof x === 'object' && x !== null
      && typeof (x as Entry).code === 'string'
      && Number.isFinite((x as Entry).lots));
  } catch {
    return [];
  }
}

function saveHoldings(v: Entry[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* 忽略 */ }
}

export function DividendPlanner({ index }: { index: CalcIndex }) {
  const data = useEtfData();
  const [entries, setEntries] = useState<Entry[]>(loadHoldings);
  const [pick, setPick] = useState('');
  const [lots, setLots] = useState(1);
  const [series, setSeries] = useState<Map<string, CalcSeries>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => { saveHoldings(entries); }, [entries]);

  // 只抓還沒抓過的，換張數不會重抓
  useEffect(() => {
    const missing = entries.map(e => e.code).filter(c => !series.has(c));
    if (missing.length === 0) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(missing.map(code =>
      fetch(`${import.meta.env.BASE_URL}data/calc/tw/${code}.json`)
        .then(r => (r.ok ? r.json() : null))
        .then((s: CalcSeries | null) => [code, s] as const)
        .catch(() => [code, null] as const)))
      .then(pairs => {
        if (cancelled) return;
        setSeries(prev => {
          const next = new Map(prev);
          for (const [code, s] of pairs) if (s) next.set(code, s);
          return next;
        });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entries, series]);

  const rows: HoldingProjection[] = useMemo(() => {
    const out: HoldingProjection[] = [];
    for (const e of entries) {
      const s = series.get(e.code);
      if (!s) continue;
      out.push(projectHolding(s, index.months, e.lots));
    }
    return out;
  }, [entries, series, index.months]);

  const portfolio = useMemo(() => buildPortfolio(rows), [rows]);
  const maxMonth = Math.max(1, ...portfolio.byMonth);

  const names = useMemo(
    () => new Map(data.etfs.map(e => [e.code, e.name] as const)), [data.etfs]);

  // 只列出真的有配息紀錄的標的 —— 沒配過息的加進來只會是一排 0
  const options = useMemo(
    () => Object.keys(index.codes)
      .filter(c => (index.codes[c].payouts ?? 0) > 0)
      .filter(c => !entries.some(e => e.code === c))
      .sort(),
    [index.codes, entries]);

  const add = useCallback(() => {
    if (!pick || !(lots > 0)) return;
    setEntries(prev => [...prev, { code: pick, lots }]);
    setPick('');
  }, [pick, lots]);

  const inputCls = 'h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-ink '
    + 'focus:border-accent focus:ring-3 focus:ring-accent-soft focus:outline-none';

  return (
    <>
      <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">加入持股</h2>
        <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2">
          <select value={pick} onChange={e => setPick(e.target.value)} className={inputCls}>
            <option value="">選一檔…</option>
            {options.map(c => (
              <option key={c} value={c}>{c}　{names.get(c) ?? ''}</option>
            ))}
          </select>
          <span className="relative">
            <input
              type="number" inputMode="decimal" min={0} step={1}
              value={Number.isFinite(lots) ? lots : ''}
              onChange={e => setLots(Number(e.target.value) || 0)}
              className={`${inputCls} w-24 pr-8`}
              aria-label="張數"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2
                             text-[13px] text-faint">張</span>
          </span>
          <button
            type="button"
            onClick={add}
            disabled={!pick || !(lots > 0)}
            className="h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink
                       transition-opacity disabled:opacity-40"
          >
            加入
          </button>
        </div>
        <p className="mt-1 text-[11px] text-faint">
          一張 = 1000 股。零股可以填小數，例如 0.5 張 = 500 股。
        </p>
      </section>

      {entries.length === 0 && (
        <p className="py-12 text-center text-[13px] text-muted">
          還沒有持股。加幾檔進來就會算出每個月能領多少。
        </p>
      )}

      {loading && rows.length < entries.length && (
        <p className="py-6 text-center text-[13px] text-muted">載入配息資料中…</p>
      )}

      {rows.length > 0 && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="預估年配息" value={money(portfolio.annual)} tone="yield"
                  sub={`${rows.length} 檔`} />
            <Stat label="平均每月" value={money(portfolio.monthlyAverage)} />
            <Stat label="持股市值" value={money(portfolio.value)} />
            <Stat label="整體殖利率" value={`${nf2.format(portfolio.yieldPct)}%`} tone="yield" />
          </div>

          <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h2 className="text-sm font-bold text-ink">配息月曆</h2>
              <span className="text-[11.5px] text-faint">
                依各檔實際的除息月份排列
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {MONTH_LABELS.map((label, m) => {
                const v = portfolio.byMonth[m];
                const who = rows.filter(r => r.byMonth[m] > 0);
                return (
                  <li key={label} className="flex items-center gap-2">
                    <span className="w-9 shrink-0 text-right text-[12px] text-muted">{label}</span>
                    <span className="relative h-6 flex-1 overflow-hidden rounded bg-sunken">
                      <span
                        className="absolute inset-y-0 left-0 bg-yield"
                        style={{ width: `${(v / maxMonth) * 100}%`, opacity: 0.85 }}
                      />
                      {who.length > 0 && (
                        <span className="absolute inset-y-0 left-1.5 flex items-center
                                         text-[10.5px] text-ink">
                          {who.map(r => r.code).join(' ')}
                        </span>
                      )}
                    </span>
                    <span className="w-20 shrink-0 text-right font-mono text-[12.5px]
                                     font-semibold tabular-nums text-ink">
                      {v > 0 ? money(v) : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <h2 className="text-sm font-bold text-ink">各檔明細</h2>
            <ul className="mt-2 divide-y divide-line">
              {rows.map(r => (
                <li key={r.code} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-[13.5px] font-bold text-ink">{r.code}</span>
                      <span className="ml-1.5 text-[13px] text-muted">{r.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEntries(prev => prev.filter(e => e.code !== r.code))}
                      className="shrink-0 text-[11.5px] font-semibold text-muted hover:text-up"
                    >
                      移除
                    </button>
                  </div>
                  <dl className="mt-1 grid grid-cols-3 gap-x-3 gap-y-1 text-[12px] sm:grid-cols-6">
                    <Cell label="張數" value={`${nf2.format(r.lots)} 張`} />
                    <Cell label="配息頻率" value={`${r.freq}`} />
                    <Cell label="最近一次" value={`${nf4(r.latest)} 元`}
                          hint={`${r.latestMonth}${r.exact ? '' : '　約略值'}`} />
                    <Cell label="預估年配息/股" value={`${nf2.format(r.perShare)} 元`} />
                    <Cell label="殖利率" value={`${nf2.format(r.yieldPct)}%`} tone />
                    <Cell label="一年可領" value={`${money(r.annual)} 元`} tone />
                  </dl>
                  {/* 上市未滿一年時，推估與近 12 個月實際本來就會差很多
                      —— 那是「還沒配滿一年」，不是「調整了配息」，不能說成同一件事 */}
                  {r.monthsListed < 12 ? (
                    <p className="mt-1 rounded bg-sunken px-2 py-1 text-[11px] leading-snug text-muted">
                      這檔上市才 {r.monthsListed} 個月，只配過 {r.payouts} 次
                      （實際共 {money(r.annualTtm)} 元）。上面的年配息是照公告的
                      「{r.freq}」用最近一次 {nf2.format(r.latest)} 元推算滿一年的結果。
                    </p>
                  ) : Math.abs(r.annual - r.annualTtm) > r.annualTtm * 0.15
                      && r.annualTtm > 0 ? (
                    <p className="mt-1 rounded bg-sunken px-2 py-1 text-[11px] leading-snug text-muted">
                      近 12 個月實際配了 {money(r.annualTtm)} 元，跟推估差不少。
                      推估用的是最近一次的 {nf2.format(r.latest)} 元 ——
                      {r.annual > r.annualTtm ? '最近調高了配息' : '最近那次配得比平常少'}。
                    </p>
                  ) : null}

                  {r.monthsListed >= 12 && r.payouts > 0 && r.payouts !== r.perYear && (
                    <p className="mt-1 rounded bg-sunken px-2 py-1 text-[11px] leading-snug text-muted">
                      公告是{r.freq}（一年 {r.perYear} 次），但過去 12 個月實際配了
                      {r.payouts} 次。年配息按公告的次數算。
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-3 space-y-1.5 rounded-lg bg-sunken px-3 py-2.5
                          text-[12px] leading-relaxed text-muted">
            <p>
              年配息 = <strong className="text-ink">最近一次配息 × 一年配幾次</strong>。
              一年幾次以公告的配息頻率為準，除息月份則照這檔實際發生過的月份排
              —— 同樣是季配，各家的月份不一樣。
            </p>
            <p>
              配息金額優先採用
              <strong className="text-ink">交易所公告的原始數字</strong>（精確到小數第六位）。
              標示「約略值」的是從還原股價回推的 —— 除權息參考價依最小跳動單位取整，
              所以那種只準到「分」（公告 0.138 會變成 0.14）。
              櫃買中心查不到歷史除息，所以在櫃買掛牌的債券 ETF 目前多半是約略值。
            </p>
            <p>
              配息金額每次都會變，ETF 也可能調整配息政策 —— 這是依現況的推估，不是保證。
              數字是稅前的，沒有扣二代健保補充保費與所得稅。
            </p>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'yield';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-[17px] font-bold tabular-nums
                       ${tone === 'yield' ? 'text-yield' : 'text-ink'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

function Cell({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`font-mono tabular-nums ${tone ? 'font-semibold text-yield' : 'text-ink'}`}>
        {value}
      </dd>
      {hint && <dd className="text-[10.5px] text-faint">{hint}</dd>}
    </div>
  );
}
