/* 價平和資料的存取層。
 *
 * atm.json 是**進版控**的累積檔（每天兩列），所以它不像籌碼那樣可能整份缺席；
 * 但仍然容許 404 —— 這個站的資料檔一律不假設一定存在。
 */

import type { AtmData } from '../lib/atm.ts';

const BASE = import.meta.env.BASE_URL;

export const ATM_URL = `${BASE}data/atm.json`;

export class AtmError extends Error {
  readonly detail: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'AtmError';
    this.detail = detail;
  }
}

export async function fetchAtm(signal?: AbortSignal): Promise<AtmData | null> {
  let res: Response;
  try {
    res = await fetch(ATM_URL, { signal, cache: 'no-cache' });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new AtmError('無法連線取得價平和資料，請檢查網路', err);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new AtmError(`取得價平和資料失敗（HTTP ${res.status}）`);

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new AtmError('價平和資料不是有效的 JSON', err);
  }
  const d = json as Partial<AtmData>;
  if (!Array.isArray(d.rows) || !d.meta) throw new AtmError('價平和資料格式不正確');
  return json as AtmData;
}
