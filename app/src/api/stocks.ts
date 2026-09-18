/* 個股資料的存取層。與 api/etfs.ts、api/chips.ts、api/news.ts 同一個角色。
 *
 * 分兩層抓：index.json 是搜尋框要的清單（兩千檔、約 100 KB），個股詳細資料是
 * 每檔一個小檔（平均 600 bytes）。不把兩千檔的財報塞進一份 —— 使用者一次只看一檔。
 */

import type { StockData, StockIndex, Ranking, Highs } from '../lib/stock.ts';

const BASE = import.meta.env.BASE_URL;

export const STOCK_INDEX_URL = `${BASE}data/stocks/index.json`;

export class StockError extends Error {
  readonly detail: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'StockError';
    this.detail = detail;
  }
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal, cache: 'no-cache' });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new StockError('無法連線取得個股資料，請檢查網路', err);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new StockError(`取得個股資料失敗（HTTP ${res.status}）`);
  try {
    return await res.json();
  } catch (err) {
    throw new StockError('個股資料不是有效的 JSON', err);
  }
}

/** 回 null 代表這次部署沒有產生個股資料。 */
export async function fetchStockIndex(signal?: AbortSignal): Promise<StockIndex | null> {
  const json = await getJson(STOCK_INDEX_URL, signal);
  if (json === null) return null;
  const d = json as Partial<StockIndex>;
  if (!Array.isArray(d.stocks) || !d.meta) {
    throw new StockError('個股清單格式不正確');
  }
  return json as StockIndex;
}

/** 單檔個股。代號是從清單裡來的，但仍然只允許代號長相的字串接進網址。 */
export async function fetchStock(
  code: string, signal?: AbortSignal,
): Promise<StockData | null> {
  if (!/^[0-9A-Z]{4,6}$/.test(code)) return null;
  const json = await getJson(`${BASE}data/stocks/${code}.json`, signal);
  if (json === null) return null;
  const d = json as Partial<StockData>;
  if (!d.code || !d.info) throw new StockError('個股資料格式不正確');
  return json as StockData;
}

/** 營收排行（全市場最新一個月）。回 null 代表這次部署沒有產生。 */
export async function fetchRanking(signal?: AbortSignal): Promise<Ranking | null> {
  const json = await getJson(`${BASE}data/stocks/ranking.json`, signal);
  if (json === null) return null;
  const d = json as Partial<Ranking>;
  if (!Array.isArray(d.rows)) throw new StockError('營收排行格式不正確');
  return json as Ranking;
}

/** 創新高／新低。這份由 FinLab 那條路徑產生，所以可能因為額度而缺席。 */
export async function fetchHighs(signal?: AbortSignal): Promise<Highs | null> {
  const json = await getJson(`${BASE}data/highs.json`, signal);
  if (json === null) return null;
  const d = json as Partial<Highs>;
  if (!Array.isArray(d.rows)) throw new StockError('創新高資料格式不正確');
  return json as Highs;
}
