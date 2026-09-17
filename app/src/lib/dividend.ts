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
 * ## 一年配幾次是推出來的，不是讀欄位
 *
 * 用實際的除息月份推，而不是直接信 etfs.json 的 freq。那個欄位來自 MoneyDJ
 * 的公告頻率，跟實際發生的次數偶爾對不上（中途改頻率、當年少配一次）。
 * 這裡要回答的是「我實際會在幾月拿到錢」，所以看實際紀錄。
 */

import type { CalcSeries } from './backtest.ts';

/** 台股一張是 1000 股。 */
export const SHARES_PER_LOT = 1000;

export interface Holding {
  code: string;
  /** 持有張數，可以是小數（零股） */
  lots: number;
}

export interface HoldingProjection {
  code: string;
  name: string;
  lots: number;
  shares: number;

  /** 最近一次每股配息 */
  latest: number;
  /** 最近一次除息的月份 'YYYY-MM' */
  latestMonth: string;
  /** 一年配幾次，由實際除息月份推得 */
  perYear: number;
  freq: string;
  /** 預期會除息的月份（0=一月），依過去一年的實際月份 */
  payoutMonths: number[];

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
 * 把一檔 ETF 的配息攤成日曆月份。
 *
 * months 是整個市場共用的月份清單（'YYYY-MM'），series.first 是這檔在裡面的
 * 起始位置。只看最後 12 個有資料的月份 —— 不足 12 個就有多少算多少。
 */
export function projectHolding(
  series: CalcSeries, months: string[], lots: number,
): HoldingProjection {
  const n = series.d.length;
  const take = Math.min(12, n);
  const shares = lots * SHARES_PER_LOT;

  const payoutMonths: number[] = [];
  let perShareTtm = 0;
  let payouts = 0;
  let latest = 0;
  let latestMonth = '';

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
  }
  payoutMonths.sort((a, b) => a - b);

  const freq = inferFrequency(payouts);
  const perYear = payoutsPerYear(freq);
  const perShare = latest * perYear;

  // 把「最近一次的金額」放到每個預期會除息的月份。
  // 用過去一年實際發生的月份，而不是機械式地平均分配 —— 季配不一定落在
  // 1/4/7/10，各家的除息月份不同。
  const byMonth = new Array<number>(12).fill(0);
  if (payoutMonths.length > 0) {
    for (const m of payoutMonths) byMonth[m] = latest;
    // 推出來的次數比實際記錄到的月份多時（例如月配但只記到 11 個月），
    // 差額平均補到其餘月份，讓月份加總與年配息一致
    const missing = perYear - payoutMonths.length;
    if (missing > 0) {
      const spare = [];
      for (let m = 0; m < 12; m++) if (!payoutMonths.includes(m)) spare.push(m);
      for (let k = 0; k < missing && k < spare.length; k++) byMonth[spare[k]] = latest;
    }
  }

  const price = series.last.close;
  return {
    code: series.code,
    name: series.name,
    lots,
    shares,
    latest,
    latestMonth,
    perYear,
    freq,
    payoutMonths,
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
