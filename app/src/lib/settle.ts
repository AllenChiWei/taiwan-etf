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
export const POLL_END_SEC = 13 * 3600 + 35 * 60;  // 13:35:00（MIS 真實收盤約 13:33 才出，輪詢續到此）
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

/** 轉接站即時回應所需的最小欄位（與 api/settle.ts 的 TaiexLive 相容，保持 lib 獨立）。 */
export interface LiveSnapshot {
  src: string;
  /** YYYYMMDD */
  d: string;
  /** HH:MM:SS */
  t: string;
  z: number;
  bars: Array<[number, number]>;
  samples?: Array<[number, number]>;
}

/** '20261125' → '2026-11-25' */
export function isoFromYmd(d: string): string {
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d;
}

/**
 * 合併轉接站回傳的即時快照與本頁累積的每 5 秒樣本（純函式）。
 * - 只有 src === 'mis' 的回應才接受；非 MIS 回應直接忽略，不寫入 samples 也不覆蓋畫面。
 * - 回應日期比目前顯示的舊（舊後端回昨日）直接忽略，不清空 samples、不改畫面；只有日期較新才換日清空。
 * - 只有日期為 today 的 MIS 回應才寫入 samples。
 * - 同一天若回應時間比目前顯示的早（後端節點不同步），只補還沒收過的 5 秒點，不讓畫面時間與預測值倒退。
 * - 13:30 之後：已收到時間 > 13:30:00 的真收盤後，之後時間 <= 該時間（含相同時間）的回應不可覆蓋 CLOSE_SEC 與畫面。
 */
export function mergeLiveResponse<T extends LiveSnapshot>(
  prev: T | null,
  incoming: T,
  samples: ReadonlyMap<number, number>,
  today: string,
): { live: T | null; samples: Map<number, number> } {
  if (incoming.src !== 'mis') {
    return { live: prev, samples: new Map(samples) };
  }
  const inSec = hmsSec(incoming.t);
  if (!Number.isFinite(inSec) || !(incoming.z > 0)) {
    return { live: prev, samples: new Map(samples) };
  }
  if (prev && incoming.d < prev.d) {
    return { live: prev, samples: new Map(samples) };
  }

  const isNewerDay = prev !== null && incoming.d > prev.d;
  const sameDayPrev = prev && incoming.d === prev.d ? prev : null;
  const nextSamples = isNewerDay ? new Map<number, number>() : new Map(samples);
  const prevSec = sameDayPrev ? hmsSec(sameDayPrev.t) : -1;
  // 已收到時間 > 13:30:00 的真收盤後，時間 <= 該時間（含相同時間）都不算比較新，不可覆蓋 CLOSE_SEC 與畫面
  const isNotNewer = sameDayPrev !== null && Number.isFinite(prevSec) && (
    prevSec > CLOSE_SEC ? inSec <= prevSec : inSec < prevSec
  );

  if (isoFromYmd(incoming.d) === today) {
    // 補入 KV 帶回的盤中每 5 秒點（不覆蓋收盤點，避免 KV 的 13:30 凍結價蓋掉真實收盤價）
    for (const [ts, v] of incoming.samples ?? []) {
      const s = hmsSec(ts);
      if (Number.isFinite(s) && v > 0 && s >= SLOT_FIRST - 5 && s < CLOSE_SEC && s % 5 === 0 && !nextSamples.has(s)) {
        nextSamples.set(s, v);
      }
    }
    if (inSec >= SLOT_FIRST - 5 && inSec < CLOSE_SEC && inSec % 5 === 0) {
      if (!nextSamples.has(inSec)) nextSamples.set(inSec, incoming.z);
    } else if (inSec >= CLOSE_SEC) {
      // MIS 13:30 先給 13:25 凍結價，真實收盤約 13:33 才出；已收到 > 13:30:00 真收盤後，時間 <= 該時間不再覆蓋
      if (!isNotNewer) nextSamples.set(CLOSE_SEC, incoming.z);
    }
  }

  if (isNotNewer) {
    return { live: sameDayPrev, samples: nextSamples };
  }

  // mis_ohlc 偶發失敗時只剩 getStockInfo（bars 空），沿用同日前一份 bars 避免每分鐘基準閃失
  const live: T =
    sameDayPrev && incoming.bars.length === 0 && sameDayPrev.bars.length > 0
      ? { ...incoming, bars: sameDayPrev.bars }
      : incoming;

  return { live, samples: nextSamples };
}

/** 組合已知指數點：每分鐘資料 → 轉接站排程存的每 5 秒 → 本頁累積的每 5 秒（後蓋前）。 */
export function collectLivePoints(
  live: Pick<LiveSnapshot, 'bars' | 'samples'>,
  samples: ReadonlyMap<number, number>,
  maxSec?: number,
): Point[] {
  const pts: Point[] = [];
  const cap = maxSec !== undefined && Number.isFinite(maxSec) ? maxSec : Infinity;
  for (const [ts, v] of live.bars) {
    const sec = hmsSec(ts);
    if (sec <= cap) pts.push({ sec, v });
  }
  for (const [ts, v] of live.samples ?? []) {
    const sec = hmsSec(ts);
    if (sec <= cap) pts.push({ sec, v });
  }
  for (const [sec, v] of samples) {
    if (sec <= cap) pts.push({ sec, v });
  }
  return pts;
}

/**
 * 是否繼續輪詢轉接站：看到 13:30:00 不立刻停止，繼續到台北 13:35（等延遲收盤價）或證交所每 5 秒資料校正完成。
 */
export function shouldPollSettle(opts: {
  isToday: boolean;
  demo: boolean;
  nowSec: number;
  startSec: number;
  liveSec: number | null;
  hasExact: boolean;
}): boolean {
  const { isToday, demo, nowSec, startSec, liveSec, hasExact } = opts;
  if (!isToday || hasExact) return false;
  if (!demo && nowSec < startSec) return false;
  if (liveSec === null) return true;
  if (demo) return liveSec < CLOSE_SEC;
  return liveSec < CLOSE_SEC || nowSec < POLL_END_SEC;
}

/** 收盤後一律以證交所每 5 秒資料（MI_5MINS_INDEX）校正，不論盤中是否仍有內插點。 */
export function shouldFetchExact(
  pred: Pick<Prediction, 'final'> | null,
  hasLiveToday: boolean,
  hasExact: boolean,
): boolean {
  return !!pred && pred.final && hasLiveToday && !hasExact;
}

/** 證交所每 5 秒資料（MI_5MINS_INDEX）綁定所屬日期（YYYYMMDD），跨日或 live 換日不沿用舊資料。 */
export interface ExactSeries {
  /** YYYYMMDD */
  d: string;
  points: Point[];
}

/** 只有與目前 liveDate（YYYYMMDD）相符時才採用已抓到的每 5 秒資料；跨日或換日時回 null。 */
export function exactPointsForDate(exact: ExactSeries | null, liveDate: string | null): Point[] | null {
  return exact && liveDate && exact.d === liveDate ? exact.points : null;
}

/** 預測卡片標題：盤中為預測、13:30 後尚未拿到證交所每 5 秒資料前為收盤後暫估，校正後才稱最後結算價。 */
export function settleCardTitle(final: boolean, hasExact: boolean): string {
  if (!final) return '預測最後結算價';
  return hasExact ? '今天的最後結算價（自算，以期交所公告為準）' : '收盤後暫估（等證交所資料校正）';
}
