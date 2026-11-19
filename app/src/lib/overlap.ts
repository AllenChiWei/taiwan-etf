/* 收藏 ETF 的持股重疊（用投信投顧公會月報的前十大）。純函式，沒有 React。
 *
 * 重疊度 = Σ 共同持股 min(甲的佔比, 乙的佔比)。兩檔前十大完全一樣、比重也一樣時等於兩檔前十大的合計；
 * 只看前十大，所以是「下限」：前十大以外的共同持股算不到。
 */

import { lookupMonthly, type Top10Data } from './top10.ts';
import { isStock, type ActiveData } from './active.ts';

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

/* ───── 任選兩檔比對（#/compare，2026-11-19 站主：選兩檔 ETF 比共同持股與比例）─────
 *
 * 跟收藏頁的兩兩配對不同，這裡每一檔挑「最完整」的持股來源：
 *   主動式（active_holdings.json 有的）→ 投信每日公告的持股（不只前十大）
 *   其他 → 投信投顧公會月報前十大
 * 兩邊來源不同時（每日 vs 月報）日期也不同，畫面要標出各自的來源與日期。
 * 期貨部位不算持股（跟主動式「合計持股」同一條規則，isStock）。
 */

export interface HoldingSet {
  code: string;
  /** 'daily'＝投信每日公告；'monthly'＝公會月報前十大 */
  kind: 'daily' | 'monthly';
  /** 每日是交易日 YYYY-MM-DD，月報是 YYYY/MM */
  asof: string;
  /** 代號 → 名稱、佔淨值 % */
  w: Map<string, { name: string; pct: number }>;
  /** 這份資料涵蓋的淨值合計 %（前十大通常 40～70%） */
  covered: number;
}

export function holdingsOf(code: string, top10: Top10Data | null, active: ActiveData | null): HoldingSet | null {
  const daily = active?.etfs[code];
  if (daily && daily.holdings.length) {
    const w = new Map<string, { name: string; pct: number }>();
    for (const [c, n, , pct] of daily.holdings) {
      if (!c || !isStock(n) || !(pct > 0)) continue;
      const prev = w.get(c);
      w.set(c, { name: prev && prev.name.length <= n.length ? prev.name : n, pct: (prev?.pct ?? 0) + pct });
    }
    return { code, kind: 'daily', asof: daily.asof, w, covered: sumPct(w) };
  }
  const m = top10 ? lookupMonthly(top10, code) : undefined;
  if (m && m.rows.length) {
    const w = new Map<string, { name: string; pct: number }>();
    for (const [, , sid, name, pct] of m.rows) {
      if (sid && pct !== null && pct > 0 && isStock(name)) w.set(sid, { name, pct: (w.get(sid)?.pct ?? 0) + pct });
    }
    if (!w.size) return null;
    const ym = top10!.meta.ym;
    return { code, kind: 'monthly', asof: `${ym.slice(0, 4)}/${ym.slice(4)}`, w, covered: sumPct(w) };
  }
  return null;
}

function sumPct(w: Map<string, { pct: number }>): number {
  let s = 0;
  for (const x of w.values()) s += x.pct;
  return s;
}

export interface OnlyRow { code: string; name: string; pct: number }

export interface Comparison {
  /** 重疊度 = Σ 共同持股 min(甲, 乙)（佔淨值 %）；只看得到的部分，所以是下限 */
  overlap: number;
  /** 共同持股，依兩檔中較小的佔比排序（重疊貢獻大的在前） */
  common: Common[];
  /** 共同持股佔甲／乙淨值的合計 % */
  sumA: number;
  sumB: number;
  /** 只有甲／乙有的（依佔比排序） */
  onlyA: OnlyRow[];
  onlyB: OnlyRow[];
}

export function compareHoldings(a: HoldingSet, b: HoldingSet): Comparison {
  const common: Common[] = [];
  const onlyA: OnlyRow[] = [];
  for (const [code, x] of a.w) {
    const y = b.w.get(code);
    if (y) common.push({ code, name: y.name.length < x.name.length ? y.name : x.name, a: x.pct, b: y.pct });
    else onlyA.push({ code, name: x.name, pct: x.pct });
  }
  const onlyB: OnlyRow[] = [];
  for (const [code, y] of b.w) if (!a.w.has(code)) onlyB.push({ code, name: y.name, pct: y.pct });
  common.sort((p, q) => Math.min(q.a, q.b) - Math.min(p.a, p.b) || Math.max(q.a, q.b) - Math.max(p.a, p.b));
  onlyA.sort((p, q) => q.pct - p.pct);
  onlyB.sort((p, q) => q.pct - p.pct);
  return {
    overlap: common.reduce((s, c) => s + Math.min(c.a, c.b), 0),
    common,
    sumA: common.reduce((s, c) => s + c.a, 0),
    sumB: common.reduce((s, c) => s + c.b, 0),
    onlyA, onlyB,
  };
}
