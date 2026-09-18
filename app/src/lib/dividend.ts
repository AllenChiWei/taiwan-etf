/* 持股配息試算：把幾檔 ETF 的除息紀錄攤成月曆，算出每個月與整年能領多少。
 *
 * 純函式，資料來自 scripts/fetch_calc.py 產的月頻序列（CalcSeries），
 * 那裡的 d[] 是每個月的實際除息金額，不是估的。
 *
 * ## 年配息怎麼估：最近一次 × 一年配幾次
 *
 * 用最近一次的配息金額，乘上這檔一年配幾次。好處是反映「現在的配息水準」——
 * 某檔上個月剛調高配息，這個算法馬上跟上。
 *
 * 缺點是單次配息本來就會上下波動，尤其高股息 ETF 常常某一季特別多。所以
 * 同時算出「近 12 個月實際合計」放在旁邊對照：兩個數字差很遠時，
 * 通常代表最近調整過配息，或是那次配息不具代表性 —— 那是值得看見的訊號，
 * 不該被平均掉。
 *
 * ## 一年配幾次以「公告頻率」為準
 *
 * 曾經改成從實際除息次數推，結果 00406A（2026-06 才上市的月配 ETF）只有兩筆
 * 除息紀錄，被判成半年配，年配息因此算成實際的六分之一。新上市的標的還沒配滿
 * 一年，用次數推一定錯 —— 而這種標的正是使用者最會想試算的。
 *
 * 所以以 etfs.json 的公告頻率為準。只有在公告頻率是「—」或認不得時，
 * 才退回用實際次數推。實際次數仍然留著，跟公告頻率對不上時畫面會提醒。
 */

import type { CalcSeries } from './backtest.ts';

/** 台股一張是 1000 股。介面以股為單位，這個常數只用在「換算成幾張」的提示。 */
export const SHARES_PER_LOT = 1000;

export interface Holding {
  code: string;
  /** 持有股數 */
  shares: number;
}

export interface HoldingProjection {
  code: string;
  name: string;
  shares: number;

  /** 最近一次每股配息 */
  latest: number;
  /** 最近一次除息的月份 'YYYY-MM' */
  latestMonth: string;
  /** 一年配幾次，由實際除息月份推得 */
  perYear: number;
  freq: string;
  /** 預期會除息的月份（0=一月）。已記錄到的一定在裡面，不足處按間隔補 */
  payoutMonths: number[];
  /** 實際記錄到的除息月份，用來判斷推估可不可靠 */
  actualMonths: number[];

  /** 年配息（每股）= 最近一次 × 一年幾次 */
  perShare: number;
  /** 依日曆月份攤開的每股配息，索引 0 = 一月 */
  byMonth: number[];
  /** 這筆持股一年可領 */
  annual: number;

  /** 對照用：近 12 個月實際發生的每股配息合計，以及換算成錢 */
  perShareTtm: number;
  annualTtm: number;
  /** 近 12 個月實際配息次數 */
  payouts: number;

  price: number;
  yieldPct: number;
  value: number;
  /** 這檔有幾個月的資料。不滿 12 表示推估的次數可能不準 */
  monthsListed: number;
  /** 配息金額是交易所公告的原始值（而非由還原股價回推的約略值） */
  exact: boolean;
}

export interface Portfolio {
  rows: HoldingProjection[];
  /** 每個日曆月的配息合計（元），索引 0 = 一月 */
  byMonth: number[];
  annual: number;
  annualTtm: number;
  value: number;
  yieldPct: number;
  monthlyAverage: number;
}

export const MONTH_LABELS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

/** 由近一年的實際配息次數推回頻率標籤。 */
export function inferFrequency(payouts: number): string {
  if (payouts >= 11) return '月配';
  if (payouts >= 5) return '雙月配';
  if (payouts >= 3) return '季配';
  if (payouts === 2) return '半年配';
  if (payouts === 1) return '年配';
  return '近一年未配息';
}

/** 頻率標籤對應一年幾次。 */
export function payoutsPerYear(freq: string): number {
  switch (freq) {
    case '月配': return 12;
    case '雙月配': return 6;
    case '季配': return 4;
    case '半年配': return 2;
    case '年配': return 1;
    default: return 0;
  }
}

/**
 * 推出「一年會在哪幾個月除息」。
 *
 * 已經記錄到的月份一定算數。不夠 perYear 個時，從最近一次除息的月份往後
 * 按間隔補（月配間隔 1、季配 3、半年配 6），而不是隨便挑空的月份塞。
 *
 * 這對新上市的標的特別重要：00406A 只配過 7 月與 9 月，但它是月配 ——
 * 正確的月曆是十二個月都有，而不是「7、9 月再加十個隨機月份」。
 */
export function expectedMonths(known: number[], perYear: number): number[] {
  if (perYear <= 0) return [];
  const out = new Set(known);
  if (out.size >= perYear) return [...out].sort((a, b) => a - b).slice(0, perYear);

  const interval = Math.round(12 / perYear);
  // 從最近一次已知的除息月往後推
  let cursor = known.length ? known[known.length - 1] : 0;
  let guard = 0;
  while (out.size < perYear && guard++ < 24) {
    cursor = (cursor + interval) % 12;
    out.add(cursor);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 把一檔 ETF 的配息攤成日曆月份。
 *
 * months 是整個市場共用的月份清單（'YYYY-MM'），series.first 是這檔在裡面的
 * 起始位置。只看最後 12 個有資料的月份 —— 不足 12 個就有多少算多少。
 */
export function projectHolding(
  series: CalcSeries, months: string[], shares: number,
): HoldingProjection {
  const n = series.d.length;
  const take = Math.min(12, n);

  const payoutMonths: number[] = [];
  let perShareTtm = 0;
  let payouts = 0;
  let latest = 0;
  let latestMonth = '';
  let latestExact = false;

  for (let i = n - take; i < n; i++) {
    const amount = series.d[i] ?? 0;
    if (amount <= 0) continue;
    const label = months[series.first + i];              // 'YYYY-MM'
    const m = Number(label.slice(5, 7)) - 1;
    if (!payoutMonths.includes(m)) payoutMonths.push(m);
    perShareTtm += amount;
    payouts += 1;
    latest = amount;                                     // 迴圈往後跑，最後一個就是最近的
    latestMonth = label;
    latestExact = (series.dSrc?.[i] ?? 0) === 1;
  }
  payoutMonths.sort((a, b) => a - b);

  // 公告頻率優先；認不得才退回用實際次數推
  const declared = payoutsPerYear(series.freq) > 0 ? series.freq : inferFrequency(payouts);
  const freq = declared;
  const perYear = payoutsPerYear(freq);
  const perShare = latest * perYear;

  const expected = expectedMonths(payoutMonths, perYear);
  const byMonth = new Array<number>(12).fill(0);
  for (const m of expected) byMonth[m] = latest;

  const price = series.last.close;
  return {
    code: series.code,
    name: series.name,
    shares,
    latest,
    latestMonth,
    perYear,
    freq,
    payoutMonths: expected,
    actualMonths: payoutMonths,
    perShare,
    byMonth,
    annual: perShare * shares,
    perShareTtm,
    annualTtm: perShareTtm * shares,
    payouts,
    price,
    yieldPct: price > 0 ? (perShare / price) * 100 : 0,
    value: price * shares,
    monthsListed: n,
    // 只看「最近一次」那筆的來源。整檔有一筆回推值就把整檔標成約略，
    // 會讓其實精確的那個數字看起來不可信 —— 而畫面上顯示的正是那一筆。
    exact: latestExact,
  };
}

export function buildPortfolio(rows: HoldingProjection[]): Portfolio {
  const byMonth = new Array<number>(12).fill(0);
  let annual = 0;
  let annualTtm = 0;
  let value = 0;
  for (const r of rows) {
    for (let m = 0; m < 12; m++) byMonth[m] += r.byMonth[m] * r.shares;
    annual += r.annual;
    annualTtm += r.annualTtm;
    value += r.value;
  }
  return {
    rows,
    byMonth,
    annual,
    annualTtm,
    value,
    yieldPct: value > 0 ? (annual / value) * 100 : 0,
    monthlyAverage: annual / 12,
  };
}

/* ── 年配息佔比（圓餅圖） ───────────────────────────────── */

export interface Slice {
  /** 對應的持股在輸入陣列裡的索引 */
  i: number;
  /** 佔全部年配息的百分比 */
  pct: number;
  /** SVG 的 path d；整圈時是空字串，改用 full 旗標畫圓 */
  d: string;
  /** 這一片是不是整圈（只有一檔有配息時） */
  full: boolean;
}

/**
 * 甜甜圈圖的扇形。
 *
 * 自己算路徑而不是引圖表套件：需要的就是幾條 arc，而這個專案的圖表一律是內嵌
 * SVG（見籌碼頁的柱狀圖）。
 *
 * 兩個邊界條件是這個函式存在的理由：
 *
 * - **只有一檔有配息時畫不出扇形**。SVG 的 arc 起點與終點重合時什麼都不會畫，
 *   所以那種情況回 full=true，讓呼叫端改畫一個圓環。
 * - **金額為 0 的不佔位置**。沒配過息的持股不該在圖上分到一片薄薄的角度，
 *   它會有顏色卻沒有意義。
 */
export function donutSlices(
  values: number[], radius = 42, inner = 26, cx = 50, cy = 50,
): Slice[] {
  const total = values.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (total <= 0) return [];

  const usable = values
    .map((v, i) => ({ i, v }))
    .filter(x => x.v > 0);

  if (usable.length === 1) {
    return [{ i: usable[0].i, pct: 100, d: '', full: true }];
  }

  const out: Slice[] = [];
  let angle = -Math.PI / 2;                    // 從十二點鐘方向開始，順時針
  for (const { i, v } of usable) {
    const sweep = (v / total) * Math.PI * 2;
    const end = angle + sweep;
    const p = (r: number, a: number) =>
      `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    // 超過半圈要把 large-arc-flag 打開，否則 SVG 會畫成另一邊的短弧
    const large = sweep > Math.PI ? 1 : 0;
    out.push({
      i,
      pct: Math.round((v / total) * 1000) / 10,
      d: [
        `M${p(radius, angle)}`,
        `A${radius} ${radius} 0 ${large} 1 ${p(radius, end)}`,
        `L${p(inner, end)}`,
        `A${inner} ${inner} 0 ${large} 0 ${p(inner, angle)}`,
        'Z',
      ].join(' '),
      full: false,
    });
    angle = end;
  }
  return out;
}
