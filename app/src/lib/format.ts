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
