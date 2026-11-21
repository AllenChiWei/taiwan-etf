/* 民生必需股（defensive.json，scripts/fetch_defensive.py 每天算）：便宜／合理／昂貴價與現在落在哪一區。純函式，沒有 React。
 * 主要用「這檔自己近 10 年的殖利率分布」（殖利率河流）：便宜＝最近全年股利 ÷ 第 80 百分位殖利率，合理 ÷ 第 50，昂貴 ÷ 第 20；
 * 本益比、淨值比區間與傳統股利法（平均股利 × 16／20／32）當參考。 */

export interface Band { cheap: number; fair: number; rich: number; q?: number[] }

export interface DefRow {
  c: string; n: string; cat: string; m?: string | null; i?: string | null;
  price: number; pdate: string; chg1y: number | null; hi52: number | null; lo52: number | null;
  /** 最近一次全年現金股利、所屬年份、近 5 年平均、連續配息年數、近 8 年 [年, 股利] */
  div: number | null; divYear: string | null; avg5: number | null; streak: number; divs: Array<[string, number]>;
  /** 從股利資料第一年就連續配息（實際可能更久） */
  streakMin?: boolean;
  /** 現在殖利率（%）與在近 10 年的百分位（0～1，高＝殖利率高＝股價相對便宜） */
  yield: number | null; yieldRank: number | null;
  pe: number | null; pb: number | null; peRank: number | null; pbRank: number | null;
  byYield: Band | null; byPe: Band | null; byPb: Band | null; byClassic: Band | null;
  since: string;
}

export interface DefData {
  meta: { updated: string; date: string; years: number; source: string; errors: string[] };
  rows: DefRow[];
}

export type Zone = 'cheap' | 'fairLow' | 'fairHigh' | 'rich';
export const ZONE_LABEL: Record<Zone, string> = {
  cheap: '便宜', fairLow: '合理偏低', fairHigh: '合理偏高', rich: '昂貴',
};
export const ZONE_HINT: Record<Zone, string> = {
  cheap: '在便宜價以下：歷史上少見的價位，可以分批買',
  fairLow: '介於便宜和合理之間：可以持有、逢低加碼',
  fairHigh: '介於合理和昂貴之間：持有，不追價',
  rich: '在昂貴價以上：歷史上偏貴，不追，可以考慮減碼',
};
export const ZONE_ORDER: Zone[] = ['cheap', 'fairLow', 'fairHigh', 'rich'];

export function zoneOf(price: number, b: Band | null): Zone | null {
  if (!b || !(price > 0)) return null;
  if (price <= b.cheap) return 'cheap';
  if (price <= b.fair) return 'fairLow';
  if (price <= b.rich) return 'fairHigh';
  return 'rich';
}

/** 條狀圖的刻度：從便宜價再往下 15% 到昂貴價再往上 15%（股價超出就延伸），回傳 0～1 的位置 */
export function scale(price: number, b: Band): { lo: number; hi: number; at: (v: number) => number } {
  const lo = Math.min(b.cheap * 0.85, price * 0.97);
  const hi = Math.max(b.rich * 1.15, price * 1.03);
  return { lo, hi, at: v => Math.min(1, Math.max(0, (v - lo) / (hi - lo))) };
}

/** 依區排序（便宜的在前），同區依殖利率百分位高到低 */
export function sortRows(rows: DefRow[]): DefRow[] {
  const zi = (r: DefRow) => { const z = zoneOf(r.price, r.byYield); return z ? ZONE_ORDER.indexOf(z) : 9; };
  return [...rows].sort((a, b) => zi(a) - zi(b) || (b.yieldRank ?? 0) - (a.yieldRank ?? 0));
}
