/* ETF 的受益人數與前十大持股：清單彈窗（Top10Modal）與 ETF 頁（routes/EtfPage）共用。
 *
 * 資料第一次用到時才下載（top10.json 約 200 KB、active_holdings.json 約 60 KB、etf_holders.json），
 * 之後同一個分頁內重複使用。算法在 lib/top10.ts、lib/etfHolders.ts。
 */

import { useEffect, useState } from 'react';
import { fetchActive, fetchEtfHolders, fetchTop10 } from '../api/extras';
import { top10For, missingReason, type Top10Data } from '../lib/top10';
import { holdersFor, type EtfHoldersData } from '../lib/etfHolders';
import type { ActiveData } from '../lib/active';
import type { Etf } from '../types';

const nf2 = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const signed = (v: number) => `${v > 0 ? '+' : ''}${nf0.format(v)}`;

export type EtfExtras = [Top10Data | null, ActiveData | null, EtfHoldersData | null];

// 模組層級的快取：開過一次之後，再點別檔不必重新下載
let cache: Promise<EtfExtras> | null = null;
function loadAll() {
  cache ??= Promise.all([fetchTop10().catch(() => null), fetchActive().catch(() => null), fetchEtfHolders().catch(() => null)]);
  return cache;
}

/** null＝還在載入 */
export function useEtfExtras(): EtfExtras | null {
  const [data, setData] = useState<EtfExtras | null>(null);
  useEffect(() => {
    let alive = true;
    loadAll().then(d => { if (alive) setData(d); });
    return () => { alive = false; };
  }, []);
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

export function Top10List({ etf, data }: { etf: Etf; data: EtfExtras | null }) {
  const view = data ? top10For(etf.code, data[0], data[1]) : null;
  const max = view ? Math.max(...view.rows.map(r => r.pct ?? 0), 1) : 1;
  if (!data) return <p className="py-10 text-center text-[13px] text-muted">載入中…</p>;
  if (!view) return <p className="py-8 text-center text-[13px] leading-relaxed text-muted">{missingReason(etf.sec)}</p>;
  return (
    <>
      <ol className="mt-3 space-y-1.5">
        {view.rows.map(r => (
          <li key={`${r.rank}-${r.code}`} className="grid grid-cols-[1.4em_1fr_auto] items-center gap-2">
            <span className="text-right font-mono text-[12px] text-faint">{r.rank}</span>
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] text-ink">
                {r.name}
                {/^\d{4,6}$/.test(r.code) && (
                  <span className="ml-1.5 font-mono text-[11.5px] text-muted">{r.code}</span>
                )}
              </span>
              <span className="mt-0.5 block h-1.5 rounded-full bg-sunken">
                <span className="block h-1.5 rounded-full bg-accent"
                      style={{ width: `${((r.pct ?? 0) / max) * 100}%` }} />
              </span>
            </span>
            <span className="w-[4.2em] text-right font-mono text-[13px] tabular-nums text-ink">
              {r.pct === null ? '—' : `${nf2.format(r.pct)}%`}
            </span>
          </li>
        ))}
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
      </p>
    </>
  );
}
