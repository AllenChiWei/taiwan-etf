/* 台指選擇權週選價平和的型別與統計。純函式，沒有 React。
 *
 * 價平和 = 價平履約價的 Call 收盤 + Put 收盤，價平取 |Call−Put| 最小的履約價。
 * 每一列是**該交易日收盤**的數字，也就是隔一個交易日開盤前看到的值。
 *
 * 這一頁只有兩件事需要想清楚，兩件都在這裡處理：
 *
 * 1. **到期當日的價平和接近 0**（實測週三系列在週三平均只有 15，隔天換倉後是
 *    1350）。把它混進「週三的平均」會得到一個沒有意義的數字，所以可以排除。
 * 2. **「週三的價平和」有兩種問法**：週三收盤那一筆，或週三早上開盤前看到的
 *    那一筆（＝前一個交易日收盤）。使用者問的是盤前，所以預設用後者。
 */

export type Series = 'wed' | 'fri';

export interface AtmRow {
  /** 資料交易日（收盤日） */
  d: string;
  s: Series;
  /** 0 = 該系列最近到期那口，1 = 換倉後的下一口 */
  r: 0 | 1;
  /** 合約代號，例如 202609W4 */
  c: string;
  /** 到期日 */
  e: string;
  /** 剩餘日曆天數；0 = 到期當日 */
  dte: number;
  /** 價平履約價 */
  k: number;
  call: number;
  put: number;
  diff: number;
  /** 價平和 */
  sum: number;
  /** 有完整買賣權報價的履約價數 */
  pairs: number;
  /** 1 = 配對太少，價平可能偏離 */
  thin: 0 | 1;
}

export interface AtmData {
  meta: {
    updated: string;
    latest: string | null;
    days: number;
    counts: Record<string, number>;
    minPairs: number;
    /** 每個系列記了幾口 */
    ranks?: number;
    source: string;
    note: string;
    errors: string[];
  };
  rows: AtmRow[];
}

export const SERIES_LABEL: Record<Series, string> = {
  wed: '週三選擇權',
  fri: '週五選擇權',
};

export const WEEKDAY_LABEL = ['週一', '週二', '週三', '週四', '週五'];

/**
 * 星期幾（0 = 週一 … 4 = 週五）。週末回 null。
 *
 * 用字串切出年月日再自己算，不經過 Date 的時區：資料裡的日期是台北的交易日，
 * 交給 new Date('2026-09-17') 會被當成 UTC，在台灣以西的時區就差一天。
 */
export function weekdayOf(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const wd = new Date(utc).getUTCDay();        // 0 = 週日
  if (wd === 0 || wd === 6) return null;
  return wd - 1;
}

/** 依 'data'（收盤日）或 'preopen'（下一個交易日的盤前）分組時，該用哪一天。 */
export type Basis = 'data' | 'preopen';

export interface AtmFilter {
  series: Series;
  basis: Basis;
  /** 排除到期當日那一筆（dte === 0） */
  excludeExpiry: boolean;
  /** 排除配對過少的那幾天 */
  excludeThin?: boolean;
}

/**
 * 交易日 -> 下一個交易日。從資料裡實際出現的日期推，不需要交易日曆，
 * 連假自然被跳過。最後一天沒有「下一天」，所以不會出現在對照表裡。
 */
export function nextTradingDay(rows: AtmRow[]): Map<string, string> {
  const days = [...new Set(rows.map(r => r.d))].sort();
  const map = new Map<string, string>();
  for (let i = 0; i < days.length - 1; i++) map.set(days[i], days[i + 1]);
  return map;
}

/**
 * 某一天某個系列要用哪一口合約。
 *
 * 規則是「符合條件中最近到期的那一口」。這條規則讓「排除到期當日」自動退到換倉後
 * 的下一口 —— 到期那天早上，交易者看的本來就是新的那口，而不是只剩幾小時的舊口。
 * 少了第二口的話那一格會變成沒有樣本（實際做過一版，週四早上的週三系列是空的）。
 */
export function pickRow(rows: AtmRow[], f: AtmFilter): AtmRow | null {
  let best: AtmRow | null = null;
  for (const r of rows) {
    if (r.s !== f.series) continue;
    if (f.excludeExpiry && r.dte === 0) continue;
    if (f.excludeThin && r.thin) continue;
    if (!best || r.dte < best.dte) best = r;
  }
  return best;
}

/** 依交易日分組（同一天同一系列會有兩口）。 */
export function byDay(rows: AtmRow[]): Map<string, AtmRow[]> {
  const map = new Map<string, AtmRow[]>();
  for (const r of rows) {
    if (!map.has(r.d)) map.set(r.d, []);
    map.get(r.d)!.push(r);
  }
  return map;
}

export interface WeekdayStat {
  /** 0 = 週一 */
  wd: number;
  avg: number | null;
  n: number;
  min: number | null;
  max: number | null;
}

/**
 * 週一到週五的價平和平均。
 *
 * basis='preopen' 時，一筆收盤資料會被算到**下一個交易日**的星期上 ——
 * 星期五收盤的那筆算進星期一，因為那正是星期一開盤前看到的數字。最後一個
 * 交易日還沒有「下一天」，所以會被排除（它要等下一個交易日才派上用場）。
 *
 * 每一天只取一口（見 pickRow），不然同一天的兩口會一起進平均。
 */
export function weekdayAverages(rows: AtmRow[], f: AtmFilter): WeekdayStat[] {
  const next = f.basis === 'preopen' ? nextTradingDay(rows) : null;
  const buckets = new Map<number, number[]>();

  for (const [day, dayRows] of byDay(rows)) {
    const pick = pickRow(dayRows, f);
    if (!pick) continue;
    const useDay = next ? next.get(day) : day;
    if (!useDay) continue;                    // 盤前基準下，最後一筆還沒有用到的日子
    const wd = weekdayOf(useDay);
    if (wd === null) continue;
    if (!buckets.has(wd)) buckets.set(wd, []);
    buckets.get(wd)!.push(pick.sum);
  }

  return WEEKDAY_LABEL.map((_, wd) => {
    const vals = buckets.get(wd) ?? [];
    if (vals.length === 0) return { wd, avg: null, n: 0, min: null, max: null };
    const total = vals.reduce((a, b) => a + b, 0);
    return {
      wd,
      avg: Math.round((total / vals.length) * 10) / 10,
      n: vals.length,
      min: Math.min(...vals),
      max: Math.max(...vals),
    };
  });
}

/** 某個系列最新一天、符合條件的那一口。 */
export function latestOf(rows: AtmRow[], f: AtmFilter): AtmRow | null {
  const days = [...new Set(rows.filter(r => r.s === f.series).map(r => r.d))].sort();
  for (let i = days.length - 1; i >= 0; i--) {
    const pick = pickRow(rows.filter(r => r.d === days[i]), f);
    if (pick) return pick;
  }
  return null;
}

/** 某個系列的近期列（每天一口，與平均用的是同一條挑選規則），新到舊。 */
export function recentOf(rows: AtmRow[], f: AtmFilter, limit = 10): AtmRow[] {
  const out: AtmRow[] = [];
  const days = [...byDay(rows).entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  for (const [, dayRows] of days) {
    const pick = pickRow(dayRows, f);
    if (pick) out.push(pick);
    if (out.length >= limit) break;
  }
  return out;
}
