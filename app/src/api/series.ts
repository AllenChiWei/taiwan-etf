/* 績效曲線的資料抓取。
 *
 * 每檔 ETF 一個檔案（約 7-13 KB），只抓使用者勾選的那幾檔 —— 全部加起來有 11 MB，
 * 為了畫三條線去下載那些是不合理的。交易日曆每個市場一份，所有標的共用。
 *
 * **兩個市場的來源與保護方式不同**，這是這個模組唯一需要記住的事：
 *
 *   台股　FinMind（公開資料）　-> 明文，任何人都看得到
 *   美股　FinLab（付費訂閱）　 -> 加密，要先解鎖
 *
 * 台股原本也走 FinLab，所以整份都要加密；沒設定 SITE_PASSWORD 的部署會把曲線丟掉，
 * 收藏頁就一片空白。換成 FinMind 之後那條鍊子在台股這半整個不見了。
 *
 * 這些檔案是部署時產生的，沒有進版控。
 */

import type { RawSeries } from '../lib/series';
import { DataError } from './etfs';
import { decryptJson, isUnlocked } from '../lib/secure';

const BASE = import.meta.env.BASE_URL;
export type Market = 'tw' | 'us';

const calendarCache = new Map<Market, Promise<string[]>>();
const seriesCache = new Map<string, Promise<RawSeries>>();

/** 這個市場的曲線需不需要解鎖。台股是公開資料，不需要。 */
export function needsUnlock(market: Market): boolean {
  return market === 'us';
}

async function getResponse(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new DataError('無法取得曲線資料，請檢查網路', err);
  }
  if (res.status === 404) throw new DataError('這檔沒有曲線資料');
  if (!res.ok) throw new DataError(`取得曲線資料失敗（HTTP ${res.status}）`);
  return res;
}

/** 美股：FinLab 的付費資料，加密上線。 */
async function getEncrypted(url: string): Promise<unknown> {
  if (!isUnlocked()) throw new DataError('尚未解鎖');
  const res = await getResponse(url);
  try {
    return await decryptJson<unknown>(await res.arrayBuffer());
  } catch (err) {
    throw new DataError('曲線資料解密失敗，請重新輸入密碼', err);
  }
}

/** 台股：FinMind 的公開資料，明文。 */
async function getPlain(url: string): Promise<unknown> {
  const res = await getResponse(url);
  try {
    return await res.json();
  } catch (err) {
    throw new DataError('曲線資料不是有效的 JSON', err);
  }
}

function getJson(market: Market, url: string): Promise<unknown> {
  return needsUnlock(market) ? getEncrypted(url) : getPlain(url);
}

export function fetchCalendar(market: Market): Promise<string[]> {
  let p = calendarCache.get(market);
  if (!p) {
    // 副檔名跟著保護方式走：加密的是 .json.enc，明文的就是 .json
    const ext = needsUnlock(market) ? '.json.enc' : '.json';
    p = getJson(market, `${BASE}data/series/_${market}${ext}`).then(j => {
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
    const ext = needsUnlock(market) ? '.json.enc' : '.json';
    p = getJson(market, `${BASE}data/series/${key}${ext}`).then(j => {
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
