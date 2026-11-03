/* 策略產生器私人頁（#/GEN）：依「開著的策略」重算組合。純函式，沒有 React。
 *
 * 2026-11-03 站主要求：可以單獨開關策略，看它對整體 Portfolio 的影響。
 * 每支策略的 eq 是累計淨利（萬，四捨五入到 0.1），組合＝開著的策略每日損益直接相加（每支各用自己的口數，同產生器）。
 * 獲利因子要用交易層級的獲利合計÷虧損合計：資料的每段、每年有 gp／gl（萬）；舊資料沒有就顯示「—」。
 * 交易次數直接相加；勝率用交易次數加權。 */

export interface Seg {
  net: number; mdd: number; nd: number | null; pf: number | null; trades: number; win: number | null;
  /** 獲利交易合計、虧損交易合計（萬）；2026-11-03 起的資料才有 */
  gp?: number; gl?: number;
}
export interface Year extends Seg { y: number }
export interface Stats { all: Seg; is: Seg; os: Seg }
export interface StratLike { eq: number[]; stats: Stats; years: Year[] }
export interface ComboCalc {
  stats: Stats; years: Year[]; eq: number[]; corrMedian: number; corrMax: number; n: number;
  /** 每日損益（萬），算多單組合 vs 空單組合相關用 */
  daily: number[];
}

/** 累計 → 每日（第一天＝第一天的累計） */
export function toDaily(eq: number[]): number[] {
  return eq.map((v, i) => (i === 0 ? v : v - eq[i - 1]));
}

export function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

const round = (x: number, k: number) => Math.round(x * 10 ** k) / 10 ** k;

/** 一段（mask 為 true 的日子）的淨利、MDD；交易數、勝率、獲利因子從各策略的同一段加總 */
function seg(daily: number[], mask: boolean[], parts: (Seg | undefined)[]): Seg {
  let c = 0, pk = 0, dd = 0;
  for (let i = 0; i < daily.length; i++) {
    if (!mask[i]) continue;
    c += daily[i]; pk = Math.max(pk, c); dd = Math.max(dd, pk - c);
  }
  const ok = parts.filter((p): p is Seg => p != null);
  const trades = ok.reduce((s, p) => s + p.trades, 0);
  const wins = ok.reduce((s, p) => s + (p.win ?? 0) / 100 * p.trades, 0);
  const hasPf = ok.length > 0 && ok.every(p => p.gp != null && p.gl != null);
  const gp = hasPf ? ok.reduce((s, p) => s + p.gp!, 0) : 0;
  const gl = hasPf ? ok.reduce((s, p) => s + p.gl!, 0) : 0;
  return {
    net: round(c, 1), mdd: round(dd, 1), nd: dd > 0 ? round(c / dd, 2) : null,
    pf: hasPf && gl > 0 ? round(gp / gl, 2) : null, trades, win: trades > 0 ? round(wins / trades * 100, 1) : null,
    gp: hasPf ? round(gp, 1) : undefined, gl: hasPf ? round(gl, 1) : undefined,
  };
}

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** 開著的策略 → 組合（全期、樣本內 ≤ isEnd、樣本外、每年、累計曲線、兩兩相關） */
export function buildCombo(strats: StratLike[], dates: string[], isEnd: string): ComboCalc {
  const T = dates.length;
  const dailies = strats.map(s => toDaily(s.eq));
  const daily = new Array<number>(T).fill(0);
  for (const d of dailies) for (let i = 0; i < T; i++) daily[i] += d[i] ?? 0;
  const all = dates.map(() => true);
  const isM = dates.map(x => x <= isEnd);
  const osM = isM.map(x => !x);
  const stats: Stats = {
    all: seg(daily, all, strats.map(s => s.stats.all)),
    is: seg(daily, isM, strats.map(s => s.stats.is)),
    os: seg(daily, osM, strats.map(s => s.stats.os)),
  };
  const ys = [...new Set(dates.map(x => Number(x.slice(0, 4))))];
  const years: Year[] = ys.map(y => ({
    y, ...seg(daily, dates.map(x => Number(x.slice(0, 4)) === y), strats.map(s => s.years.find(v => v.y === y))),
  }));
  let c = 0;
  const eq = daily.map(v => round((c += v), 1));
  const cs: number[] = [];
  for (let i = 0; i < dailies.length; i++) for (let j = i + 1; j < dailies.length; j++) cs.push(corr(dailies[i], dailies[j]));
  return {
    stats, years, eq, daily, n: strats.length,
    corrMedian: round(median(cs), 2), corrMax: cs.length ? round(Math.max(...cs), 2) : 0,
  };
}
