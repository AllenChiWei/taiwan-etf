/* 收藏 ETF 的持股重疊（用投信投顧公會月報的前十大）。純函式，沒有 React。
 *
 * 重疊度 = Σ 共同持股 min(甲的佔比, 乙的佔比)。兩檔前十大完全一樣、比重也一樣時等於兩檔前十大的合計；
 * 只看前十大，所以是「下限」：前十大以外的共同持股算不到。
 */

import type { Top10Data } from './top10.ts';

export interface Common {
  code: string;
  name: string;
  a: number;
  b: number;
}

export interface Pair {
  a: string;
  b: string;
  /** 重疊度（%，佔淨值） */
  overlap: number;
  common: Common[];
}

function weights(data: Top10Data, code: string): Map<string, { name: string; pct: number }> {
  const m = new Map<string, { name: string; pct: number }>();
  for (const [, , sid, name, pct] of data.etfs[code]?.rows ?? []) {
    if (sid && pct !== null && pct > 0) m.set(sid, { name, pct });
  }
  return m;
}

export function overlapPair(data: Top10Data, a: string, b: string): Pair {
  const wa = weights(data, a);
  const wb = weights(data, b);
  const common: Common[] = [];
  for (const [sid, x] of wa) {
    const y = wb.get(sid);
    if (y) common.push({ code: sid, name: x.name, a: x.pct, b: y.pct });
  }
  common.sort((p, q) => Math.min(q.a, q.b) - Math.min(p.a, p.b));
  return { a, b, overlap: common.reduce((s, c) => s + Math.min(c.a, c.b), 0), common };
}

/** 收藏中有前十大資料的 ETF，兩兩配對，重疊度高的在前 */
export function overlapPairs(data: Top10Data, codes: string[]): { covered: string[]; pairs: Pair[] } {
  const covered = codes.filter(c => (data.etfs[c]?.rows.length ?? 0) > 0);
  const pairs: Pair[] = [];
  for (let i = 0; i < covered.length; i++) {
    for (let j = i + 1; j < covered.length; j++) pairs.push(overlapPair(data, covered[i], covered[j]));
  }
  pairs.sort((p, q) => q.overlap - p.overlap);
  return { covered, pairs };
}
