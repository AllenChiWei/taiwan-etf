/* 持股每日總市值走勢（/dividend?view=value）：
 * 讀取 localStorage 的持股（twetf.holdings）與變動紀錄（twetf.holdingsLog），
 * 僅在切到此分頁時才向 FinMind 抓台股／美股歷史收盤價與美元歷史匯率（每日快取於 localStorage）。
 * 總市值折線與扣掉加減碼的累計損益折線分開繪製，沿用站內手寫 SVG 與既有色票（深淺主題自適應），
 * 手機 390px 維持單欄不撐寬。純計算在 lib/valueHistory.ts 與 lib/holdingsLog.ts。
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useEtfData } from '../context/AppContext';
import { fetchEtfDividends, fetchStockDividends, fetchUsStocks } from '../api/extras';
import {
  fetchTaiexPrices,
  fetchTaiexTotalReturn,
  fetchTwPrices,
  fetchUsPrices,
  fetchUsdTwdHistory,
} from '../api/finmind';
import { fetchUsDataset } from '../api/usEtfs';
import { holdingLinkKind } from '../lib/active';
import type { EtfDividendData, StockDividendData } from '../lib/dividend';
import {
  HOLDINGS_KEY,
  HOLDINGS_LOG_KEY,
  assetKey,
  collectLogAssets,
  parseHoldingsLog,
  resolveHoldingsLog,
  taipeiDate,
  type HoldingsSnapshot,
} from '../lib/holdingsLog';
import { parseStoredHoldings } from '../lib/portfolioXray';
import { deriveUsDividends, type UsPriceRow } from '../lib/usDividend';
import { usStockNameMap, type UsStocksDataset } from '../lib/usStocks';
import {
  buildBenchmarkComparison,
  buildValueHistory,
  type BenchmarkDayPoint,
  type BenchmarkMode,
  type DailyFx,
  type DailyPrice,
  type PeriodChange,
  type ValueDayRow,
  type ValueHoldingChange,
  type ValueRange,
} from '../lib/valueHistory';
import type { UsEtfDataset } from '../types';
import { EmptyState } from './EmptyState';
import { Fold } from './Fold';
import { StockSheet } from './StockSheet';

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const money = (v: number) => nf0.format(Math.round(v));
const signedMoney = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf0.format(Math.abs(Math.round(v)))}`;
const signedPct = (v: number | null) =>
  v === null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf2.format(Math.abs(v))}%`;
const toneClass = (v: number | null | undefined) =>
  v === null || v === undefined ? 'text-muted' : v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink';

/** Y 軸座標縮寫（與試算頁相同口徑，含負號）。 */
function compactMoney(v: number): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(1).replace(/\.0$/, '')}兆`;
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(1).replace(/\.0$/, '')}億`;
  if (a >= 1e4) return `${sign}${nf0.format(Math.round(a / 1e4))}萬`;
  return `${sign}${nf0.format(Math.round(a))}`;
}

/** Y 軸百分比刻度（例如 +10%、0%、−5%，遇到 2.5 等刻度自動保留小數）。 */
function formatAxisPct(v: number): string {
  if (v === 0) return '0%';
  const sign = v > 0 ? '+' : '−';
  const abs = Math.abs(v);
  const digits = Math.abs(abs * 10 - Math.round(abs * 10)) > 1e-4
    ? 2
    : Math.abs(abs - Math.round(abs)) > 1e-4
      ? 1
      : 0;
  return `${sign}${abs.toFixed(digits).replace(/\.0+$/, '')}%`;
}

/** 漂亮 Y 軸刻度（對齊 EquityPage）。 */
function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const rounded = Math.round(v / step) * step;
    out.push(Object.is(rounded, -0) ? 0 : rounded);
  }
  return out.length >= 2 ? out : [lo, (lo + hi) / 2, hi];
}

function estimateLabelWidth(labels: string[], fontSize = 11): number {
  let max = 0;
  for (const s of labels) {
    let w = 0;
    for (const ch of s) w += (ch.charCodeAt(0) < 128 ? 0.62 : 1) * fontSize;
    if (w > max) max = w;
  }
  return Math.ceil(max);
}

function useChartWidth(initial = 340) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    if (!node) return;
    const update = () => {
      const w = Math.floor(node.getBoundingClientRect().width || node.clientWidth);
      if (w > 0) setWidth(prev => (prev === w ? prev : w));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return { ref: setNode, width };
}

function readLocalState(): { holdings: ReturnType<typeof parseStoredHoldings>; log: HoldingsSnapshot[] } {
  try {
    return {
      holdings: parseStoredHoldings(localStorage.getItem(HOLDINGS_KEY)),
      log: parseHoldingsLog(localStorage.getItem(HOLDINGS_LOG_KEY)),
    };
  } catch {
    return { holdings: [], log: [] };
  }
}

function changeSummaryText(c: ValueHoldingChange): string {
  if (c.kind === 'add') return `${c.code} 新增 ${nf0.format(c.after)} 股`;
  if (c.kind === 'remove') return `${c.code} 清倉 −${nf0.format(c.before)} 股`;
  const sign = c.delta > 0 ? '+' : '−';
  return `${c.code} ${sign}${nf0.format(Math.abs(c.delta))} 股`;
}

function StatCard({ label, value, sub, valueClass = 'text-ink', className }: {
  label: string;
  value: string;
  sub?: ReactNode;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5 ${className ?? ''}`}>
      <div className="truncate text-[11.5px] text-muted">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-[15.5px] font-bold tabular-nums sm:text-[17px] ${valueClass}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 break-words text-[11px] leading-snug text-faint">{sub}</div>}
    </div>
  );
}

function periodSub(p: PeriodChange | null, emptyText: string): string {
  if (!p) return emptyText;
  const parts = [signedPct(p.retPct), `自 ${p.fromDate.slice(5).replace('-', '/')}`];
  if (p.hasFlow) parts.push(`含加減碼 ${signedMoney(p.valueDiff)}`);
  return parts.join('・');
}

const VALUE_COLOR = 'var(--cat-1)';
const BENCH_COLOR = 'var(--cat-2)';
const CHANGE_DOT = 'var(--cat-2)';

/** 圖一：每日總市值折線（估算區間虛線、實際紀錄實線、加減碼日可點標記點） */
function ValueLineChart({
  rows,
  activeIdx,
  pinnedIdx,
  onHover,
  onPin,
}: {
  rows: readonly ValueDayRow[];
  activeIdx: number;
  pinnedIdx: number | null;
  onHover: (idx: number | null) => void;
  onPin: (idx: number) => void;
}) {
  const { ref, width: W } = useChartWidth(340);
  const H = 270;
  const FONT = 11;

  const { lo, hi, yTicks } = useMemo(() => {
    let minV = Infinity;
    let maxV = -Infinity;
    for (const r of rows) {
      if (r.totalValue < minV) minV = r.totalValue;
      if (r.totalValue > maxV) maxV = r.totalValue;
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
      return { lo: 0, hi: 100, yTicks: [0, 50, 100] };
    }
    const span = maxV - minV;
    const pad = span > 0 ? span * 0.08 : Math.max(1000, maxV * 0.08 || 1000);
    const y0 = Math.max(0, minV - pad);
    const y1 = maxV + pad;
    return { lo: y0, hi: y1, yTicks: niceTicks(y0, y1, 4) };
  }, [rows]);

  const xTicks = useMemo(() => {
    const last = rows.length - 1;
    if (last <= 0) return [0];
    const steps = W >= 720 && rows.length >= 20 ? 4 : 2;
    const out: number[] = [];
    for (let k = 0; k <= steps; k++) {
      const idx = Math.round((last * k) / steps);
      if (out[out.length - 1] !== idx) out.push(idx);
    }
    return out;
  }, [rows.length, W]);

  if (rows.length < 2) {
    return (
      <div ref={ref} className="mt-2 w-full min-w-0 overflow-hidden">
        <p className="py-10 text-center text-[12.5px] text-muted">交易日數不足 2 天，暫無法繪製總市值曲線。</p>
      </div>
    );
  }

  const labelW = estimateLabelWidth(yTicks.map(compactMoney), FONT);
  const PAD = { top: 12, right: 10, bottom: 22, left: Math.max(36, labelW + 8) };
  const plotW = Math.max(40, W - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (rows.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;

  // 拆成估算（虛線）與實際（實線）；交界處相連不斷裂
  let estPath = '';
  let actualPath = '';
  let actualStartIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const pt = `${x(i).toFixed(1)},${y(rows[i].totalValue).toFixed(1)}`;
    if (rows[i].estimated) {
      estPath += `${estPath ? 'L' : 'M'}${pt}`;
    } else {
      if (actualStartIdx === -1) {
        actualStartIdx = i;
        if (estPath) estPath += `L${pt}`;
      }
      actualPath += `${actualPath ? 'L' : 'M'}${pt}`;
    }
  }

  const cur = rows[Math.max(0, Math.min(rows.length - 1, activeIdx))];
  const pickIndex = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / (rect.width || 1)) * W;
    const raw = ((px - PAD.left) / plotW) * (rows.length - 1);
    return Math.max(0, Math.min(rows.length - 1, Math.round(raw)));
  };

  return (
    <div ref={ref} className="mt-2 w-full min-w-0 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ height: H }}
        className="block w-full touch-pan-y select-none"
        role="img"
        aria-label="持股每日總市值走勢圖"
        onMouseLeave={() => onHover(null)}
        onMouseMove={e => onHover(pickIndex(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onClick={e => onPin(pickIndex(e.clientX, e.currentTarget.getBoundingClientRect()))}
      >
        {yTicks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
                  stroke="var(--c-border)" strokeWidth={1} opacity={0.65} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={FONT} fill="var(--c-faint)">
              {compactMoney(t)}
            </text>
          </g>
        ))}

        {/* 若視窗同時含估算與實際區間，在開始記錄日畫分界線 */}
        {actualStartIdx > 0 && (
          <g>
            <line x1={x(actualStartIdx)} x2={x(actualStartIdx)} y1={PAD.top} y2={H - PAD.bottom}
                  stroke="var(--c-border-strong)" strokeDasharray="3 3" strokeWidth={1} />
            <text x={Math.min(W - PAD.right - 2, x(actualStartIdx) + 4)} y={PAD.top + 10}
                  fontSize={10} fill="var(--c-faint)">開始記錄</text>
          </g>
        )}

        {estPath && (
          <path d={estPath} fill="none" stroke={VALUE_COLOR} strokeWidth={1.8}
                strokeDasharray="5 4" strokeLinejoin="round" opacity={0.85} />
        )}
        {actualPath && (
          <path d={actualPath} fill="none" stroke={VALUE_COLOR} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />
        )}

        {xTicks.map(i => (
          <text key={i} x={x(i)} y={H - 5}
                textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}
                fontSize={FONT} fill="var(--c-faint)">
            {rows[i].date}
          </text>
        ))}

        {/* 準線與目前檢視點 */}
        <line x1={x(activeIdx)} x2={x(activeIdx)} y1={PAD.top} y2={H - PAD.bottom}
              stroke="var(--c-border-strong)" strokeWidth={1} strokeDasharray="3 3" />
        <circle cx={x(activeIdx)} cy={y(cur.totalValue)} r={4}
                fill={VALUE_COLOR} stroke="var(--c-surface)" strokeWidth={2} />

        {/* 加減碼日標記點（點了鎖定當天並顯示變動明細） */}
        {rows.map((r, i) => {
          if (r.changes.length === 0) return null;
          const pinned = pinnedIdx === i;
          return (
            <g key={r.date}>
              <circle
                cx={x(i)} cy={y(r.totalValue)}
                r={pinned ? 6 : 4.5}
                fill={CHANGE_DOT}
                stroke="var(--c-surface)"
                strokeWidth={2}
              />
              <circle
                cx={x(i)} cy={y(r.totalValue)} r={12}
                fill="transparent"
                className="cursor-pointer"
                onClick={e => { e.stopPropagation(); onPin(i); }}
              >
                <title>{`${r.date} 加減碼：${r.changes.map(changeSummaryText).join('、')}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        <span className="font-mono font-semibold text-ink">
          {cur.date}
          {cur.estimated && (
            <span className="ml-1 rounded bg-sunken px-1 py-0.5 font-sans text-[10px] font-semibold text-muted">估算</span>
          )}
        </span>
        <span>
          總市值 <strong className="font-mono tabular-nums text-ink">{money(cur.totalValue)} 元</strong>
        </span>
        <span>
          當日損益{' '}
          <strong className={`font-mono tabular-nums ${toneClass(cur.dailyPnl)}`}>
            {signedMoney(cur.dailyPnl)} 元
          </strong>
          {cur.dailyRetPct !== null && (
            <span className={`ml-1 font-mono text-[11px] tabular-nums ${toneClass(cur.dailyRetPct)}`}>
              ({signedPct(cur.dailyRetPct)})
            </span>
          )}
        </span>
        {cur.changes.length > 0 && (
          <span className="inline-flex items-center gap-1 text-ink">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: CHANGE_DOT }} />
            加減碼估 {signedMoney(cur.netFlow)} 元
          </span>
        )}
      </div>
    </div>
  );
}

/** 圖二：累計損益折線（扣掉加減碼；零軸上方紅、下方綠，估算區間虛線） */
function PnlLineChart({
  rows,
  activeIdx,
  pinnedIdx,
  onHover,
  onPin,
}: {
  rows: readonly ValueDayRow[];
  activeIdx: number;
  pinnedIdx: number | null;
  onHover: (idx: number | null) => void;
  onPin: (idx: number) => void;
}) {
  const { ref, width: W } = useChartWidth(340);
  const clipBase = useId();
  const H = 260;
  const FONT = 11;

  const { lo, hi, yTicks } = useMemo(() => {
    let minV = 0;
    let maxV = 0;
    for (const r of rows) {
      if (r.cumPnl < minV) minV = r.cumPnl;
      if (r.cumPnl > maxV) maxV = r.cumPnl;
    }
    const span = maxV - minV;
    const pad = span > 0 ? span * 0.1 : 1000;
    const y0 = minV - pad;
    const y1 = maxV + pad;
    const ts = niceTicks(y0, y1, 4);
    if (!ts.includes(0)) ts.push(0);
    ts.sort((a, b) => a - b);
    return { lo: y0, hi: y1, yTicks: ts };
  }, [rows]);

  const xTicks = useMemo(() => {
    const last = rows.length - 1;
    if (last <= 0) return [0];
    const steps = W >= 720 && rows.length >= 20 ? 4 : 2;
    const out: number[] = [];
    for (let k = 0; k <= steps; k++) {
      const idx = Math.round((last * k) / steps);
      if (out[out.length - 1] !== idx) out.push(idx);
    }
    return out;
  }, [rows.length, W]);

  if (rows.length < 2) {
    return (
      <div ref={ref} className="mt-2 w-full min-w-0 overflow-hidden">
        <p className="py-10 text-center text-[12.5px] text-muted">交易日數不足 2 天，暫無法繪製累計損益曲線。</p>
      </div>
    );
  }

  const labelW = estimateLabelWidth(yTicks.map(compactMoney), FONT);
  const PAD = { top: 12, right: 10, bottom: 22, left: Math.max(36, labelW + 8) };
  const plotW = Math.max(40, W - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (rows.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const zeroY = y(0);

  let fullPath = '';
  let estPath = '';
  let actualPath = '';
  let actualStarted = false;
  for (let i = 0; i < rows.length; i++) {
    const pt = `${x(i).toFixed(1)},${y(rows[i].cumPnl).toFixed(1)}`;
    fullPath += `${i ? 'L' : 'M'}${pt}`;
    if (rows[i].estimated) {
      estPath += `${estPath ? 'L' : 'M'}${pt}`;
    } else {
      if (!actualStarted) {
        actualStarted = true;
        if (estPath) estPath += `L${pt}`;
      }
      actualPath += `${actualPath ? 'L' : 'M'}${pt}`;
    }
  }
  const areaPath = `${fullPath}L${x(rows.length - 1).toFixed(1)},${zeroY.toFixed(1)}L${x(0).toFixed(1)},${zeroY.toFixed(1)}Z`;
  const cur = rows[Math.max(0, Math.min(rows.length - 1, activeIdx))];

  const aboveId = `${clipBase}-up`;
  const belowId = `${clipBase}-dn`;
  const pickIndex = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / (rect.width || 1)) * W;
    const raw = ((px - PAD.left) / plotW) * (rows.length - 1);
    return Math.max(0, Math.min(rows.length - 1, Math.round(raw)));
  };

  return (
    <div ref={ref} className="mt-2 w-full min-w-0 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ height: H }}
        className="block w-full touch-pan-y select-none"
        role="img"
        aria-label="扣掉加減碼累計損益走勢圖"
        onMouseLeave={() => onHover(null)}
        onMouseMove={e => onHover(pickIndex(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onClick={e => onPin(pickIndex(e.clientX, e.currentTarget.getBoundingClientRect()))}
      >
        <defs>
          <clipPath id={aboveId}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={Math.max(0, zeroY - PAD.top)} />
          </clipPath>
          <clipPath id={belowId}>
            <rect x={PAD.left} y={zeroY} width={plotW} height={Math.max(0, H - PAD.bottom - zeroY)} />
          </clipPath>
        </defs>

        {yTicks.map(t => (
          <g key={t}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
              stroke={t === 0 ? 'var(--c-border-strong)' : 'var(--c-border)'}
              strokeWidth={t === 0 ? 1.2 : 1}
              strokeDasharray={t === 0 ? '4 4' : undefined}
              opacity={t === 0 ? 0.9 : 0.6}
            />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={FONT} fill="var(--c-faint)">
              {t === 0 ? '0' : compactMoney(t)}
            </text>
          </g>
        ))}

        {/* 零軸上方紅、零軸下方綠（台股紅漲綠跌慣例） */}
        <g clipPath={`url(#${aboveId})`}>
          <path d={areaPath} fill="var(--c-up)" opacity={0.12} />
          {estPath && (
            <path d={estPath} fill="none" stroke="var(--c-up)" strokeWidth={1.8}
                  strokeDasharray="5 4" strokeLinejoin="round" />
          )}
          {actualPath && (
            <path d={actualPath} fill="none" stroke="var(--c-up)" strokeWidth={2}
                  strokeLinejoin="round" strokeLinecap="round" />
          )}
        </g>
        <g clipPath={`url(#${belowId})`}>
          <path d={areaPath} fill="var(--c-down)" opacity={0.12} />
          {estPath && (
            <path d={estPath} fill="none" stroke="var(--c-down)" strokeWidth={1.8}
                  strokeDasharray="5 4" strokeLinejoin="round" />
          )}
          {actualPath && (
            <path d={actualPath} fill="none" stroke="var(--c-down)" strokeWidth={2}
                  strokeLinejoin="round" strokeLinecap="round" />
          )}
        </g>

        {xTicks.map(i => (
          <text key={i} x={x(i)} y={H - 5}
                textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}
                fontSize={FONT} fill="var(--c-faint)">
            {rows[i].date}
          </text>
        ))}

        <line x1={x(activeIdx)} x2={x(activeIdx)} y1={PAD.top} y2={H - PAD.bottom}
              stroke="var(--c-border-strong)" strokeWidth={1} strokeDasharray="3 3" />
        <circle
          cx={x(activeIdx)} cy={y(cur.cumPnl)} r={4}
          fill={cur.cumPnl >= 0 ? 'var(--c-up)' : 'var(--c-down)'}
          stroke="var(--c-surface)" strokeWidth={2}
        />

        {rows.map((r, i) => {
          if (r.changes.length === 0) return null;
          return (
            <circle
              key={r.date}
              cx={x(i)} cy={y(r.cumPnl)}
              r={pinnedIdx === i ? 5 : 3.5}
              fill={CHANGE_DOT}
              stroke="var(--c-surface)"
              strokeWidth={1.5}
              className="cursor-pointer"
              onClick={e => { e.stopPropagation(); onPin(i); }}
            >
              <title>{`${r.date} 加減碼：${r.changes.map(changeSummaryText).join('、')}`}</title>
            </circle>
          );
        })}
      </svg>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        <span className="font-mono font-semibold text-ink">{cur.date}</span>
        <span>
          區間累計損益{' '}
          <strong className={`font-mono tabular-nums ${toneClass(cur.cumPnl)}`}>
            {signedMoney(cur.cumPnl)} 元
          </strong>
        </span>
        <span>
          時間加權報酬{' '}
          <strong className={`font-mono tabular-nums ${toneClass(cur.cumRetPct)}`}>
            {signedPct(cur.cumRetPct)}
          </strong>
        </span>
      </div>
    </div>
  );
}

/** 圖三：報酬比較折線（我的持股 TWR vs 加權指數／加權報酬指數，同區間自 0% 起算） */
function ReturnCompareChart({
  points,
  benchLabel,
  activeRowIdx,
  onHoverRow,
  onPinRow,
}: {
  points: readonly BenchmarkDayPoint[];
  benchLabel: string;
  activeRowIdx: number;
  onHoverRow: (rowIdx: number | null) => void;
  onPinRow: (rowIdx: number) => void;
}) {
  const { ref, width: W } = useChartWidth(340);
  const H = 260;
  const FONT = 11;

  const { lo, hi, yTicks } = useMemo(() => {
    let minV = 0;
    let maxV = 0;
    for (const p of points) {
      if (p.portfolioRetPct < minV) minV = p.portfolioRetPct;
      if (p.portfolioRetPct > maxV) maxV = p.portfolioRetPct;
      if (p.benchmarkRetPct < minV) minV = p.benchmarkRetPct;
      if (p.benchmarkRetPct > maxV) maxV = p.benchmarkRetPct;
    }
    const span = maxV - minV;
    const pad = span > 0 ? span * 0.1 : 2;
    const y0 = minV - pad;
    const y1 = maxV + pad;
    const ts = niceTicks(y0, y1, 4);
    if (!ts.includes(0)) ts.push(0);
    ts.sort((a, b) => a - b);
    return { lo: y0, hi: y1, yTicks: ts };
  }, [points]);

  const xTicks = useMemo(() => {
    const last = points.length - 1;
    if (last <= 0) return [0];
    const steps = W >= 720 && points.length >= 20 ? 4 : 2;
    const out: number[] = [];
    for (let k = 0; k <= steps; k++) {
      const idx = Math.round((last * k) / steps);
      if (out[out.length - 1] !== idx) out.push(idx);
    }
    return out;
  }, [points.length, W]);

  const activePointIdx = useMemo(() => {
    if (points.length === 0) return 0;
    const exact = points.findIndex(p => p.rowIndex === activeRowIdx);
    if (exact >= 0) return exact;
    return activeRowIdx < points[0].rowIndex ? 0 : points.length - 1;
  }, [points, activeRowIdx]);

  if (points.length < 2) {
    return (
      <div ref={ref} className="mt-2 w-full min-w-0 overflow-hidden">
        <p className="py-10 text-center text-[12.5px] text-muted">交易日數不足 2 天，暫無法繪製報酬比較曲線。</p>
      </div>
    );
  }

  const labelW = estimateLabelWidth(yTicks.map(formatAxisPct), FONT);
  const PAD = { top: 12, right: 10, bottom: 22, left: Math.max(40, labelW + 8) };
  const plotW = Math.max(40, W - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;

  let benchPath = '';
  let portEstPath = '';
  let portActualPath = '';
  let actualStartIdx = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const bPt = `${x(i).toFixed(1)},${y(p.benchmarkRetPct).toFixed(1)}`;
    benchPath += `${i ? 'L' : 'M'}${bPt}`;

    const pPt = `${x(i).toFixed(1)},${y(p.portfolioRetPct).toFixed(1)}`;
    if (p.estimated) {
      portEstPath += `${portEstPath ? 'L' : 'M'}${pPt}`;
    } else {
      if (actualStartIdx === -1) {
        actualStartIdx = i;
        if (portEstPath) portEstPath += `L${pPt}`;
      }
      portActualPath += `${portActualPath ? 'L' : 'M'}${pPt}`;
    }
  }

  const cur = points[activePointIdx];
  const pickPointIdx = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / (rect.width || 1)) * W;
    const raw = ((px - PAD.left) / plotW) * (points.length - 1);
    return Math.max(0, Math.min(points.length - 1, Math.round(raw)));
  };

  return (
    <div ref={ref} className="mt-2 w-full min-w-0 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ height: H }}
        className="block w-full touch-pan-y select-none"
        role="img"
        aria-label={`持股時間加權報酬與${benchLabel}報酬比較圖`}
        onMouseLeave={() => onHoverRow(null)}
        onMouseMove={e => onHoverRow(points[pickPointIdx(e.clientX, e.currentTarget.getBoundingClientRect())].rowIndex)}
        onClick={e => onPinRow(points[pickPointIdx(e.clientX, e.currentTarget.getBoundingClientRect())].rowIndex)}
      >
        {yTicks.map(t => (
          <g key={t}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
              stroke={t === 0 ? 'var(--c-border-strong)' : 'var(--c-border)'}
              strokeWidth={t === 0 ? 1.2 : 1}
              strokeDasharray={t === 0 ? '4 4' : undefined}
              opacity={t === 0 ? 0.9 : 0.6}
            />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={FONT} fill="var(--c-faint)">
              {formatAxisPct(t)}
            </text>
          </g>
        ))}

        {actualStartIdx > 0 && (
          <g>
            <line x1={x(actualStartIdx)} x2={x(actualStartIdx)} y1={PAD.top} y2={H - PAD.bottom}
                  stroke="var(--c-border-strong)" strokeDasharray="3 3" strokeWidth={1} />
            <text x={Math.min(W - PAD.right - 2, x(actualStartIdx) + 4)} y={PAD.top + 10}
                  fontSize={10} fill="var(--c-faint)">開始記錄</text>
          </g>
        )}

        <path d={benchPath} fill="none" stroke={BENCH_COLOR} strokeWidth={1.8}
              strokeLinejoin="round" strokeLinecap="round" opacity={0.92} />

        {portEstPath && (
          <path d={portEstPath} fill="none" stroke={VALUE_COLOR} strokeWidth={1.8}
                strokeDasharray="5 4" strokeLinejoin="round" opacity={0.85} />
        )}
        {portActualPath && (
          <path d={portActualPath} fill="none" stroke={VALUE_COLOR} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />
        )}

        {xTicks.map(i => (
          <text key={i} x={x(i)} y={H - 5}
                textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                fontSize={FONT} fill="var(--c-faint)">
            {points[i].date}
          </text>
        ))}

        <line x1={x(activePointIdx)} x2={x(activePointIdx)} y1={PAD.top} y2={H - PAD.bottom}
              stroke="var(--c-border-strong)" strokeWidth={1} strokeDasharray="3 3" />
        <circle cx={x(activePointIdx)} cy={y(cur.benchmarkRetPct)} r={3.5}
                fill={BENCH_COLOR} stroke="var(--c-surface)" strokeWidth={1.5} />
        <circle cx={x(activePointIdx)} cy={y(cur.portfolioRetPct)} r={4}
                fill={VALUE_COLOR} stroke="var(--c-surface)" strokeWidth={2} />
      </svg>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        <span className="font-mono font-semibold text-ink">
          {cur.date}
          {cur.estimated && (
            <span className="ml-1 rounded bg-sunken px-1 py-0.5 font-sans text-[10px] font-semibold text-muted">估算</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: VALUE_COLOR }} />
          我的持股{' '}
          <strong className={`font-mono tabular-nums ${toneClass(cur.portfolioRetPct)}`}>
            {signedPct(cur.portfolioRetPct)}
          </strong>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: BENCH_COLOR }} />
          {benchLabel}{' '}
          <strong className={`font-mono tabular-nums ${toneClass(cur.benchmarkRetPct)}`}>
            {signedPct(cur.benchmarkRetPct)}
          </strong>
          {cur.benchmarkFilled && (
            <span className="text-[10.5px] text-faint">（補前值）</span>
          )}
        </span>
        <span>
          超額{' '}
          <strong className={`font-mono tabular-nums ${toneClass(cur.excessRetPct)}`}>
            {signedPct(cur.excessRetPct)}
          </strong>
        </span>
      </div>
    </div>
  );
}

const RANGES: ReadonlyArray<{ id: ValueRange; label: string }> = [
  { id: '3m', label: '近 3 月' },
  { id: '6m', label: '近 6 月' },
  { id: '1y', label: '近 1 年' },
];

export function PortfolioValue({ onGoPlan }: { onGoPlan: () => void }) {
  const etfData = useEtfData();
  const [local, setLocal] = useState(readLocalState);
  const [range, setRange] = useState<ValueRange>('1y');
  const [retryTick, setRetryTick] = useState(0);

  // 歷史日價、匯率、標的名稱與配息（皆在進入本分頁後才載入）
  const [twPrices, setTwPrices] = useState<Map<string, DailyPrice[]>>(() => new Map());
  const [usPrices, setUsPrices] = useState<Map<string, UsPriceRow[]>>(() => new Map());
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());
  const [fxState, setFxState] = useState<{ rows: DailyFx[]; stale: boolean } | null | 'error'>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [stockDivs, setStockDivs] = useState<StockDividendData | null>(null);
  const [etfDivs, setEtfDivs] = useState<EtfDividendData | null>(null);
  const [usDataset, setUsDataset] = useState<UsEtfDataset | null>(null);
  const [usStocks, setUsStocks] = useState<UsStocksDataset | null>(null);

  // 加權指數（未含息／含息報酬指數）比較狀態，僅進入本分頁且有持股時抓
  const [benchMode, setBenchMode] = useState<BenchmarkMode>('price');
  const [taiexPrices, setTaiexPrices] = useState<DailyPrice[]>([]);
  const [taiexLoading, setTaiexLoading] = useState(false);
  const [taiexError, setTaiexError] = useState<string | null>(null);
  const [taiexRetryTick, setTaiexRetryTick] = useState(0);
  const [taiexTrPrices, setTaiexTrPrices] = useState<DailyPrice[]>([]);
  const [taiexTrLoading, setTaiexTrLoading] = useState(false);
  const [taiexTrError, setTaiexTrError] = useState<string | null>(null);
  const [taiexTrRetryTick, setTaiexTrRetryTick] = useState(0);

  // 圖表互動與明細表狀態
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [sheet, setSheet] = useState<{ code: string; name?: string } | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const pickStock = useCallback((code: string, name?: string) => setSheet({ code, name }), []);

  // 跨分頁修改持股或紀錄時同步重讀
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === HOLDINGS_KEY || e.key === HOLDINGS_LOG_KEY || e.key === null) {
        setLocal(readLocalState());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const today = taipeiDate();
  const resolvedLog = useMemo(
    () => resolveHoldingsLog(local.log, local.holdings, today),
    [local.log, local.holdings, today],
  );
  const assets = useMemo(() => collectLogAssets(resolvedLog), [resolvedLog]);
  const assetsKey = useMemo(() => assets.map(a => a.key).sort().join(','), [assets]);

  const twCodes = useMemo(() => assets.filter(a => a.m !== 'us').map(a => a.code), [assets]);
  const usCodes = useMemo(() => assets.filter(a => a.m === 'us').map(a => a.code), [assets]);
  const etfCodeSet = useMemo(() => new Set(etfData.etfs.map(e => e.code)), [etfData.etfs]);
  const hasTwEtf = useMemo(() => twCodes.some(c => etfCodeSet.has(c)), [twCodes, etfCodeSet]);
  const hasTwStock = useMemo(() => twCodes.some(c => !etfCodeSet.has(c)), [twCodes, etfCodeSet]);
  const hasUsEtf = useMemo(() => assets.some(a => a.m === 'us' && a.k !== 'stock'), [assets]);
  const hasUsStock = useMemo(() => assets.some(a => a.m === 'us' && a.k === 'stock'), [assets]);

  const totalRequests = twCodes.length + usCodes.length + (usCodes.length > 0 ? 1 : 0);

  // 按需抓取台美股歷史收盤價與美元歷史匯率
  useEffect(() => {
    if (assets.length === 0) return;
    const ac = new AbortController();
    setDoneCount(0);
    setErrors(new Map());
    if (usCodes.length > 0) setFxState(null);

    const markDone = () => {
      if (!ac.signal.aborted) setDoneCount(n => n + 1);
    };

    for (const code of twCodes) {
      const key = assetKey(code);
      fetchTwPrices(code, ac.signal)
        .then(list => {
          if (ac.signal.aborted) return;
          if (list.length > 0) {
            setTwPrices(prev => new Map(prev).set(code, list));
          } else {
            setErrors(prev => new Map(prev).set(key, 'FinMind 查無歷史收盤價'));
          }
        })
        .catch((err: unknown) => {
          if (ac.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          setErrors(prev => new Map(prev).set(key, msg));
        })
        .finally(markDone);
    }

    for (const code of usCodes) {
      const key = assetKey(code, 'us');
      fetchUsPrices(code)
        .then(list => {
          if (ac.signal.aborted) return;
          if (list.length > 0) {
            setUsPrices(prev => new Map(prev).set(code, list));
          } else {
            setErrors(prev => new Map(prev).set(key, 'FinMind 查無美股歷史價'));
          }
        })
        .catch((err: unknown) => {
          if (ac.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          setErrors(prev => new Map(prev).set(key, msg));
        })
        .finally(markDone);
    }

    if (usCodes.length > 0) {
      fetchUsdTwdHistory(ac.signal)
        .then(res => { if (!ac.signal.aborted) setFxState(res); })
        .catch(() => { if (!ac.signal.aborted) setFxState('error'); })
        .finally(markDone);
    }

    return () => ac.abort();
  }, [assetsKey, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasAssets = assets.length > 0;

  // 加權指數（未含息）：僅進入本分頁且有持股時向 FinMind 抓取（每日快取）
  useEffect(() => {
    if (!hasAssets) return;
    const ac = new AbortController();
    setTaiexLoading(true);
    setTaiexError(null);
    fetchTaiexPrices(ac.signal)
      .then(list => {
        if (ac.signal.aborted) return;
        if (list.length > 0) {
          setTaiexPrices(list);
        } else {
          setTaiexError('FinMind 查無加權指數資料');
        }
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setTaiexError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setTaiexLoading(false);
      });
    return () => ac.abort();
  }, [hasAssets, taiexRetryTick]);

  // 加權報酬指數（含息）：僅在使用者切換時按需向 FinMind 抓取（每日快取）
  useEffect(() => {
    if (!hasAssets || benchMode !== 'tr') return;
    const ac = new AbortController();
    setTaiexTrLoading(true);
    setTaiexTrError(null);
    fetchTaiexTotalReturn(ac.signal)
      .then(list => {
        if (ac.signal.aborted) return;
        if (list.length > 0) {
          setTaiexTrPrices(list);
        } else {
          setTaiexTrError('FinMind 查無加權報酬指數（含息）資料');
        }
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setTaiexTrError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setTaiexTrLoading(false);
      });
    return () => ac.abort();
  }, [hasAssets, benchMode, taiexTrRetryTick]);

  // 背景載入標的名稱與配息（容許缺檔，不阻塞走勢圖）
  useEffect(() => {
    if (assets.length === 0) return;
    const ac = new AbortController();
    if (hasTwEtf) {
      fetchEtfDividends(ac.signal).then(d => { if (!ac.signal.aborted) setEtfDivs(d); }).catch(() => {});
    }
    if (hasTwStock) {
      fetchStockDividends(ac.signal).then(d => { if (!ac.signal.aborted) setStockDivs(d); }).catch(() => {});
    }
    if (hasUsEtf) {
      fetchUsDataset(ac.signal).then(d => { if (!ac.signal.aborted) setUsDataset(d); }).catch(() => {});
    }
    if (hasUsStock) {
      fetchUsStocks().then(d => { if (!ac.signal.aborted && d) setUsStocks(d); }).catch(() => {});
    }
    return () => ac.abort();
  }, [assetsKey, hasTwEtf, hasTwStock, hasUsEtf, hasUsStock]); // eslint-disable-line react-hooks/exhaustive-deps

  // 切換期間時清掉舊的索引鎖定，避免越界
  useEffect(() => {
    setHoverIdx(null);
    setPinnedIdx(null);
  }, [range]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of etfData.etfs) m.set(assetKey(e.code), e.name);
    if (stockDivs) {
      for (const [c, s] of Object.entries(stockDivs.stocks)) {
        const k = assetKey(c);
        if (!m.has(k)) m.set(k, s.n);
      }
    }
    if (usDataset) {
      for (const e of usDataset.etfs) m.set(assetKey(e.code, 'us'), e.name);
    }
    const usStockNames = usStockNameMap(usStocks);
    for (const [c, n] of usStockNames) {
      const k = assetKey(c, 'us');
      if (!m.has(k)) m.set(k, n);
    }
    return m;
  }, [etfData.etfs, stockDivs, usDataset, usStocks]);

  const usDailyPrices = useMemo(() => {
    const m = new Map<string, DailyPrice[]>();
    for (const [code, rows] of usPrices) {
      m.set(code, rows.map(r => ({ date: r.date, close: r.Close })));
    }
    return m;
  }, [usPrices]);

  const dividendsMap = useMemo(() => {
    const m = new Map<string, ReadonlyArray<readonly [string, number]>>();
    let hasAny = false;
    if (etfDivs) {
      hasAny = true;
      for (const c of twCodes) {
        const ev = etfDivs.dividends[c];
        if (ev?.length) m.set(assetKey(c), ev.map(([d, cash]) => [d, cash] as const));
      }
    }
    if (stockDivs) {
      hasAny = true;
      for (const c of twCodes) {
        const k = assetKey(c);
        if (m.has(k)) continue;
        const ev = stockDivs.stocks[c]?.ev;
        if (ev?.length) m.set(k, ev.map(([d, cash]) => [d, cash] as const));
      }
    }
    for (const [code, rows] of usPrices) {
      const ev = deriveUsDividends(rows);
      if (ev.length) {
        hasAny = true;
        m.set(assetKey(code, 'us'), ev);
      }
    }
    return hasAny ? m : undefined;
  }, [etfDivs, stockDivs, twCodes, usPrices]);

  const fxHistory = useMemo(
    () => (fxState && fxState !== 'error' ? fxState.rows : []),
    [fxState],
  );
  const fxStale = fxState !== null && fxState !== 'error' && fxState.stale;

  const history = useMemo(
    () => buildValueHistory({
      log: resolvedLog,
      twPrices,
      usPrices: usDailyPrices,
      fxHistory,
      names,
      dividends: dividendsMap,
      range,
      errors,
    }),
    [resolvedLog, twPrices, usDailyPrices, fxHistory, names, dividendsMap, range, errors],
  );

  const loadingPrices = totalRequests > 0 && doneCount < totalRequests;
  const rows = history.rows;
  const activeBenchPrices = benchMode === 'tr' ? taiexTrPrices : taiexPrices;
  const benchLoading = benchMode === 'tr' ? taiexTrLoading : taiexLoading;
  const benchError = benchMode === 'tr' ? taiexTrError : taiexError;
  const benchName = benchMode === 'tr' ? '加權報酬指數（含息）' : '加權指數';
  const benchShort = benchMode === 'tr' ? '加權含息' : '加權';
  const comparison = useMemo(
    () => buildBenchmarkComparison(rows, activeBenchPrices),
    [rows, activeBenchPrices],
  );
  const rangeLabel = range === 'all' ? '全部' : (RANGES.find(r => r.id === range)?.label ?? '近 1 年');
  const retryBenchmark = useCallback(() => {
    if (benchMode === 'tr') setTaiexTrRetryTick(n => n + 1);
    else setTaiexRetryTick(n => n + 1);
  }, [benchMode]);

  const lastIdx = Math.max(0, rows.length - 1);
  const safePinned = pinnedIdx !== null && pinnedIdx < rows.length ? pinnedIdx : null;
  const activeIdx = hoverIdx !== null && hoverIdx < rows.length
    ? hoverIdx
    : (safePinned ?? lastIdx);
  const pinnedRow = safePinned !== null ? rows[safePinned] : null;

  const togglePin = useCallback((idx: number) => {
    setPinnedIdx(prev => (prev === idx ? null : idx));
  }, []);

  const tableSource = useMemo(() => {
    const list = onlyChanges ? history.changeDays : rows;
    return [...list].reverse();
  }, [onlyChanges, history.changeDays, rows]);

  if (resolvedLog.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-line bg-surface px-4 pb-8">
        <EmptyState
          icon="📈"
          title="還沒有持股紀錄"
          hint="在「配息試算」加入持股後，這裡會自動追蹤每日總市值與扣掉加減碼的累計損益走勢，並以目前持股往回估算近一年。"
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

  const rangeOptions = history.hasOverOneYear
    ? [...RANGES, { id: 'all' as const, label: '全部' }]
    : RANGES;

  const shownRows = showAllRows ? tableSource : tableSource.slice(0, 30);

  const hasErrors = errors.size > 0 || fxState === 'error';
  const showDivCard = history.estDividends !== null && history.estDividends > 0;

  return (
    <div className="mt-3 min-w-0">
      {/* 載入進度與估算區間標示 */}
      {loadingPrices && (
        <p className="mb-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-muted">
          載入歷史收盤價與匯率中（{doneCount} / {totalRequests}）…
        </p>
      )}

      {history.hasEstimated && rows.length > 0 && (
        <div className="mb-2.5 rounded-lg border border-line bg-sunken px-3 py-2 text-[12px] leading-relaxed text-muted">
          <strong className="text-ink">估算（以目前持股回推）</strong>：
          {history.allEstimated
            ? `尚未累積多日持股變動紀錄（記錄起點 ${history.logStartDate}），此區間以目前持股往回推算每日總市值；之後每次在配息試算調整持股皆會自動記下當日快照。`
            : `自 ${history.logStartDate} 起為實際持股紀錄（實線），之前為以首次記錄持股往回推算之估算區間（虛線）。`}
          {history.pendingLogDate && (
            <span className="mt-1 block text-[11.5px] text-faint">
              註：{history.pendingLogDate} 的最新持股變動將於下個交易日收盤後反映在走勢中。
            </span>
          )}
        </div>
      )}

      {!history.hasEstimated && history.pendingLogDate && (
        <p className="mb-2.5 rounded-lg bg-sunken px-3 py-1.5 text-[11.5px] text-muted">
          {history.pendingLogDate} 的最新持股變動將於下個交易日收盤後反映在走勢中。
        </p>
      )}

      {/* 頂部總覽卡片 */}
      <div className={`grid grid-cols-2 gap-2.5 sm:grid-cols-4 ${showDivCard ? 'xl:grid-cols-6' : 'lg:grid-cols-5'}`}>
        <StatCard
          label="目前總市值"
          value={history.latestValue !== null ? `${money(history.latestValue)} 元` : '—'}
          sub={history.latestDate
            ? `截至 ${history.latestDate}・${history.latestPricedCount}/${history.latestHoldingCount} 檔`
            : '尚無可用收盤價'}
        />
        <StatCard
          label="近 1 日變化"
          value={history.change1d ? `${signedMoney(history.change1d.pnl)} 元` : '—'}
          valueClass={toneClass(history.change1d?.pnl)}
          sub={periodSub(history.change1d, '需要至少 2 個交易日')}
        />
        <StatCard
          label="近 1 月變化"
          value={history.change1m ? `${signedMoney(history.change1m.pnl)} 元` : '—'}
          valueClass={toneClass(history.change1m?.pnl)}
          sub={periodSub(history.change1m, '歷史資料未滿 1 個月')}
        />
        <StatCard
          label="今年以來"
          value={history.changeYtd ? `${signedMoney(history.changeYtd.pnl)} 元` : '—'}
          valueClass={toneClass(history.changeYtd?.pnl)}
          sub={periodSub(history.changeYtd, '今年尚無足夠交易日')}
        />
        <StatCard
          className={showDivCard ? 'col-span-2 sm:col-span-2 xl:col-span-1' : 'col-span-2 sm:col-span-4 lg:col-span-1'}
          label={`區間報酬 vs ${benchShort}（${rangeLabel}）`}
          value={
            comparison.excessRetPct !== null
              ? `超額 ${signedPct(comparison.excessRetPct)}`
              : benchLoading
                ? '載入中…'
                : '—'
          }
          valueClass={comparison.excessRetPct !== null ? toneClass(comparison.excessRetPct) : 'text-muted'}
          sub={
            comparison.portfolioRetPct !== null && comparison.benchmarkRetPct !== null ? (
              <>
                <span className="block">
                  我{' '}
                  <span className={`font-mono font-semibold ${toneClass(comparison.portfolioRetPct)}`}>
                    {signedPct(comparison.portfolioRetPct)}
                  </span>
                  {'・'}{benchShort}{' '}
                  <span className={`font-mono font-semibold ${toneClass(comparison.benchmarkRetPct)}`}>
                    {signedPct(comparison.benchmarkRetPct)}
                  </span>
                </span>
                <span className="block">
                  最大回撤 我 <span className="font-mono">{signedPct(comparison.portfolioMaxDrawdownPct)}</span>
                  {'・'}{benchShort}{' '}
                  <span className="font-mono">{signedPct(comparison.benchmarkMaxDrawdownPct)}</span>
                </span>
              </>
            ) : benchError ? (
              '暫時抓不到大盤指數'
            ) : benchLoading ? (
              `正在抓${benchName}…`
            ) : (
              '需要至少 2 個交易日'
            )
          }
        />
        {showDivCard && history.estDividends !== null && (
          <StatCard
            className="col-span-2 sm:col-span-2 xl:col-span-1"
            label="區間估計配息"
            value={`${money(history.estDividends)} 元`}
            valueClass="text-yield"
            sub="稅前估算・未計入市值"
          />
        )}
      </div>

      {/* 缺價、補價或匯率提醒 */}
      {(history.missingAssets.length > 0 || history.filledAssets.length > 0 || fxStale || fxState === 'error' || history.usedFxFallback) && (
        <div className="mt-2.5 space-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] leading-relaxed text-muted">
          {history.missingAssets.length > 0 && (
            <p>
              <strong className="text-ink">缺歷史收盤價（未計入市值）</strong>：
              {history.missingAssets.map(m => `${m.code} ${m.name}（${m.reason}）`).join('、')}。
            </p>
          )}
          {history.filledAssets.length > 0 && (
            <p>
              <strong className="text-ink">部分日期缺價已以前日補齊</strong>：
              {history.filledAssets.map(f => {
                const parts: string[] = [];
                if (f.filledDays > 0) parts.push(`補前價 ${f.filledDays} 天`);
                if (f.missingBefore) parts.push(`${f.missingBefore} 起才有報價`);
                return `${f.code} ${f.name}（${parts.join('、')}）`;
              }).join('、')}。
            </p>
          )}
          {(fxState === 'error' || fxStale || history.usedFxFallback) && (
            <p>
              <strong className="text-ink">美元匯率提示</strong>：
              {fxState === 'error'
                ? '暫時抓不到美元歷史匯率，美股暫無法換算台幣。'
                : '部分日期缺少歷史匯率，已改以最近一筆台銀即期中價換算。'}
            </p>
          )}
          {hasErrors && !loadingPrices && (
            <button
              type="button"
              onClick={() => setRetryTick(n => n + 1)}
              className="mt-0.5 text-[12px] font-semibold text-accent hover:underline"
            >
              重試抓不到的資料
            </button>
          )}
        </div>
      )}

      {/* 期間切換 */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="走勢區間">
          {rangeOptions.map(opt => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={range === opt.id}
              onClick={() => setRange(opt.id)}
              className={`h-8 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
                range === opt.id ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {rows.length > 0 && (
          <span className="text-[11.5px] text-faint">
            {rows[0].date} ～ {rows[rows.length - 1].date}・共 {rows.length} 個交易日
          </span>
        )}
      </div>

      {/* 無資料時的明確回饋 */}
      {rows.length === 0 && !loadingPrices ? (
        <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-8 text-center">
          <p className="text-[13px] text-muted">暫時取不到持股的歷史收盤價，無法繪製走勢圖。</p>
          <button
            type="button"
            onClick={() => setRetryTick(n => n + 1)}
            className="mt-3 h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-accent-ink hover:opacity-90"
          >
            重新載入
          </button>
        </div>
      ) : (
        <>
          {/* 圖一：總市值折線 */}
          <section className="mt-3 min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-sm font-bold text-ink">每日總市值</h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint">
                {!history.allEstimated && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-0.5 w-3.5" style={{ background: VALUE_COLOR }} />實際紀錄
                  </span>
                )}
                {history.hasEstimated && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: VALUE_COLOR }} />
                    估算（回推）
                  </span>
                )}
                {history.changeDays.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: CHANGE_DOT }} />
                    加減碼日（點看明細）
                  </span>
                )}
              </div>
            </div>

            <ValueLineChart
              rows={rows}
              activeIdx={activeIdx}
              pinnedIdx={safePinned}
              onHover={setHoverIdx}
              onPin={togglePin}
            />

            {/* 加減碼日快速膠囊：手機上好點、與圖上標記點完全連動 */}
            {history.changeDays.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-[11.5px]">
                <span className="text-faint">加減碼日：</span>
                {history.changeDays.map(day => {
                  const idx = rows.findIndex(r => r.date === day.date);
                  const active = safePinned === idx;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      aria-pressed={active}
                      onClick={() => { if (idx >= 0) togglePin(idx); }}
                      className={`h-7 rounded-md px-2 font-mono text-[11.5px] font-semibold transition-colors ${
                        active ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink hover:bg-hover'}`}
                    >
                      {day.date.slice(5)}
                      <span className="ml-1 font-sans text-[10.5px] opacity-80">{day.changes.length} 檔</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 點選加減碼日（或任意日）後展開的當天變動詳情卡 */}
            {pinnedRow && (
              <div className="mt-2.5 rounded-lg border border-line bg-bg px-3 py-2 text-[12px]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {pinnedRow.date}
                    {pinnedRow.changes.length > 0 ? ' 持股變動' : ' 市值快照'}
                    {pinnedRow.estimated && <span className="ml-1 text-[11px] font-normal text-muted">（估算）</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPinnedIdx(null)}
                    className="text-[11.5px] font-semibold text-accent hover:underline"
                  >
                    關閉
                  </button>
                </div>
                {pinnedRow.changes.length === 0 ? (
                  <p className="mt-1 text-muted">
                    當日無持股變動；總市值 {money(pinnedRow.totalValue)} 元，當日損益{' '}
                    <span className={`font-mono font-semibold ${toneClass(pinnedRow.dailyPnl)}`}>
                      {signedMoney(pinnedRow.dailyPnl)} 元
                    </span>。
                  </p>
                ) : (
                  <>
                    <ul className="mt-1.5 space-y-1">
                      {pinnedRow.changes.map(c => {
                        const isTwEtf = c.m !== 'us' && etfCodeSet.has(c.code);
                        const isTwStock = c.m !== 'us' && !isTwEtf && holdingLinkKind(c.code) === 'stock';
                        return (
                          <li key={c.key} className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                            <span className="min-w-0">
                              {isTwEtf ? (
                                <Link to="/etf" search={{ code: c.code }} className="font-mono font-bold text-accent hover:underline">
                                  {c.code}
                                </Link>
                              ) : isTwStock ? (
                                <button type="button" onClick={() => pickStock(c.code, c.name)}
                                        className="font-mono font-bold text-accent hover:underline">
                                  {c.code}
                                </button>
                              ) : (
                                <span className="font-mono font-bold text-ink">{c.code}</span>
                              )}
                              {c.m === 'us' && (
                                <span className="ml-1 rounded bg-sunken px-1 py-0.5 text-[10px] font-semibold text-muted">美股</span>
                              )}
                              <span className="ml-1.5 text-muted">{c.name !== c.code ? c.name : ''}</span>
                              <span className="ml-1.5 font-mono text-[11.5px] text-faint">
                                {nf0.format(c.before)} → {nf0.format(c.after)} 股
                              </span>
                            </span>
                            <span className="shrink-0 font-mono tabular-nums">
                              <span className={c.delta > 0 ? 'font-semibold text-up' : 'font-semibold text-down'}>
                                {c.delta > 0 ? '+' : '−'}{nf0.format(Math.abs(c.delta))} 股
                              </span>
                              {c.estAmount !== null && (
                                <span className="ml-1.5 text-[11px] text-muted">
                                  （約 {signedMoney(c.estAmount)} 元）
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-1.5 text-[11px] text-faint">
                      估算淨加減碼 {signedMoney(pinnedRow.netFlow)} 元（依當日收盤價換算，已從當日與累計損益排除）。
                    </p>
                  </>
                )}
              </div>
            )}
          </section>

          {/* 圖二：累計損益折線（與總市值分開） */}
          <section className="mt-3 min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-sm font-bold text-ink">累計損益（扣掉加減碼）</h2>
              <span className="text-[11px] text-faint">每日損益＝前日持股 ×（今價 − 昨價）・不含配息</span>
            </div>
            <PnlLineChart
              rows={rows}
              activeIdx={activeIdx}
              pinnedIdx={safePinned}
              onHover={setHoverIdx}
              onPin={togglePin}
            />
          </section>

          {/* 圖三：報酬比較（我的持股 TWR vs 加權指數／加權報酬指數，同區間起點歸零） */}
          <section className="mt-3 min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-ink">報酬比較（vs {benchName}）</h2>
                <p className="mt-0.5 text-[11px] leading-snug text-faint">
                  同區間自 0% 起算・我的持股採時間加權報酬（扣加減碼、不含配息）；
                  {benchMode === 'tr' ? '加權報酬指數含現金股利還原' : '加權指數未含息'}
                  {comparison.filledDays > 0 ? `・含 ${comparison.filledDays} 天以前日指數補齊` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="比較基準">
                <button
                  type="button"
                  aria-pressed={benchMode === 'price'}
                  onClick={() => setBenchMode('price')}
                  className={`h-7 rounded-md px-2.5 text-[12px] font-semibold transition-colors ${
                    benchMode === 'price' ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
                >
                  加權指數（未含息）
                </button>
                <button
                  type="button"
                  aria-pressed={benchMode === 'tr'}
                  onClick={() => setBenchMode('tr')}
                  className={`h-7 rounded-md px-2.5 text-[12px] font-semibold transition-colors ${
                    benchMode === 'tr' ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
                >
                  加權報酬指數（含息）
                </button>
              </div>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint">
              {!history.allEstimated && (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3.5" style={{ background: VALUE_COLOR }} />我的持股（實際）
                </span>
              )}
              {history.hasEstimated && (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: VALUE_COLOR }} />
                  我的持股（估算）
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-0.5 w-3.5" style={{ background: BENCH_COLOR }} />{benchName}
              </span>
              {comparison.trimmedLeadingDays > 0 && comparison.startDate && (
                <span>共同起點自 {comparison.startDate} 起算</span>
              )}
            </div>

            {benchLoading && comparison.points.length === 0 ? (
              <p className="py-10 text-center text-[12.5px] text-muted">載入{benchName}資料中…</p>
            ) : benchError && comparison.points.length === 0 ? (
              <div className="mt-2 rounded-lg border border-line bg-bg px-3 py-4 text-center text-[12px] text-muted">
                <p>暫時抓不到{benchName}：{benchError}</p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={retryBenchmark}
                    className="h-8 rounded-lg bg-accent px-3 text-[12px] font-semibold text-accent-ink hover:opacity-90"
                  >
                    重新載入
                  </button>
                  {benchMode === 'tr' && (
                    <button
                      type="button"
                      onClick={() => setBenchMode('price')}
                      className="h-8 rounded-lg bg-sunken px-3 text-[12px] font-semibold text-ink hover:bg-hover"
                    >
                      改看加權指數（未含息）
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <ReturnCompareChart
                points={comparison.points}
                benchLabel={benchShort}
                activeRowIdx={activeIdx}
                onHoverRow={setHoverIdx}
                onPinRow={togglePin}
              />
            )}
          </section>

          {/* 每日明細表 */}
          <section className="mt-3 min-w-0 rounded-xl border border-line bg-surface p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">每日明細</h2>
              {history.changeDays.length > 0 && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    aria-pressed={!onlyChanges}
                    onClick={() => { setOnlyChanges(false); setShowAllRows(false); }}
                    className={`h-7 rounded-md px-2.5 text-[12px] font-semibold ${
                      !onlyChanges ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
                  >
                    全部（{rows.length}）
                  </button>
                  <button
                    type="button"
                    aria-pressed={onlyChanges}
                    onClick={() => { setOnlyChanges(true); setShowAllRows(false); }}
                    className={`h-7 rounded-md px-2.5 text-[12px] font-semibold ${
                      onlyChanges ? 'bg-accent text-accent-ink' : 'bg-sunken text-muted hover:text-ink'}`}
                  >
                    只看加減碼（{history.changeDays.length}）
                  </button>
                </div>
              )}
            </div>

            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[480px] text-[12px] tabular-nums">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="py-1.5 pr-2 text-left font-semibold whitespace-nowrap">日期</th>
                    <th className="py-1.5 px-2 text-right font-semibold whitespace-nowrap">總市值</th>
                    <th className="py-1.5 px-2 text-right font-semibold whitespace-nowrap">當日損益</th>
                    <th className="py-1.5 px-2 text-right font-semibold whitespace-nowrap">累計損益</th>
                    <th className="py-1.5 pl-2 text-left font-semibold whitespace-nowrap">持股變動</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shownRows.map(r => {
                    const rowIdx = rows.findIndex(x => x.date === r.date);
                    const isPinned = safePinned === rowIdx;
                    return (
                      <tr
                        key={r.date}
                        onClick={() => { if (rowIdx >= 0) togglePin(rowIdx); }}
                        className={`cursor-pointer transition-colors ${isPinned ? 'bg-accent-soft/60' : 'hover:bg-hover'}`}
                      >
                        <td className="py-1.5 pr-2 font-mono whitespace-nowrap text-ink">
                          {r.changes.length > 0 && (
                            <span
                              aria-label="加減碼日"
                              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                              style={{ background: CHANGE_DOT }}
                            />
                          )}
                          {r.date}
                          {r.estimated && (
                            <span className="ml-1 rounded bg-sunken px-1 py-0.5 font-sans text-[10px] text-muted">估</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono whitespace-nowrap text-ink">
                          {money(r.totalValue)}
                        </td>
                        <td className={`py-1.5 px-2 text-right font-mono whitespace-nowrap ${toneClass(r.dailyPnl)}`}>
                          {signedMoney(r.dailyPnl)}
                          {r.dailyRetPct !== null && (
                            <span className="ml-1 text-[10.5px] opacity-80">({signedPct(r.dailyRetPct)})</span>
                          )}
                        </td>
                        <td className={`py-1.5 px-2 text-right font-mono whitespace-nowrap ${toneClass(r.cumPnl)}`}>
                          {signedMoney(r.cumPnl)}
                        </td>
                        <td className="py-1.5 pl-2 text-left text-muted">
                          {r.changes.length === 0 ? (
                            <span className="text-faint">—</span>
                          ) : (
                            <span className="text-ink">{r.changes.map(changeSummaryText).join('、')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {tableSource.length > 30 && (
              <button
                type="button"
                onClick={() => setShowAllRows(v => !v)}
                className="mt-2.5 h-8 rounded-lg bg-sunken px-3 text-[12px] font-semibold text-muted hover:text-ink"
              >
                {showAllRows ? '收起明細' : `顯示全部 ${tableSource.length} 天`}
              </button>
            )}
          </section>
        </>
      )}

      {/* 持股快照紀錄清單與計算說明 */}
      <Fold
        className="mt-3"
        summary={`本機已記錄 ${resolvedLog.length} 筆持股快照（起自 ${resolvedLog[0].date}）；持股僅存本機與加密同步`}
      >
        <p>
          計算方式：每個交易日取該日以前最近一筆持股紀錄乘上當日收盤價（台股取 FinMind 日收盤價、美股取 FinMind 日收盤價 × 當日台銀美元即期中價，皆快取於本機瀏覽器）。
          每日損益＝前一天生效持股 ×（今天台幣價 − 昨天台幣價），美股自動涵蓋匯率變動，加減碼資金進出不影響累計損益；配息不計入市值。
          報酬比較以時間加權報酬對照 FinMind 加權指數（TaiwanStockPrice TAIEX，未含息）或加權報酬指數（TaiwanStockTotalReturnIndex TAIEX，含息），共同起點皆歸零為 0%，台股休市日以前一交易日指數補齊。
          開始記錄前的估算區間以首次記錄持股往回推算，未調整歷史分割與期間異動。
        </p>
        <p className="mt-1">
          隱私：持股清單與變動紀錄僅存於瀏覽器本機，或經由「配息試算」的私人持股功能以密碼加密同步，不會明文上傳；查詢歷史收盤價僅向 FinMind 傳送公開代號。
        </p>
        <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-muted">
          {[...resolvedLog].reverse().slice(0, 12).map(s => (
            <li key={s.date}>
              {s.date}：{s.holdings.length} 筆（{s.holdings.slice(0, 4).map(h => `${h.code} ${nf0.format(h.shares)}`).join('、')}{s.holdings.length > 4 ? '…' : ''}）
            </li>
          ))}
        </ul>
      </Fold>

      <StockSheet code={sheet?.code ?? null} name={sheet?.name} onClose={closeSheet} />
    </div>
  );
}
