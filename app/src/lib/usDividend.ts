/* 美股 ETF 接進配息試算：從 FinMind 日價反推配息，再用匯率換成台幣。純函式，沒有 React。
 *
 * ## 配息從哪裡來
 *
 * FinMind 沒有美股配息的資料集（2026-09 查過，只有 USStockInfo／USStockPrice），
 * 但 USStockPrice 同時給收盤價 Close 與含息還原價 Adj_Close。兩者的比值只在
 * 除息日變動，變動幅度就是那次配息佔前一日收盤的比例：
 *
 *     y = 1 − (Adj[t-1]/Close[t-1]) ÷ (Adj[t]/Close[t])     配息 ≈ Close[t-1] × y
 *
 * 實測（2025-06 起）SCHD 每季約 0.26、QYLD 每月約 0.17～0.19、SPY 每季 1.8～2.0 美元，
 * 與實際配息水準一致，TLT 十二月那筆額外配息也抓得到。Adj_Close 只到小數第二位，
 * 所以誤差約 1 美分 —— 畫面一律標「約略值」。
 *
 * 比值跳超過 MAX_YIELD 的不是配息，是分割或反分割（Close 沒還原分割、Adj_Close 有），
 * 丟掉。小於 MIN_YIELD 的是四捨五入的雜訊。
 *
 * ## 換成台幣
 *
 * 金額與股價在進 projectHolding 之前就乘上匯率，下游的月曆、圓餅圖、殖利率、合計
 * 全部照舊，不必知道有美元這回事。殖利率是比值，換不換匯都一樣。
 * 用的是單一匯率（最新的台銀即期中價），不是每次除息當天的匯率 —— 這裡算的是
 * 「照現在的配息水準，一年大約領多少台幣」，匯率本來就會變，用現在的最合理。
 */

import type { CalcSeries } from './backtest.ts';
import { seriesFromStock } from './dividend.ts';

export interface UsPriceRow { date: string; Close: number; Adj_Close: number }

/** 單次配息佔股價的比例上下限。月配的高股息 ETF 單次也很少超過 5%。 */
export const MIN_YIELD = 0.0008;
export const MAX_YIELD = 0.15;

/** 日價 -> [除息日, 每股配息（美元）]。日價要依日期排好。 */
export function deriveUsDividends(rows: UsPriceRow[]): [string, number][] {
  const out: [string, number][] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (!(a.Close > 0 && b.Close > 0 && a.Adj_Close > 0 && b.Adj_Close > 0)) continue;
    const y = 1 - (a.Adj_Close / a.Close) / (b.Adj_Close / b.Close);
    if (y > MIN_YIELD && y < MAX_YIELD) {
      out.push([b.date, Math.round(a.Close * y * 10000) / 10000]);
    }
  }
  return out;
}

/** FinMind TaiwanExchangeRate 的一列（台銀牌告） */
export interface FxRow { date: string; spot_buy: number; spot_sell: number }

/** 最新一天的即期買賣中價。缺值（假日回 0 或 -1）的日子跳過。 */
export function latestMidRate(rows: FxRow[]): { date: string; rate: number } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.spot_buy > 0 && r.spot_sell > 0) {
      return { date: r.date, rate: Math.round(((r.spot_buy + r.spot_sell) / 2) * 1000) / 1000 };
    }
  }
  return null;
}

/**
 * 美股 ETF -> 跟台股同樣形狀的序列（台幣）。
 * freq 留空：美股沒有「公告頻率」這個欄位，projectHolding 會用近 12 個月的次數推。
 */
export function seriesFromUs(code: string, name: string, rows: UsPriceRow[],
                             rate: number, months: string[]): CalcSeries {
  const last = rows[rows.length - 1];
  const ev = deriveUsDividends(rows).map(([d, usd]) => [d, usd * rate, 0] as [string, number, number]);
  return seriesFromStock(code, { n: name, m: 'twse', c: last ? last.Close * rate : null, ev }, months);
}
