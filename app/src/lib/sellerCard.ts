/* 選擇權賣方決策卡：用價平和換算「市場預期波動」，跟大盤實際走過的波動比，看賣方現在划不划算。
 *
 * 規則來自站主的回測（D:\ai\OptionsBacktest\vol_strategies.py，2013–2026 週三序列 710 期）：
 *   每個週三序列結算日收盤，賣出「下一個週三序列」離標的 ±1.5 倍價平和的價外買權、賣權各 1 口，
 *   各腳 3 倍權利金停損、跌到一半停利，而且只在「預期波動 ÷ 近 20 日實際波動 > 1.2」時才做。
 *   這是測過的組合裡唯一前半段、後半段都賺的，但獲利不大 —— 卡片上要把這件事講清楚。
 *
 * 純函式，沒有 React。
 */

import type { AtmData, AtmRow } from './atm.ts';

export const RULE = {
  strikeMult: 1.5,      // 賣出腳離標的幾倍價平和
  stopMult: 3,          // 停損：權利金漲到進場的幾倍
  takeProfit: 0.5,      // 停利：權利金跌到進場的幾成
  ratioMin: 1.2,        // 預期 ÷ 實際 波動門檻
  rvDays: 20,
  strikeStep: 50,
} as const;

/** 回測統計（每期 1 組、1 口，扣手續費、稅、滑價；只有日資料，停損用最高價觸發） */
export const BACKTEST = {
  period: '2013–2026',
  trades: 220,
  winRate: 0.68,
  total: 25038,
  maxDrawdown: 21300,
  netOverDd: 1.18,
  losingYears: '3／14',
  firstHalf: 1694,
  secondHalf: 23344,
} as const;

/** d（不含）之後到 e（含）之間的週一到週五天數；不扣國定假日，所以連假前後會略多 */
export function tradingDaysBetween(d: string, e: string): number {
  const a = new Date(d + 'T00:00:00Z');
  const b = new Date(e + 'T00:00:00Z');
  let n = 0;
  for (let t = a.getTime() + 86400000; t <= b.getTime(); t += 86400000) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** asof（含）以前最近 n 個交易日的對數報酬年化標準差；資料不足回 null */
export function realizedVol(taiex: Record<string, number>, asof: string, n: number = RULE.rvDays): number | null {
  const days = Object.keys(taiex).filter(d => d <= asof).sort();
  if (days.length < n + 1) return null;
  const px = days.slice(-(n + 1)).map(d => taiex[d]);
  const r: number[] = [];
  for (let i = 1; i < px.length; i++) r.push(Math.log(px[i] / px[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

/** 由價平和反推的年化預期波動（價平跨式 ≈ 0.8 × σ × S × √T） */
export function impliedVol(row: AtmRow): { forward: number; iv: number; days: number } | null {
  const forward = row.k + row.call - row.put;
  const days = Math.max(tradingDaysBetween(row.d, row.e), 1);
  if (!(forward > 0) || !(row.sum > 0)) return null;
  return { forward, iv: row.sum / (0.8 * forward * Math.sqrt(days / 252)), days };
}

export interface Decision {
  date: string;
  /** 今天是不是週三序列的結算日（回測的進場日） */
  entryDay: boolean;
  /** 下一個進場日（目前週三序列的到期日） */
  nextEntry: string | null;
  row: AtmRow;
  forward: number;
  days: number;
  iv: number;
  rv: number | null;
  ratio: number | null;
  favorable: boolean;
  callStrike: number;
  putStrike: number;
}

function wedRows(rows: AtmRow[], date: string) {
  const day = rows.filter(r => r.d === date && r.s === 'wed');
  return { r0: day.find(r => r.r === 0) ?? null, r1: day.find(r => r.r === 1) ?? null };
}

/** 某一天的判斷：看「下一個週三序列」（r=1）—— 結算日當天它就是要賣的那一口，其他天是下一次進場會賣的那一口 */
export function decisionOn(data: AtmData, date: string): Decision | null {
  const { r0, r1 } = wedRows(data.rows, date);
  if (!r1) return null;
  const v = impliedVol(r1);
  if (!v) return null;
  const rv = data.taiex ? realizedVol(data.taiex, date) : null;
  const ratio = rv && rv > 0 ? v.iv / rv : null;
  const w = RULE.strikeMult * r1.sum;
  return {
    date,
    entryDay: Boolean(r0 && r0.dte === 0),
    nextEntry: r0 ? r0.e : null,
    row: r1,
    forward: v.forward,
    days: v.days,
    iv: v.iv,
    rv,
    ratio,
    favorable: ratio !== null && ratio > RULE.ratioMin,
    callStrike: Math.ceil((v.forward + w) / RULE.strikeStep) * RULE.strikeStep,
    putStrike: Math.floor((v.forward - w) / RULE.strikeStep) * RULE.strikeStep,
  };
}

export function latestDecision(data: AtmData): Decision | null {
  const days = [...new Set(data.rows.filter(r => r.s === 'wed').map(r => r.d))].sort();
  for (let i = days.length - 1; i >= 0; i--) {
    const d = decisionOn(data, days[i]);
    if (d) return d;
  }
  return null;
}

/** 過去的進場日（週三序列結算日）各自的判斷，新的在前 */
export function pastEntries(data: AtmData, limit = 10): Decision[] {
  const days = [...new Set(data.rows.filter(r => r.s === 'wed' && r.r === 0 && r.dte === 0).map(r => r.d))].sort();
  const out: Decision[] = [];
  for (let i = days.length - 1; i >= 0 && out.length < limit; i--) {
    const d = decisionOn(data, days[i]);
    if (d) out.push(d);
  }
  return out;
}
