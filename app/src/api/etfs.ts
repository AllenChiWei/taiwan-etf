/* 資料存取層。
 *
 * Phase 1：直接抓每日流程產生的靜態 JSON。
 * Phase 2（真的需要後端時）：只要把 fetchDataset 改成打 API，
 *   其他元件一行都不用動 —— 這正是把它獨立成一個模組的理由。
 */

import type { EtfDataset } from '../types';

/** Vite 的 base（/taiwan-etf/），換主機時只要改 vite.config.ts。 */
const BASE = import.meta.env.BASE_URL;

export const DATA_URL = `${BASE}data/etfs.json`;

export class DataError extends Error {
  // 明確宣告而不是用建構子參數屬性 —— tsconfig 開了 erasableSyntaxOnly，
  // 那個語法需要 TypeScript 產生執行期程式碼，不能單純抹除型別。
  readonly detail: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'DataError';
    this.detail = detail;
  }
}

function assertDataset(value: unknown): asserts value is EtfDataset {
  const d = value as Partial<EtfDataset> | null;
  if (!d || typeof d !== 'object') throw new DataError('資料格式不正確：不是物件');
  if (!Array.isArray(d.etfs)) throw new DataError('資料格式不正確：缺少 etfs 陣列');
  if (!Array.isArray(d.sections)) throw new DataError('資料格式不正確：缺少 sections');
  if (!d.meta) throw new DataError('資料格式不正確：缺少 meta');
  if (d.etfs.length === 0) throw new DataError('資料是空的');
}

export async function fetchDataset(signal?: AbortSignal): Promise<EtfDataset> {
  let res: Response;
  try {
    // 資料一天才變一次，但快取由 service worker 與 HTTP 標頭決定，
    // 這裡要的是「別拿瀏覽器記憶體裡的舊副本」。
    res = await fetch(DATA_URL, { signal, cache: 'no-cache' });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new DataError('無法連線取得資料，請檢查網路', err);
  }

  if (!res.ok) throw new DataError(`取得資料失敗（HTTP ${res.status}）`);

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new DataError('資料不是有效的 JSON', err);
  }

  assertDataset(json);
  return json;
}
