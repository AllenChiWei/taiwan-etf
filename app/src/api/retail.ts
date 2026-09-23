/* 散戶多空比歷史的存取層。
 *
 * retail.json 是**進版控**的累積檔，跟 atm.json 一樣；仍然容許 404 ——
 * 這個站的資料檔一律不假設一定存在。
 */

import type { RetailData } from '../lib/retail.ts';

const BASE = import.meta.env.BASE_URL;

export const RETAIL_URL = `${BASE}data/retail.json`;

export async function fetchRetail(signal?: AbortSignal): Promise<RetailData | null> {
  let res: Response;
  try {
    res = await fetch(RETAIL_URL, { signal, cache: 'no-cache' });
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
  if (!res.ok) return null;
  try {
    const d = (await res.json()) as Partial<RetailData>;
    if (!d.contracts || !d.taiex) return null;
    return d as RetailData;
  } catch {
    return null;
  }
}
