/* 單檔 ETF 頁（#/etf?code=0056，2026-10-27）。
 *
 * 原本一檔 ETF 的資訊散在清單彈窗（前十大、受益人數）、配息、試算好幾個地方，也沒有網址可以分享。
 * 這頁只把既有資料集中起來，不新增來源：etfs.json（含息總報酬）、yields.json（價格、年化殖利率）、
 * dividends.json（配息紀錄）、div_mix.json（配息組成）、calc/tw/<代號>.json（成長圖，lib/backtest）、
 * EtfExtras（受益人數、前十大）。算法都在各自的 lib，這裡只負責呈現。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEtfData, useFavoritesApi } from '../context/AppContext';
import { fetchDivMix, fetchEtfDividends, fetchYields } from '../api/extras';
import { fetchUsDataset } from '../api/usEtfs';
import { useCalcIndex } from '../hooks/useCalcIndex';
import { useFillSummary } from '../hooks/useFillSummary';
import { runBacktest, type CalcSeries } from '../lib/backtest';
import { incomeRow, type DivMixData } from '../lib/monthlyIncome';
import { exchangeName, formatAdv, nasdaqUrl, returnBasisNote } from '../lib/format';
import type { EtfDividendData, YieldData } from '../lib/dividend';
import type { UsEtfDataset } from '../types';
import { DivMixDetail } from '../components/DivMixDetail';
import { EtfFillSummary } from '../components/FillSummary';
import { FavButton } from '../components/FavButton';
import { GrowthChart, type GrowthPoint } from '../components/GrowthChart';
import { SearchableSelect, type SelectOption } from '../components/SearchableSelect';
import { EmptyState } from '../components/EmptyState';
import { HoldersBox, Top10List, top10Asof, useEtfExtras } from '../components/EtfExtras';

// 美股資料約 960 KB，只有網址代號不在台股清單（例如 #/etf?code=VOO）時才按需載入並快取
let usCache: UsEtfDataset | null = null;

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

function Stat({ label, value, tone, sub }: {
  label: string; value: string; tone?: 'up' | 'down'; sub?: ReactNode;
}) {
  const color = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink';
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 sm:px-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-[16px] font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10.5px] leading-tight text-faint">{sub}</div>}
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
  const fillSummary = useFillSummary();
  const [div, setDiv] = useState<{ d: EtfDividendData | null; y: YieldData | null; m: DivMixData | null } | null>(null);
  const [series, setSeries] = useState<CalcSeries | null>(null);
  const [copied, setCopied] = useState(false);

  const needUs = Boolean(code) && !etf;
  const [usState, setUsState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    needUs ? (usCache ? 'ready' : 'loading') : 'idle',
  );
  const [usData, setUsData] = useState<UsEtfDataset | null>(usCache);

  useEffect(() => {
    if (!needUs) return;
    if (usCache) {
      setUsData(usCache);
      setUsState('ready');
      return;
    }
    setUsState('loading');
    const ac = new AbortController();
    fetchUsDataset(ac.signal)
      .then(d => {
        if (ac.signal.aborted) return;
        usCache = d;
        setUsData(d);
        setUsState('ready');
      })
      .catch(() => {
        if (!ac.signal.aborted) setUsState('error');
      });
    return () => ac.abort();
  }, [needUs]);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([fetchEtfDividends(ac.signal), fetchYields(ac.signal), fetchDivMix(ac.signal)])
      .then(([d, y, m]) => { if (!ac.signal.aborted) setDiv({ d, y, m }); })
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

  const share = async (title: string) => {
    const url = location.href;
    const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> };
    try {
      if (nav.share) await nav.share({ title, url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch { /* 使用者取消分享 */ }
  };

  if (!etf) {
    if (needUs && (usState === 'idle' || usState === 'loading')) {
      return (
        <>
          <h1 className="sr-only">ETF 個別頁</h1>
          <div className="mt-4 lg:max-w-md">{picker}</div>
          <p className="py-16 text-center text-muted">查詢美股 ETF 資料中…</p>
        </>
      );
    }
    const usEtf = needUs && usData ? usData.etfs.find(e => e.code === code) ?? null : null;
    if (usEtf && usData) {
      return (
        <>
          <h1 className="sr-only">{usEtf.code} {usEtf.name}</h1>
          <div className="mt-4 lg:max-w-md">{picker}</div>

          <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[18px] font-bold text-ink">
                  <span className="font-mono text-accent">{usEtf.code}</span> {usEtf.name}
                </h2>
                <p className="mt-1 flex flex-wrap gap-1.5 text-[11.5px]">
                  <span className="rounded-md bg-sunken px-1.5 py-0.5 text-muted">美股ETF</span>
                  <span className="rounded-md bg-sunken px-1.5 py-0.5 text-muted">{exchangeName(usEtf.exch)}</span>
                  {usEtf.tr && (
                    <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">含息總報酬</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <FavButton code={usEtf.code} active={fav.has(usEtf.code)} onToggle={fav.toggle} />
                <button type="button" onClick={() => void share(`${usEtf.code} ${usEtf.name}`)}
                        className="h-9 rounded-lg border border-line px-2.5 text-[12.5px] font-semibold text-muted hover:text-ink">
                  {copied ? '已複製連結' : '分享'}
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
              <Stat label="日均成交額" value={formatAdv(usEtf.adv)} />
              <Stat label="近 3 月" {...ret(num(usEtf.r3))} />
              <Stat label="近 6 月" {...ret(num(usEtf.r6))} />
              <Stat label="近 1 年" {...ret(num(usEtf.r12))} />
              <Stat label="近 3 年" {...ret(num(usEtf.r36))} />
              <Stat label="近 5 年" {...ret(num(usEtf.r60))} />
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
              {returnBasisNote({
                market: 'us',
                tr: usEtf.tr,
                asof: usData.meta.asof,
                totalReturnAsOf: usData.meta.totalReturnAsOf,
              })}。日均成交額為近 60 個交易日平均（美元）；美股暫無配息紀錄與集保持股資料，
              <Link to="/us" className="text-accent">回美股清單</Link> 或至{' '}
              <a href={nasdaqUrl(usEtf.code)} target="_blank" rel="noopener noreferrer" className="text-accent">Nasdaq 查看詳情</a>。
            </p>
          </section>
        </>
      );
    }
    return (
      <>
        <h1 className="sr-only">ETF 個別頁</h1>
        <div className="mt-4 lg:max-w-md">{picker}</div>
        <EmptyState icon="🔎" title={code ? `找不到 ${code}` : '選一檔 ETF'}
                    hint="輸入代號或名稱；也可以在任何一頁按 Ctrl＋K（手機點右上角放大鏡）搜尋。" />
      </>
    );
  }

  const events = div?.d?.dividends[etf.code] ?? [];
  const yieldEntry = div?.y?.yields[etf.code];
  const price = yieldEntry?.price ?? null;
  const mix = div?.m?.mix[etf.code] ?? null;
  const income = incomeRow(etf.code, etf.name, etf.freq, events, price, 10_000, mix);
  const annualizedYield = typeof yieldEntry?.y === 'number' && Number.isFinite(yieldEntry.y)
    ? yieldEntry.y
    : num(etf.yield);
  const priceAsof = div?.y?.meta?.asof || data.meta.yieldAsof || '';
  const yieldStat = income
    ? {
        label: '實配殖利率',
        value: `${nf2.format(income.yieldPct)}%`,
        sub: annualizedYield !== null ? (
          <>最近一次年化 <span className="font-mono tabular-nums text-muted">{nf2.format(annualizedYield)}%</span></>
        ) : undefined,
      }
    : annualizedYield !== null
      ? {
          label: '實配殖利率',
          value: `${nf2.format(annualizedYield)}%`,
          sub: '最近一次年化（清單口徑）',
        }
      : { label: '實配殖利率', value: '—' };
  const asof = top10Asof(etf, extras);

  return (
    <>
      <h1 className="sr-only">{etf.code} {etf.name}</h1>
      <div className="mt-4 lg:max-w-md">{picker}</div>

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
            <button type="button" onClick={() => void share(`${etf.code} ${etf.name}`)}
                    className="h-9 rounded-lg border border-line px-2.5 text-[12.5px] font-semibold text-muted hover:text-ink">
              {copied ? '已複製連結' : '分享'}
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat label="收盤價" value={price ? nf2.format(price) : '—'} />
          {/* 主數字用近一年實配（同下方月領與試算頁），小字並列最近一次年化（同首頁清單）避免從清單點進來數字跳變 */}
          <Stat {...yieldStat} />
          <Stat label="近 3 月" {...ret(num(etf.r3))} />
          <Stat label="近 1 年" {...ret(num(etf.r12))} />
          <Stat label="近 3 年" {...ret(num(etf.r36))} />
          <Stat label="近 5 年" {...ret(num(etf.r60))} />
        </div>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
          {returnBasisNote({ market: 'tw', snapshot: data.meta.snapshot })}。
          實配殖利率＝近一年實際配息合計 ÷ 收盤價（上市未滿一年以已配平均推估，同下方月領試算）；
          最近一次年化＝最近一次配息 × 每年配息次數 ÷ 收盤價（同台股清單，單次增減配會立即反映）
          {priceAsof ? `，收盤價截至 ${priceAsof}` : ''}。
        </p>

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

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-stretch lg:gap-4 [&>section]:mt-0">
      <section className="mt-3 min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <h2 className="text-sm font-bold text-ink">配息紀錄</h2>
        {!div && <p className="py-6 text-center text-[13px] text-muted">載入中…</p>}
        {div && !events.length && <p className="py-4 text-[13px] text-muted">還沒有配息紀錄。</p>}
        {events.length > 0 && (
          <>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4 lg:grid-cols-2">
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
        {div && (events.length > 0 || mix !== null) && (
          <DivMixDetail
            mix={mix}
            unavailable={div.m === null}
            showNote
            className="mt-2.5"
          />
        )}
      </section>

      <section className="mt-3 min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
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
      </div>
      <EtfFillSummary code={etf.code} data={fillSummary} />
    </>
  );
}
