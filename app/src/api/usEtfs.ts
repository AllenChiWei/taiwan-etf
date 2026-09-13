/* 美股 ETF 資料存取。
 *
 * 這份有 554 KB（gzip 後 120 KB），是台股那份的八倍，所以**不在開頁時載入** ——
 * 只有使用者切到美股分頁才抓。首頁的載入速度不該為了另一個分頁付代價。
 */

import type { UsEtfDataset } from '../types';
import { DataError } from './etfs';
import { decryptJson, isUnlocked } from '../lib/secure';

const BASE = import.meta.env.BASE_URL;

// 加密過的檔案。沒有密碼的人拿到的只是亂數，見 scripts/encrypt_data.py
export const US_DATA_URL = `${BASE}data/us_etfs.json.enc`;

function assertDataset(value: unknown): asserts value is UsEtfDataset {
  const d = value as Partial<UsEtfDataset> | null;
  if (!d || typeof d !== 'object') throw new DataError('美股資料格式不正確：不是物件');
  if (!Array.isArray(d.etfs)) throw new DataError('美股資料格式不正確：缺少 etfs 陣列');
  if (!d.meta) throw new DataError('美股資料格式不正確：缺少 meta');
  if (d.etfs.length === 0) throw new DataError('美股資料是空的');
}

export async function fetchUsDataset(signal?: AbortSignal): Promise<UsEtfDataset> {
  if (!isUnlocked()) throw new DataError('尚未解鎖');

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
    json = await decryptJson<unknown>(await res.arrayBuffer());
  } catch (err) {
    throw new DataError('美股資料解密失敗，請重新輸入密碼', err);
  }
  assertDataset(json);
  return json;
}
