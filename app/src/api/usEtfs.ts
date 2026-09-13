/* 美股 ETF 資料存取。
 *
 * 這份有 554 KB（gzip 後 120 KB），是台股那份的八倍，所以**不在開頁時載入** ——
 * 只有使用者切到美股分頁才抓。首頁的載入速度不該為了另一個分頁付代價。
 */

import type { UsEtfDataset } from '../types';
import { DataError } from './etfs';
const BASE = import.meta.env.BASE_URL;

// 這份是公開的：代號／名稱／交易所來自 Nasdaq Trader 的公開檔案，五個報酬率與
// 成交金額是我們自己從價格算出來的衍生統計。真正受保護的是 series/ 裡的價格序列。
export const US_DATA_URL = `${BASE}data/us_etfs.json`;

function assertDataset(value: unknown): asserts value is UsEtfDataset {
  const d = value as Partial<UsEtfDataset> | null;
  if (!d || typeof d !== 'object') throw new DataError('美股資料格式不正確：不是物件');
  if (!Array.isArray(d.etfs)) throw new DataError('美股資料格式不正確：缺少 etfs 陣列');
  if (!d.meta) throw new DataError('美股資料格式不正確：缺少 meta');
  if (d.etfs.length === 0) throw new DataError('美股資料是空的');
}

export async function fetchUsDataset(signal?: AbortSignal): Promise<UsEtfDataset> {
  let res: Response;
  try {
    res = await fetch(US_DATA_URL, { signal, cache: 'no-cache' });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new DataError('無法連線取得美股資料，請檢查網路', err);
  }
  if (!res.ok) throw new DataError(`取得美股資料失敗（HTTP ${res.status}）`);

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new DataError('美股資料不是有效的 JSON', err);
  }
  assertDataset(json);
  return json;
}
