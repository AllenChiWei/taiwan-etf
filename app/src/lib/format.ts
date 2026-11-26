/* 顯示相關的小工具：顏色慣例、標籤樣式、文字。 */

import type { FreqLabel, NumericKey } from '../types.ts';
import { toNumber, NA } from './filters.ts';

export type Tone = 'up' | 'down' | 'flat' | 'na';

/** 台股慣例：紅漲綠跌。與美股相反，不要「修正」。 */
export function returnTone(v: string): Tone {
  const n = toNumber(v);
  if (n === null) return 'na';
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

export const TONE_CLASS: Record<Tone, string> = {
  up: 'text-up font-semibold',
  down: 'text-down font-semibold',
  flat: 'text-flat',
  na: 'text-na',
};

/** 殖利率沒有漲跌的概念，有值就用自己的顏色，N/A 比照灰色。 */
export function yieldClass(v: string): string {
  return v === NA ? TONE_CLASS.na : 'text-yield font-semibold';
}

const PILL: Record<FreqLabel, string> = {
  '月配': 'pill-monthly',
  '雙月配': 'pill-bimonthly',
  '季配': 'pill-quarterly',
  '半年配': 'pill-semi',
  '年配': 'pill-annual',
  '不定期': 'pill-irregular',
  '—': 'pill-none',
};

export function freqPillClass(freq: FreqLabel): string {
  return PILL[freq] ?? 'pill-none';
}

export const NUMERIC_LABEL: Record<NumericKey, string> = {
  yield: '殖利率',
  r3: '近3月',
  r6: '近6月',
  r12: '近1年',
  r36: '近3年',
  r60: '近5年',
};

/** MoneyDJ 個別 ETF 頁；代號一律小寫。 */
export function moneydjUrl(code: string): string {
  return `https://www.moneydj.com/ETF/X/Basic/Basic0004.xdjhtm?etfid=${code.toLowerCase()}.tw`;
}

/** 頁首那一行。報酬率與殖利率的資料日期不同源，分開標示才不會誤導。 */
export function metaLine(
  source: string, updated: string, snapshot: string, yieldAsof?: string,
): string {
  const parts = [`資料來源：${source}`, `更新於 ${updated}`];
  if (snapshot) parts.push(`報酬率截至 ${snapshot}`);
  if (yieldAsof) parts.push(`殖利率截至 ${yieldAsof}`);
  return parts.join('　·　');
}

export type ReturnBasisInput =
  | { market: 'tw'; snapshot?: string }
  | { market: 'us'; tr?: boolean; asof?: string; totalReturnAsOf?: string };

/** 報酬率口徑說明：台股一律為含息總報酬（FinLab etl:adj_close）；美股依 tr 旗標區分含息或價格報酬。 */
export function returnBasisNote(input: ReturnBasisInput): string {
  if (input.market === 'tw') {
    const asof = input.snapshot ? `，截至 ${input.snapshot}` : '';
    return `報酬為市價含息總報酬（配息再投入、累積非年化${asof}）`;
  }
  if (input.tr) {
    const asof = input.totalReturnAsOf || input.asof;
    return `報酬為含息總報酬（配息再投入、累積非年化${asof ? `，截至 ${asof}` : ''}）`;
  }
  return `報酬為價格報酬（不含配息、累積非年化${input.asof ? `，截至 ${input.asof}` : ''}）`;
}

/** 美股交易所代碼 -> 人看得懂的名字。來自 Nasdaq Trader 的 Listing Exchange 欄位。 */
const US_EXCHANGE: Record<string, string> = {
  A: 'NYSE American',
  N: 'NYSE',
  P: 'NYSE Arca',
  Q: 'Nasdaq',
  Z: 'Cboe BZX',
  V: 'IEX',
};

export const exchangeName = (code: string) => US_EXCHANGE[code] ?? code;

/** Nasdaq 自己的 ETF 頁面 —— 我們的名單本來就來自他們的官方檔案。 */
export const nasdaqUrl = (code: string) =>
  `https://www.nasdaq.com/market-activity/etf/${code.toLowerCase()}`;

/** 美股日均成交金額縮寫：$34.4B / $512M / $15.0M */
export function formatAdv(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
