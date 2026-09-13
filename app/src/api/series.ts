/* 績效曲線的資料抓取。
 *
 * 每檔 ETF 一個檔案（約 7-13 KB），只抓使用者勾選的那幾檔 —— 全部加起來有 11 MB，
 * 為了畫三條線去下載那些是不合理的。交易日曆每個市場一份，所有標的共用。
 *
 * 這些檔案是部署時產生的，沒有進版控（見 scripts/fetch_series.py 的說明）。
 */

import type { RawSeries } from '../lib/series';
import { DataError } from './etfs';
import { decryptJson, isUnlocked } from '../lib/secure';

const BASE = import.meta.env.BASE_URL;
export type Market = 'tw' | 'us';

const calendarCache = new Map<Market, Promise<string[]>>();
const seriesCache = new Map<string, Promise<RawSeries>>();

/** 曲線檔同樣是加密的（資料來自 FinLab 付費訂閱）。 */
async function getJson(url: string): Promise<unknown> {
  if (!isUnlocked()) throw new DataError('尚未解鎖');
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new DataError('無法取得曲線資料，請檢查網路', err);
  }
  if (res.status === 404) throw new DataError('這檔沒有曲線資料');
  if (!res.ok) throw new DataError(`取得曲線資料失敗（HTTP ${res.status}）`);
  try {
    return await decryptJson<unknown>(await res.arrayBuffer());
  } catch (err) {
    throw new DataError('曲線資料解密失敗，請重新輸入密碼', err);
  }
}

export function fetchCalendar(market: Market): Promise<string[]> {
  let p = calendarCache.get(market);
  if (!p) {
    p = getJson(`${BASE}data/series/_${market}.json.enc`).then(j => {
      const dates = (j as { dates?: unknown }).dates;
      if (!Array.isArray(dates)) throw new DataError('交易日曆格式不正確');
      return dates as string[];
    });
    // 失敗不要留在快取裡，否則使用者重試也永遠失敗
    p.catch(() => calendarCache.delete(market));
    calendarCache.set(market, p);
  }
  return p;
}

export function fetchSeries(market: Market, code: string): Promise<RawSeries> {
  const key = `${market}/${code}`;
  let p = seriesCache.get(key);
  if (!p) {
    p = getJson(`${BASE}data/series/${key}.json.enc`).then(j => {
      const r = j as Partial<RawSeries>;
      if (!Array.isArray(r.values) || typeof r.first !== 'number') {
        throw new DataError(`${code} 的曲線資料格式不正確`);
      }
      return { code, first: r.first, values: r.values } as RawSeries;
    });
    p.catch(() => seriesCache.delete(key));
    seriesCache.set(key, p);
  }
  return p;
}
