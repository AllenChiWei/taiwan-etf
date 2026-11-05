/* 台股頁的附加資料：主動式 ETF 持股與前十大持股（進版控）、即將上市（部署時產生）。
 *
 * 每一份都容許缺席：回 null，畫面顯示「還沒有資料」，不讓台股清單本身受影響。
 */

import type { ActiveData } from '../lib/active.ts';
import type { UpcomingData } from '../lib/upcoming.ts';
import type { Top10Data } from '../lib/top10.ts';
import type { EtfHoldersData } from '../lib/etfHolders.ts';
import type { DivMixData } from '../lib/monthlyIncome.ts';
import type { StockDividendData, EtfDividendData, YieldData } from '../lib/dividend.ts';
import type { MacroData } from '../lib/macro.ts';
import type { CalendarData } from '../lib/calendar.ts';
import type { CbData, CbMarket, CbSeriesPoint, CbConv } from '../lib/cb.ts';

const BASE = import.meta.env.BASE_URL;

async function load<T>(file: string, ok: (d: Partial<T>) => boolean,
                       signal?: AbortSignal): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}data/${file}`, { signal, cache: 'no-cache' });
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
  if (!res.ok) return null;
  try {
    const d = (await res.json()) as Partial<T>;
    return ok(d) ? (d as T) : null;
  } catch {
    return null;
  }
}

export const fetchActive = (signal?: AbortSignal) =>
  load<ActiveData>('active_holdings.json', d => Boolean(d.etfs && d.meta), signal);

export const fetchUpcoming = (signal?: AbortSignal) =>
  load<UpcomingData>('upcoming.json', d => Array.isArray(d.items), signal);

export const fetchTop10 = (signal?: AbortSignal) =>
  load<Top10Data>('top10.json', d => Boolean(d.etfs && d.meta), signal);

export const fetchEtfHolders = (signal?: AbortSignal) =>
  load<EtfHoldersData>('etf_holders.json', d => Boolean(d.etfs && d.dates), signal);

/** 配息組成（集保 ETF 觀測站，scripts/fetch_div_mix.py）：月領試算判斷哪部分要扣二代健保 */
export const fetchDivMix = (signal?: AbortSignal) =>
  load<DivMixData>('div_mix.json', d => Boolean(d.mix), signal);

export const fetchStockDividends = (signal?: AbortSignal) =>
  load<StockDividendData>('stock_dividends.json', d => Boolean(d.stocks), signal);

/** ETF 的交易所公告配息（dividends.json）與收盤價（yields.json 的 price）。
 *  配息試算用它們補上還沒進試算資料的新上市 ETF（上市未滿三個月的不產生回測序列）。 */
export const fetchEtfDividends = (signal?: AbortSignal) =>
  load<EtfDividendData>('dividends.json', d => Boolean(d.dividends), signal);
export const fetchYields = (signal?: AbortSignal) =>
  load<YieldData>('yields.json', d => Boolean(d.yields), signal);

/** 美國總經（FRED／EIA）與台股行事曆（交易所公告）。都是部署時產生、不進版控。 */
export const fetchMacro = (signal?: AbortSignal) =>
  load<MacroData>('macro.json', d => Boolean(d.series && d.meta), signal);
export const fetchCalendar = (signal?: AbortSignal) =>
  load<CalendarData>('calendar.json', d => Array.isArray(d.exdiv) && Array.isArray(d.meetings), signal);

/** 可轉債（scripts/fetch_cb.py，部署時產生） */
export const fetchCb = (signal?: AbortSignal) =>
  load<CbData>('cb.json', d => Array.isArray(d.bonds) && Boolean(d.meta), signal);

/** 可轉債市場溫度計歷史（2017 起每天一列） */
export const fetchCbMarket = (signal?: AbortSignal) =>
  load<CbMarket>('cb_market.json', d => Array.isArray(d.rows) && Array.isArray(d.cols), signal);

/** 單檔可轉債走勢：點開那一檔才抓 */
/** 每月底餘額（轉換分析），點開某一檔才抓，全部一個檔（約百來 KB） */
export const fetchCbConv = (signal?: AbortSignal) =>
  load<CbConv>('cb_conv.json', d => typeof d === 'object' && d !== null && !Array.isArray(d), signal);

export async function fetchCbSeries(code: string, signal?: AbortSignal): Promise<CbSeriesPoint[] | null> {
  try {
    const res = await fetch(`${BASE}data/cb_series/${encodeURIComponent(code)}.json`, { signal, cache: 'no-cache' });
    if (!res.ok) return null;
    const d: unknown = await res.json();
    return Array.isArray(d) ? (d as CbSeriesPoint[]) : null;
  } catch {
    return null;
  }
}
