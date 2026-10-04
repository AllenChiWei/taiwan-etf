/* 盤中價平和（每 15 分鐘）的統計。資料由 scripts/fetch_atm_intraday.py 產生，
 * 每個交易日一個檔，含「前一晚夜盤 ＋ 當天日盤」。
 *
 * 要回答的問題是「雙賣在什麼時候比較有利」，所以重點是**時間價值在一天之中怎麼消耗**：
 * 以當天第一個有報價的時間點為 1，看之後每個時間點剩下幾成（中位數，跨很多天），
 * 依剩餘天數分組 —— 到期當天、前一天、前兩天的消耗速度完全不同，混在一起沒有意義。 */

import type { Series } from './atm.ts';

export type Session = 'N' | 'D';

export interface AtmDayRow {
  s: Series;
  /** 0 = 最近到期，1 = 第二近 */
  r: number;
  c: string;
  e: string;
  /** 剩餘日曆天數（以交易日計，0 = 到期當日） */
  dte: number;
  k: Array<number | null>;
  call: Array<number | null>;
  put: Array<number | null>;
}

export interface AtmDay {
  d: string;
  step: number;
  /** 每個時間點屬於夜盤（N）或日盤（D） */
  sess: Session[];
  t: string[];
  rows: AtmDayRow[];
}

export interface AtmIntradayIndex {
  dates: string[];
  /** 只有夜盤（當天日盤還沒收盤）的日期 */
  partial?: string[];
  step: number;
  source: string;
}

/** 每個時間點的價平和；沒有足夠成交的時間點是 null。 */
export function sums(row: AtmDayRow): Array<number | null> {
  return row.call.map((c, i) => {
    const p = row.put[i];
    return c === null || p === null ? null : Math.round((c + p) * 10) / 10;
  });
}

/** 合成期貨 = 履約價 + Call − Put。 */
export function synthetic(row: AtmDayRow): Array<number | null> {
  return row.call.map((c, i) => {
    const p = row.put[i];
    const k = row.k[i];
    return c === null || p === null || k === null ? null : Math.round(k + c - p);
  });
}

/** 60 分鐘：只留整點，以及每個盤別的最後一點（日盤 13:45、夜盤 05:00）。 */
export function hourlyIndex(day: AtmDay): number[] {
  const out: number[] = [];
  day.t.forEach((t, i) => {
    const lastOfSession = i === day.t.length - 1 || day.sess[i + 1] !== day.sess[i];
    if (t.endsWith(':00') || lastOfSession) out.push(i);
  });
  return out;
}

/**
 * 這一天要看的那口合約。到期當天最近那口在收盤前就歸零，盤前交易者看的是換倉後的下一口，
 * 所以 excludeExpiry 時退到第二口（與 lib/atm.ts 的「排除到期當日」同一個概念）。
 */
export function pickRow(day: AtmDay, series: Series, excludeExpiry: boolean): AtmDayRow | null {
  const rows = day.rows.filter(r => r.s === series).sort((a, b) => a.r - b.r);
  if (!rows.length) return null;
  if (excludeExpiry && rows[0].dte === 0) return rows[1] ?? null;
  return rows[0];
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface DecayCurve {
  dte: number;
  /** 天數（樣本數） */
  days: number;
  /** 每個時間點：剩下的比例（中位數），起點 = 1 */
  ratio: Array<number | null>;
  /** 起點價平和的中位數（點） */
  start: number | null;
}

/**
 * 依剩餘天數分組的消耗曲線。每天以「當天第一個有報價的時間點」為 1；
 * 某個時間點至少要有 minDays 天的樣本才畫，否則是 null（避免一兩天的雜訊）。
 * 只看最近到期那口（r=0），因為消耗的問題就是在問「手上這口」。
 */
export function decayCurves(days: AtmDay[], series: Series, minDays = 3): DecayCurve[] {
  if (!days.length) return [];
  const len = days[0].t.length;
  const groups = new Map<number, Array<Array<number | null>>>();
  const starts = new Map<number, number[]>();
  for (const day of days) {
    if (day.t.length !== len) continue;
    const row = day.rows.find(r => r.s === series && r.r === 0);
    if (!row) continue;
    const v = sums(row);
    const first = v.findIndex(x => x !== null && x > 0);
    if (first < 0) continue;
    const base = v[first] as number;
    const ratio = v.map((x, i) => (i < first || x === null ? null : x / base));
    if (!groups.has(row.dte)) { groups.set(row.dte, []); starts.set(row.dte, []); }
    groups.get(row.dte)!.push(ratio);
    starts.get(row.dte)!.push(base);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([dte, rs]) => ({
    dte,
    days: rs.length,
    start: median(starts.get(dte)!),
    ratio: Array.from({ length: len }, (_, i) => {
      const xs = rs.map(r => r[i]).filter((x): x is number => x !== null);
      return xs.length >= Math.min(minDays, rs.length) ? median(xs) : null;
    }),
  }));
}

export interface SessionDecay {
  dte: number;
  days: number;
  /** 夜盤（起點 → 05:00）流失的比例，中位數 */
  night: number | null;
  /** 05:00 → 日盤開盤後第一點的跳動 */
  gap: number | null;
  /** 日盤（第一點 → 13:45）流失的比例 */
  day: number | null;
}

/** 把一天拆成夜盤、隔夜跳空、日盤三段，各自流失多少（比例，正數 = 變便宜，對賣方有利）。 */
export function sessionDecay(days: AtmDay[], series: Series): SessionDecay[] {
  const acc = new Map<number, { n: number[]; g: number[]; d: number[]; cnt: number }>();
  for (const day of days) {
    const row = day.rows.find(r => r.s === series && r.r === 0);
    if (!row) continue;
    const v = sums(row);
    const idx = (s: Session, last: boolean) => {
      const is = day.sess.map((x, i) => (x === s && v[i] !== null ? i : -1)).filter(i => i >= 0);
      return is.length ? is[last ? is.length - 1 : 0] : -1;
    };
    const n0 = idx('N', false), n1 = idx('N', true), d0 = idx('D', false), d1 = idx('D', true);
    const a = acc.get(row.dte) ?? { n: [], g: [], d: [], cnt: 0 };
    a.cnt++;
    const lost = (i: number, j: number) => (i >= 0 && j >= 0 && (v[i] as number) > 0
      ? 1 - (v[j] as number) / (v[i] as number) : null);
    const n = lost(n0, n1), g = lost(n1, d0), dd = lost(d0, d1);
    if (n !== null && n1 > n0) a.n.push(n);
    if (g !== null) a.g.push(g);
    if (dd !== null && d1 > d0) a.d.push(dd);
    acc.set(row.dte, a);
  }
  return [...acc.entries()].sort((x, y) => x[0] - y[0]).map(([dte, a]) => ({
    dte, days: a.cnt, night: median(a.n), gap: median(a.g), day: median(a.d),
  }));
}
