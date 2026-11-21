/* 隔日加權指數漲跌幅（nextday.json，scripts/fetch_nextday.py 每天算）：明天最高／最低／收盤可能到哪。
 * 方法：每天的「隔日最高÷今收−1」等除以當天 EWMA 日標準差 → 取倍數分位數 → 乘上今天的標準差；
 * 跨週末、連假各用自己那一組（尾巴比較肥）。純函式，沒有 React。 */

export type Regime = 'normal' | 'weekend' | 'holiday';

export interface NextBand {
  /** 機率，例如 0.99＝明天最高有 99% 機會不超過 up */
  p: number;
  /** 明天最高 ÷ 今收 − 1 的上緣 */
  up: number;
  /** 明天最低 ÷ 今收 − 1 的下緣（負數） */
  dn: number;
  /** |明天收盤 ÷ 今收 − 1| 的上緣 */
  c: number;
}

export interface NextRecent {
  d: string; d1: string; close: number; reg: Regime;
  H: number; L: number; C: number;
  up95: number; dn95: number; up99: number; dn99: number;
}

export interface NextdayData {
  meta: {
    updated: string; date: string; close: number; next: string; gap: number; regime: Regime;
    sigma: number; since: string; samples: number; limit: number;
    counts: Record<Regime, number>; mult99: Record<Regime, [number, number]>;
    checkFrom: string; checkDays: number; source: string;
  };
  bands: NextBand[];
  check: Array<{ p: number; up: number; dn: number }>;
  recent: NextRecent[];
  extremes: Record<'H' | 'L' | 'Cup' | 'Cdn', { v: number; d: string; d1: string }>;
}

export const REGIME_LABEL: Record<Regime, string> = {
  normal: '一般交易日',
  weekend: '跨週末',
  holiday: '連假後',
};

/** 今收 × (1 + 漲跌幅) */
export function levelOf(close: number, pct: number): number {
  return close * (1 + pct);
}

/** 買權：在預估最高點「之上」的第一個履約價（50 點一檔）。剛好整數時就是它本身。 */
export function callStrikeAbove(level: number, step = 50): number {
  return Math.ceil(level / step) * step;
}

/** 賣權：在預估最低點「之下」的第一個履約價。 */
export function putStrikeBelow(level: number, step = 50): number {
  return Math.floor(level / step) * step;
}

/** 最近幾天：實際有沒有突破當時的區間 */
export function breached(r: NextRecent, which: 95 | 99): 'up' | 'down' | null {
  const up = which === 95 ? r.up95 : r.up99;
  const dn = which === 95 ? r.dn95 : r.dn99;
  if (r.H > up) return 'up';
  if (r.L < dn) return 'down';
  return null;
}
