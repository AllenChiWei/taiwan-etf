/* 試算分頁：歷史回測 + 退休推估。
 *
 * 回測用的是 scripts/fetch_calc.py 產的月頻資料（只還原分割、不還原配息），
 * 所以「領現金 / 股息再投入 / 配息後才買」三種選擇會算出不同的結果。
 * 那份資料不加密 —— 月頻收盤價與配息金額本來就是交易所公開的資訊 ——
 * 所以這頁不需要密碼。
 *
 * 所有計算在 lib/backtest.ts，這裡只負責表單與呈現。 */

import { useEffect, useMemo, useState } from 'react';
import { useEtfData } from '../context/AppContext';
import { GrowthChart, type GrowthPoint } from '../components/GrowthChart';
import { DividendPlanner } from '../components/DividendPlanner';
import { EmptyState } from '../components/EmptyState';
import {
  runBacktest, project, monthIndex,
  type CalcIndex, type CalcSeries, type Timing,
} from '../lib/backtest';

type Tab = 'backtest' | 'retire' | 'dividend';

/** 退休推估「帶入標的」選單的一列。 */
interface Seed {
  code: string;
  name: string;
  /** 年化報酬假設；上市未滿一年時為 null，因為短期報酬年化出來只是雜訊 */
  cagr: number | null;
  /** cagr 是用哪一段期間算的，顯示給使用者看 */
  basis: string | null;
  /** 近一年報酬。只拿來顯示，不當長期假設 */
  oneYear: number | null;
  yld: number;
  /** yld 是由未滿一年的配息年化推估出來的 */
  yldEstimated: boolean;
  /** 已上市月數 */
  months: number;
}

/* ── 數字格式 ───────────────────────────────────────────── */

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

const money = (v: number) => nf0.format(Math.round(v));
const pct = (v: number | null) => (v === null ? '—' : `${nf2.format(v)}%`);

/** 圖表座標軸用：把 1234567 縮成「123.5萬」，不然軸標籤會擠成一團。 */
function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e8) return `${nf2.format(v / 1e8)}億`;
  if (a >= 1e4) return `${nf0.format(Math.round(v / 1e4))}萬`;
  return nf0.format(Math.round(v));
}

/* ── 表單元件 ───────────────────────────────────────────── */

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11.5px] font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

const inputClass =
  'mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-base text-ink ' +
  'focus:border-accent focus:ring-3 focus:ring-accent-soft focus:outline-none';

function NumberInput({ value, onChange, step = 1, min = 0, suffix }: {
  value: number; onChange: (v: number) => void;
  step?: number; min?: number; suffix?: string;
}) {
  return (
    <span className="relative block">
      <input
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        step={step}
        onChange={e => {
          const n = Number(e.target.value);
          onChange(e.target.value === '' ? 0 : Number.isFinite(n) ? n : 0);
        }}
        className={`${inputClass} ${suffix ? 'pr-10' : ''}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2
                         text-[13px] text-faint">{suffix}</span>
      )}
    </span>
  );
}

function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
      />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-ink">{label}</span>
        {hint && <span className="block text-[11.5px] leading-snug text-faint">{hint}</span>}
      </span>
    </label>
  );
}

function Stat({ label, value, tone, sub }: {
  label: string; value: string; tone?: 'up' | 'down' | 'plain'; sub?: string;
}) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink';
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-[17px] font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/* ── 回測 ───────────────────────────────────────────────── */

function BacktestTab({ index }: { index: CalcIndex }) {
  const data = useEtfData();
  const names = useMemo(
    () => new Map(data.etfs.map(e => [e.code, e.name] as const)), [data.etfs]);

  const available = useMemo(
    () => Object.keys(index.codes).sort(), [index.codes]);

  const [code, setCode] = useState(() =>
    available.includes('0050') ? '0050' : (available[0] ?? ''));
  const [series, setSeries] = useState<CalcSeries | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lump, setLump] = useState(0);
  const [monthlyAmt, setMonthlyAmt] = useState(10_000);
  const [timing, setTiming] = useState<Timing>('monthStart');
  const [reinvest, setReinvest] = useState(true);
  const [wholeShares, setWholeShares] = useState(true);
  const [feeRate, setFeeRate] = useState(0.1425);
  const [feeMin, setFeeMin] = useState(1);
  const [divTaxRate, setDivTaxRate] = useState(0);
  const [nhi, setNhi] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setSeries(null);
    setLoadError(null);
    fetch(`${import.meta.env.BASE_URL}data/calc/tw/${code}.json`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((s: CalcSeries) => { if (!cancelled) setSeries(s); })
      .catch((e: Error) => { if (!cancelled) setLoadError(e.message); });
    return () => { cancelled = true; };
  }, [code]);

  // 換標的時，把超出新標的資料範圍的起訖月份收回來，
  // 免得選了一檔 2023 才上市的 ETF 卻還留著 2019 的起始月
  const bounds = useMemo(() => {
    if (!series) return null;
    return {
      lo: index.months[series.first],
      hi: index.months[series.first + series.p.length - 1],
    };
  }, [series, index.months]);

  const result = useMemo(() => {
    if (!series) return null;
    return runBacktest({
      series, months: index.months,
      from: from || undefined, to: to || undefined,
      lump, monthly: monthlyAmt, timing, reinvest,
      feeRate, feeMin, wholeShares, divTaxRate, nhiSupplement: nhi,
    });
  }, [series, index.months, from, to, lump, monthlyAmt, timing,
      reinvest, feeRate, feeMin, wholeShares, divTaxRate, nhi]);

  const chartPoints: GrowthPoint[] = useMemo(() => {
    if (!result) return [];
    return result.rows.map(r => ({
      label: r.month, invested: r.invested, value: r.value + r.cash,
    }));
  }, [result]);

  /** 年度彙總 —— 逐月 90 列在手機上翻不完，按年看才有意義。 */
  const byYear = useMemo(() => {
    if (!result) return [];
    const out: Array<{
      year: string; contribution: number; dividend: number;
      fee: number; shares: number; value: number; invested: number;
    }> = [];
    for (const r of result.rows) {
      const year = r.month.slice(0, 4);
      let row = out[out.length - 1];
      if (!row || row.year !== year) {
        row = { year, contribution: 0, dividend: 0, fee: 0, shares: 0, value: 0, invested: 0 };
        out.push(row);
      }
      row.contribution += r.contribution;
      row.dividend += r.dividend;
      row.fee += r.fee;
      row.shares = r.shares;
      row.value = r.value + r.cash;
      row.invested = r.invested;
    }
    return out;
  }, [result]);

  const monthOptions = useMemo(() => {
    if (!bounds) return [];
    const a = monthIndex(index.months, bounds.lo);
    const b = monthIndex(index.months, bounds.hi);
    return index.months.slice(a, b + 1);
  }, [bounds, index.months]);

  const info = index.codes[code];

  return (
    <>
      {/* 標的與金額 —— 最常調整的兩件事放最上面 */}
      <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="標的"
                 hint={info ? `資料自 ${info.first}　近一年配息 ${info.payouts} 次` : undefined}>
            <select value={code}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      setCode(e.target.value); setFrom(''); setTo('');
                    }}
                    className={inputClass}>
              {available.map(c => (
                <option key={c} value={c}>{c}　{names.get(c) ?? ''}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="單筆投入" hint="在起始月一次投入">
              <NumberInput value={lump} onChange={setLump} step={10_000} suffix="元" />
            </Field>
            <Field label="每月定期定額">
              <NumberInput value={monthlyAmt} onChange={setMonthlyAmt} step={1000} suffix="元" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="起始月">
              <select value={from} onChange={e => setFrom(e.target.value)} className={inputClass}>
                <option value="">最早（{bounds?.lo ?? '—'}）</option>
                {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="結束月">
              <select value={to} onChange={e => setTo(e.target.value)} className={inputClass}>
                <option value="">最新（{bounds?.hi ?? '—'}）</option>
                {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>

          <Field label="買進時點">
            <select value={timing} onChange={e => setTiming(e.target.value as Timing)}
                    className={inputClass}>
              <option value="monthStart">每月第一個交易日扣款</option>
              <option value="afterDividend">當月除息之後才買</option>
            </select>
            <span className="mt-0.5 block text-[11px] leading-snug text-faint">
              {timing === 'afterDividend'
                ? '配息月等除息後用除息當天的價格買；那次配息只有先前持有的股數領得到。沒配息的月份仍在月初買。'
                : '券商定期定額的預設行為。月初買進的股票也領得到當月配息。'}
            </span>
          </Field>
        </div>

        <details className="mt-1 border-t border-line pt-2">
          <summary className="cursor-pointer list-none py-1.5 text-[13px] font-semibold text-accent">
            配息、手續費與稅　▾
          </summary>
          <div className="pt-1">
            <Toggle checked={reinvest} onChange={setReinvest}
                    label="股息再投入"
                    hint="配息買回同一檔；關掉則累積成現金，不會被下個月的扣款拿去買" />
            <Toggle checked={wholeShares} onChange={setWholeShares}
                    label="只買整數股"
                    hint="買不滿一股的餘額留到下個月，這是券商定期定額的實際做法" />
            <Toggle checked={nhi} onChange={setNhi}
                    label="計入二代健保補充保費"
                    hint="單次配息達 20,000 元時扣 2.11%" />
            <div className="mt-2 grid grid-cols-3 gap-2.5">
              <Field label="手續費率">
                <NumberInput value={feeRate} onChange={setFeeRate} step={0.01} suffix="%" />
              </Field>
              <Field label="最低手續費">
                <NumberInput value={feeMin} onChange={setFeeMin} step={1} suffix="元" />
              </Field>
              <Field label="配息所得稅率">
                <NumberInput value={divTaxRate} onChange={setDivTaxRate} step={1} suffix="%" />
              </Field>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
              公定手續費 0.1425%，多數券商定期定額打折並設最低 1 元。
              配息所得稅預設 0：台灣 ETF 配息裡屬於收益平準金與資本利得的部分不課所得稅，
              實際比例每次都不同，要精算的話請填自己的有效稅率。此處不計算賣出時的證交稅。
            </p>
          </div>
        </details>
      </section>

      {loadError && (
        <EmptyState icon="⚠️" title="這檔的回測資料載入失敗" hint={loadError} />
      )}
      {!series && !loadError && <p className="py-12 text-center text-muted">載入中…</p>}

      {result && series && (
        <>
          {result.months === 0 ? (
            <EmptyState icon="📭" title="這段期間沒有可用的資料"
                        hint="調整起始月或結束月再試一次。" />
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Stat label="總投入" value={money(result.totalInvested)}
                      sub={`${result.months} 個月`} />
                <Stat label="期末總值" value={money(result.finalValue)}
                      tone={result.finalValue >= result.totalInvested ? 'up' : 'down'}
                      sub={`截至 ${result.lastDate}`} />
                <Stat label="總報酬率" value={pct(result.totalReturnPct)}
                      tone={result.totalReturnPct >= 0 ? 'up' : 'down'} />
                <Stat label="年化報酬率" value={pct(result.annualizedPct)}
                      tone={(result.annualizedPct ?? 0) >= 0 ? 'up' : 'down'}
                      sub="內部報酬率" />
              </div>

              <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
                <h2 className="text-sm font-bold text-ink">資產成長</h2>
                <GrowthChart points={chartPoints} format={compact} />
              </section>

              <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
                <h2 className="text-sm font-bold text-ink">明細</h2>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                  <div>
                    <dt className="text-muted">持有股數</dt>
                    <dd className="font-mono font-semibold tabular-nums">
                      {nf2.format(result.finalShares)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">持股市值</dt>
                    <dd className="font-mono font-semibold tabular-nums">{money(result.marketValue)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">累計配息（稅後）</dt>
                    <dd className="font-mono font-semibold tabular-nums text-yield">
                      {money(result.totalDividend)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">
                      {reinvest ? '未投入的零頭' : '領到的現金 + 零頭'}
                    </dt>
                    <dd className="font-mono font-semibold tabular-nums">{money(result.cash)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">累計手續費</dt>
                    <dd className="font-mono tabular-nums text-down">−{money(result.totalFee)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">配息稅費</dt>
                    <dd className="font-mono tabular-nums text-down">−{money(result.totalTax)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">最新股價</dt>
                    <dd className="font-mono tabular-nums">{nf2.format(result.lastPrice)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">配息佔總報酬</dt>
                    <dd className="font-mono tabular-nums">
                      {result.finalValue > result.totalInvested
                        ? `${nf0.format(result.totalDividend / (result.finalValue - result.totalInvested) * 100)}%`
                        : '—'}
                    </dd>
                  </div>
                </dl>

                {series.splits.length > 0 && (
                  <p className="mt-2.5 rounded-lg bg-sunken px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
                    這檔在{series.splits.map(s => `${s.date} 做過 1 拆 ${nf2.format(s.ratio)}`).join('、')}。
                    上面的股價與股數都已換算成分割後的單位，跟你今天在券商看到的一致。
                  </p>
                )}
              </section>

              <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
                <button type="button" onClick={() => setShowTable(v => !v)}
                        aria-expanded={showTable}
                        className="-my-1 flex min-h-11 w-full items-center justify-between
                                   text-sm font-bold text-ink">
                  <span>逐年明細</span>
                  <span className="text-accent">{showTable ? '收起 ▴' : '展開 ▾'}</span>
                </button>
                {showTable && (
                  <div className="mt-2 -mx-1 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-[12.5px]">
                      <thead>
                        <tr className="border-b border-line text-left text-muted">
                          <th className="py-1.5 pr-2 font-semibold">年</th>
                          <th className="py-1.5 pr-2 text-right font-semibold">當年投入</th>
                          <th className="py-1.5 pr-2 text-right font-semibold">當年配息</th>
                          <th className="py-1.5 pr-2 text-right font-semibold">年末股數</th>
                          <th className="py-1.5 text-right font-semibold">年末總值</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono tabular-nums">
                        {byYear.map(r => (
                          <tr key={r.year} className="border-b border-line/60">
                            <td className="py-1.5 pr-2 font-sans">{r.year}</td>
                            <td className="py-1.5 pr-2 text-right">{money(r.contribution)}</td>
                            <td className="py-1.5 pr-2 text-right text-yield">{money(r.dividend)}</td>
                            <td className="py-1.5 pr-2 text-right">{nf0.format(r.shares)}</td>
                            <td className={`py-1.5 text-right font-semibold ${
                              r.value >= r.invested ? 'text-up' : 'text-down'}`}>
                              {money(r.value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}

/* ── 退休推估 ───────────────────────────────────────────── */

function RetireTab({ index }: { index: CalcIndex }) {
  const data = useEtfData();

  const [initial, setInitial] = useState(500_000);
  const [monthlyAmt, setMonthlyAmt] = useState(20_000);
  const [growth, setGrowth] = useState(0);
  const [years, setYears] = useState(20);
  const [returnPct, setReturnPct] = useState(8);
  const [inflation, setInflation] = useState(2);
  const [withdraw, setWithdraw] = useState(4);
  const [yieldPct, setYieldPct] = useState(5);
  const [reinvest, setReinvest] = useState(true);

  /**
   * 從實際標的帶入假設 —— 自己憑空填一個年化報酬率，很容易填得太樂觀。
   *
   * 用「最長的可用期間」而不是一律要求近五年。原本只收 r60，結果 345 檔裡
   * 只有 198 檔進得了選單，2024 年後上市的主動型 ETF 全部消失（00406A、00981A
   * 就是這樣不見的）。
   *
   * 但**不把不滿一年的報酬年化**：00406A 只有近三月 −4.48%，年化出來會是
   * −16%，那是雜訊不是趨勢。這種標的照樣列出來、可以帶入殖利率，
   * 只是不動年化報酬那一格，由使用者自己填。
   */
  const seeds = useMemo(() => {
    const out: Seed[] = [];
    const lastMonth = index.months.length - 1;

    for (const e of data.etfs) {
      const info = index.codes[e.code];
      if (!info) continue;

      // 由長到短取第一個有值的期間。**只收多年期** —— 單一年度的報酬不是
      // 長期年化：00981A 近一年 +120.98%，拿它推 20 年會得到天文數字。
      // 近一年仍然顯示在選項上供參考，只是不會自動填進假設。
      let cagr: number | null = null;
      let basis: string | null = null;
      for (const [key, years] of [['r60', 5], ['r36', 3]] as const) {
        const v = Number(e[key]);
        if (!Number.isFinite(v)) continue;
        cagr = (Math.pow(1 + v / 100, 1 / years) - 1) * 100;
        basis = `近${years}年`;
        break;
      }
      const r12 = Number(e.r12);
      const oneYear = Number.isFinite(r12) ? r12 : null;

      // 上市未滿一年的，TTM 配息只涵蓋幾個月，直接當殖利率會低估。
      // 按實際上市月數年化，並標示成推估。
      const listed = lastMonth - index.months.indexOf(info.first) + 1;
      const short = listed < 12;
      const yld = short && listed > 0
        ? (info.ttmYield ?? 0) * 12 / listed
        : (info.ttmYield ?? 0);

      out.push({
        code: e.code, name: e.name, cagr, basis, oneYear,
        yld, yldEstimated: short, months: listed,
      });
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  }, [data.etfs, index.codes, index.months]);

  const [seedNote, setSeedNote] = useState<string | null>(null);

  const result = useMemo(() => project({
    initial, monthly: monthlyAmt, monthlyGrowthPct: growth, years,
    returnPct, inflationPct: inflation, withdrawPct: withdraw, yieldPct, reinvest,
  }), [initial, monthlyAmt, growth, years, returnPct, inflation, withdraw,
       yieldPct, reinvest]);

  const points: GrowthPoint[] = useMemo(
    () => result.rows.map(r => ({
      // 領現金時，曲線要含已領出的配息，否則看起來像憑空虧損
      label: `${r.year}年`, invested: r.invested, value: r.value + r.cash,
    })), [result.rows]);

  return (
    <>
      <section className="mt-4 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <Field label="用實際標的的歷史數字帶入假設"
               hint="取該檔最長可用期間的年化報酬與目前殖利率。近幾年是一段大多頭，
                     直接拿來推估未來會過度樂觀 —— 帶進來是給一個起點，不是預測。">
          <select
            className={inputClass}
            value=""
            onChange={e => {
              const s = seeds.find(x => x.code === e.target.value);
              if (!s) return;
              setYieldPct(Number(s.yld.toFixed(2)));
              if (s.cagr !== null) {
                setReturnPct(Number(s.cagr.toFixed(2)));
                setSeedNote(
                  `已帶入 ${s.code} ${s.name}：年化 ${nf2.format(s.cagr)}%（${s.basis}）、`
                  + `殖利率 ${nf2.format(s.yld)}%${s.yldEstimated ? '（年化推估）' : ''}`);
              } else {
                // 只帶殖利率。年化留空是刻意的 —— 用一年（甚至幾個月）的報酬
                // 去推 20 年，得到的數字看起來很精確但毫無意義。
                setSeedNote(
                  s.oneYear !== null
                    ? `${s.code} ${s.name} 只有近一年的報酬（${nf2.format(s.oneYear)}%），`
                      + '單一年度不能當長期年化，所以沒有填進去 —— 20 年的假設請自己給一個。'
                      + `殖利率 ${nf2.format(s.yld)}% 已帶入。`
                    : `${s.code} ${s.name} 上市才 ${s.months} 個月，沒有滿一年的報酬可以參考，`
                      + `所以只帶入殖利率 ${nf2.format(s.yld)}%（由 ${s.months} 個月的配息年化推估）。`
                      + '年化報酬那一格請自己填一個假設。');
              }
            }}
          >
            <option value="">選一檔帶入…（共 {seeds.length} 檔）</option>
            {seeds.map(s => (
              <option key={s.code} value={s.code}>
                {s.code}　{s.name}　
                {s.cagr !== null
                  ? `${s.basis}年化 ${nf2.format(s.cagr)}%`
                  : s.oneYear !== null
                    ? `近1年 ${nf2.format(s.oneYear)}%（僅供參考）`
                    : `上市 ${s.months} 個月`}
                　殖利率 {nf2.format(s.yld)}%{s.yldEstimated ? '*' : ''}
              </option>
            ))}
          </select>
        </Field>

        {seedNote && (
          <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-[12px] leading-relaxed text-muted">
            {seedNote}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="目前資產">
            <NumberInput value={initial} onChange={setInitial} step={100_000} suffix="元" />
          </Field>
          <Field label="每月投入">
            <NumberInput value={monthlyAmt} onChange={setMonthlyAmt} step={1000} suffix="元" />
          </Field>
          <Field label="投入年數">
            <NumberInput value={years} onChange={setYears} step={1} suffix="年" />
          </Field>
          <Field label="每年調升投入" hint="隨加薪逐年增加">
            <NumberInput value={growth} onChange={setGrowth} step={1} suffix="%" />
          </Field>
          <Field label="假設年化報酬">
            <NumberInput value={returnPct} onChange={setReturnPct} step={0.5} suffix="%" />
          </Field>
          <Field label="通膨率" hint="用來換算購買力">
            <NumberInput value={inflation} onChange={setInflation} step={0.5} suffix="%" />
          </Field>
          <Field label="退休提領率" hint="4% 法則">
            <NumberInput value={withdraw} onChange={setWithdraw} step={0.5} suffix="%" />
          </Field>
          <Field label="殖利率" hint={reinvest ? '只花配息時用' : '每年以現金領出的比例'}>
            <NumberInput value={yieldPct} onChange={setYieldPct} step={0.5} suffix="%" />
          </Field>
        </div>

        <div className="mt-2 border-t border-line pt-1">
          <Toggle
            checked={reinvest}
            onChange={setReinvest}
            label="股息再投入"
            hint={reinvest
              ? '上面的年化報酬是「含息總報酬」，本來就假設配息全部買回 —— 這是預設行為'
              : `組合只以 ${nf2.format(Math.max(0, returnPct - yieldPct))}% 成長`
                + `（總報酬 ${nf2.format(returnPct)}% 減掉殖利率 ${nf2.format(yieldPct)}%），`
                + '配息每月領成現金，不再產生複利'}
          />
        </div>
      </section>

      {returnPct > 12 && (
        <p className="mt-3 rounded-lg border border-line bg-sunken px-3 py-2.5
                      text-[12px] leading-relaxed text-muted">
          <strong className="text-up">年化 {nf2.format(returnPct)}% 撐 {years} 年是很樂觀的假設。</strong>
          台股近五年剛好走過一段大多頭，把那段的年化直接延伸到未來，會得到看起來很美但
          幾乎不會發生的數字。長期的股市年化報酬通常落在 6～10%，
          填 8% 會比填歷史高點務實得多。
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label={`${years} 年後資產`} value={money(result.total)} tone="up"
              sub={reinvest
                ? `投入 ${money(result.totalInvested)}`
                : `其中配息現金 ${money(result.dividendCash)}`} />
        <Stat label="換算今天購買力" value={money(result.totalReal)}
              sub={`通膨 ${inflation}%`} />
        <Stat label={`每月可提領（${withdraw}%）`} value={money(result.monthlyWithdraw)}
              sub={`今天購買力 ${money(result.monthlyWithdrawReal)}`} />
        <Stat label="只花配息每月可領" value={money(result.monthlyDividend)}
              tone="plain"
              sub={`今天購買力 ${money(result.monthlyDividendReal)}`} />
      </div>

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">資產累積</h2>
        <GrowthChart points={points} format={compact} />
      </section>

      <p className="mt-3 rounded-lg bg-sunken px-3 py-2.5 text-[12px] leading-relaxed text-muted">
        這一頁是<strong className="text-ink">推估</strong>，不是回測：假設每個月固定報酬、
        沒有下跌年份。真實市場會有連續幾年不漲的時候，同樣的平均年化報酬會因為
        順序不同而得到不同的結果 —— 特別是退休後才遇到大跌（報酬順序風險）。
        想看真實走勢請用「歷史回測」。
      </p>
    </>
  );
}

/* ── 分頁外框 ───────────────────────────────────────────── */

export function CalculatorPage() {
  const [tab, setTab] = useState<Tab>('backtest');
  const [index, setIndex] = useState<CalcIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/calc/index.json`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CalcIndex) => { if (!cancelled) setIndex(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'backtest', label: '歷史回測' },
    { id: 'retire', label: '退休推估' },
    { id: 'dividend', label: '配息試算' },
  ];

  return (
    <>
      <h1 className="sr-only">投資試算</h1>

      <div className="mt-4 flex gap-1.5 rounded-lg bg-sunken p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`h-9 flex-1 rounded-md text-[13px] font-semibold transition-colors ${
              tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <EmptyState
          icon="📉"
          title="這個部署版本沒有包含試算資料"
          hint="回測資料是部署時產生的，需要 GitHub Actions 有 FINLAB_API_TOKEN。"
        />
      )}
      {!index && !error && <p className="py-16 text-center text-muted">載入試算資料中…</p>}

      {index && tab === 'backtest' && <BacktestTab index={index} />}
      {index && tab === 'retire' && <RetireTab index={index} />}
      {index && tab === 'dividend' && <DividendPlanner index={index} />}

      {index && (
        <p className="mt-4 mb-2 text-[11.5px] leading-relaxed text-faint">
          回測用每月第一個交易日與除息日的實際收盤價，配息為實際除息金額，
          股價已還原分割。結果不含賣出時的證交稅與可能的匯費，也假設每一筆都成交得到。
          歷史績效不代表未來報酬。
        </p>
      )}
    </>
  );
}
