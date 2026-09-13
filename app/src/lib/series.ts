/* 績效曲線的對齊與正規化 —— 純函式，沒有 React 也沒有 DOM，可直接用 node --test 跑。
 *
 * 要解的問題：使用者勾選幾檔 ETF 比較績效，但它們上市日不同，台股與美股的交易日曆
 * 也不一樣（假日不同）。規則是「以最晚上市那檔的起點為共同起點」，所有曲線在該點
 * 歸零成 100，之後的差距才是真正的績效差。
 */

export interface RawSeries {
  code: string;
  /** 該標的第一個有報價的日子在市場日曆中的索引 */
  first: number;
  /** 從 first 開始、對齊市場日曆的還原收盤價，缺值為 null */
  values: Array<number | null>;
}

export interface SeriesInput {
  code: string;
  label: string;
  market: 'tw' | 'us';
  raw: RawSeries;
  /** 該市場的交易日曆（YYYY-MM-DD） */
  calendar: string[];
}

export interface AlignedSeries {
  code: string;
  label: string;
  market: 'tw' | 'us';
  /** 與 AlignedResult.dates 等長，已正規化成起點 = 100；尚無資料處為 null */
  points: Array<number | null>;
  /** 期間累積報酬（%） */
  totalReturn: number | null;
}

export interface AlignedResult {
  dates: string[];
  series: AlignedSeries[];
  /** 共同起點，即所有選取標的中最晚的上市日（或使用者選的期間起點，取較晚者） */
  startDate: string | null;
  /** 因為資料不足而被排除的代號 */
  dropped: string[];
}

/** 把 raw 攤平成 日期 -> 價格。缺值跳過，不製造假資料。 */
export function toDateMap(input: SeriesInput): Map<string, number> {
  const out = new Map<string, number>();
  const { calendar, raw } = input;
  for (let i = 0; i < raw.values.length; i++) {
    const v = raw.values[i];
    if (v === null || v === undefined) continue;
    const d = calendar[raw.first + i];
    if (d) out.set(d, v);
  }
  return out;
}

/** 該標的最早有報價的日期。 */
export function firstDate(input: SeriesInput): string | null {
  const { calendar, raw } = input;
  for (let i = 0; i < raw.values.length; i++) {
    if (raw.values[i] !== null && raw.values[i] !== undefined) {
      return calendar[raw.first + i] ?? null;
    }
  }
  return null;
}

/**
 * 對齊多條曲線。
 *
 * @param inputs 要比較的標的
 * @param minStart 使用者選的期間起點（YYYY-MM-DD）。實際起點取它與「最晚上市日」
 *                 之中較晚的那個 —— 這正是使用者要的規則：不能拿一檔還沒上市的
 *                 期間去跟別人比。
 */
export function alignSeries(inputs: SeriesInput[], minStart?: string): AlignedResult {
  const usable: Array<{ input: SeriesInput; map: Map<string, number>; first: string }> = [];
  const dropped: string[] = [];

  for (const input of inputs) {
    const first = firstDate(input);
    const map = toDateMap(input);
    if (!first || map.size < 2) { dropped.push(input.code); continue; }
    usable.push({ input, map, first });
  }

  if (usable.length === 0) {
    return { dates: [], series: [], startDate: null, dropped };
  }

  // 共同起點 = 最晚的上市日，若使用者另選了期間則取較晚者
  let start = usable.reduce((acc, u) => (u.first > acc ? u.first : acc), usable[0].first);
  if (minStart && minStart > start) start = minStart;

  // 跨市場時兩邊的交易日不同，取聯集當作橫軸，各自用前值補齊
  const dateSet = new Set<string>();
  for (const u of usable) {
    for (const d of u.map.keys()) if (d >= start) dateSet.add(d);
  }
  const dates = [...dateSet].sort();

  if (dates.length === 0) {
    return { dates: [], series: [], startDate: start, dropped };
  }

  const series: AlignedSeries[] = usable.map(({ input, map }) => {
    const points: Array<number | null> = [];
    let base: number | null = null;
    let last: number | null = null;

    for (const d of dates) {
      const v = map.get(d);
      if (v !== undefined) last = v;
      // 前值補齊：某市場放假那天沿用上一個交易日的價格
      if (last === null) { points.push(null); continue; }
      if (base === null) base = last;
      points.push((last / base) * 100);
    }

    const finite = points.filter((p): p is number => p !== null);
    const totalReturn = finite.length ? finite[finite.length - 1] - 100 : null;
    return { code: input.code, label: input.label, market: input.market, points, totalReturn };
  });

  return { dates, series, startDate: start, dropped };
}

/** 圖表 Y 軸範圍，含一點留白。 */
export function extent(series: AlignedSeries[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (p === null) continue;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [90, 110];
  if (lo === hi) return [lo - 5, hi + 5];
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** 期間選項 -> 起始日期字串。null 代表「全部」。 */
export function periodStart(period: string, latest: string): string | null {
  const months: Record<string, number> = { '3m': 3, '6m': 6, '1y': 12, '3y': 36, '5y': 60 };
  const m = months[period];
  if (!m) return null;
  const d = new Date(latest);
  d.setMonth(d.getMonth() - m);
  return d.toISOString().slice(0, 10);
}
