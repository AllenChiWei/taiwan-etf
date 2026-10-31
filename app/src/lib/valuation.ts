/* 個股估值：本益比／淨值比的歷史百分位、河流圖、預估本益比。純函式，tests/valuation.test.ts 直接跑。
 *
 * 資料是 FinMind 的 TaiwanStockPER（證交所／櫃買每日公布的本益比、淨值比、殖利率）與
 * TaiwanStockPrice（收盤價），打開個股時由瀏覽器抓（api/finmind.ts）。
 *
 * 河流圖要的「近四季 EPS」不另外抓財報，直接用 收盤價 ÷ 本益比 反推：交易所的本益比
 * 就是用近四季 EPS 算的，反推回來跟它自己的口徑一致（台積電 2026-10-30：2370 ÷ 27.47
 * = 86.28 元）。本益比只到小數兩位，反推誤差約萬分之二，畫圖用不到那麼細。
 * 交易所在近四季 EPS ≤ 0 時本益比給 0 —— 那幾天沒有 EPS、也不畫河流。
 *
 * 預估本益比兩種：
 * - 營收推估：近 3 個月營收比去年同期成長多少，就假設未來四季 EPS 比近四季多多少
 *   （淨利率不變）。這是很粗的假設，毛利率變動、業外損益、匯兌都不在裡面，畫面標「推估」。
 * - 自己輸入 EPS：算出本益比、落在歷史哪裡、各百分位倍數對應的股價。
 */

import type { Month } from './stock';

export interface PerRow { date: string; PER: number; PBR: number; dividend_yield: number }
export interface PriceRow { date: string; close: number }

export interface ValPoint {
  date: string;
  close: number;
  per: number | null;
  pbr: number | null;
  yld: number | null;
  /** 近四季 EPS（收盤價 ÷ 本益比） */
  eps: number | null;
  /** 每股淨值（收盤價 ÷ 淨值比） */
  bps: number | null;
}

export type ValKey = 'per' | 'pbr';

/** 河流的五條線：歷史第 10、25、50、75、90 百分位的倍數。 */
export const BAND_PCTS = [10, 25, 50, 75, 90] as const;

/** 兩份資料依日期接起來；任一邊缺的那天丟掉。 */
export function joinValuation(per: PerRow[], price: PriceRow[]): ValPoint[] {
  const px = new Map(price.map(r => [r.date, Number(r.close)]));
  const out: ValPoint[] = [];
  for (const r of per) {
    const close = px.get(r.date);
    if (!close || !(close > 0)) continue;
    const pe = Number(r.PER) > 0 ? Number(r.PER) : null;
    const pb = Number(r.PBR) > 0 ? Number(r.PBR) : null;
    const y = Number(r.dividend_yield);
    out.push({
      date: r.date, close, per: pe, pbr: pb, yld: Number.isFinite(y) ? y : null,
      eps: pe === null ? null : close / pe,
      bps: pb === null ? null : close / pb,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 最後一天往前 N 年（含）。 */
export function lastYears(points: ValPoint[], years: number): ValPoint[] {
  if (!points.length) return [];
  const end = points[points.length - 1].date;
  const start = `${Number(end.slice(0, 4)) - years}${end.slice(4)}`;
  return points.filter(p => p.date > start);
}

/** 線性內插的百分位（p 為 0～100）；sorted 要先由小到大排好。 */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const k = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(k); const hi = Math.ceil(k);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}

/** 目前的值比歷史上多少比例的天數高（0～100）。 */
export function rankPct(values: number[], cur: number): number | null {
  if (!values.length) return null;
  let below = 0; let equal = 0;
  for (const v of values) { if (v < cur) below++; else if (v === cur) equal++; }
  return ((below + equal / 2) / values.length) * 100;
}

/** 一年至少要有大約半年的有效天數，否則百分位太不穩，不算。 */
const MIN_DAYS = 120;

export interface Stats {
  key: ValKey;
  cur: number | null;
  /** 目前在歷史的百分位 */
  pct: number | null;
  /** BAND_PCTS 對應的倍數 */
  bands: number[] | null;
  /** 參與計算的天數 */
  n: number;
}

export function stats(points: ValPoint[], key: ValKey): Stats {
  const vals = points.map(p => p[key]).filter((v): v is number => v !== null);
  const cur = points.length ? points[points.length - 1][key] : null;
  if (vals.length < MIN_DAYS) return { key, cur, pct: null, bands: null, n: vals.length };
  const sorted = [...vals].sort((a, b) => a - b);
  return {
    key, cur, n: vals.length,
    pct: cur === null ? null : rankPct(vals, cur),
    bands: BAND_PCTS.map(p => percentile(sorted, p)),
  };
}

/** 百分位的白話。 */
export function zone(pct: number | null): { label: string; tone: 'low' | 'mid' | 'high' | null } {
  if (pct === null) return { label: '—', tone: null };
  if (pct < 25) return { label: '歷史低檔', tone: 'low' };
  if (pct > 75) return { label: '歷史高檔', tone: 'high' };
  return { label: '歷史中段', tone: 'mid' };
}

/** 河流圖的點：每月最後一個交易日，加上最新一天。每點的河流 = 當時的 EPS（或淨值）× 各倍數。 */
export interface RiverPoint { date: string; close: number; bands: (number | null)[] }

export function river(points: ValPoint[], key: ValKey, multiples: number[]): RiverPoint[] {
  const base = key === 'per' ? 'eps' : 'bps';
  const out: RiverPoint[] = [];
  points.forEach((p, i) => {
    const next = points[i + 1];
    if (next && next.date.slice(0, 7) === p.date.slice(0, 7)) return;     // 不是月底
    const b = p[base];
    out.push({ date: p.date, close: p.close, bands: multiples.map(m => (b === null ? null : b * m)) });
  });
  return out;
}

/** 營收推估。 */
export interface RevenueEstimate {
  /** 用到的月份（舊到新） */
  months: string[];
  /** 近 N 個月合計比去年同期成長（%） */
  growth: number;
  /** 推估未來四季 EPS */
  eps: number;
  /** 近 N 個月營收合計、去年同期合計（千元）—— 篩選頁拿來擋基期近零的 */
  cur: number;
  prev: number;
}

/**
 * 近 3 個月（不足就用有的，至少 1 個月）營收合計 ÷ 去年同期合計 − 1，套到近四季 EPS 上。
 * 去年同月由當月營收與年增率反推（月營收端點只給當月與年增率）。
 * 近四季 EPS ≤ 0 不推：虧損公司乘上成長率沒有意義。
 */
export function revenueEstimate(months: Month[], ttmEps: number | null, n = 3): RevenueEstimate | null {
  if (ttmEps === null || !(ttmEps > 0)) return null;
  const usable = months
    .filter(m => m.rev != null && m.rev > 0 && m.yoy != null && m.yoy > -100)
    .sort((a, b) => (a.p < b.p ? -1 : 1))
    .slice(-n);
  if (!usable.length) return null;
  const cur = usable.reduce((s, m) => s + (m.rev as number), 0);
  const prev = usable.reduce((s, m) => s + (m.rev as number) / (1 + (m.yoy as number) / 100), 0);
  if (!(prev > 0)) return null;
  const growth = (cur / prev - 1) * 100;
  return { months: usable.map(m => m.p), growth, eps: ttmEps * (cur / prev), cur, prev };
}

/** 給定 EPS（或每股淨值）：目前價格對應的倍數、在歷史的百分位、各百分位倍數對應的股價。 */
export interface Implied { multiple: number; pct: number | null; prices: number[] }

export function implied(price: number, base: number, history: ValPoint[], key: ValKey, s: Stats): Implied | null {
  if (!(base > 0) || !s.bands) return null;
  const multiple = price / base;
  const vals = history.map(p => p[key]).filter((v): v is number => v !== null);
  return { multiple, pct: rankPct(vals, multiple), prices: s.bands.map(m => base * m) };
}

/** 金融股看淨值比：本益比受呆帳提存、投資損益影響大，淨值才是主體。 */
export const FINANCIAL = new Set(['金融保險業', '金融業']);

/** 景氣循環產業：獲利高峰時本益比最低，看起來最便宜 —— 本益比會騙人，提示改看淨值比。 */
export const CYCLICAL = new Set(['航運業', '鋼鐵工業', '塑膠工業', '水泥工業', '造紙工業', '玻璃陶瓷',
  '化學工業', '橡膠工業', '紡織纖維', '油電燃氣業']);

/** 預設看哪一種：金融股、或目前沒有本益比（虧損）就看淨值比。 */
export function defaultKey(industry: string | undefined, latest: ValPoint | undefined): ValKey {
  if (industry && FINANCIAL.has(industry)) return 'pbr';
  if (latest && latest.per === null && latest.pbr !== null) return 'pbr';
  return 'per';
}
