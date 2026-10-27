/* 單檔 ETF 頁（#/etf?code=0056，2026-10-27）。
 *
 * 原本一檔 ETF 的資訊散在清單彈窗（前十大、受益人數）、配息、試算好幾個地方，也沒有網址可以分享。
 * 這頁只把既有資料集中起來，不新增來源：etfs.json（報酬）、yields.json（價格、實配殖利率）、
 * dividends.json（配息紀錄）、calc/tw/<代號>.json（成長圖，lib/backtest 的 runBacktest）、
 * EtfExtras（受益人數、前十大）。算法都在各自的 lib，這裡只負責呈現。
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEtfData, useFavoritesApi } from '../context/AppContext';
import { fetchEtfDividends, fetchYields } from '../api/extras';
import { useCalcIndex } from '../hooks/useCalcIndex';
import { runBacktest, type CalcSeries } from '../lib/backtest';
import { incomeRow } from '../lib/monthlyIncome';
import type { EtfDividendData, YieldData } from '../lib/dividend';
import { FavButton } from '../components/FavButton';
import { GrowthChart, type GrowthPoint } from '../components/GrowthChart';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { EmptyState } from '../components/EmptyState';
import { HoldersBox, Top10List, top10Asof, useEtfExtras } from '../components/EtfExtras';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 3 });
const LUMP = 100_000;

function num(s: string | undefined): number | null {
  const v = Number(s);
  return s !== undefined && s !== '' && Number.isFinite(v) ? v : null;
}

function compact(v: number): string {
  return Math.abs(v) >= 1e4 ? `${nf0.format(Math.round(v / 1e4))}萬` : nf0.format(Math.round(v));
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink';
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-[16px] font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

const ret = (v: number | null) => ({
  value: v === null ? '—' : `${v > 0 ? '+' : ''}${nf2.format(v)}%`,
  tone: v === null ? undefined : v >= 0 ? 'up' as const : 'down' as const,
});

export function EtfPage() {
  const { code } = useSearch({ from: '/etf' });
  const navigate = useNavigate();
  const data = useEtfData();
  const fav = useFavoritesApi();
  const etf = data.etfs.find(e => e.code === code) ?? null;
  const section = etf ? data.sections.find(s => s.id === etf.sec)?.title : undefined;

  const extras = useEtfExtras();
  const { index } = useCalcIndex();
  const [div, setDiv] = useState<{ d: EtfDividendData | null; y: YieldData | null } | null>(null);
  const [series, setSeries] = useState<CalcSeries | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([fetchEtfDividends(ac.signal), fetchYields(ac.signal)])
      .then(([d, y]) => { if (!ac.signal.aborted) setDiv({ d, y }); })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  // 成長圖：只有進了試算索引的才有月資料（上市未滿三個月的沒有）
  useEffect(() => {
    setSeries(null);
    if (!code || !index?.codes[code]) return;
    const ac = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/calc/tw/${code}.json`, { signal: ac.signal })
      .then(r => (r.ok ? r.json() : null))
      .then((s: CalcSeries | null) => { if (!ac.signal.aborted) setSeries(s); })
      .catch(() => {});
    return () => ac.abort();
  }, [code, index]);

  const growth = useMemo(() => {
    if (!series || !index) return null;
    const r = runBacktest({
      series, months: index.months, lump: LUMP, monthly: 0, timing: 'monthStart', reinvest: true,
      feeRate: 0.1425, feeMin: 1, wholeShares: false, divTaxRate: 0, nhiSupplement: false,
    });
    if (!r.months) return null;
    const points: GrowthPoint[] = r.rows.map(x => ({ label: x.month, invested: x.invested, value: x.value + x.cash }));
    return { r, points };
  }, [series, index]);

  const options = useMemo<SelectOption[]>(
    () => data.etfs.map(e => ({ value: e.code, label: e.code, hint: e.name })), [data.etfs]);

  const picker = (
    <SearchableSelect options={options} value={code} placeholder="輸入 ETF 代號或名稱…"
                      onChange={c => void navigate({ to: '/etf', search: { code: c } })} />
  );

  if (!etf) {
    return (
      <>
        <h1 className="sr-only">ETF 個別頁</h1>
        <div className="mt-4">{picker}</div>
        <EmptyState icon="🔎" title={code ? `找不到 ${code}` : '選一檔 ETF'}
                    hint="輸入代號或名稱；也可以在任何一頁按 Ctrl＋K（手機點右上角放大鏡）搜尋。" />
      </>
    );
  }

  const events = div?.d?.dividends[etf.code] ?? [];
  const price = div?.y?.yields[etf.code]?.price ?? null;
  const income = incomeRow(etf.code, etf.name, etf.freq, events, price, 10_000);
  const asof = top10Asof(etf, extras);
  const share = async () => {
    const url = location.href;
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    try {
      if (nav.share) await nav.share({ title: `${etf.code} ${etf.name}`, url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch { /* 使用者取消分享 */ }
  };

  return (
    <>
      <h1 className="sr-only">{etf.code} {etf.name}</h1>
      <div className="mt-4">{picker}</div>

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold text-ink">
              <span className="font-mono text-accent">{etf.code}</span> {etf.name}
            </h2>
            <p className="mt-1 flex flex-wrap gap-1.5 text-[11.5px]">
              {[section, etf.freq !== '—' ? etf.freq : null, etf.act ? '主動式' : null, etf.cust !== '—' ? `保管：${etf.cust}` : null]
                .filter(Boolean).map(t => (
                  <span key={t} className="rounded-md bg-sunken px-1.5 py-0.5 text-muted">{t}</span>
                ))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <FavButton code={etf.code} active={fav.has(etf.code)} onToggle={fav.toggle} />
            <button type="button" onClick={() => void share()}
                    className="h-9 rounded-lg border border-line px-2.5 text-[12.5px] font-semibold text-muted hover:text-ink">
              {copied ? '已複製連結' : '分享'}
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat label="收盤價" value={price ? nf2.format(price) : '—'} />
          {/* 用近一年實配（和下面月領、試算頁同一個數），不用交易所「最近一次 × 次數」：0056 會差 12.2% 對 8.8% */}
          <Stat label="實配殖利率" value={income ? `${nf2.format(income.yieldPct)}%` : num(etf.yield) === null ? '—' : `${nf2.format(num(etf.yield)!)}%`} />
          <Stat label="近 3 月" {...ret(num(etf.r3))} />
          <Stat label="近 1 年" {...ret(num(etf.r12))} />
          <Stat label="近 3 年" {...ret(num(etf.r36))} />
          <Stat label="近 5 年" {...ret(num(etf.r60))} />
        </div>
        <p className="mt-1.5 text-[10.5px] text-faint">報酬是市價報酬（不含息），{data.meta.snapshot} 為止；實配殖利率＝近一年實際配息 ÷ 收盤價。</p>

        <HoldersBox code={etf.code} data={extras} />
      </section>

      {growth && (
        <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-sm font-bold text-ink">{growth.r.rows[0].month} 投入 10 萬（配息再投入）</h2>
            <span className={`font-mono text-[13px] font-bold tabular-nums ${growth.r.finalValue >= LUMP ? 'text-up' : 'text-down'}`}>
              {nf0.format(growth.r.finalValue)} 元
              {growth.r.annualizedPct !== null && <span className="ml-1.5 font-normal text-muted">年化 {nf2.format(growth.r.annualizedPct)}%</span>}
            </span>
          </div>
          <GrowthChart points={growth.points} format={compact} height={200} />
          <p className="mt-1 text-[10.5px] text-faint">
            用每月第一個交易日收盤價與實際除息金額，扣買進手續費、不扣稅與二代健保。
            想調整金額、定期定額或比較領現金，<Link to="/calc" className="text-accent">到試算頁</Link>。
          </p>
        </section>
      )}

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">配息紀錄</h2>
        {!div && <p className="py-6 text-center text-[13px] text-muted">載入中…</p>}
        {div && !events.length && <p className="py-4 text-[13px] text-muted">還沒有配息紀錄。</p>}
        {events.length > 0 && (
          <>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
              {events.slice(-8).reverse().map(([d, v]) => (
                <li key={d} className="flex justify-between gap-2 border-b border-line/60 py-1">
                  <span className="font-mono text-[12px] text-muted">{d}</span>
                  <span className="font-mono font-semibold tabular-nums text-yield">{nf3.format(v)}</span>
                </li>
              ))}
            </ul>
            {income && (
              <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-[12.5px] text-muted">
                每月想領 1 萬元：約要 <strong className="font-mono text-ink">{nf0.format(income.lots)}</strong> 張、
                本金約 <strong className="font-mono text-ink">{nf0.format(Math.round(income.capital / 1e4))}</strong> 萬
                （近一年實配殖利率 {nf2.format(income.yieldPct)}%{income.estimated ? `，只配過 ${income.paid} 次、年化推估` : ''}）。
                <Link to="/calc" className="ml-1 text-accent">月領試算 →</Link>
              </p>
            )}
          </>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-sm font-bold text-ink">前十大持股</h2>
          {asof && <span className="text-[11.5px] text-faint">{asof}</span>}
        </div>
        <Top10List etf={etf} data={extras} />
        {etf.act && (
          <Link to="/" search={{ q: '', cust: '', freq: '', sec: '', act: '', sort: '', view: 'active' }} className="mt-2 inline-block text-[12.5px] font-semibold text-accent">
            看主動式換股紀錄 →
          </Link>
        )}
      </section>
    </>
  );
}
