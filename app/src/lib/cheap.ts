/* 低本益比篩選：全市場的預估本益比。純函式，tests/cheap.test.ts 直接跑。
 *
 * 資料是 stocks/pe.json（scripts/fetch_pe.py，部署時產生）：交易所每日本益比與收盤價，
 * 加上每檔近 3 個月營收。預估本益比跟個股頁「營收推估」是同一支 revenueEstimate()，
 * 所以兩邊的數字一定一樣：近 3 個月營收比去年同期成長多少，就假設未來四季 EPS 多多少。
 *
 * 這個假設在幾種情況下會失真，所以預設排除或標出來：
 * - 基期近零：建設公司依完工比例認列，去年同月可能只有幾十萬，成長 +2,630,241%，
 *   預估本益比變成 0.0 倍 —— 跟營收排行同一個坑，同樣把門檻套在本期與基期兩邊。
 * - 營收倍增以上：淨利率幾乎一定跟著變，「淨利率不變」不成立。
 * - 金融股：月營收含投資損益，一個月可以 −60%；而且金融股本來就該看淨值比。
 * - 景氣循環股：獲利高峰時本益比最低，看起來最便宜（只標出來，預設不排除）。
 */

import type { Month } from './stock';
import { revenueEstimate, FINANCIAL, CYCLICAL } from './valuation.ts';

export interface PeRow {
  c: string; n: string; m: string; i: string;
  /** 收盤價 */
  p: number;
  /** 近四季本益比（交易所公布） */
  pe: number;
  pb: number | null;
  /** 殖利率（%） */
  y: number | null;
  /** 成交金額（元） */
  v: number | null;
  /** 近 3 個可用月份：[期別, 營收（千元）, 年增率 %] */
  r: Array<[string, number, number]>;
}

export interface PeData {
  meta: {
    date: string | null;
    dates: Record<string, string | null>;
    months: string[];
    count: number;
    updated: string;
    source: string;
  };
  rows: PeRow[];
}

export interface CheapRow extends PeRow {
  /** 預估本益比 */
  fpe: number;
  /** 近 N 個月營收比去年同期（%） */
  growth: number;
  /** 用到的月份 */
  months: string[];
  /** 本期、基期的月平均營收（千元） */
  revAvg: number;
  baseAvg: number;
  financial: boolean;
  cyclical: boolean;
}

/** 營收年增超過這麼多就不信「淨利率不變」。 */
export const EXTREME_GROWTH = 100;

/** 算出每檔的預估本益比；近四季虧損或沒有可用月營收的不列。 */
export function enrich(rows: PeRow[]): CheapRow[] {
  const out: CheapRow[] = [];
  for (const r of rows) {
    if (!(r.pe > 0) || !(r.p > 0)) continue;
    const months: Month[] = r.r.map(([p, rev, yoy]) => ({ p, rev, yoy }));
    const est = revenueEstimate(months, r.p / r.pe);
    if (!est || !(est.eps > 0)) continue;
    const n = est.months.length;
    out.push({
      ...r,
      fpe: r.p / est.eps,
      growth: est.growth,
      months: est.months,
      revAvg: est.cur / n,
      baseAvg: est.prev / n,
      financial: FINANCIAL.has(r.i),
      cyclical: CYCLICAL.has(r.i),
    });
  }
  return out;
}

export type CheapSort = 'fpe' | 'growth' | 'yield' | 'pe';

export interface CheapOptions {
  /** 預估本益比上限（不含） */
  maxFpe: number;
  sort?: CheapSort;
  /** '' 全部 / '上市' / '上櫃' */
  market?: string;
  /** 月平均營收門檻（千元），本期與基期都要過 */
  minRev?: number;
  /** 成交金額門檻（元） */
  minValue?: number;
  exFinancial?: boolean;
  exCyclical?: boolean;
  /** 排除營收年增超過 EXTREME_GROWTH 的 */
  exExtreme?: boolean;
}

/** 依條件篩選並排序。本益比由低到高，成長與殖利率由高到低；同值依代號。 */
export function screen(rows: CheapRow[], opts: CheapOptions): CheapRow[] {
  const {
    maxFpe, sort = 'fpe', market = '', minRev = 0, minValue = 0,
    exFinancial = false, exCyclical = false, exExtreme = false,
  } = opts;
  const out = rows.filter(r => {
    if (!(r.fpe < maxFpe)) return false;
    if (market && r.m !== market) return false;
    if (minRev && (r.revAvg < minRev || r.baseAvg < minRev)) return false;
    if (minValue && (r.v ?? 0) < minValue) return false;
    if (exFinancial && r.financial) return false;
    if (exCyclical && r.cyclical) return false;
    if (exExtreme && r.growth > EXTREME_GROWTH) return false;
    return true;
  });
  const key = (r: CheapRow): number => {
    switch (sort) {
      case 'growth': return -r.growth;
      case 'yield': return -(r.y ?? -Infinity);
      case 'pe': return r.pe;
      default: return r.fpe;
    }
  };
  return out.sort((a, b) => key(a) - key(b) || (a.c < b.c ? -1 : 1));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}
