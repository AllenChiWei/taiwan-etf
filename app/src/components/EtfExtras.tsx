/* ETF 的受益人數與前十大持股：清單彈窗（Top10Modal）與 ETF 頁（routes/EtfPage）共用。
 *
 * 資料第一次用到時才下載（top10.json 約 200 KB、active_holdings.json 約 60 KB、etf_holders.json），
 * 之後同一個分頁內重複使用。算法在 lib/top10.ts、lib/etfHolders.ts。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { fetchActive, fetchEtfHolders, fetchTop10 } from '../api/extras';
import { top10For, missingReason, type Top10Data } from '../lib/top10';
import { holdersFor, type EtfHoldersData } from '../lib/etfHolders';
import { holdingLinkKind, type ActiveData } from '../lib/active';
import { etfTopHoldings, formatShareClasses } from '../lib/portfolioXray';
import type { StockDividendData } from '../lib/dividend';
import type { Etf } from '../types';
import { StockSheet } from './StockSheet';

const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const signed = (v: number) => `${v > 0 ? '+' : ''}${nf0.format(v)}`;

export type EtfExtras = [Top10Data | null, ActiveData | null, EtfHoldersData | null];

// 模組層級的快取：開過一次之後，再點別檔不必重新下載
let cache: Promise<EtfExtras> | null = null;
let resolved: EtfExtras | null = null;
function loadAll() {
  cache ??= Promise.all([fetchTop10().catch(() => null), fetchActive().catch(() => null), fetchEtfHolders().catch(() => null)])
    .then((d: EtfExtras) => { resolved = d; return d; });
  return cache;
}

/** null＝還在載入（或尚未啟用）。enabled=false 時不發請求，供配息試算等頁面按需載入。 */
export function useEtfExtras(enabled = true): EtfExtras | null {
  const [data, setData] = useState<EtfExtras | null>(() => (enabled ? resolved : null));
  useEffect(() => {
    if (!enabled) return;
    if (resolved) { setData(resolved); return; }
    let alive = true;
    loadAll().then(d => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [enabled]);
  return data;
}

/** 前十大的資料日期說明（標題下方那行用） */
export function top10Asof(etf: Etf, data: EtfExtras | null): string | null {
  const view = data ? top10For(etf.code, data[0], data[1]) : null;
  if (!view) return null;
  return view.kind === 'daily' ? `${view.asof} 收盤後（投信每日公告）` : `${view.asof} 月底（投信投顧公會月報）`;
}

export function HoldersBox({ code, data }: { code: string; data: EtfExtras | null }) {
  const holders = data ? holdersFor(code, data[2]) : null;
  if (!holders) return null;
  return (
    <div className="mt-3 rounded-lg bg-sunken px-3 py-2 text-[12.5px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-muted">
          受益人數 <strong className="font-mono text-[14px] tabular-nums text-ink">{nf0.format(holders.holders)}</strong> 人
          {holders.w1 && <span className={`ml-1.5 font-mono tabular-nums ${holders.w1.holders >= 0 ? 'text-up' : 'text-down'}`}>週 {signed(holders.w1.holders)}</span>}
          {holders.w4 && <span className={`ml-1.5 font-mono tabular-nums ${holders.w4.holders >= 0 ? 'text-up' : 'text-down'}`}>4 週 {signed(holders.w4.holders)}</span>}
        </span>
        <span className="text-muted">
          流通 <span className="font-mono tabular-nums text-ink">{nf0.format(holders.lots)}</span> 張
          {holders.w1 && <span className="ml-1.5 font-mono tabular-nums">（週{holders.w1.lots >= 0 ? '淨申購' : '淨贖回'} {nf0.format(Math.abs(holders.w1.lots))}）</span>}
        </span>
      </div>
      <p className="mt-0.5 text-[10.5px] text-faint">
        集保股權分散表 · {holders.asof}（每週更新{holders.w1 ? '' : '；週變化從下週開始累積'}）
      </p>
    </div>
  );
}

export function Top10List({ etf, data, onPickStock, onNavigate }: {
  etf: Etf;
  data: EtfExtras | null;
  /** 外層彈窗（Top10Modal）自行掛 StockSheet，避免雙層彈窗互相干擾 Esc 與背景捲動鎖 */
  onPickStock?: (code: string, name?: string) => void;
  /** 點 ETF 連結導頁時的回呼（例如關閉外層彈窗） */
  onNavigate?: () => void;
}) {
  const [sheet, setSheet] = useState<{ code: string; name?: string } | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  useEffect(() => { setSheet(null); }, [etf.code]);

  const view = data ? top10For(etf.code, data[0], data[1]) : null;
  const max = view ? Math.max(...view.rows.map(r => r.pct ?? 0), 1) : 1;
  if (!data) return <p className="py-10 text-center text-[13px] text-muted">載入中…</p>;
  if (!view) return <p className="py-8 text-center text-[13px] leading-relaxed text-muted">{missingReason(etf.sec)}</p>;

  const pickStock = onPickStock ?? ((code: string, name?: string) => setSheet({ code, name }));
  const hasStock = view.rows.some(r => holdingLinkKind(r.code, r.type) === 'stock');

  return (
    <>
      <ol className="mt-3 space-y-1.5">
        {view.rows.map(r => {
          const kind = holdingLinkKind(r.code, r.type);
          const showCode = kind !== null || /^\d{4,6}$/.test(r.code);
          const label = (
            <>
              {r.name}
              {showCode && (
                <span className={`ml-1.5 font-mono text-[11.5px] ${kind ? 'text-accent' : 'text-muted'}`}>{r.code}</span>
              )}
            </>
          );
          return (
            <li key={`${r.rank}-${r.code}`} className="grid grid-cols-[1.4em_1fr_auto] items-center gap-2">
              <span className="text-right font-mono text-[12px] text-faint">{r.rank}</span>
              <span className="min-w-0">
                {kind === 'stock' ? (
                  <button type="button" onClick={() => pickStock(r.code, r.name)}
                          className="block max-w-full truncate text-left text-[13.5px] text-ink hover:text-accent hover:underline">
                    {label}
                  </button>
                ) : kind === 'etf' ? (
                  <Link to="/etf" search={{ code: r.code }} onClick={onNavigate}
                        className="block max-w-full truncate text-[13.5px] text-ink hover:text-accent hover:underline">
                    {label}
                  </Link>
                ) : (
                  <span className="block truncate text-[13.5px] text-ink">{label}</span>
                )}
                <span className="mt-0.5 block h-1.5 rounded-full bg-sunken">
                  <span className="block h-1.5 rounded-full bg-accent"
                        style={{ width: `${((r.pct ?? 0) / max) * 100}%` }} />
                </span>
              </span>
              <span className="w-[4.2em] text-right font-mono text-[13px] tabular-nums text-ink">
                {r.pct === null ? '—' : `${nf2.format(r.pct)}%`}
              </span>
            </li>
          );
        })}
      </ol>
      {view.total !== null && (
        <p className="mt-2 text-right text-[12px] text-muted">
          前十大合計 <strong className="font-mono text-ink">{nf2.format(view.total)}%</strong>
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        {view.kind === 'daily'
          ? '這一檔是站上追蹤的主動式 ETF，用的是投信每天公告的完整持股，取權重前十名。'
          : '投信投顧公會每月公布上個月底的持股，大約每月 10 號以後更新；主動式 ETF 天天換股，月報會落後。'}
        {hasStock && ' 點台股成分股可以直接看財報與籌碼。'}
      </p>
      {!onPickStock && (
        <StockSheet code={sheet?.code ?? null} name={sheet?.name} onClose={closeSheet} />
      )}
    </>
  );
}

/**
 * 單一台灣掛牌 ETF 的前十大持股與約略曝險金額表（配息試算「各檔明細」展開用）。
 * 共用 useEtfExtras 快取與 lib/portfolioXray.ts 的成分解析（市場小標籤、ADR 併回台股、股別合併）。
 */
export function EtfHoldingsTable({ code, sec, holdingValue, data, stockDivs, onPickStock }: {
  code: string;
  sec?: Etf['sec'];
  /** 使用者持有這筆 ETF 的市值（台幣）；缺收盤價時傳 null */
  holdingValue: number | null;
  data: EtfExtras | null;
  stockDivs?: StockDividendData | null;
  /** 外層元件（DividendPlanner）統一掛一個 StockSheet，避免每列各掛一個 */
  onPickStock?: (code: string, name?: string) => void;
}) {
  const [sheet, setSheet] = useState<{ code: string; name?: string } | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  useEffect(() => { setSheet(null); }, [code]);

  const result = useMemo(
    () => (data
      ? etfTopHoldings({ code, sec, holdingValue, top10: data[0], active: data[1], stockDivs })
      : null),
    [code, sec, holdingValue, data, stockDivs],
  );

  if (!result) {
    return (
      <div className="mt-2 rounded-lg border border-line bg-sunken/60 px-3 py-2.5 text-[12px] text-muted">
        載入持股明細中…
      </div>
    );
  }

  if (result.status === 'empty') {
    return (
      <div className="mt-2 rounded-lg border border-line bg-sunken/60 px-3 py-2 text-[12px] text-muted">
        {result.reason}
      </div>
    );
  }

  const { view } = result;
  const pickStock = onPickStock ?? ((c: string, n?: string) => setSheet({ code: c, name: n }));
  const hasTwStock = view.rows.some(r => r.market === 'tw' && holdingLinkKind(r.code) === 'stock');

  return (
    <div className="mt-2 rounded-lg border border-line bg-bg p-2.5 sm:p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11.5px]">
        <span className="font-semibold text-ink">
          前十大持股
          {view.kind === 'daily' && view.totalCount > view.rows.length && (
            <span className="ml-1 font-normal text-muted">（共 {view.totalCount} 檔成分股）</span>
          )}
        </span>
        <span className="text-faint">{view.sourceLabel}</span>
      </div>

      {/* 手機 390px 用橫向捲動容器，不撐寬外層版面 */}
      <div className="mt-2 overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full min-w-[440px] text-[12px]">
          <thead className="bg-sunken text-muted">
            <tr>
              <th className="w-9 px-2 py-1.5 text-right font-semibold">#</th>
              <th className="px-2 py-1.5 text-left font-semibold">代號</th>
              <th className="px-2 py-1.5 text-left font-semibold">名稱</th>
              <th className="px-2 py-1.5 text-right font-semibold">占淨值</th>
              <th className="px-2.5 py-1.5 text-right font-semibold">你的約略曝險</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {view.rows.map(row => {
              const isForeign = row.market === 'foreign';
              const canSheet = !isForeign && holdingLinkKind(row.code) === 'stock';
              const showShareDetail = Boolean(
                row.shareClasses && (
                  row.shareClasses.length > 1
                  || row.hasAdr
                  || row.shareClasses[0]?.code !== row.displayCode
                ),
              );
              return (
                <tr key={row.code}>
                  <td className="px-2 py-1.5 text-right font-mono text-[11.5px] tabular-nums text-faint">
                    {row.rank}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className="inline-flex items-center gap-1">
                      {isForeign && (
                        <span className="rounded bg-sunken px-1 py-0.5 text-[10px] font-semibold text-muted">
                          {row.marketLabel}
                        </span>
                      )}
                      {canSheet ? (
                        <button
                          type="button"
                          onClick={() => pickStock(row.code, row.name)}
                          className="font-mono font-bold text-accent hover:underline"
                        >
                          {row.displayCode}
                        </button>
                      ) : (
                        <span className={`font-mono ${row.isIsin ? 'text-[10.5px] text-faint' : 'font-semibold text-ink'}`}>
                          {row.displayCode}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-ink">
                    <span className="inline-flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                      <span>{row.name}</span>
                      {row.hasAdr && (
                        <span className="rounded bg-sunken px-1 py-0.5 text-[10px] font-semibold text-muted">
                          含 ADR
                        </span>
                      )}
                    </span>
                    {showShareDetail && row.shareClasses && (
                      <div className="mt-0.5 text-[10.5px] text-faint">
                        {formatShareClasses(row.shareClasses, row.pct)}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums text-ink">
                    {nf2.format(row.pct)}%
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono tabular-nums text-ink">
                    {row.exposureAmount !== null ? `${nf0.format(Math.round(row.exposureAmount))} 元` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-line bg-sunken/60 font-semibold text-ink">
            <tr>
              <td colSpan={3} className="px-2 py-1.5 text-left text-[11.5px] text-muted">
                上列 {view.rows.length} 檔合計
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums">
                {nf2.format(view.shownPct)}%
              </td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-right font-mono tabular-nums">
                {view.shownAmount !== null ? `${nf0.format(Math.round(view.shownAmount))} 元` : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11px] text-faint">
        <span>
          約略曝險＝這筆持有市值 × 占淨值%
          {hasTwStock ? '・點台股代號看財報與籌碼' : ''}
        </span>
        <Link to="/etf" search={{ code }} className="font-semibold text-accent hover:underline">
          看 {code} 完整頁面 →
        </Link>
      </div>

      {!onPickStock && (
        <StockSheet code={sheet?.code ?? null} name={sheet?.name} onClose={closeSheet} />
      )}
    </div>
  );
}
