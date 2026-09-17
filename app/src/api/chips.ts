/* 籌碼資料的存取層。與 api/etfs.ts 同樣的角色：只有這裡知道資料在哪。
 *
 * chips.json 跟 calc/ 一樣是部署時產生、不進版控的，所以「檔案不存在」是
 * 正常情況之一（例如某次部署時期交所沒回應）。這裡把它跟真正的錯誤分開：
 * 缺檔回 null 讓畫面說「今天還沒有資料」，格式壞掉才丟錯。
 */

import type { ChipsData } from '../lib/chips.ts';

const BASE = import.meta.env.BASE_URL;

export const CHIPS_URL = `${BASE}data/chips.json`;

export class ChipsError extends Error {
  readonly detail: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'ChipsError';
    this.detail = detail;
  }
}

function assertChips(value: unknown): asserts value is ChipsData {
  const d = value as Partial<ChipsData> | null;
  if (!d || typeof d !== 'object') throw new ChipsError('籌碼資料格式不正確：不是物件');
  if (!d.meta?.date) throw new ChipsError('籌碼資料缺少日期');
  if (!Array.isArray(d.futures)) throw new ChipsError('籌碼資料缺少期貨未平倉');
  if (!d.pc || !Array.isArray(d.pc.dates)) throw new ChipsError('籌碼資料缺少 Put/Call Ratio');
}

/** 回 null 代表這次部署沒產生籌碼資料（404），不是錯誤。 */
export async function fetchChips(signal?: AbortSignal): Promise<ChipsData | null> {
  let res: Response;
  try {
    res = await fetch(CHIPS_URL, { signal, cache: 'no-cache' });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ChipsError('無法連線取得籌碼資料，請檢查網路', err);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new ChipsError(`取得籌碼資料失敗（HTTP ${res.status}）`);

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new ChipsError('籌碼資料不是有效的 JSON', err);
  }
  assertChips(json);
  return json;
}
