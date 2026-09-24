/* 持股配息試算：加入自己持有的 ETF 與張數，看每個月與整年能領多少。
 *
 * 持股清單存在 localStorage，重新整理不會不見 —— 這是使用者自己輸入的資料，
 * 每次都要重打的話等於沒做。 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchableSelect, type SelectOption } from './SearchableSelect';
import { NumberInput } from './NumberInput';
import { DividendPie } from './DividendPie';
import {
  projectHolding, buildPortfolio, MONTH_LABELS, SHARES_PER_LOT,
  seriesFromStock, activePayer,
  type HoldingProjection, type StockDividendData, type EtfDividendData, type YieldData,
} from '../lib/dividend';
import { fetchStockDividends, fetchEtfDividends, fetchYields } from '../api/extras';
import { useDataset } from '../hooks/useDataset';
import { useUsDataset } from '../hooks/useUsDataset';
import { fetchUsPrices, fetchUsdTwd } from '../api/finmind';
import { seriesFromUs, type UsPriceRow } from '../lib/usDividend';
import type { CalcIndex, CalcSeries } from '../lib/backtest';

const STORAGE_KEY = 'twetf.holdings';

/* 月曆柱狀圖每檔一個顏色。刻意避開紅綠 —— 這裡是多檔並列比較，
   紅綠在台股語境代表漲跌，用在這會被誤讀。 */
const SERIES_COLORS = [
  '#1f6feb', '#e06c00', '#7b4fd6', '#0f9b8e',
  '#c2185b', '#5d7a17', '#0277bd', '#8d6e63',
  '#00695c', '#ad1457', '#4527a0', '#827717',
];

/** 代號 -> 0..n 的穩定雜湊。同一檔 ETF 永遠落在同一個位置。 */
function hashCode(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
  return Math.abs(h) % SERIES_COLORS.length;
}

/**
 * 決定每一檔的顏色。
 *
 * 顏色由**代號**決定而不是清單位置 —— 照位置給的話，移除中間一檔會讓後面
 * 每一檔都換色，而使用者是靠顏色記住哪條是哪檔的。
 *
 * 撞色時往後找還沒用到的顏色。用排序後的順序決定誰先挑，這樣同一組持股
 * 不論加入先後都得到同一份配色。
 */
function buildColorMap(codes: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<number>();
  for (const code of [...codes].sort()) {
    let slot = hashCode(code);
    for (let k = 0; used.has(slot) && k < SERIES_COLORS.length; k++) {
      slot = (slot + 1) % SERIES_COLORS.length;
    }
    used.add(slot);
    map.set(code, SERIES_COLORS[slot]);
  }
  return map;
}

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });
/** 配息常是 0.138 這種三位數，用兩位會把交易所公告的精度丟掉。
    末尾的 0 去掉比較好讀（1.010 -> 1.01），但不能把小數點也留著（1.000 -> 1）。 */
const nf4 = (v: number) => v.toFixed(3).replace(/\.?0+$/, '') || '0';
const money = (v: number) => nf0.format(Math.round(v));

/** m='us' 是美股 ETF：代號可能跟台股撞名以外，也決定要不要走匯率換算 */
interface Entry { code: string; shares: number; m?: 'us' }

function loadHoldings(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is Entry =>
      typeof x === 'object' && x !== null
      && typeof (x as Entry).code === 'string'
      && Number.isFinite((x as Entry).shares));
  } catch {
    return [];
  }
}

function saveHoldings(v: Entry[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* 忽略 */ }
}

export function DividendPlanner({ index }: { index: CalcIndex }) {
  const [entries, setEntries] = useState<Entry[]>(loadHoldings);
  const [pick, setPick] = useState('');
  const [shares, setShares] = useState(1000);
  const [series, setSeries] = useState<Map<string, CalcSeries>>(new Map());
  const [loading, setLoading] = useState(false);
  /** 正在改股數的那一檔；null 代表沒有在編輯 */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState(0);
  // 全部上市櫃個股的配息（ETF 與幾檔金控另外走 calc/ 的試算序列）
  const [stockDivs, setStockDivs] = useState<StockDividendData | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchStockDividends(ac.signal).then(d => { if (!ac.signal.aborted) setStockDivs(d); })
      .catch(() => { /* 沒有這份就只能選 ETF，不影響其他功能 */ });
    return () => ac.abort();
  }, []);

  // 還沒進試算資料的新上市 ETF（上市未滿三個月不產生回測序列）：
  // 改用交易所公告的配息＋當日收盤價，跟個股同一條路
  const dataset = useDataset();
  const [etfDivs, setEtfDivs] = useState<EtfDividendData | null>(null);
  const [yields, setYields] = useState<YieldData | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchEtfDividends(ac.signal).then(d => { if (!ac.signal.aborted) setEtfDivs(d); }).catch(() => {});
    fetchYields(ac.signal).then(d => { if (!ac.signal.aborted) setYields(d); }).catch(() => {});
    return () => ac.abort();
  }, []);
  /** 代號 -> 名稱與公告頻率；只收試算資料裡沒有的 ETF */
  const newEtfs = useMemo(() => {
    const m = new Map<string, { name: string; freq: string }>();
    if (dataset.status !== 'ready') return m;
    for (const e of dataset.data.etfs) {
      if (!(e.code in index.codes)) m.set(e.code, { name: e.name, freq: e.freq });
    }
    return m;
  }, [dataset, index.codes]);

  // 美股 ETF：清單來自 us_etfs.json；日價與匯率由瀏覽器直接向 FinMind 抓（api/finmind.ts）
  const usDataset = useUsDataset();
  const usNames = useMemo(() => new Map(usDataset.status === 'ready'
    ? usDataset.data.etfs.map(e => [e.code, e.name] as const) : []), [usDataset]);
  const [usRows, setUsRows] = useState<Map<string, UsPriceRow[] | Error>>(new Map());
  const [fx, setFx] = useState<{ date: string; rate: number; stale: boolean } | Error | null>(null);
  const usCodes = entries.filter(e => e.m === 'us').map(e => e.code);
  const usKey = usCodes.join(',');
  useEffect(() => {
    if (!usKey) return;
    let cancelled = false;
    if (fx === null) {
      fetchUsdTwd().then(v => { if (!cancelled) setFx(v); })
        .catch((e: Error) => { if (!cancelled) setFx(e); });
    }
    for (const code of usKey.split(',')) {
      if (usRows.has(code)) continue;
      fetchUsPrices(code)
        .then(r => { if (!cancelled) setUsRows(prev => new Map(prev).set(code, r.length ? r : new Error('FinMind 查不到這一檔'))); })
        .catch((e: Error) => { if (!cancelled) setUsRows(prev => new Map(prev).set(code, e)); });
    }
    return () => { cancelled = true; };
  }, [usKey, usRows, fx]);

  useEffect(() => { saveHoldings(entries); }, [entries]);

  // 只抓還沒抓過的，換張數不會重抓
  useEffect(() => {
    const missing = entries.map(e => e.code).filter(c => !series.has(c) && c in index.codes);
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
  }, [entries, series, index.codes]);

  const rows: HoldingProjection[] = useMemo(() => {
    const out: HoldingProjection[] = [];
    for (const e of entries) {
      if (e.m === 'us') {
        const r = usRows.get(e.code);
        if (!Array.isArray(r) || !fx || fx instanceof Error) continue;
        out.push(projectHolding(seriesFromUs(e.code, usNames.get(e.code) ?? e.code, r, fx.rate, index.months),
                                index.months, e.shares));
        continue;
      }
      const stock = stockDivs?.stocks[e.code];
      const fresh = newEtfs.get(e.code);
      const s = series.get(e.code)
        ?? (stock && !(e.code in index.codes) ? seriesFromStock(e.code, stock, index.months) : undefined)
        ?? (fresh ? {
          ...seriesFromStock(e.code, {
            n: fresh.name, m: 'twse', c: yields?.yields[e.code]?.price ?? null,
            ev: etfDivs?.dividends[e.code] ?? [],
          }, index.months),
          freq: fresh.freq,                     // 公告頻率優先，跟其他 ETF 一致
        } : undefined);
      if (!s) continue;
      out.push(projectHolding(s, index.months, e.shares));
    }
    // 依一年可領金額由大到小。圖例、月曆的分段、佔比圖與各檔明細都吃這個順序，
    // 四處才會一致 —— 加入的先後對「誰貢獻最多」沒有意義。
    // 顏色是由代號決定的（buildColorMap），所以排序不會讓顏色跟著跳。
    out.sort((a, b) => b.annual - a.annual);
    return out;
  }, [entries, series, index.months, index.codes, stockDivs, newEtfs, etfDivs, yields, usRows, fx, usNames]);

  const portfolio = useMemo(() => buildPortfolio(rows), [rows]);
  const usSet = useMemo(() => new Set(usKey ? usKey.split(',') : []), [usKey]);
  /** 加了卻算不出來的美股：抓不到日價或匯率。不說的話它們會安靜地從畫面消失 */
  const usProblems = usCodes.flatMap(c => {
    const r = usRows.get(c);
    if (r instanceof Error) return [`${c}：${r.message}`];
    if (fx instanceof Error) return [`${c}：匯率抓不到（${fx.message}）`];
    return [];
  });
  const usPending = usCodes.some(c => !usRows.has(c)) || (usCodes.length > 0 && fx === null);
  const maxMonth = Math.max(1, ...portfolio.byMonth);
  const colors = useMemo(() => buildColorMap(rows.map(r => r.code)), [rows]);
  const colorOf = (code: string) => colors.get(code) ?? SERIES_COLORS[0];

  // 還沒配過息的也列（站主要求）：持股先記著，之後有除息紀錄就自動算進來。
  // 選單上標出來，免得加進去看到一排 0 以為壞了。
  // 分成 ETF 與個股兩組：金控股跟三百多檔 ETF 混在同一個清單裡會很難找。
  const options = useMemo<SelectOption[]>(() => {
    const pick = (kind: 'etf' | 'stock', group: string) => Object.keys(index.codes)
      .filter(c => index.codes[c].kind === kind)
      .filter(c => !entries.some(e => e.code === c))
      .sort()
      .map(c => ({ value: c, label: c, group,
                   hint: index.codes[c].name + ((index.codes[c].payouts ?? 0) > 0 ? '' : '・尚未配息') }));
    // 全部上市櫃個股；最近 15 個月內沒除過息的標「近期未配息」
    const cutoff = new Date(Date.now() - 456 * 86_400_000).toISOString().slice(0, 10);
    const all = stockDivs ? Object.entries(stockDivs.stocks)
      .filter(([c]) => !(c in index.codes))
      .filter(([c]) => !entries.some(e => e.code === c))
      .map(([c, s]) => ({ value: c, label: c, group: '個股',
                          hint: s.n + (activePayer(s, cutoff) ? '' : '・近期未配息') })) : [];
    const fresh = [...newEtfs].filter(([c]) => !entries.some(e => e.code === c))
      .map(([c, v]) => ({ value: c, label: c, group: 'ETF',
                          hint: v.name + ((etfDivs?.dividends[c]?.length ?? 0) > 0 ? '・新上市' : '・尚未配息') }));
    const etfs = [...pick('etf', 'ETF'), ...fresh].sort((a, b) => a.value.localeCompare(b.value));
    // 美股的 value 加前綴，跟台股代號分開（加入時再拿掉）
    const us = [...usNames].filter(([c]) => !entries.some(e => e.m === 'us' && e.code === c))
      .map(([c, n]) => ({ value: `us:${c}`, label: c, hint: n, group: '美股 ETF' }));
    return [...pick('stock', '個股'), ...all, ...etfs, ...us];
  }, [index.codes, entries, stockDivs, newEtfs, etfDivs, usNames]);

  const add = useCallback(() => {
    if (!pick || !(shares > 0)) return;
    setEntries(prev => [...prev, pick.startsWith('us:')
      ? { code: pick.slice(3), shares, m: 'us' as const } : { code: pick, shares }]);
    setPick('');
  }, [pick, shares]);

  // 不要把 w-full 寫進共用的 class：下面數字框需要 w-24，兩個寬度 utility
  // 權重相同，誰贏取決於 CSS 產生的先後，會變成不可靠的版面。寬度各自指定。
  /** 存下新的股數並收起編輯框。0 或空值不存 —— 那等於把持股變成沒有意義的 0。 */
  const save = useCallback((code: string) => {
    if (!(draft > 0)) return;
    setEntries(prev => prev.map(e => (e.code === code ? { ...e, shares: draft } : e)));
    setEditing(null);
  }, [draft]);

  const inputCls = 'h-11 rounded-lg border border-line bg-bg px-3 text-base text-ink '
    + 'focus:border-accent focus:ring-3 focus:ring-accent-soft focus:outline-none';

  return (
    <>
      <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">加入持股</h2>
        {/* 手機上搜尋框自己佔一列。三個控制項擠在同一列時，1fr 只剩一百多 px，
            打「國泰」就看不到自己打了什麼，選單也被壓在螢幕邊上。 */}
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <SearchableSelect
            options={options}
            value={pick}
            onChange={setPick}
            placeholder="輸入代號或名稱…"
            className="min-w-0"
          />
          <div className="grid grid-cols-[1fr_auto] gap-2 sm:contents">
            <NumberInput
              value={shares}
              onChange={setShares}
              step={1000}
              suffix="股"
              aria-label="股數"
              className={`${inputCls} w-full sm:w-28`}
            />
            <button
              type="button"
              onClick={add}
              disabled={!pick || !(shares > 0)}
              className="h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink
                         transition-opacity disabled:opacity-40"
            >
              加入
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-faint">
          以股為單位。一張 = 1000 股，零股直接填實際股數。
        </p>
      </section>

      {entries.length === 0 && (
        <p className="py-12 text-center text-[13px] text-muted">
          還沒有持股。加幾檔進來就會算出每個月能領多少。
        </p>
      )}

      {usProblems.length > 0 && (
        <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-muted">
          {usProblems.map(p => <p key={p}>{p}</p>)}
          {/* 失敗的會被記住（不然每次重新渲染都重打一次），所以要給一個重試的出口 */}
          <button
            type="button"
            onClick={() => {
              setUsRows(prev => new Map([...prev].filter(([, v]) => !(v instanceof Error))));
              if (fx instanceof Error) setFx(null);
            }}
            className="mt-1.5 text-[12px] font-semibold text-accent"
          >
            重試
          </button>
        </div>
      )}

      {(loading || usPending) && rows.length < entries.length && (
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
              <span className="text-[11.5px] text-faint">依一年可領金額排序</span>
            </div>

            {/* 圖例。每檔的顏色在十二個月裡固定，才看得出誰佔比大 */}
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {rows.map(r => (
                <li key={r.code} className="flex items-center gap-1.5 text-[11.5px]">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: colorOf(r.code) }} />
                  <span className="font-mono font-semibold text-ink">{r.code}</span>
                  <span className="text-muted">{r.latest > 0 ? money(r.annual) : '待配息'}</span>
                </li>
              ))}
            </ul>

            <ul className="mt-2 space-y-1">
              {MONTH_LABELS.map((label, m) => {
                const v = portfolio.byMonth[m];
                const parts = rows
                  .map(r => ({ r, amount: r.byMonth[m] * r.shares }))
                  .filter(x => x.amount > 0);
                return (
                  <li key={label} className="flex items-center gap-2">
                    <span className="w-9 shrink-0 text-right text-[12px] text-muted">{label}</span>
                    <span className="relative h-6 flex-1 overflow-hidden rounded bg-sunken">
                      {/* 外層寬度 = 這個月佔最高月份的比例；內層再按各檔金額分段。
                          兩層分開，分段比例才不會被外層的縮放扭曲 */}
                      <span className="absolute inset-y-0 left-0 flex"
                            style={{ width: `${(v / maxMonth) * 100}%` }}>
                        {parts.map(({ r, amount }) => (
                          <span
                            key={r.code}
                            title={`${label}　${r.code} ${r.name}　${money(amount)} 元`}
                            className="flex items-center justify-center overflow-hidden
                                       text-[10px] font-semibold whitespace-nowrap text-white"
                            style={{ width: `${(amount / v) * 100}%`,
                                     background: colorOf(r.code) }}
                          >
                            {amount / v > 0.22 ? r.code : ''}
                          </span>
                        ))}
                      </span>
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

          <DividendPie rows={rows} total={portfolio.annual} colorOf={colorOf} />

          <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <h2 className="text-sm font-bold text-ink">各檔明細</h2>
            <ul className="mt-2 divide-y divide-line">
              {rows.map(r => (
                <li key={r.code} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ background: colorOf(r.code) }} />
                      <span className="font-mono text-[13.5px] font-bold text-ink">{r.code}</span>
                      <span className="ml-1.5 text-[13px] text-muted">{r.name}</span>
                    </div>
                    <span className="flex shrink-0 items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(editing === r.code ? null : r.code);
                          setDraft(r.shares);
                        }}
                        className="text-[11.5px] font-semibold text-accent"
                      >
                        {editing === r.code ? '取消' : '修改'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEntries(prev => prev.filter(e => e.code !== r.code));
                          if (editing === r.code) setEditing(null);
                        }}
                        className="text-[11.5px] font-semibold text-muted hover:text-up"
                      >
                        移除
                      </button>
                    </span>
                  </div>
                  {editing === r.code && (
                    <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-sunken p-2">
                      <NumberInput
                        value={draft}
                        onChange={setDraft}
                        step={1000}
                        suffix="股"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') save(r.code); }}
                        aria-label={`${r.code} 的股數`}
                        className={`${inputCls} w-full`}
                      />
                      <button
                        type="button"
                        onClick={() => save(r.code)}
                        disabled={!(draft > 0)}
                        className="h-11 shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold
                                   text-accent-ink transition-opacity disabled:opacity-40"
                      >
                        儲存
                      </button>
                    </div>
                  )}

                  <dl className="mt-1 grid grid-cols-3 gap-x-3 gap-y-1 text-[12px] sm:grid-cols-7">
                    <Cell label="股數" value={`${nf0.format(r.shares)} 股`}
                          hint={r.shares >= 1000
                            ? `${nf2.format(r.shares / SHARES_PER_LOT)} 張` : undefined} />
                    {/* 市值＝股數 × 最新收盤價（美股已換成台幣）。沒有收盤價的顯示「—」，
                        不要顯示 0 —— 那會跟「持有 0 股」看起來一樣 */}
                    <Cell label="市值" value={r.price > 0 ? `${money(r.value)} 元` : '—'}
                          hint={r.price <= 0 ? undefined
                            // 美股的 price 已經換成台幣，提示給美元原價才不會被當成美元股價
                            : usSet.has(r.code) && fx && !(fx instanceof Error)
                              ? `股價 US$${nf2.format(r.price / fx.rate)}`
                              : `股價 ${nf2.format(r.price)}`} />
                    <Cell label="配息頻率" value={`${r.freq}`} />
                    <Cell label="最近一次" value={r.latest > 0 ? `${nf4(r.latest)} 元` : '—'}
                          hint={r.latest > 0 ? `${r.latestMonth}${r.exact ? '' : '　約略值'}` : undefined} />
                    <Cell label="預估年配息/股" value={`${nf2.format(r.perShare)} 元`} />
                    <Cell label="殖利率" value={`${nf2.format(r.yieldPct)}%`} tone />
                    <Cell label="一年可領" value={`${money(r.annual)} 元`} tone />
                  </dl>
                  {/* 上市未滿一年時，推估與近 12 個月實際本來就會差很多
                      —— 那是「還沒配滿一年」，不是「調整了配息」，不能說成同一件事 */}
                  {usSet.has(r.code) && fx && !(fx instanceof Error) && (
                    <p className="mt-1 rounded bg-sunken px-2 py-1 text-[11px] leading-snug text-muted">
                      美股，金額以 1 美元 = {fx.rate} 元（台銀即期中價，{fx.date}
                      {fx.stale ? '，今天抓不到，沿用上次' : ''}）換成台幣。
                      最近一次 US${nf4(r.latest / fx.rate)}、股價 US${nf2.format(r.price / fx.rate)}。
                      配息由還原股價反推，約略值（誤差約 1 美分），未扣美國 30% 預扣稅。
                    </p>
                  )}
                  {r.latest === 0 ? (
                    <p className="mt-1 rounded bg-sunken px-2 py-1 text-[11px] leading-snug text-muted">
                      近 12 個月沒有配息紀錄，先記在持股裡、不計入配息。
                      之後有除息資料時會自動算進來，不用重新加入。
                    </p>
                  ) : r.monthsListed < 12 ? (
                    <p className="mt-1 rounded bg-sunken px-2 py-1 text-[11px] leading-snug text-muted">
                      這檔上市才 {r.monthsListed} 個月，只配過 {r.payouts} 次
                      （實際共 {money(r.annualTtm)} 元）。上面的年配息是照公告的
                      「{r.freq}」用最近一次 {nf4(r.latest)} 元推算滿一年的結果。
                    </p>
                  ) : Math.abs(r.annual - r.annualTtm) > r.annualTtm * 0.15
                      && r.annualTtm > 0 ? (
                    <p className="mt-1 rounded bg-sunken px-2 py-1 text-[11px] leading-snug text-muted">
                      近 12 個月實際配了 {money(r.annualTtm)} 元，跟推估差不少。
                      推估用的是最近一次的 {nf4(r.latest)} 元 ——
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
              <strong className="text-ink">個股</strong>涵蓋全部上市櫃普通股：上市的配息來自證交所除權除息結果表，
              上櫃的來自櫃買每天的除息清單與 FinMind 回補的歷史。同時配股又配息的（「權息」）
              如果拆不出現金部分，會標示約略值（數字偏高）；純配股不算，因為沒有現金入帳。
            </p>
            <p>
              配息金額每次都會變，ETF 與公司也可能調整配息政策 —— 這是依現況的推估，不是保證。
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
