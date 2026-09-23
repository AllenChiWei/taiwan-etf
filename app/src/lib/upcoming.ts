/* 還沒上市的 ETF：募集中、待上市、明天上市。純函式，沒有 React。
 *
 * 資料來自 scripts/fetch_upcoming.py。官方沒有「募集中」的結構化清單，所以代號與
 * 日期是從鉅亨網新聞推出來的；上市前一天證交所簡介發布後才有完整規格。
 * **已上市的不列**（站主指定）—— 那些在台股清單裡就看得到。
 */

export type Stage = 'raising' | 'listing' | 'tomorrow';

export interface UpcomingItem {
  code: string;
  /** 從新聞或簡介推出的名稱；推不出來是 null */
  name: string | null;
  issuer: string | null;
  /** 開募日「9/16」（新聞推的，不寫年份） */
  raise: string | null;
  /** 預計上市日 YYYY-MM-DD；還沒公布是 null */
  listing: string | null;
  stage: Stage;
  /** twse = 證交所簡介（官方）；news = 新聞推的 */
  source: 'twse' | 'news';
  /** 證交所簡介連結 */
  url: string | null;
  /** [欄名, 內容]，只有證交所簡介才有 */
  fields: [string, string][];
  /** [標題, 連結, 日期] —— 只存標題與連結 */
  news: [string, string, string][];
}

export interface UpcomingData {
  meta: { updated: string; source: string; note: string; errors?: string[] };
  items: UpcomingItem[];
}

export const STAGE_LABEL: Record<Stage, string> = {
  raising: '募集中／待上市',
  listing: '已排定上市',
  tomorrow: '即將上市',
};

/** 台北的今天。用 Intl 取，不經過瀏覽器所在時區。 */
export function taipeiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * 還沒上市的才留。部署是一天一次，資料可能比畫面舊一天：上市日在今天或之前的，
 * 在瀏覽器這邊再濾一次，免得清單上掛著「已經上市了」的東西。
 */
export function stillUpcoming(items: UpcomingItem[], today: string): UpcomingItem[] {
  return items.filter(it => !it.listing || it.listing > today);
}

/** 距離上市還有幾天；沒有上市日回 null。 */
export function daysUntil(listing: string | null, today: string): number | null {
  if (!listing) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+listing.slice(0, 4), +listing.slice(5, 7) - 1, +listing.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** 簡介裡幾個最常看的欄位，給卡片摘要用；其餘在展開後照原樣列出。 */
export function pick(fields: [string, string][], ...keys: string[]): string | null {
  for (const k of keys) {
    const hit = fields.find(([name]) => name.includes(k));
    if (hit) return hit[1];
  }
  return null;
}
