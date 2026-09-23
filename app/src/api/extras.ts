/* 台股頁的附加資料：主動式 ETF 持股與前十大持股（進版控）、即將上市（部署時產生）。
 *
 * 每一份都容許缺席：回 null，畫面顯示「還沒有資料」，不讓台股清單本身受影響。
 */

import type { ActiveData } from '../lib/active.ts';
import type { UpcomingData } from '../lib/upcoming.ts';
import type { Top10Data } from '../lib/top10.ts';
import type { StockDividendData } from '../lib/dividend.ts';

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

export const fetchStockDividends = (signal?: AbortSignal) =>
  load<StockDividendData>('stock_dividends.json', d => Boolean(d.stocks), signal);
