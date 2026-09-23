/* 即將上市／近期新上市的 ETF，以及「募集、核准」的新聞雷達。純函式，沒有 React。
 *
 * 資料來自 scripts/fetch_upcoming.py（證交所 e添富的新上市簡介）。那份簡介通常在
 * 上市前一天才發布，所以更早的「已核准、募集中」只能靠新聞標題補 —— 官方沒有
 * 結構化的清單（查過證交所 OpenAPI、集保、投信投顧公會）。
 */

import type { NewsItem } from './news.ts';

export interface UpcomingItem {
  code: string;
  name: string;
  /** 上市交易日期 YYYY-MM-DD；簡介沒寫時 null */
  listing: string | null;
  /** 簡介發布日 */
  posted: string;
  url: string;
  /** [欄名, 內容]，照簡介原本的順序 */
  fields: [string, string][];
}

export interface UpcomingData {
  meta: { updated: string; source: string; note: string };
  items: UpcomingItem[];
}

export type ListingStatus = 'upcoming' | 'today' | 'listed';

export const STATUS_LABEL: Record<ListingStatus, string> = {
  upcoming: '即將上市', today: '今天上市', listed: '已上市',
};

/** 相對於 today（YYYY-MM-DD，台北日期）是還沒上市、今天、還是已經上市。 */
export function listingStatus(listing: string | null, today: string): ListingStatus {
  if (!listing) return 'upcoming';
  if (listing > today) return 'upcoming';
  if (listing === today) return 'today';
  return 'listed';
}

/** 台北的今天。用 Intl 取，不經過瀏覽器所在時區。 */
export function taipeiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** 簡介裡幾個最常看的欄位，給卡片摘要用；其餘在展開後照原樣列出。 */
export function pick(fields: [string, string][], ...keys: string[]): string | null {
  for (const k of keys) {
    const hit = fields.find(([name]) => name.includes(k));
    if (hit) return hit[1];
  }
  return null;
}

/**
 * 新聞雷達：標題同時提到 ETF 與「募集／核准／掛牌／上市／申購」的新聞。
 * 這是還沒發布上市簡介之前，唯一看得到的訊號 —— 只放標題與連結。
 */
const RADAR = /(募集|核准|掛牌|上市|申購|開募|首募|新發)/;

export function newsRadar(news: NewsItem[]): NewsItem[] {
  return news.filter(n => /ETF/i.test(n.t) && RADAR.test(n.t));
}
