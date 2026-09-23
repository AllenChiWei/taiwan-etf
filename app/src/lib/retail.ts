/* 散戶多空比的事後驗收。純函式，沒有 React。
 *
 * 市場上常把小台散戶多空比當反向指標：散戶越偏多，之後越容易跌。這裡不預設它
 * 對或錯，只把每一天的多空比跟「之後 N 個交易日加權指數漲跌多少」放在一起，
 * 依多空比由低到高切成五等分，看各組之後的表現。
 *
 * 兩件事要在畫面上講清楚：
 *
 * 1. **要跟「全部日子」比**。這三年指數漲很多，任何一組的平均報酬都是正的；
 *    該看的是某一組比基準好還是差，不是它是不是正的。
 * 2. **樣本是重疊的**。第 1 天的「之後 20 日」與第 2 天的幾乎是同一段行情，
 *    七百個交易日在 20 日這個尺度上只有三十幾段真正獨立的樣本。
 */

export interface RetailData {
  meta: { updated: string; latest: string | null; source: string; note: string; errors: string[] };
  /** 行情代號（MTX／TMF）-> 每日 [全市場未沖銷, 三大法人多方合計, 空方合計] */
  contracts: Record<string, { name: string; days: Record<string, [number, number, number]> }>;
  taiex: Record<string, number>;
}

export interface RetailPoint {
  d: string;
  /** 散戶淨口數（多 − 空） */
  net: number;
  oi: number;
  /** 多空比（%）＝淨口數 ÷ 全市場未沖銷 */
  ratio: number;
}

/** 某個契約每天的散戶多空比，舊到新。全市場為 0 的日子跳過。 */
export function retailPoints(data: RetailData, cid: string): RetailPoint[] {
  const days = data.contracts[cid]?.days ?? {};
  return Object.keys(days).sort().flatMap(d => {
    const [oi, bn, sn] = days[d];
    if (!oi) return [];
    // 散戶多 − 散戶空 = (oi − bn) − (oi − sn) = sn − bn
    const net = sn - bn;
    return [{ d, net, oi, ratio: (net / oi) * 100 }];
  });
}

/**
 * 交易日 -> 之後 h 個交易日的指數漲跌（%）。
 *
 * 用指數自己的日期序列數交易日，不用日曆天：連假一週跟一般一週不該被當成一樣長。
 * 還沒走完 h 天的最後幾天不在結果裡。
 */
export function forwardReturns(taiex: Record<string, number>, h: number): Map<string, number> {
  const days = Object.keys(taiex).sort();
  const out = new Map<string, number>();
  for (let i = 0; i + h < days.length; i++) {
    const a = taiex[days[i]];
    const b = taiex[days[i + h]];
    if (a > 0 && b > 0) out.set(days[i], (b / a - 1) * 100);
  }
  return out;
}

export interface Group {
  /** 這一組多空比的範圍（%） */
  lo: number;
  hi: number;
  n: number;
  /** 之後 h 日的平均漲跌（%） */
  avg: number;
  /** 之後 h 日上漲的比例（0–1） */
  up: number;
}

export interface Backtest {
  horizon: number;
  groups: Group[];
  /** 所有有答案的日子：比較的基準 */
  base: Group;
  /** 最新一天的多空比與它落在哪一組（groups 的索引） */
  latest: RetailPoint | null;
  latestGroup: number | null;
  /** 最新多空比在歷史裡的百分位（0–100）：比多少比例的日子更偏多 */
  latestPct: number | null;
}

function stats(pairs: { ratio: number; ret: number }[]): Group {
  const n = pairs.length;
  const rs = pairs.map(p => p.ratio);
  return {
    lo: Math.min(...rs), hi: Math.max(...rs), n,
    avg: pairs.reduce((a, p) => a + p.ret, 0) / n,
    up: pairs.filter(p => p.ret > 0).length / n,
  };
}

/**
 * 依多空比切成 k 等分，每組算之後 h 日的平均漲跌與上漲機率。
 *
 * 分組的邊界只用「有答案的日子」算，最新那幾天（還沒走完 h 日）不參與分組，
 * 但會被放進對應的組別裡標出來 —— 那正是使用者想知道的：今天落在哪一組。
 * 樣本少於 k × 10 天時回 null，太少的分組只會是雜訊。
 */
export function backtest(points: RetailPoint[], taiex: Record<string, number>,
                         h: number, k = 5): Backtest | null {
  const fwd = forwardReturns(taiex, h);
  const pairs = points.flatMap(p => {
    const ret = fwd.get(p.d);
    return ret === undefined ? [] : [{ ratio: p.ratio, ret }];
  });
  if (pairs.length < k * 10) return null;

  const sorted = [...pairs].sort((a, b) => a.ratio - b.ratio);
  const groups: Group[] = [];
  for (let g = 0; g < k; g++) {
    const slice = sorted.slice(Math.floor((g * sorted.length) / k),
                               Math.floor(((g + 1) * sorted.length) / k));
    groups.push(stats(slice));
  }

  const latest = points.length ? points[points.length - 1] : null;
  let latestGroup: number | null = null;
  let latestPct: number | null = null;
  if (latest) {
    // 比最低組的上界低就算最低組、比最高組的下界高就算最高組；中間照上界找
    latestGroup = groups.findIndex(g => latest.ratio <= g.hi);
    if (latestGroup < 0) latestGroup = k - 1;
    latestPct = (sorted.filter(p => p.ratio < latest.ratio).length / sorted.length) * 100;
  }
  return { horizon: h, groups, base: stats(pairs), latest, latestGroup, latestPct };
}
