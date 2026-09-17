/* 新聞資料的存取層。與 api/etfs.ts、api/chips.ts 同一個角色。
 *
 * 跟籌碼一樣是部署時產生、不進版控的，所以 404 是正常情況之一
 * （某次部署時來源掛掉），回 null 讓畫面說「還沒有資料」。
 */

import type { NewsData } from '../lib/news.ts';

const BASE = import.meta.env.BASE_URL;

export const NEWS_URL = `${BASE}data/news.json`;

export class NewsError extends Error {
  readonly detail: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = 'NewsError';
    this.detail = detail;
  }
}

function assertNews(value: unknown): asserts value is NewsData {
  const d = value as Partial<NewsData> | null;
  if (!d || typeof d !== 'object') throw new NewsError('新聞資料格式不正確：不是物件');
  if (!Array.isArray(d.news)) throw new NewsError('新聞資料缺少 news 陣列');
  if (!Array.isArray(d.filings)) throw new NewsError('新聞資料缺少 filings 陣列');
  if (!d.meta?.updated) throw new NewsError('新聞資料缺少更新時間');
}

/** 回 null 代表這次部署沒有產生新聞資料（404），不是錯誤。 */
export async function fetchNews(signal?: AbortSignal): Promise<NewsData | null> {
  let res: Response;
  try {
    res = await fetch(NEWS_URL, { signal, cache: 'no-cache' });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NewsError('無法連線取得新聞資料，請檢查網路', err);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new NewsError(`取得新聞資料失敗（HTTP ${res.status}）`);

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new NewsError('新聞資料不是有效的 JSON', err);
  }
  assertNews(json);
  return json;
}
