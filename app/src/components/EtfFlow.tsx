/* ETF 每週受益人與資金流向榜（台股頁「資金流向」分頁，?view=flow）。
 *
 * 計算邏輯全在 lib/etfHolders.ts，這裡只負責呈現與互動。
 * 估算淨申贖金額＝Δ流通張數 × 最新收盤價 × 1,000（明確標示為估算）；
 * 遇分割／反分割造成流通張數異常倍增／倍減時標示徽章，且不計入金額排行與合計。
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useEtfData } from '../context/AppContext';
import { fetchEtfHolders, fetchYields } from '../api/extras';
import { useIsMobile } from '../hooks/useMediaQuery';
import {
  buildFlowRows, filterFlowRows, FLOW_CATEGORIES, FLOW_METRICS, formatFlowYi,
  matchesFlowCategory, sortFlowRows, summarizeFlow, windowRange,
  type EtfHoldersData, type FlowCategory, type FlowDir, type FlowMetric,
  type FlowRow, type FlowWindow, type SplitWarning,
} from '../lib/etfHolders';
import type { YieldData } from '../lib/dividend';
import type { Etf, SectionId } from '../types';
import { EmptyState } from './EmptyState';
import { FreqPill } from './FreqPill';
import { Fold } from './Fold';

const Top10Modal = lazy(() => import('./Top10Modal')
  .then(m => ({ default: m.Top10Modal })));

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DEFAULT_LIMIT = 30;

const SEC_SHORT: Record<SectionId, string> = {
  'cat-domestic': '台股',
  'cat-foreign': '海外',
  'cat-bond': '債券',
  'cat-leveraged': '槓反',
  'cat-futures': '期貨',
  'cat-leveraged-futures': '槓期',
};

const signedInt = (v: number) => `${v > 0 ? '+' : ''}${nf0.format(v)}`;
const signedPct = (v: number | null) => (v === null ? '' : `${v > 0 ? '+' : ''}${nf1.format(v)}%`);
const flowTone = (v: number | null | undefined) => (
  v == null || v === 0 ? 'text-flat' : v > 0 ? 'text-up' : 'text-down'
);

function compactCount(v: number): string {
  if (v >= 1e4) return `${nf1.format(v / 1e4)} 萬`;
  return nf0.format(v);
}

function formatAum(yuan: number | null): string {
  if (yuan === null || !Number.isFinite(yuan)) return '';
  if (yuan >= 1e8) return `約 ${nf0.format(Math.round(yuan / 1e8))} 億`;
  if (yuan >= 1e4) return `約 ${nf0.format(Math.round(yuan / 1e4))} 萬`;
  return '';
}

function SplitBadge({ split }: { split: SplitWarning }) {
  const label = split.kind === 'split' ? `疑分割 ~${split.ratio}×` : `疑反分割 ~${split.ratio}×`;
  const title = `${split.fromDate} → ${split.toDate} 流通張數變動約 ${split.ratio} 倍（且人均張數同步跳變），疑似${split.kind === 'split' ? '分割' : '反分割'}，張數與估算金額變化不計入申贖排行`;
  return (
    <span title={title}
          className="inline-block rounded border border-yield/40 bg-sunken px-1.5 py-px font-mono text-[10.5px] font-semibold whitespace-nowrap text-yield">
      {label}
    </span>
  );
}

function Chip({ active, disabled, title, onClick, children }: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`h-8 shrink-0 rounded-lg px-2.5 text-[12.5px] font-semibold transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-sunken text-faint opacity-60'
          : active
            ? 'bg-accent text-accent-ink'
            : 'bg-sunken text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function SummaryCard({ label, value, valueClass = 'text-ink', sub }: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-[14.5px] font-bold tabular-nums sm:text-[16px] ${valueClass}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10.5px] leading-snug text-faint sm:text-[11px]">{sub}</div>}
    </div>
  );
}

export function EtfFlow() {
  const data = useEtfData();
  const isMobile = useIsMobile();

  const [holders, setHolders] = useState<EtfHoldersData | null | undefined>(undefined);
  const [yields, setYields] = useState<YieldData | null | undefined>(undefined);

  const [win, setWin] = useState<FlowWindow>('w1');
  const [cat, setCat] = useState<FlowCategory>('all');
  const [metric, setMetric] = useState<FlowMetric>('flow');
  const [dir, setDir] = useState<FlowDir>('in');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<Etf | null>(null);
  const closePicked = useCallback(() => setPicked(null), []);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      fetchEtfHolders(ac.signal).catch(() => null),
      fetchYields(ac.signal).catch(() => null),
    ]).then(([h, y]) => {
      if (ac.signal.aborted) return;
      setHolders(h);
      setYields(y);
      // 收盤價檔案缺席時，預設切回受益人變化，避免金額欄全空
      if (!y) setMetric(prev => (prev === 'flow' ? 'holders' : prev));
    });
    return () => ac.abort();
  }, []);

  const etfMap = useMemo(() => new Map(data.etfs.map(e => [e.code, e])), [data.etfs]);
  const allRows = useMemo(
    () => buildFlowRows(data.etfs, holders, yields),
    [data.etfs, holders, yields],
  );

  const dates = holders?.dates ?? [];
  const hasW1 = dates.length >= 2;
  const hasW4 = dates.length >= 5;
  const activeWin: FlowWindow = win === 'w4' && !hasW4 ? 'w1' : win;
  const range = useMemo(() => windowRange(dates, activeWin), [dates, activeWin]);

  // 累積僅 1 週時沒有變化可算，退回最新受益人數排序
  const activeMetric: FlowMetric = !hasW1 && (metric === 'flow' || metric === 'holders' || metric === 'lots')
    ? 'totalHolders'
    : metric;
  const metricInfo = FLOW_METRICS.find(m => m.id === activeMetric)!;

  const catCounts = useMemo(() => {
    const counts: Record<FlowCategory, number> = {
      all: allRows.length,
      domestic: 0,
      foreign: 0,
      bond: 0,
      leveraged: 0,
      active: 0,
    };
    for (const r of allRows) {
      if (matchesFlowCategory(r, 'domestic')) counts.domestic++;
      if (matchesFlowCategory(r, 'foreign')) counts.foreign++;
      if (matchesFlowCategory(r, 'bond')) counts.bond++;
      if (matchesFlowCategory(r, 'leveraged')) counts.leveraged++;
      if (matchesFlowCategory(r, 'active')) counts.active++;
    }
    return counts;
  }, [allRows]);

  const filtered = useMemo(
    () => filterFlowRows(allRows, cat, q),
    [allRows, cat, q],
  );
  const sorted = useMemo(
    () => sortFlowRows(filtered, activeWin, activeMetric, dir),
    [filtered, activeWin, activeMetric, dir],
  );
  const summary = useMemo(
    () => summarizeFlow(filtered, activeWin),
    [filtered, activeWin],
  );

  const splitRows = useMemo(
    () => filtered.filter(r => r[activeWin]?.split != null),
    [filtered, activeWin],
  );

  // 摘要卡：本分類淨申購最大／淨贖回最大（無收盤價時改列受益人數增減最大）
  const { topIn, topOut } = useMemo(() => {
    let bestIn: FlowRow | null = null;
    let bestInVal = 0;
    let bestOut: FlowRow | null = null;
    let bestOutVal = 0;
    const useFlow = summary.pricedCount > 0;
    for (const r of filtered) {
      const s = r[activeWin];
      if (!s) continue;
      const v = useFlow ? s.estFlow : s.dHolders;
      if (v === null) continue;
      if (v > bestInVal) { bestInVal = v; bestIn = r; }
      if (v < bestOutVal) { bestOutVal = v; bestOut = r; }
    }
    return { topIn: bestIn, topOut: bestOut };
  }, [filtered, activeWin, summary.pricedCount]);

  const onHeaderSort = (m: FlowMetric) => {
    if (activeMetric === m) setDir(d => (d === 'in' ? 'out' : 'in'));
    else { setMetric(m); setDir('in'); }
  };

  const openModal = (code: string) => {
    const etf = etfMap.get(code);
    if (etf) setPicked(etf);
  };

  if (holders === undefined) {
    return <p className="py-12 text-center text-[13px] text-muted">載入資金流向資料中…</p>;
  }

  if (holders === null || allRows.length === 0) {
    return (
      <div className="pt-4">
        <EmptyState
          title="資金流向資料暫時讀不到"
          hint="集保每週股權分散表尚未載入或目前沒有可顯示的資料，請稍後再試。"
        />
      </div>
    );
  }

  const visible = q.trim() || showAll ? sorted : sorted.slice(0, DEFAULT_LIMIT);
  const hasMore = !q.trim() && !showAll && sorted.length > DEFAULT_LIMIT;
  const priceAsof = yields?.meta?.asof ?? '';
  const winLabel = activeWin === 'w1' ? '1 週' : '4 週';

  const thBase = 'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-sunken px-2.5 py-2.5 text-xs font-bold text-muted';
  const tdBase = 'border-b border-line px-2.5 py-2 align-middle';

  const sortArrow = (m: FlowMetric) => (
    <span aria-hidden="true" className={activeMetric === m ? 'ml-1' : 'ml-1 opacity-35'}>
      {activeMetric === m ? (dir === 'in' ? '↓' : '↑') : '↕'}
    </span>
  );

  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-bold text-ink">ETF 受益人與資金流向榜</h2>
        <span className="text-[11.5px] text-faint">
          集保 {holders.meta.asof}
          {range && `（比較 ${range.prevDate} → ${range.asof}）`}
          {priceAsof && ` · 收盤價 ${priceAsof}`}
        </span>
      </div>

      {!hasW1 && (
        <p className="mt-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[12px] text-muted">
          目前僅累積 1 週集保資料，尚無法計算週變化；以下先依最新受益人數與流通張數排列。
        </p>
      )}
      {yields === null && (
        <p className="mt-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[12px] text-muted">
          收盤價資料暫時讀不到，目前僅顯示受益人數與流通張數變化（估算淨申贖金額暫缺）。
        </p>
      )}

      {/* 摘要統計卡 */}
      {hasW1 && (
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryCard
            label={`${winLabel}合計估算淨申贖`}
            value={summary.pricedCount > 0 ? formatFlowYi(summary.netFlow) : '—'}
            valueClass={summary.pricedCount > 0 ? flowTone(summary.netFlow) : 'text-na'}
            sub={summary.pricedCount > 0 ? (
              <span className="inline-flex flex-wrap gap-x-2">
                <span>申購 {formatFlowYi(summary.inflow)}</span>
                <span>贖回 {formatFlowYi(summary.outflow)}</span>
              </span>
            ) : '缺少收盤價，無法估算'}
          />
          <SummaryCard
            label={`${winLabel}受益人數合計變化`}
            value={`${signedInt(summary.netHolders)} 人`}
            valueClass={flowTone(summary.netHolders)}
            sub={`共 ${summary.totalCount} 檔有${winLabel}資料`}
          />
          <SummaryCard
            label={summary.pricedCount > 0 ? `${winLabel}估算淨申購最多` : `${winLabel}人數增加最多`}
            value={topIn ? (
              <Link to="/etf" search={{ code: topIn.code }} className="hover:underline">
                <span className="text-accent">{topIn.code}</span>{' '}
                <span className="text-up">
                  {summary.pricedCount > 0 && topIn[activeWin]?.estFlow != null
                    ? formatFlowYi(topIn[activeWin]!.estFlow!)
                    : signedInt(topIn[activeWin]?.dHolders ?? 0)}
                </span>
              </Link>
            ) : '—'}
            sub={topIn ? topIn.name : '本篩選無淨流入標的'}
          />
          <SummaryCard
            label={summary.pricedCount > 0 ? `${winLabel}估算淨贖回最多` : `${winLabel}人數減少最多`}
            value={topOut ? (
              <Link to="/etf" search={{ code: topOut.code }} className="hover:underline">
                <span className="text-accent">{topOut.code}</span>{' '}
                <span className="text-down">
                  {summary.pricedCount > 0 && topOut[activeWin]?.estFlow != null
                    ? formatFlowYi(topOut[activeWin]!.estFlow!)
                    : signedInt(topOut[activeWin]?.dHolders ?? 0)}
                </span>
              </Link>
            ) : '—'}
            sub={topOut ? topOut.name : '本篩選無淨流出標的'}
          />
        </div>
      )}

      {/* 篩選與排序控制列 */}
      <section className="mt-3 rounded-xl border border-line bg-surface p-3 sm:p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="比較區間" className="flex gap-1.5">
            <Chip active={activeWin === 'w1'} disabled={!hasW1}
                  title={hasW1 ? '比較前 1 週' : '需至少 2 週資料'}
                  onClick={() => setWin('w1')}>
              近 1 週
            </Chip>
            <Chip active={activeWin === 'w4'} disabled={!hasW4}
                  title={hasW4 ? '比較 4 週前' : `目前僅 ${dates.length} 週資料，需滿 5 週`}
                  onClick={() => setWin('w4')}>
              近 4 週
            </Chip>
          </div>

          <div role="group" aria-label="排行方向" className="flex gap-1.5">
            <Chip active={dir === 'in'} onClick={() => setDir('in')}>
              {metricInfo.isDelta ? '淨申購／增加' : '由高到低'}
            </Chip>
            <Chip active={dir === 'out'} onClick={() => setDir('out')}>
              {metricInfo.isDelta ? '淨贖回／減少' : '由低到高'}
            </Chip>
          </div>

          <div className="relative w-full sm:ml-auto sm:w-52">
            <input
              type="search"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="搜尋代號或名稱…"
              aria-label="搜尋 ETF 代號或名稱"
              className="h-8 w-full rounded-lg border border-line bg-bg px-2.5 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent"
            />
          </div>
        </div>

        <div role="group" aria-label="ETF 分類篩選" className="mt-2.5 flex flex-wrap gap-1.5">
          {FLOW_CATEGORIES.map(c => (
            <Chip key={c.id} active={cat === c.id} onClick={() => { setCat(c.id); setShowAll(false); }}>
              {c.label}
              <span className={`ml-1 font-mono text-[11px] tabular-nums ${cat === c.id ? 'opacity-85' : 'text-faint'}`}>
                {catCounts[c.id]}
              </span>
            </Chip>
          ))}
        </div>

        <div role="group" aria-label="排序指標" className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-faint">排序</span>
          {FLOW_METRICS.map(m => {
            const disabled = (!hasW1 && m.isDelta) || (m.id === 'flow' && yields === null);
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={activeMetric === m.id}
                disabled={disabled}
                onClick={() => {
                  if (activeMetric === m.id) setDir(d => (d === 'in' ? 'out' : 'in'));
                  else { setMetric(m.id); setDir('in'); }
                }}
                className={`h-7 rounded-full border px-2.5 text-[12px] font-semibold transition-colors ${
                  disabled
                    ? 'cursor-not-allowed border-line bg-sunken text-faint opacity-60'
                    : activeMetric === m.id
                      ? 'border-accent bg-accent text-accent-ink'
                      : 'border-line bg-bg text-muted hover:text-ink'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* 疑似分割／反分割提醒 */}
      {splitRows.length > 0 && (
        <div className="mt-2.5 rounded-xl border border-yield/40 bg-surface px-3.5 py-2.5 text-[12px] leading-relaxed text-ink">
          <span className="font-bold text-yield">疑似分割／反分割提醒：</span>
          近 {winLabel}偵測到{' '}
          {splitRows.map((r, i) => {
            const sp = r[activeWin]!.split!;
            return (
              <span key={r.code}>
                {i > 0 && '、'}
                <Link to="/etf" search={{ code: r.code }} className="font-mono font-bold text-accent hover:underline">
                  {r.code}
                </Link>{' '}
                {r.name}（張數約 {sp.ratio}×）
              </span>
            );
          })}
          ，因流通張數倍增／倍減會使申贖估算嚴重失真，其張數與估算金額變化已標示並排除於申贖金額排行與合計（受益人數照常計算）。
        </div>
      )}

      {/* 排行榜主體 */}
      <div className="mt-3">
        <p className="mb-2 text-[12.5px] text-muted">
          顯示 <strong className="tabular font-mono text-ink">{visible.length}</strong> / {sorted.length} 檔
          {'　·　'}
          依 {metricInfo.label}（{metricInfo.isDelta ? (dir === 'in' ? '淨申購／增加優先' : '淨贖回／減少優先') : (dir === 'in' ? '高→低' : '低→高')}）
        </p>

        {sorted.length === 0 ? (
          <EmptyState
            title="找不到符合條件的 ETF"
            hint="試試清除搜尋字詞或切換其他分類。"
          />
        ) : isMobile ? (
          <div className="space-y-2">
            {visible.map((r, i) => {
              const s = r[activeWin];
              return (
                <article key={r.code} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      <span className="w-[1.8em] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-faint">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-1.5">
                          <Link to="/etf" search={{ code: r.code }}
                                className="font-mono text-[13.5px] font-bold text-accent hover:underline">
                            {r.code}
                          </Link>
                          <button type="button" onClick={() => openModal(r.code)}
                                  className="min-w-0 truncate text-left text-[13.5px] font-semibold text-ink hover:text-accent hover:underline">
                            {r.name}
                          </button>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px]">
                          <span className="rounded bg-sunken px-1.5 py-px text-muted">{SEC_SHORT[r.sec]}</span>
                          {r.act && <span className="rounded bg-accent-soft px-1.5 py-px font-semibold text-accent">主動</span>}
                          {r.freq !== '—' && <FreqPill freq={r.freq} />}
                          {s?.split && <SplitBadge split={s.split} />}
                        </div>
                      </div>
                    </div>
                    {r.price !== null && (
                      <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-faint">
                        {nf2.format(r.price)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-lg bg-sunken px-2 py-2 text-center">
                    <div className="min-w-0">
                      <div className="text-[10.5px] text-faint">估算淨申贖</div>
                      {s?.split ? (
                        <div className="mt-0.5 text-[11.5px] font-semibold text-yield">分割失真</div>
                      ) : (
                        <div className={`mt-0.5 truncate font-mono text-[12.5px] font-bold tabular-nums ${flowTone(s?.estFlow)}`}>
                          {s?.estFlow != null ? formatFlowYi(s.estFlow) : '—'}
                        </div>
                      )}
                      {r.estAum !== null && (
                        <div className="truncate text-[10px] text-faint">{formatAum(r.estAum)}</div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10.5px] text-faint">受益人變化</div>
                      <div className={`mt-0.5 truncate font-mono text-[12.5px] font-bold tabular-nums ${flowTone(s?.dHolders)}`}>
                        {s ? signedInt(s.dHolders) : '—'}
                      </div>
                      <div className="truncate font-mono text-[10px] tabular-nums text-faint">
                        共 {compactCount(r.holders)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10.5px] text-faint">淨申贖張數</div>
                      {s?.split ? (
                        <div className="mt-0.5 text-[11.5px] font-semibold text-yield">含分割</div>
                      ) : (
                        <div className={`mt-0.5 truncate font-mono text-[12.5px] font-bold tabular-nums ${flowTone(s?.dLots)}`}>
                          {s ? signedInt(s.dLots) : '—'}
                        </div>
                      )}
                      <div className="truncate font-mono text-[10px] tabular-nums text-faint">
                        共 {compactCount(r.lots)}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr>
                  <th className={`${thBase} w-10 text-right`}>#</th>
                  <th className={`${thBase} text-left`}>代號／名稱</th>
                  <th className={`${thBase} text-left`}>分類</th>
                  <th scope="col" tabIndex={0}
                      aria-sort={activeMetric === 'flow' ? (dir === 'in' ? 'descending' : 'ascending') : 'none'}
                      onClick={() => onHeaderSort('flow')}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHeaderSort('flow'); } }}
                      className={`${thBase} cursor-pointer text-right select-none hover:text-accent ${activeMetric === 'flow' ? 'text-accent' : ''}`}>
                    {winLabel}估算淨申贖{sortArrow('flow')}
                  </th>
                  <th scope="col" tabIndex={0}
                      aria-sort={activeMetric === 'lots' ? (dir === 'in' ? 'descending' : 'ascending') : 'none'}
                      onClick={() => onHeaderSort('lots')}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHeaderSort('lots'); } }}
                      className={`${thBase} cursor-pointer text-right select-none hover:text-accent ${activeMetric === 'lots' ? 'text-accent' : ''}`}>
                    {winLabel}張數變化{sortArrow('lots')}
                  </th>
                  <th scope="col" tabIndex={0}
                      aria-sort={activeMetric === 'holders' ? (dir === 'in' ? 'descending' : 'ascending') : 'none'}
                      onClick={() => onHeaderSort('holders')}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHeaderSort('holders'); } }}
                      className={`${thBase} cursor-pointer text-right select-none hover:text-accent ${activeMetric === 'holders' ? 'text-accent' : ''}`}>
                    {winLabel}受益人變化{sortArrow('holders')}
                  </th>
                  <th scope="col" tabIndex={0}
                      aria-sort={activeMetric === 'totalHolders' ? (dir === 'in' ? 'descending' : 'ascending') : 'none'}
                      onClick={() => onHeaderSort('totalHolders')}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHeaderSort('totalHolders'); } }}
                      className={`${thBase} cursor-pointer text-right select-none hover:text-accent ${activeMetric === 'totalHolders' ? 'text-accent' : ''}`}>
                    最新受益人{sortArrow('totalHolders')}
                  </th>
                  <th scope="col" tabIndex={0}
                      aria-sort={activeMetric === 'totalLots' ? (dir === 'in' ? 'descending' : 'ascending') : 'none'}
                      onClick={() => onHeaderSort('totalLots')}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHeaderSort('totalLots'); } }}
                      className={`${thBase} cursor-pointer text-right select-none hover:text-accent ${activeMetric === 'totalLots' ? 'text-accent' : ''}`}>
                    最新流通張數{sortArrow('totalLots')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const s = r[activeWin];
                  return (
                    <tr key={r.code} className="hover:bg-hover last:[&>td]:border-b-0">
                      <td className={`${tdBase} text-right font-mono text-[12px] tabular-nums text-faint`}>
                        {i + 1}
                      </td>
                      <td className={tdBase}>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <Link to="/etf" search={{ code: r.code }}
                                className="font-mono font-bold text-accent hover:underline"
                                title={`看 ${r.code} 完整頁面`}>
                            {r.code}
                          </Link>
                          <button type="button" onClick={() => openModal(r.code)}
                                  className="text-left font-medium text-ink hover:text-accent hover:underline"
                                  title="看前十大持股與受益人">
                            {r.name}
                          </button>
                          {s?.split && <SplitBadge split={s.split} />}
                        </div>
                      </td>
                      <td className={`${tdBase} whitespace-nowrap`}>
                        <div className="flex items-center gap-1">
                          <span className="rounded bg-sunken px-1.5 py-0.5 text-[11px] text-muted">{SEC_SHORT[r.sec]}</span>
                          {r.act && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent">主動</span>}
                          {r.freq !== '—' && <FreqPill freq={r.freq} />}
                        </div>
                      </td>
                      <td className={`${tdBase} text-right font-mono tabular-nums whitespace-nowrap`}>
                        {s?.split ? (
                          <span className="text-[12px] font-semibold text-yield">分割失真</span>
                        ) : s?.estFlow != null ? (
                          <span className={`font-semibold ${flowTone(s.estFlow)}`}>
                            {formatFlowYi(s.estFlow)}
                          </span>
                        ) : (
                          <span className="text-na">—</span>
                        )}
                      </td>
                      <td className={`${tdBase} text-right font-mono tabular-nums whitespace-nowrap`}>
                        {s?.split ? (
                          <div>
                            <div className="text-[12px] text-faint">{signedInt(s.dLots)}</div>
                            <div className="text-[10.5px] text-yield">含分割效應</div>
                          </div>
                        ) : s ? (
                          <div>
                            <div className={`font-semibold ${flowTone(s.dLots)}`}>{signedInt(s.dLots)}</div>
                            {s.dLotsPct !== null && (
                              <div className="text-[10.5px] text-faint">{signedPct(s.dLotsPct)}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-na">—</span>
                        )}
                      </td>
                      <td className={`${tdBase} text-right font-mono tabular-nums whitespace-nowrap`}>
                        {s ? (
                          <div>
                            <div className={`font-semibold ${flowTone(s.dHolders)}`}>{signedInt(s.dHolders)}</div>
                            {s.dHoldersPct !== null && (
                              <div className="text-[10.5px] text-faint">{signedPct(s.dHoldersPct)}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-na">—</span>
                        )}
                      </td>
                      <td className={`${tdBase} text-right font-mono tabular-nums whitespace-nowrap text-ink`}>
                        {nf0.format(r.holders)}
                      </td>
                      <td className={`${tdBase} text-right font-mono tabular-nums whitespace-nowrap`}>
                        <div className="text-ink">{nf0.format(r.lots)}</div>
                        <div className="text-[10.5px] text-faint">
                          {r.price !== null ? `收 ${nf2.format(r.price)}` : ''}
                          {r.estAum !== null ? ` · ${formatAum(r.estAum)}` : ''}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasMore && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="h-9 rounded-lg border border-line bg-surface px-4 text-[13px] font-semibold text-accent hover:border-accent hover:bg-accent-soft"
            >
              顯示全部 {sorted.length} 檔（目前前 {DEFAULT_LIMIT} 名）
            </button>
          </div>
        )}
      </div>

      {/* 口徑與限制說明 */}
      <Fold
        className="mt-4"
        summary="估算淨申贖金額＝Δ流通張數 × 最新收盤價 × 1,000（僅為近似估算）；遇分割或反分割會標示並排除於金額排行"
      >
        <p>
          資料來源為集保結算所「集保戶股權分散表」（每週五統計，持股分級 17 合計；截至 {holders.meta.asof}，已累積 {dates.length} 週）
          {priceAsof ? `，估算金額採用交易所收盤價（截至 ${priceAsof}）` : ''}。
          集保僅公布每週流通張數（受益權單位 ÷ 1,000），沒有每日實際申贖價格，故淨申贖金額為收盤價估算值，與投信實際資金進出會有誤差。
        </p>
        <p className="mt-1">
          若比較區間內相鄰有效週的流通張數與人均張數同時劇烈倍增（≥ 1.8× 且人均 ≥ 1.6×）或倍減（≤ 0.55× 且人均 ≤ 0.62×），
          系統會標示為「疑分割／疑反分割」，並將該檔的張數與金額變化排除於申贖金額排行與合計，避免分割造成假流入；受益人數不受分割影響，照常參與人數排行。
        </p>
        <p className="mt-1">
          可搭配對照{' '}
          <Link to="/chips" className="text-accent hover:underline">籌碼頁「定期定額人氣榜（月報）」</Link>
          {' '}與{' '}
          <Link to="/calendar" className="text-accent hover:underline">行事曆「ETF 除息日程」</Link>。
          點代號可進單檔 ETF 頁，點名稱可看前十大持股。本頁統計僅反映已發生的受益人數與單位數變動，僅供參考，不構成投資建議。
        </p>
      </Fold>

      {picked && (
        <Suspense fallback={null}>
          <Top10Modal etf={picked} onClose={closePicked} />
        </Suspense>
      )}
    </div>
  );
}