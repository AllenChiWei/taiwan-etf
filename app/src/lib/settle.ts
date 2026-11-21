/* 選擇權最後結算價預測（週三、週五到期的臺指選擇權，含月選）。純函式，沒有 React。
 *
 * 期交所算法：到期日 13:00:00（不含）～13:25:00（含）每 5 秒揭示的加權指數 300 筆，
 * 加上 13:30 收盤指數 1 筆，共 301 筆簡單平均，四捨五入到 1 點。
 * 13:25～13:30 是收盤集合競價，指數不動，不取樣。
 * 已用 2026-10-02～11-20 共 15 個結算日核對（證交所每 5 秒指數 vs 期交所公告），全部相同。
 *
 * 預測＝(已經過的取樣點 ＋ 目前指數 × 還沒到的取樣點) ÷ 301。
 * 取樣點的值：網頁開著時每 5 秒抓到的就是那一筆；沒抓到的（13:00 後才打開網頁、或漏抓）
 * 用證交所每分鐘資料（就是整分那一筆）前後內插：30 個結算日模擬只有 5 天全中、最多差 34 點
 * （指數每 5 秒常在兩價位間跳 40 點，08-28、09-29 整分那筆都偏高）；所以 2026-11-21 起轉接站自己存每 5 秒。
 */

export const SLOT_FIRST = 13 * 3600 + 5;          // 13:00:05
export const SLOT_LAST = 13 * 3600 + 25 * 60;     // 13:25:00
export const CLOSE_SEC = 13 * 3600 + 30 * 60;     // 13:30:00
export const SLOTS = 300;
export const TOTAL = SLOTS + 1;

/** '13:04:05'、'130405'、130405 → 一天中的秒數；認不得回 NaN。 */
export function hmsSec(x: string | number): number {
  const s = String(x).replace(/:/g, '').padStart(6, '0');
  if (!/^\d{6}$/.test(s)) return NaN;
  return +s.slice(0, 2) * 3600 + +s.slice(2, 4) * 60 + +s.slice(4, 6);
}

export function secLabel(sec: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec / 60) % 60)}:${p(sec % 60)}`;
}

export interface Point { sec: number; v: number }

export interface Prediction {
  /** 預測平均（未取整） */
  value: number;
  /** 預測結算價（四捨五入到 1 點） */
  rounded: number;
  /** 已經確定（時間已過）的取樣筆數，含收盤那筆，0～301 */
  fixed: number;
  /** 其中沒抓到、用前後資料內插補的筆數（整分的每分鐘資料本身就是那一筆，不算內插） */
  interpolated: number;
  /** 收盤指數已出來：rounded 就是自算的最後結算價 */
  final: boolean;
  /** 已確定那幾筆的合計（含收盤那筆，若已收盤） */
  fixedSum: number;
  /** 還沒到的筆數（TOTAL − fixed）；每 1 點「剩下的指數平均」變動，結算價動 remaining ÷ 301 點 */
  remaining: number;
}

/**
 * points：已知的指數（每 5 秒抓到的＋每分鐘資料），cur：目前最新的一筆（時間＝證交所揭示時間）。
 * 同一秒有多筆時用最後一筆。
 */
export function predictSettle(points: Point[], cur: Point): Prediction {
  const map = new Map<number, number>();
  for (const p of [...points, cur]) if (Number.isFinite(p.sec) && p.v > 0) map.set(p.sec, p.v);
  const known = [...map.entries()].sort((a, b) => a[0] - b[0]);
  const final = cur.sec >= CLOSE_SEC;

  let sum = 0, fixedSum = 0, fixed = 0, interpolated = 0, j = 0;
  for (let s = SLOT_FIRST; s <= SLOT_LAST; s += 5) {
    if (s > cur.sec) { sum += cur.v; continue; }
    fixed++;
    while (j < known.length && known[j][0] < s) j++;          // known[j] 是 >= s 的第一筆
    const next = known[j], prev = j > 0 ? known[j - 1] : null;
    let v: number;
    if (next && next[0] === s) {
      v = next[1];
    } else if (prev && next) {
      v = prev[1] + (next[1] - prev[1]) * (s - prev[0]) / (next[0] - prev[0]);
      interpolated++;
    } else {
      v = (prev ?? next ?? [0, cur.v])[1];
      interpolated++;
    }
    sum += v;
    fixedSum += v;
  }
  // 收盤那一筆：13:30 以後 cur 就是收盤指數（收市撮合延緩時是拿得到的最後一筆）；之前用目前指數估
  if (final) { fixed++; fixedSum += cur.v; }
  const value = (sum + cur.v) / TOTAL;
  return { value, rounded: Math.floor(value + 0.5), fixed, interpolated, final, fixedSum, remaining: TOTAL - fixed };
}

/** 臺指選擇權履約價間距（週選、近月都是 50 點） */
export const STRIKE_STEP = 50;

/**
 * 某個履約價 K 的翻轉門檻：剩下還沒到的那幾筆，平均要多少，結算價才會「高於 K」或「低於 K」。
 * 四捨五入：結算價 > K ⇔ 平均 ≥ K + 0.5；結算價 < K ⇔ 平均 < K − 0.5。
 * 已收盤（remaining＝0）回 null。
 */
export function strikeNeed(p: Pick<Prediction, 'fixedSum' | 'remaining'>, K: number): { above: number; below: number } | null {
  if (p.remaining <= 0) return null;
  return {
    above: ((K + 0.5) * TOTAL - p.fixedSum) / p.remaining,
    below: ((K - 0.5) * TOTAL - p.fixedSum) / p.remaining,
  };
}

/** 預測結算價附近的履約價：下面兩檔、上面兩檔（預測剛好等於履約價時，那一檔也列進來）。 */
export function strikesAround(rounded: number, step = STRIKE_STEP): number[] {
  const lo = Math.floor(rounded / step) * step;
  return [lo - step, lo, lo + step, lo + 2 * step].filter(k => k > 0);
}

export interface CurvePoint {
  sec: number;
  /** 那個時間的加權指數（沒抓到的用前後內插） */
  v: number;
  /** 站在那個時間點看的預測結算價（四捨五入） */
  p: number;
}

/**
 * 13:00:00 起每 5 秒畫一點，到 untilSec（含）為止：指數、和「當時」的預測結算價。
 * 和 predictSettle 同一套算法（同樣的內插），所以最後一點就是 predictSettle 的結果。
 */
export function settleCurve(points: Point[], untilSec: number): CurvePoint[] {
  const map = new Map<number, number>();
  for (const p of points) if (Number.isFinite(p.sec) && p.v > 0) map.set(p.sec, p.v);
  const known = [...map.entries()].sort((a, b) => a[0] - b[0]);
  if (!known.length) return [];
  let j = 0;
  const valAt = (s: number): number => {
    while (j < known.length && known[j][0] < s) j++;
    const next = known[j], prev = j > 0 ? known[j - 1] : null;
    if (next && next[0] === s) return next[1];
    if (prev && next) return prev[1] + (next[1] - prev[1]) * (s - prev[0]) / (next[0] - prev[0]);
    return (prev ?? next)[1];
  };
  const out: CurvePoint[] = [];
  let fixedSum = 0, fixed = 0;
  const end = Math.min(untilSec, CLOSE_SEC);
  for (let s = SLOT_FIRST - 5; s <= end; s += 5) {
    const v = valAt(s);
    if (s >= SLOT_FIRST && s <= SLOT_LAST) { fixedSum += v; fixed++; }
    const p = s >= CLOSE_SEC
      ? (fixedSum + v) / TOTAL
      : (fixedSum + v * (TOTAL - fixed)) / TOTAL;
    out.push({ sec: s, v, p: Math.floor(p + 0.5) });
  }
  return out;
}

/** atm.json 的列 → 所有結算日（YYYY-MM-DD，週三系列含月選、週五系列）。 */
export function settleDates(rows: Array<{ e?: string }>): string[] {
  return [...new Set(rows.map(r => r.e).filter((e): e is string => !!e))].sort();
}

/** 今天（台北）以後（含）的第一個結算日；沒有回 null。 */
export function nextSettle(dates: string[], today: string): string | null {
  return dates.find(d => d >= today) ?? null;
}

/** 台北的日期（YYYY-MM-DD）與一天中的秒數。 */
export function taipeiNow(now = new Date()): { date: string; sec: number } {
  const t = new Date(now.getTime() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`,
    sec: t.getUTCHours() * 3600 + t.getUTCMinutes() * 60 + t.getUTCSeconds(),
  };
}

/** 結算價歷史的一列（新到舊）：13:00 指數到結算價拉了多少（有每 5 秒走勢的才有）。 */
export interface SettleHistView {
  d: string;
  c: string[];
  settle: number;
  /** 期交所公告；undefined＝沒抓到 */
  fsp?: number;
  /** 13:00:00 加權指數 */
  at1300?: number;
  /** 結算價 − 13:00 指數 */
  drift?: number;
}

export function settleHistory(rows: Array<{ d: string; c: string[]; settle: number; fsp?: number; v?: number[] }>): SettleHistView[] {
  return [...rows].sort((a, b) => (a.d < b.d ? 1 : -1)).map(r => {
    const final = r.fsp ?? r.settle;
    const at1300 = r.v && r.v.length === 361 ? r.v[0] : undefined;
    return { d: r.d, c: r.c, settle: r.settle, fsp: r.fsp, at1300, drift: at1300 === undefined ? undefined : final - at1300 };
  });
}

/** 13:00 到結算價的偏移統計（只看有走勢的） */
export function driftStats(list: SettleHistView[]): { n: number; meanAbs: number; maxAbs: number; up: number; down: number } | null {
  const xs = list.map(x => x.drift).filter((x): x is number => x !== undefined);
  if (!xs.length) return null;
  return {
    n: xs.length,
    meanAbs: xs.reduce((a, x) => a + Math.abs(x), 0) / xs.length,
    maxAbs: Math.max(...xs.map(Math.abs)),
    up: xs.filter(x => x > 0).length,
    down: xs.filter(x => x < 0).length,
  };
}
