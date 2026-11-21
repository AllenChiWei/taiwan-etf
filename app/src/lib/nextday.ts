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
  /** 沒有維持率調整前的上下緣（2026-11-21） */
  up0?: number;
  dn0?: number;
}

/** 融資維持率調整（2026-11-21 使用者：維持率太低會加速破低） */
export interface NextMaint {
  /** 最近一筆大盤融資維持率（%）與日期 */
  value: number | null;
  date: string | null;
  /** 低於這個數＝低維持率日，上下緣乘放大係數 */
  thr: number;
  low: boolean;
  lowDays: number;
  /** 低於 call（斷頭區，證交所口徑 139）的日子；欄位名沿用 below140 */
  below140: { days: number; avgC: number };
  call?: number;
}

export interface NextRecent {
  d: string; d1: string; close: number; reg: Regime;
  H: number; L: number; C: number;
  up95: number; dn95: number; up99: number; dn99: number;
}

export interface NextdayData {
  meta: {
    updated: string; date: string; close: number; next: string; gap: number; regime: Regime;
    /** 實際用的日波動＝max(EWMA, 選擇權隱含)；sigmaE＝EWMA、sigmaIv＝價平和反推（沒有＝null） */
    sigma: number; sigmaE?: number; sigmaIv?: number | null; since: string; samples: number; limit: number;
    counts: Record<Regime, number>; mult99: Record<Regime, [number, number]>;
    checkFrom: string; checkDays: number; stressDays?: number; source: string;
  };
  bands: NextBand[];
  /** 最近 3 年樣本外：up/dn＝含狀態調整、up0/dn0＝不含；stress*＝壓力日（大跌 2% 或維持率一天掉 2 點）的突破率 */
  check: Array<{ p: number; up: number; dn: number; up0?: number; dn0?: number;
    stressUp0?: number | null; stressDn0?: number | null; stressUp?: number | null; stressDn?: number | null }>;
  /** 今天的狀態調整（2026-11-21 IC 研究）：fu／fd＝上／下緣係數（≥ 1），why*＝各特徵貢獻（log，正＝放寬） */
  state?: { fu: number; fd: number; whyUp: Array<{ k: string; label: string; x: number; c: number }>; whyDn: Array<{ k: string; label: string; x: number; c: number }> };
  maint?: NextMaint;
  /** 選擇權隱含波動的驗證：有隱含波動的那些天，EWMA（upE/dnE）與取大（up/dn）各被突破多少 */
  iv?: { days: number; from: string | null; check: Array<{ p: number; upE: number; dnE: number; up: number; dn: number }> };
  recent: NextRecent[];
  extremes: Record<'H' | 'L' | 'Cup' | 'Cdn', { v: number; d: string; d1: string }>;
  /** 通道推移：每一天（被預測的那天）當時估的通道（點位）與實際；最後一列是明天（f＝1，沒有 h/l/c） */
  series?: NextPoint[];
}

export interface NextPoint {
  /** 被預測的那一天 */
  d: string;
  /** 前一交易日收盤（通道的基準） */
  b: number;
  /** 實際最高、最低、收盤（明天那列沒有） */
  h?: number; l?: number; c?: number;
  /** n 一般／w 跨週末／h 連假 */
  r: 'n' | 'w' | 'h';
  u95: number; d95: number; u99: number; d99: number;
  /** 1＝明天的預估 */
  f?: 1;
  /** 那天（前一交易日收盤時）的融資維持率 */
  mt?: number | null;
}

export interface ChannelStats {
  days: number;
  up95: number; dn95: number; up99: number; dn99: number;
}

/** 這一段裡，盤中最高突破上緣、最低跌破下緣各幾次（明天那列不算） */
export function channelStats(points: NextPoint[]): ChannelStats {
  const done = points.filter(p => !p.f && p.h !== undefined && p.l !== undefined);
  return {
    days: done.length,
    up95: done.filter(p => p.h! > p.u95).length,
    dn95: done.filter(p => p.l! < p.d95).length,
    up99: done.filter(p => p.h! > p.u99).length,
    dn99: done.filter(p => p.l! < p.d99).length,
  };
}

/** 這一天的結果：破 99%／破 95%（上或下），或在通道內 */
export function pointBreach(p: NextPoint): { side: 'up' | 'down'; level: 95 | 99 } | null {
  if (p.f || p.h === undefined || p.l === undefined) return null;
  if (p.h > p.u99) return { side: 'up', level: 99 };
  if (p.l < p.d99) return { side: 'down', level: 99 };
  if (p.h > p.u95) return { side: 'up', level: 95 };
  if (p.l < p.d95) return { side: 'down', level: 95 };
  return null;
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
