/* 持股穿透健檢（/dividend?view=xray）：
 * 讀取使用者在配息試算輸入的持股（localStorage 的 twetf.holdings），按市值權重展開 ETF 成分股
 * 並加總成單一個股真實曝險排行；同頁匯總低融資維持率、可轉債轉換賣壓、未來 14 天除息／法說／股東會
 * 與近期重大訊息。所有部署時產生的 JSON 均容許缺檔，缺哪一項就優雅降級不影響其他區塊。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useEtfData } from '../context/AppContext';
import { useEtfExtras } from './EtfExtras';
import { StockSheet } from './StockSheet';
import { EmptyState } from './EmptyState';
import { Fold } from './Fold';
import { fetchCalendar, fetchCb, fetchStockDividends, fetchUsStocks, fetchYields } from '../api/extras';
import { fetchMarginState, type MarginState } from '../api/market';
import { fetchNews } from '../api/news';
import { fetchUsDataset } from '../api/usEtfs';
import { fetchUsPrices, fetchUsdTwd } from '../api/finmind';
import { holdingLinkKind } from '../lib/active';
import { dayLabel, KIND_LABEL, type CalendarData, type EventKind } from '../lib/calendar';
import { yi, type CbData } from '../lib/cb';
import type { StockDividendData, YieldData } from '../lib/dividend';
import { dayLabel as newsDayLabel, timeOfDay, type NewsData } from '../lib/news';
import type { UsPriceRow } from '../lib/usDividend';
import { usStockNameMap, type UsStocksDataset } from '../lib/usStocks';
import type { UsEtfDataset } from '../types';
import {
  buildPortfolioXray,
  checkPortfolioCb,
  checkPortfolioEvents,
  checkPortfolioFilings,
  checkPortfolioMargin,
  matchesHealthFilter,
  MINOR_EXPOSURE_PCT,
  parseStoredHoldings,
  type ExposureRow,
  type HealthFilterMode,
} from '../lib/portfolioXray';

const STORAGE_KEY = 'twetf.holdings';

// 非漲跌警示用琥珀／黃（同 MarketPage／PremarketCard），避免與台股紅漲綠跌混淆
const AMBER = '#d97706';
const WATCH = '#ca8a04';
// 海外個股曝險進度條採用既有類別 token（非紅非綠，深淺主題皆相容）
const FOREIGN_BAR = 'var(--cat-8)';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const money = (v: number) => nf0.format(Math.round(v));

function readHoldings() {
  try {
    return parseStoredHoldings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function taipeiToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

function whenLabel(days: number): string {
  if (days <= 0) return '今天';
  if (days === 1) return '明天';
  return `${days} 天後`;
}

const EVENT_BADGE: Partial<Record<EventKind, string>> = {
  exdiv: 'bg-accent-soft text-accent',
  call: 'bg-sunken text-ink',
  meeting: 'bg-sunken text-ink',
};

function StatCard({ label, value, sub, accent, className }: {
  label: string; value: string; sub?: string; accent?: 'yield' | 'amber'; className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5 ${className ?? ''}`}>
      <div className="truncate text-[11.5px] text-muted">{label}</div>
      <div
        className={`mt-0.5 truncate font-mono text-[16px] font-bold tabular-nums sm:text-[17px] ${
          accent === 'yield' ? 'text-yield' : 'text-ink'}`}
        style={accent === 'amber' ? { color: AMBER } : undefined}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 break-words text-[11px] leading-snug text-faint">{sub}</div>}
    </div>
  );
}

function RelationTag({ isDirect, exposurePct, viaEtfs }: {
  isDirect: boolean; exposurePct: number; viaEtfs: string[];
}) {
  if (isDirect) {
    return (
      <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">
        直接持有{exposurePct > 0 ? `・合計 ${nf1.format(exposurePct)}%` : ''}
      </span>
    );
  }
  const via = viaEtfs.length > 0 ? `（${viaEtfs.slice(0, 2).join('、')}${viaEtfs.length > 2 ? '等' : ''}）` : '';
  return (
    <span className="rounded bg-sunken px-1.5 py-0.5 text-[10.5px] text-muted">
      穿透 {nf1.format(exposurePct)}%{via}
    </span>
  );
}

function TargetLink({ code, name, kind, onPickStock }: {
  code: string;
  name?: string;
  kind: 'etf' | 'stock';
  onPickStock: (code: string, name?: string) => void;
}) {
  if (kind === 'etf') {
    return (
      <Link to="/etf" search={{ code }} className="font-mono font-bold text-accent hover:underline">
        {code}
      </Link>
    );
  }
  if (holdingLinkKind(code) === 'stock') {
    return (
      <button
        type="button"
        onClick={() => onPickStock(code, name)}
        className="font-mono font-bold text-accent hover:underline"
      >
        {code}
      </button>
    );
  }
  return <span className="font-mono font-bold text-ink">{code}</span>;
}

export function PortfolioXray({ onGoPlan }: { onGoPlan: () => void }) {
  const etfData = useEtfData();
  const extras = useEtfExtras();
  const top10 = extras?.[0] ?? null;
  const active = extras?.[1] ?? null;

  const [holdings, setHoldings] = useState(readHoldings);
  const [yields, setYields] = useState<YieldData | null | undefined>(undefined);
  const [stockDivs, setStockDivs] = useState<StockDividendData | null | undefined>(undefined);
  const [marginState, setMarginState] = useState<MarginState | null | undefined>(undefined);
  const [cbData, setCbData] = useState<CbData | null | undefined>(undefined);
  const [calendar, setCalendar] = useState<CalendarData | null | undefined>(undefined);
  const [news, setNews] = useState<NewsData | null | undefined>(undefined);

  // 美股（只有持股含 m === 'us' 才去載入對應清單與 FinMind 報價）
  const usCodes = useMemo(
    () => [...new Set(holdings.filter(h => h.m === 'us').map(h => h.code))],
    [holdings],
  );
  const hasUsEtfs = useMemo(() => holdings.some(h => h.m === 'us' && h.k !== 'stock'), [holdings]);
  const hasUsStocks = useMemo(() => holdings.some(h => h.m === 'us' && h.k === 'stock'), [holdings]);
  const usKey = usCodes.join(',');
  const [usDataset, setUsDataset] = useState<UsEtfDataset | null>(null);
  const [usStocks, setUsStocks] = useState<UsStocksDataset | null>(null);
  const [usRows, setUsRows] = useState<Map<string, UsPriceRow[]>>(new Map());
  const [fx, setFx] = useState<{ date: string; rate: number; stale: boolean } | null>(null);

  // 介面互動狀態
  const [marketFilter, setMarketFilter] = useState<'all' | 'tw' | 'foreign'>('all');
  const [query, setQuery] = useState('');
  const [showAllExp, setShowAllExp] = useState(false);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [healthMode, setHealthMode] = useState<HealthFilterMode>('major');
  const [marginThr, setMarginThr] = useState<150 | 160 | 999>(150);
  const [showAllCb, setShowAllCb] = useState(false);
  const [showAllFilings, setShowAllFilings] = useState(false);
  const [sheet, setSheet] = useState<{ code: string; name?: string } | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const pickStock = useCallback((code: string, name?: string) => setSheet({ code, name }), []);

  // 跨分頁修改持股時同步重新讀取
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setHoldings(readHoldings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const hasHoldings = holdings.length > 0;

  // 載入報價與四份健檢資料（皆容許缺檔）
  useEffect(() => {
    if (!hasHoldings) return;
    const ac = new AbortController();
    fetchYields(ac.signal)
      .then(d => { if (!ac.signal.aborted) setYields(d); })
      .catch(() => { if (!ac.signal.aborted) setYields(null); });
    fetchStockDividends(ac.signal)
      .then(d => { if (!ac.signal.aborted) setStockDivs(d); })
      .catch(() => { if (!ac.signal.aborted) setStockDivs(null); });
    fetchMarginState()
      .then(d => { if (!ac.signal.aborted) setMarginState(d); })
      .catch(() => { if (!ac.signal.aborted) setMarginState(null); });
    fetchCb(ac.signal)
      .then(d => { if (!ac.signal.aborted) setCbData(d); })
      .catch(() => { if (!ac.signal.aborted) setCbData(null); });
    fetchCalendar(ac.signal)
      .then(d => { if (!ac.signal.aborted) setCalendar(d); })
      .catch(() => { if (!ac.signal.aborted) setCalendar(null); });
    fetchNews(ac.signal)
      .then(d => { if (!ac.signal.aborted) setNews(d); })
      .catch(() => { if (!ac.signal.aborted) setNews(null); });
    return () => ac.abort();
  }, [hasHoldings]);

  useEffect(() => {
    if (!usKey) return;
    const ac = new AbortController();
    if (hasUsEtfs) {
      fetchUsDataset(ac.signal)
        .then(d => { if (!ac.signal.aborted) setUsDataset(d); })
        .catch(() => {});
    }
    if (hasUsStocks) {
      fetchUsStocks()
        .then(d => { if (!ac.signal.aborted && d) setUsStocks(d); })
        .catch(() => {});
    }
    fetchUsdTwd()
      .then(v => { if (!ac.signal.aborted) setFx(v); })
      .catch(() => {});
    for (const code of usKey.split(',')) {
      fetchUsPrices(code)
        .then(r => {
          if (!ac.signal.aborted && r.length > 0) {
            setUsRows(prev => new Map(prev).set(code, r));
          }
        })
        .catch(() => {});
    }
    return () => ac.abort();
  }, [usKey, hasUsEtfs, hasUsStocks]);

  const usNames = useMemo(
    () => new Map(usDataset ? usDataset.etfs.map(e => [e.code, e.name] as const) : []),
    [usDataset],
  );
  const usStockNames = useMemo(() => usStockNameMap(usStocks), [usStocks]);
  const usPricesTwd = useMemo(() => {
    const m = new Map<string, number>();
    if (!fx) return m;
    for (const [code, rows] of usRows) {
      const last = rows[rows.length - 1];
      if (last && last.Close > 0) m.set(code, last.Close * fx.rate);
    }
    return m;
  }, [usRows, fx]);

  const today = taipeiToday();

  const xray = useMemo(
    () => buildPortfolioXray({
      holdings,
      etfs: etfData.etfs,
      top10,
      active,
      yields: yields ?? null,
      stockDivs: stockDivs ?? null,
      usPricesTwd,
      usNames,
      usStockNames,
    }),
    [holdings, etfData.etfs, top10, active, yields, stockDivs, usPricesTwd, usNames, usStockNames],
  );

  const marginCheck = useMemo(
    () => checkPortfolioMargin(xray, marginState ?? null, marginThr === 999 ? Infinity : marginThr),
    [xray, marginState, marginThr],
  );
  const cbCheck = useMemo(() => checkPortfolioCb(xray, cbData ?? null), [xray, cbData]);
  const eventRows = useMemo(() => checkPortfolioEvents(xray, calendar ?? null, today, 14), [xray, calendar, today]);
  const filingRows = useMemo(() => checkPortfolioFilings(xray, news ?? null), [xray, news]);

  // 套用「主要部位／只看直接持有／全部穿透標的」篩選
  const filteredMarginAll = useMemo(
    () => marginCheck.all.filter(r => matchesHealthFilter(r, healthMode)),
    [marginCheck.all, healthMode],
  );
  const filteredMarginFlagged = useMemo(
    () => marginCheck.flagged.filter(r => matchesHealthFilter(r, healthMode)),
    [marginCheck.flagged, healthMode],
  );
  const filteredCbAll = useMemo(
    () => cbCheck.all.filter(r => matchesHealthFilter(r, healthMode)),
    [cbCheck.all, healthMode],
  );
  const filteredCbPressured = useMemo(
    () => cbCheck.pressured.filter(r => matchesHealthFilter(r, healthMode)),
    [cbCheck.pressured, healthMode],
  );
  const filteredEvents = useMemo(
    () => eventRows.filter(r => matchesHealthFilter(r, healthMode)),
    [eventRows, healthMode],
  );
  const filteredFilings = useMemo(
    () => filingRows.filter(r => matchesHealthFilter(r, healthMode)),
    [filingRows, healthMode],
  );

  const { twCount, foreignCount } = useMemo(() => {
    let tw = 0;
    let foreign = 0;
    for (const e of xray.exposures) {
      if (e.market === 'foreign') foreign += 1;
      else tw += 1;
    }
    return { twCount: tw, foreignCount: foreign };
  }, [xray.exposures]);

  const filteredExposures = useMemo<ExposureRow[]>(() => {
    const byMarket = marketFilter === 'all'
      ? xray.exposures
      : xray.exposures.filter(e => e.market === marketFilter);
    const q = query.trim().toLowerCase();
    if (!q) return byMarket;
    return byMarket.filter(e =>
      e.code.toLowerCase().includes(q)
      || e.displayCode.toLowerCase().includes(q)
      || e.name.toLowerCase().includes(q)
      || e.marketLabel.toLowerCase().includes(q)
      || e.sources.some(s => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)));
  }, [xray.exposures, marketFilter, query]);

  if (holdings.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-line bg-surface px-4 pb-8">
        <EmptyState
          icon="🔎"
          title="還沒有輸入持股"
          hint="持股健檢會讀取你在「配息試算」輸入（或載入私人持股）的 ETF 與個股，展開真實個股曝險並檢查維持率、可轉債、行事曆與重大訊息。"
        />
        <div className="-mt-6 text-center">
          <button
            type="button"
            onClick={onGoPlan}
            className="h-10 rounded-lg bg-accent px-5 text-[13.5px] font-semibold text-accent-ink hover:opacity-90"
          >
            前往配息試算加入持股
          </button>
        </div>
      </div>
    );
  }

  const baseLoading = !extras || yields === undefined || stockDivs === undefined;
  const maxPct = Math.max(1, filteredExposures[0]?.pct ?? xray.exposures[0]?.pct ?? 1);
  const visibleExposures = showAllExp || query.trim() ? filteredExposures : filteredExposures.slice(0, 20);
  const top1 = xray.exposures[0] ?? null;

  const majorAlertTotal =
    marginCheck.all.filter(r => r.maint < 150 && matchesHealthFilter(r, 'major')).length
    + cbCheck.pressured.filter(r => matchesHealthFilter(r, 'major')).length
    + eventRows.filter(r => matchesHealthFilter(r, 'major')).length
    + filingRows.filter(r => matchesHealthFilter(r, 'major')).length;

  const healthLoadedCount =
    (marginCheck.available ? 1 : 0)
    + (cbCheck.available ? 1 : 0)
    + (calendar ? 1 : 0)
    + (news ? 1 : 0);
  const healthPending =
    marginState === undefined || cbData === undefined || calendar === undefined || news === undefined;
  const healthUnavailable = !healthPending && healthLoadedCount === 0;
  const healthSub = healthUnavailable
    ? '四項健檢資料暫時讀不到'
    : !healthPending && healthLoadedCount < 4
      ? `已檢核 ${healthLoadedCount}/4 項（部分資料暫時讀不到）`
      : '低維持率／可轉債／14 天行程／重訊';

  const cbShown = showAllCb ? filteredCbAll : filteredCbPressured;
  const filingsShown = showAllFilings ? filteredFilings : filteredFilings.slice(0, 12);

  return (
    <div className="mt-3">
      {baseLoading && (
        <p className="py-4 text-center text-[12.5px] text-muted">載入持股成分與報價資料中…</p>
      )}

      {/* 頂部五格總覽（手機 2 欄首格滿版、中螢幕 3 欄、寬螢幕 5 欄） */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          className="col-span-2 sm:col-span-1"
          label="投組已定價市值"
          value={xray.totalValue > 0 ? `${money(xray.totalValue)} 元` : '—'}
          sub={`${xray.pricedCount} / ${xray.holdingCount} 檔・台股 ${nf1.format(xray.knownTwPct)}%・海外 ${nf1.format(xray.foreignStockPct)}%`}
        />
        <StatCard
          label={xray.hasLowerBound ? '海外個股曝險（下限）' : '海外個股曝險'}
          value={xray.totalValue > 0 ? `${nf1.format(xray.foreignStockPct)}%` : '—'}
          sub={xray.foreignStockValue > 0
            ? `約 ${money(xray.foreignStockValue)} 元（${foreignCount} 檔）`
            : '尚無展開海外個股'}
        />
        <StatCard
          label={xray.hasLowerBound ? '最大單一個股（下限）' : '最大單一個股'}
          value={top1 ? `${nf1.format(top1.pct)}%` : '—'}
          accent={top1 && top1.pct >= 20 ? 'amber' : 'yield'}
          sub={top1
            ? `${top1.isIsin ? top1.name : `${top1.displayCode} ${top1.name}`}（約 ${money(top1.amount)} 元）`
            : '無可穿透個股'}
        />
        <StatCard
          label={xray.hasLowerBound ? '前五大合計（下限）' : '前五大個股合計'}
          value={xray.exposures.length > 0 ? `${nf1.format(xray.top5Pct)}%` : '—'}
          sub={`共展開 ${xray.exposures.length} 檔（台 ${twCount}・海 ${foreignCount}）`}
        />
        <StatCard
          className="sm:col-span-2 lg:col-span-1"
          label="健檢項目提醒"
          value={healthUnavailable ? '—' : `${majorAlertTotal} 筆`}
          accent={!healthUnavailable && majorAlertTotal > 0 ? 'amber' : undefined}
          sub={healthSub}
        />
      </div>

      {/* 投組穿透覆蓋結構與限制摘要 */}
      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-bold text-ink">投組穿透覆蓋度</h2>
          <button
            type="button"
            onClick={() => setShowBreakdown(v => !v)}
            aria-expanded={showBreakdown}
            className="text-[12px] font-semibold text-accent hover:underline"
          >
            {showBreakdown ? '收合各檔穿透明細 ▴' : `檢視 ${xray.breakdown.length} 檔穿透明細 ▾`}
          </button>
        </div>

        {xray.totalValue > 0 && (
          <>
            <div
              className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-sunken"
              role="img"
              aria-label={`直接持股 ${nf1.format(xray.directStockPct)}%、ETF 穿透台股 ${nf1.format(xray.penetratedEtfPct)}%、海外個股 ${nf1.format(xray.foreignStockPct)}%、未揭露或現金 ${nf1.format(xray.unrevealedEtfPct)}%、無法穿透 ${nf1.format(xray.unpenetrablePct)}%`}
            >
              {xray.directStockPct > 0 && (
                <span className="bg-accent" style={{ width: `${Math.min(100, xray.directStockPct)}%` }} />
              )}
              {xray.penetratedEtfPct > 0 && (
                <span className="bg-yield" style={{ width: `${Math.min(100, xray.penetratedEtfPct)}%` }} />
              )}
              {xray.foreignStockPct > 0 && (
                <span style={{ width: `${Math.min(100, xray.foreignStockPct)}%`, backgroundColor: FOREIGN_BAR }} />
              )}
              {xray.unrevealedEtfPct > 0 && (
                <span className="bg-line-strong" style={{ width: `${Math.min(100, xray.unrevealedEtfPct)}%` }} />
              )}
              {xray.unpenetrablePct > 0 && (
                <span className="bg-sunken" style={{ width: `${Math.min(100, xray.unpenetrablePct)}%` }} />
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-xs bg-accent" />
                直接持股（台股） <b className="font-mono tabular-nums text-ink">{nf1.format(xray.directStockPct)}%</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-xs bg-yield" />
                ETF 穿透台股 <b className="font-mono tabular-nums text-ink">{nf1.format(xray.penetratedEtfPct)}%</b>
              </span>
              {xray.foreignStockPct > 0.05 && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: FOREIGN_BAR }} />
                  海外個股曝險 <b className="font-mono tabular-nums text-ink">{nf1.format(xray.foreignStockPct)}%</b>
                </span>
              )}
              {xray.unrevealedEtfPct > 0.05 && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-xs bg-line-strong" />
                  前十大以外／期貨現金 <b className="font-mono tabular-nums text-ink">{nf1.format(xray.unrevealedEtfPct)}%</b>
                </span>
              )}
              {xray.unpenetrablePct > 0.05 && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-xs border border-line-strong bg-sunken" />
                  無法穿透（債券／美股 ETF／槓反／無明細） <b className="font-mono tabular-nums text-ink">{nf1.format(xray.unpenetrablePct)}%</b>
                </span>
              )}
            </div>
          </>
        )}

        {/* 關鍵限制一律明示 */}
        {(xray.hasLowerBound || xray.unpenetrableValue > 0 || xray.hasDateMismatch) && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
            {xray.hasLowerBound && (
              <>
                <b className="text-ink">前十大是已知下限</b>：含月報前十大 ETF（{xray.monthlyAsof} 月底），第 11 名以後成分股算不到，實際個股佔比只會等於或更高。
              </>
            )}
            {xray.unpenetrableValue > 0 && (
              <>
                {xray.hasLowerBound ? ' ' : ''}
                <b className="text-ink">債券／美股 ETF／槓反及尚無明細的 ETF 無法穿透</b>，已計入總市值分母但不展開至個股。
              </>
            )}
            {xray.hasDateMismatch && (
              <span className="block mt-1" style={{ color: AMBER }}>
                ⚠ 持股來源基準日不同（
                {[
                  xray.dailyDates.length > 0 ? `主動式每日 ${xray.dailyDates.join('／')}` : '',
                  xray.monthlyAsof ? `公會月報 ${xray.monthlyAsof} 月底` : '',
                  yields?.meta?.asof ? `收盤報價 ${yields.meta.asof}` : '',
                ].filter(Boolean).join('、')}
                ），穿透比例僅作結構輪廓參考。
              </span>
            )}
          </p>
        )}

        {xray.unpriced.length > 0 && (
          <p className="mt-1.5 rounded-lg bg-sunken px-2.5 py-1.5 text-[11.5px] text-muted">
            以下標的暫時缺少報價，未計入總市值分母：
            {xray.unpriced.map(u => `${u.code} ${u.name}（${u.reason}）`).join('、')}。
          </p>
        )}

        {showBreakdown && (
          <div className="mt-2.5 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead className="bg-sunken text-muted">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-semibold">標的</th>
                  <th className="px-2 py-1.5 text-right font-semibold">佔投組</th>
                  <th className="px-2 py-1.5 text-left font-semibold">穿透來源與口徑</th>
                  <th className="px-2.5 py-1.5 text-right font-semibold">已展開個股</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {xray.breakdown.map(b => (
                  <tr key={`${b.kind}-${b.code}`}>
                    <td className="px-2.5 py-1.5">
                      <span className="font-mono font-semibold text-ink">
                        {b.kind === 'etf' ? (
                          <Link to="/etf" search={{ code: b.code }} className="text-accent hover:underline">{b.code}</Link>
                        ) : b.kind === 'stock' && holdingLinkKind(b.code) === 'stock' ? (
                          <button type="button" onClick={() => pickStock(b.code, b.name)} className="text-accent hover:underline">
                            {b.code}
                          </button>
                        ) : b.code}
                      </span>
                      <span className="ml-1.5 text-muted">{b.name}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink">
                      {b.value !== null ? `${nf1.format(b.pctOfPortfolio)}%` : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-muted">
                      {b.status === 'direct' && (b.note ?? '直接持股（100%）')}
                      {b.status === 'daily' && (b.note
                        ? `${b.note}（${b.asof}・${b.stockCount} 檔）`
                        : `主動式每日持股（${b.asof}・${b.stockCount} 檔）`)}
                      {b.status === 'monthly' && (b.note
                        ? `${b.note}（${b.asof}）`
                        : `公會月報前十大（${b.asof}・下限）`)}
                      {b.status === 'unpenetrable' && (b.note ?? '無法穿透')}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-ink">
                      {b.status === 'unpenetrable' ? '—' : `${nf1.format(b.coveredPct)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 主內容：寬螢幕左欄曝險排行、右欄四張風險與事件健檢卡；手機單欄 */}
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start xl:gap-4">
        {/* 左欄：單一個股真實曝險排行 */}
        <section className="min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-sm font-bold text-ink">
              單一個股真實曝險排行
              {xray.hasLowerBound && <span className="ml-1.5 text-[11.5px] font-normal text-muted">（已知下限）</span>}
            </h2>
            <span className="text-[11.5px] text-faint">點列展開來源・點台股代號看財報籌碼</span>
          </div>

          {xray.exposures.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted">
              目前持股沒有可穿透的個股（例如全為債券或美股掛牌 ETF，或報價尚未載入）。
            </p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {([
                  ['all', `全部（${xray.exposures.length}）`],
                  ['tw', `台股（${twCount}）`],
                  ['foreign', `海外（${foreignCount}）`],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={marketFilter === id}
                    onClick={() => setMarketFilter(id)}
                    className={`h-8 rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${
                      marketFilter === id ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="搜尋個股、市場或來源 ETF…"
                  aria-label="搜尋穿透個股"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-[13px]
                             text-ink placeholder:text-faint sm:max-w-xs"
                />
                <span className="text-[11.5px] text-faint">
                  顯示 {visibleExposures.length} / {filteredExposures.length} 檔
                </span>
              </div>

              {filteredExposures.length === 0 ? (
                <p className="py-8 text-center text-[12.5px] text-muted">
                  此篩選條件下沒有符合的個股。
                </p>
              ) : (
                <ol className="mt-2.5 divide-y divide-line">
                  {visibleExposures.map((row, idx) => {
                    const isOpen = openCode === row.code;
                    const isForeign = row.market === 'foreign';
                    const canSheet = !isForeign && holdingLinkKind(row.code) === 'stock';
                    const directBarW = (row.directPct / maxPct) * 100;
                    const etfBarW = (row.etfPct / maxPct) * 100;
                    return (
                      <li key={row.code} className="py-2 first:pt-0.5 last:pb-0.5">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-faint">
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                                {isForeign && (
                                  <span className="rounded bg-sunken px-1.5 py-0.5 text-[10.5px] font-semibold text-muted">
                                    {row.marketLabel}
                                  </span>
                                )}
                                {canSheet ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => pickStock(row.code, row.name)}
                                      className="font-mono text-[13px] font-bold text-accent hover:underline"
                                    >
                                      {row.displayCode}
                                    </button>
                                    <span className="truncate text-[13px] font-semibold text-ink">{row.name}</span>
                                  </>
                                ) : isForeign && row.isIsin ? (
                                  <>
                                    <span className="truncate text-[13px] font-semibold text-ink">{row.name}</span>
                                    <span className="font-mono text-[10.5px] text-faint">{row.displayCode}</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="font-mono text-[13px] font-bold text-ink">{row.displayCode}</span>
                                    <span className="truncate text-[13px] font-semibold text-ink">{row.name}</span>
                                  </>
                                )}
                                {row.isDirect && row.etfAmount > 0 && (
                                  <span className="rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent">
                                    直接＋ETF
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => setOpenCode(isOpen ? null : row.code)}
                                aria-expanded={isOpen}
                                className="shrink-0 text-right hover:opacity-80"
                              >
                                <span className="font-mono text-[13.5px] font-bold tabular-nums text-ink">
                                  {nf2.format(row.pct)}%
                                </span>
                                <span className="ml-1 text-[10px] text-accent">{isOpen ? '▴' : '▾'}</span>
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => setOpenCode(isOpen ? null : row.code)}
                              aria-expanded={isOpen}
                              className="mt-1 block w-full text-left"
                            >
                              <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                                {row.directPct > 0 && (
                                  <span className="bg-accent" style={{ width: `${Math.min(100, directBarW)}%` }} />
                                )}
                                {row.etfPct > 0 && (
                                  <span
                                    className={isForeign ? undefined : 'bg-yield'}
                                    style={{
                                      width: `${Math.min(100 - directBarW, etfBarW)}%`,
                                      ...(isForeign ? { backgroundColor: FOREIGN_BAR } : {}),
                                    }}
                                  />
                                )}
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 text-[11px] text-faint">
                                <span className="min-w-0 truncate">
                                  來源：{row.sources.slice(0, 3).map(s => (s.kind === 'direct' ? '直接持有' : s.code)).join('、')}
                                  {row.sources.length > 3 ? ` 等 ${row.sources.length} 項` : ''}
                                </span>
                                <span className="shrink-0 font-mono tabular-nums text-muted">
                                  約 {money(row.amount)} 元
                                </span>
                              </span>
                            </button>

                            {isOpen && (
                              <ul className="mt-1.5 space-y-1.5 rounded-lg bg-sunken px-2.5 py-2 text-[11.5px]">
                                {row.sources.map(src => (
                                  <li key={`${src.kind}-${src.code}`}>
                                    <div className="flex items-baseline justify-between gap-2">
                                      <span className="min-w-0 truncate text-ink">
                                        {src.kind === 'direct' ? (
                                          <span className="font-semibold text-accent">直接持有</span>
                                        ) : (
                                          <>
                                            <Link to="/etf" search={{ code: src.code }} className="font-mono font-semibold text-accent hover:underline">
                                              {src.code}
                                            </Link>
                                            <span className="ml-1 text-muted">{src.name}</span>
                                          </>
                                        )}
                                      </span>
                                      <span className="shrink-0 font-mono tabular-nums text-ink">
                                        {nf2.format(src.pctOfPortfolio)}%
                                        <span className="ml-1.5 text-muted">{money(src.amount)} 元</span>
                                      </span>
                                    </div>
                                    {src.kind !== 'direct' && (
                                      <div className="mt-0.5 text-[10.5px] text-faint">
                                        佔淨值 {nf2.format(src.weightInSource)}%・{src.kind === 'daily' ? `每日持股 ${src.asof}` : `公會月報 ${src.asof}`}
                                      </div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              {!query.trim() && filteredExposures.length > 20 && (
                <button
                  type="button"
                  onClick={() => setShowAllExp(v => !v)}
                  className="mt-2.5 text-[12.5px] font-semibold text-accent hover:underline"
                >
                  {showAllExp ? '只看前 20 名 ▴' : `展開全部 ${filteredExposures.length} 檔個股 ▾`}
                </button>
              )}
            </>
          )}
        </section>

        {/* 右欄：持股風險與事件健檢（4 張卡片） */}
        <div className="min-w-0 space-y-3">
          {/* 風險／事件範圍切換（以下四項健檢僅適用台股） */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2.5">
            <span className="mr-1 text-[12px] font-semibold text-muted">健檢範圍（台股）</span>
            {([
              ['major', `主要部位（直接＋穿透 ≥${MINOR_EXPOSURE_PCT}%）`],
              ['direct', '只看直接持有'],
              ['all', '全部穿透標的'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={healthMode === id}
                onClick={() => setHealthMode(id)}
                className={`h-8 rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${
                  healthMode === id ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 卡片 1：低融資維持率警戒 */}
          <section className="rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <h2 className="text-sm font-bold text-ink">低融資維持率警戒</h2>
              <div className="flex items-center gap-2 text-[11.5px]">
                {marginCheck.date && <span className="font-mono text-faint">{marginCheck.date}</span>}
                <Link to="/chips" className="text-accent hover:underline">籌碼頁 →</Link>
              </div>
            </div>

            {marginState === undefined ? (
              <p className="mt-2 text-[12.5px] text-muted">載入融資維持率中…</p>
            ) : !marginCheck.available ? (
              <p className="mt-2 text-[12.5px] text-muted">
                個股融資維持率資料暫時讀不到（部署時產生），稍後再試。
              </p>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {([
                    [150, '< 150%'],
                    [160, '< 160%'],
                    [999, `全部有融資（${filteredMarginAll.length}）`],
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={marginThr === v}
                      onClick={() => setMarginThr(v)}
                      className={`h-7 rounded-md px-2 text-[11.5px] font-semibold transition-colors ${
                        marginThr === v ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {filteredMarginFlagged.length === 0 ? (
                  <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
                    {filteredMarginAll.length === 0
                      ? '此範圍內沒有融資交易個股資料。'
                      : `已檢核 ${filteredMarginAll.length} 檔，目前無維持率低於 ${marginThr}% 者`
                        + (filteredMarginAll[0]
                          ? `（最低為 ${filteredMarginAll[0].code} ${filteredMarginAll[0].name} ${nf1.format(filteredMarginAll[0].maint)}%）。`
                          : '。')}
                    {healthMode !== 'all' && marginCheck.flagged.length > filteredMarginFlagged.length && (
                      <span className="block mt-0.5 text-[11.5px] text-faint">
                        微小穿透部位另有 {marginCheck.flagged.length - filteredMarginFlagged.length} 檔低於門檻，可切至「全部穿透標的」檢視。
                      </span>
                    )}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-line">
                    {filteredMarginFlagged.slice(0, 15).map(r => (
                      <li key={r.code} className="flex items-center justify-between gap-2 py-2 first:pt-0.5 last:pb-0.5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                            <TargetLink code={r.code} name={r.name} kind="stock" onPickStock={pickStock} />
                            <span className="text-[13px] font-semibold text-ink">{r.name}</span>
                            <RelationTag isDirect={r.isDirect} exposurePct={r.exposurePct} viaEtfs={r.viaEtfs} />
                          </div>
                          <div className="mt-0.5 text-[11px] text-faint">
                            {r.level === 'danger' ? '低於 130% 追繳線' : r.level === 'watch' ? '接近追繳線（130–150%）' : '融資平均成本推算'}
                          </div>
                        </div>
                        <span
                          className="shrink-0 font-mono text-[14.5px] font-bold tabular-nums"
                          style={{ color: r.level === 'danger' ? AMBER : r.level === 'watch' ? WATCH : 'var(--c-ink)' }}
                        >
                          {nf1.format(r.maint)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  依 XQ 融資平均成本公式推算之市場估算值（非券商個人整戶維持率）；融資資料最晚約 21:30 公布。
                </p>
              </>
            )}
          </section>

          {/* 卡片 2：可轉債轉換賣壓 */}
          <section className="rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <h2 className="text-sm font-bold text-ink">可轉債轉換賣壓</h2>
              <div className="flex items-center gap-2 text-[11.5px]">
                {cbCheck.date && <span className="font-mono text-faint">行情 {cbCheck.date}</span>}
                <Link to="/cb" className="text-accent hover:underline">可轉債頁 →</Link>
              </div>
            </div>

            {cbData === undefined ? (
              <p className="mt-2 text-[12.5px] text-muted">載入可轉債資料中…</p>
            ) : !cbCheck.available ? (
              <p className="mt-2 text-[12.5px] text-muted">
                可轉債資料暫時讀不到（部署時產生），稍後再試。
              </p>
            ) : (
              <>
                {filteredCbAll.length > filteredCbPressured.length && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      aria-pressed={!showAllCb}
                      onClick={() => setShowAllCb(false)}
                      className={`h-7 rounded-md px-2 text-[11.5px] font-semibold transition-colors ${
                        !showAllCb ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
                    >
                      轉換留意（{filteredCbPressured.length}）
                    </button>
                    <button
                      type="button"
                      aria-pressed={showAllCb}
                      onClick={() => setShowAllCb(true)}
                      className={`h-7 rounded-md px-2 text-[11.5px] font-semibold transition-colors ${
                        showAllCb ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
                    >
                      全部掛牌（{filteredCbAll.length}）
                    </button>
                  </div>
                )}

                {cbShown.length === 0 ? (
                  <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
                    {filteredCbAll.length === 0
                      ? '此範圍內的標的目前沒有掛牌中的可轉債（已排除交換債）。'
                      : `此範圍共關聯 ${filteredCbAll.length} 檔掛牌可轉債，目前沒有顯著轉換或負溢價訊號。`}
                    {healthMode !== 'all' && cbCheck.pressured.length > filteredCbPressured.length && (
                      <span className="block mt-0.5 text-[11.5px] text-faint">
                        微小穿透部位另有 {cbCheck.pressured.length - filteredCbPressured.length} 檔具轉換訊號。
                      </span>
                    )}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-line">
                    {cbShown.slice(0, 15).map(r => (
                      <li key={r.bond.c} className="py-2 first:pt-0.5 last:pb-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                            <span className="font-mono text-[12.5px] font-bold text-ink">{r.bond.c}</span>
                            <span className="text-[13px] font-semibold text-ink">{r.bond.n}</span>
                            <span className="text-[11.5px] text-muted">
                              標的 <TargetLink code={r.stockCode} name={r.stockName} kind="stock" onPickStock={pickStock} /> {r.stockName}
                            </span>
                          </div>
                          <span
                            className="shrink-0 font-mono text-[12.5px] font-bold tabular-nums"
                            style={{ color: r.pressureLevel === 2 ? AMBER : r.pressureLevel === 1 ? WATCH : 'var(--c-muted)' }}
                          >
                            {r.bond.px !== null ? nf1.format(r.bond.px) : '—'}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                          <RelationTag isDirect={r.isDirect} exposurePct={r.exposurePct} viaEtfs={r.viaEtfs} />
                          <span className="font-mono tabular-nums text-muted">
                            轉換價 {r.bond.cp !== null ? nf2.format(r.bond.cp) : '—'}
                            {' · '}溢價 {r.bond.prem !== null ? `${nf1.format(r.bond.prem)}%` : '—'}
                            {r.remainPct !== null ? ` · 餘額 ${nf1.format(r.remainPct)}%（${yi(r.bond.out)}）` : ''}
                          </span>
                        </div>
                        {r.reasons.length > 0 && (
                          <p
                            className="mt-0.5 text-[11.5px]"
                            style={{ color: r.pressureLevel === 2 ? AMBER : r.pressureLevel === 1 ? WATCH : 'var(--c-muted)' }}
                          >
                            {r.reasons.join('・')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {cbCheck.upcoming.length > 0 && (
                  <p className="mt-2 rounded-lg bg-sunken px-2.5 py-1.5 text-[11.5px] text-muted">
                    關聯公司待發行可轉債：
                    {cbCheck.upcoming.slice(0, 5).map(u => `${u.item.n}（${u.item.s}，${u.item.list || u.item.issue || '日期待定'}）`).join('、')}
                  </p>
                )}

                <p className="mt-2 text-[11px] leading-relaxed text-faint">
                  已排除交換債；看板日 {cbCheck.boardDate ?? '—'}（晚行情一日）。近月餘額減少含轉換、賣回與買回（櫃買未拆列），僅作籌碼參考。
                </p>
              </>
            )}
          </section>

          {/* 卡片 3：未來 14 天除息／法說／股東會 */}
          <section className="rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <h2 className="text-sm font-bold text-ink">未來 14 天除息／法說／股東會</h2>
              <div className="flex items-center gap-2 text-[11.5px]">
                {calendar?.meta.updated && <span className="font-mono text-faint">{calendar.meta.updated}</span>}
                <Link to="/calendar" className="text-accent hover:underline">行事曆 →</Link>
              </div>
            </div>

            {calendar === undefined ? (
              <p className="mt-2 text-[12.5px] text-muted">載入行事曆中…</p>
            ) : !calendar ? (
              <p className="mt-2 text-[12.5px] text-muted">
                行事曆資料暫時讀不到（部署時產生），稍後再試。
              </p>
            ) : filteredEvents.length === 0 ? (
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
                未來 14 天（{today} 起）此範圍內沒有已公告的除權息、法說會或股東會。
                {healthMode !== 'all' && eventRows.length > filteredEvents.length && (
                  <span className="block mt-0.5 text-[11.5px] text-faint">
                    微小穿透部位另有 {eventRows.length - filteredEvents.length} 筆日程。
                  </span>
                )}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {filteredEvents.slice(0, 20).map((r, i) => (
                  <li key={`${r.event.d}-${r.event.kind}-${r.code}-${i}`} className="py-2 first:pt-0.5 last:pb-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="font-mono text-[12px] font-bold tabular-nums text-ink">{dayLabel(r.event.d)}</span>
                      <span
                        className="text-[11px] font-semibold"
                        style={{ color: r.daysLeft <= 2 ? AMBER : 'var(--c-faint)' }}
                      >
                        {whenLabel(r.daysLeft)}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold ${EVENT_BADGE[r.event.kind] ?? 'bg-sunken text-ink'}`}>
                        {KIND_LABEL[r.event.kind]}
                      </span>
                      <TargetLink code={r.code} kind={r.targetKind} onPickStock={pickStock} />
                      <RelationTag isDirect={r.isDirect} exposurePct={r.exposurePct} viaEtfs={r.viaEtfs} />
                    </div>
                    <div className="mt-0.5 text-[13px] font-semibold text-ink">{r.event.title}</div>
                    {r.event.detail && (
                      <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{r.event.detail}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {calendar && (
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                除權息與股東會為交易所預告，法說會取自重大訊息逐日累積（不保證完整）；日期與金額以公司及投信公告為準。
              </p>
            )}
          </section>

          {/* 卡片 4：近期重大訊息 */}
          <section className="rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <h2 className="text-sm font-bold text-ink">近期重大訊息</h2>
              <div className="flex items-center gap-2 text-[11.5px]">
                {news?.meta.updated && <span className="font-mono text-faint">{news.meta.updated.slice(0, 10)}</span>}
                <Link to="/news" className="text-accent hover:underline">新聞與公告 →</Link>
              </div>
            </div>

            {news === undefined ? (
              <p className="mt-2 text-[12.5px] text-muted">載入重大訊息中…</p>
            ) : !news ? (
              <p className="mt-2 text-[12.5px] text-muted">
                重大訊息資料暫時讀不到（部署時產生），稍後再試。
              </p>
            ) : filteredFilings.length === 0 ? (
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
                近期沒有此範圍內標的之公開資訊觀測站重大訊息。
                {healthMode !== 'all' && filingRows.length > filteredFilings.length && (
                  <span className="block mt-0.5 text-[11.5px] text-faint">
                    微小穿透部位另有 {filingRows.length - filteredFilings.length} 則公告。
                  </span>
                )}
              </p>
            ) : (
              <>
                <ul className="mt-2 divide-y divide-line">
                  {filingsShown.map((r, i) => (
                    <li key={`${r.filing.code}-${r.filing.at ?? ''}-${i}`} className="py-2 first:pt-0.5 last:pb-0.5">
                      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <TargetLink code={r.filing.code} name={r.filing.name} kind={r.targetKind} onPickStock={pickStock} />
                        <span className="text-[12.5px] font-semibold text-ink">{r.filing.name}</span>
                        <RelationTag isDirect={r.isDirect} exposurePct={r.exposurePct} viaEtfs={r.viaEtfs} />
                        <span className="ml-auto text-[11px] text-faint">
                          {newsDayLabel(r.filing.at)} {timeOfDay(r.filing.at)}
                        </span>
                      </div>
                      <a
                        href={r.filing.u}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 block break-words text-[12.5px] leading-snug text-muted hover:text-accent hover:underline"
                      >
                        {r.filing.subject}
                      </a>
                    </li>
                  ))}
                </ul>
                {filteredFilings.length > 12 && (
                  <button
                    type="button"
                    onClick={() => setShowAllFilings(v => !v)}
                    className="mt-2 text-[12px] font-semibold text-accent hover:underline"
                  >
                    {showAllFilings ? '收起 ▴' : `看全部 ${filteredFilings.length} 則重大訊息 ▾`}
                  </button>
                )}
              </>
            )}

            {news && (
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                僅收錄公開資訊觀測站原始主旨與外連（不存內文），點主旨前往原站查閱。
              </p>
            )}
          </section>
        </div>
      </div>

      {/* 各來源資料日期與完整口徑／限制說明 */}
      <section className="mt-3 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-faint">
          <span className="font-semibold text-muted">來源日期</span>
          <span>
            主動式每日持股：<span className="font-mono text-muted">{active?.meta.updated ?? '暫時讀不到'}</span>
          </span>
          <span>
            公會月報前十大：<span className="font-mono text-muted">{top10 ? `${top10.meta.ym.slice(0, 4)}/${top10.meta.ym.slice(4)} 月底` : '暫時讀不到'}</span>
          </span>
          <span>
            ETF 收盤價：<span className="font-mono text-muted">{yields?.meta?.asof ?? '暫時讀不到'}</span>
          </span>
          <span>
            個股收盤價：<span className="font-mono text-muted">{stockDivs?.meta.updated ?? '暫時讀不到'}</span>
          </span>
          {usCodes.length > 0 && (
            <span>
              美元匯率：<span className="font-mono text-muted">{fx ? `${fx.date}（${fx.rate}）` : '暫時讀不到'}</span>
            </span>
          )}
          <span>
            融資維持率：<span className="font-mono text-muted">{marginCheck.date ?? '暫時讀不到'}</span>
          </span>
          <span>
            可轉債：<span className="font-mono text-muted">{cbCheck.date ? `${cbCheck.date}（看板 ${cbCheck.boardDate ?? '—'}）` : '暫時讀不到'}</span>
          </span>
        </div>

        <Fold summary="算法口徑與限制：前十大為已知下限、海外成分來自月報與每日持股、美股／債券／槓反 ETF 無法穿透，僅供檢視參考">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <strong className="text-muted">前十大是已知下限</strong>：除站上每日追蹤的主動式股票型 ETF 採用投信每日完整持股外，其餘台灣掛牌 ETF（含海外股票 ETF 及未提供每日持股的主動式 ETF）僅有投信投顧公會月報前十大持股，排名第 11 名以後成分股無法展開，因此單一個股曝險為已知下限，實際集中度可能更高。
            </li>
            <li>
              <strong className="text-muted">海外個股穿透口徑</strong>：海外成分來自公會月報前十大（月）與主動式 ETF 每日持股；直接持有的美股個股亦計入海外個股曝險並與 ETF 成分合併，美股 ETF 本身沒有成分資料。公會月報的 ISIN 代號透過對照表合併至同一家公司，尚無對照者以原 ISIN 呈現；低融資維持率、可轉債、除息／法說與重大訊息四項健檢僅針對台股標的。
            </li>
            <li>
              <strong className="text-muted">無法穿透的標的</strong>：債券 ETF、美股掛牌 ETF、槓桿／反向與期貨 ETF、以及尚無明細之新上市／平衡型／連結型 ETF 均無法展開成分股；已取得報價者仍計入投組總市值分母。主動式 ETF 內含之台指期貨部位亦不計為個股曝險。
            </li>
            <li>
              <strong className="text-muted">資料日期與口徑差異</strong>：公會月報為上月底快照（約每月 10 號後更新）、主動式持股為投信每日收盤後公告、股價為最新收盤價、融資維持率採 XQ 平均成本推算（非券商個人整戶維持率，最晚約 21:30 更新）、可轉債看板晚行情一個交易日且近月餘額減少含轉換／賣回／買回。
            </li>
            <li>
              本頁僅整合公開資料供投組結構檢視，不構成任何投資或調整部位建議。持股資料僅存於瀏覽器本機，不會上傳。
            </li>
          </ul>
        </Fold>
      </section>

      <StockSheet code={sheet?.code ?? null} name={sheet?.name} onClose={closeSheet} />
    </div>
  );
}
