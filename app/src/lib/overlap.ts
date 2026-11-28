/* 收藏 ETF 的持股重疊（主動式每日 → 被動式每日全部持股 → 公會季報 1% 以上 → 公會月報前十大）。純函式，沒有 React。
 *
 * 重疊度 = Σ 共同持股 min(甲的佔比, 乙的佔比)。只算看得到的部分，有月報前十大參與時是「下限」：
 * 前十大以外的共同持股算不到。期貨部位不算持股（isStock）。
 */

import { lookupMonthly, type Top10Data } from './top10.ts';
import { isStock, type ActiveData } from './active.ts';
import {
  lookupFullHoldings,
  type FullHoldingBasis,
  type FullHoldingsData,
  type QtyDenom,
} from './fullHoldings.ts';
import {
  lookupUsEtfHoldings,
  type UsEtfHoldingBasis,
  type UsEtfHoldingsData,
} from './usEtfHoldings.ts';

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

/** 收藏中有持股資料的 ETF（依完整度優先序取來源），兩兩配對，重疊度高的在前 */
export function overlapPairs(
  data: Top10Data | null,
  codes: string[],
  active: ActiveData | null = null,
  full: FullHoldingsData | null = null,
): { covered: string[]; pairs: Pair[]; sets: Record<string, HoldingSet> } {
  const covered: string[] = [];
  const sets: Record<string, HoldingSet> = {};
  const seen = new Set<string>();
  for (const c of codes) {
    if (seen.has(c)) continue;
    seen.add(c);
    const s = holdingsOf(c, data, active, full);
    if (s) {
      covered.push(c);
      sets[c] = s;
    }
  }
  const pairs: Pair[] = [];
  for (let i = 0; i < covered.length; i++) {
    for (let j = i + 1; j < covered.length; j++) {
      const a = covered[i];
      const b = covered[j];
      const cmp = compareHoldings(sets[a], sets[b]);
      pairs.push({ a, b, overlap: cmp.overlap, common: cmp.common });
    }
  }
  pairs.sort((p, q) => q.overlap - p.overlap);
  return { covered, pairs, sets };
}

/* ───── 任選兩檔比對（#/compare，2026-11-19 站主：選兩檔 ETF 比共同持股與比例）─────
 *
 * 每一檔依以下優先序挑最完整的持股來源：
 *   1. 主動式每日持股（active_holdings.json）
 *   2. 被動式每日全部持股（etf_holdings.json，投信申購買回清單）
 *   3. 公會季報持股 1% 以上（etf_holdings.json，只在它比月報前十大涵蓋更多權重時採用）
 *   4. 公會月報前十大（top10.json）
 * 兩邊來源不同時日期也不同，畫面要標出各自的來源與日期。
 * 期貨部位不算持股（跟主動式「合計持股」同一條規則，isStock）。
 */

export type HoldingSourceKind = 'daily' | 'pcf' | 'quarterly' | 'monthly' | 'us';

export interface HoldingSet {
  code: string;
  /** 'daily'＝主動式每日；'pcf'＝被動式申購買回清單；'quarterly'＝公會季報 1% 以上；'monthly'＝公會月報前十大；'us'＝美股 ETF 官網持股 */
  kind: HoldingSourceKind;
  /** 每日／申購清單／美股官網為 YYYY-MM-DD，季報為 YYYYQ#，月報為 YYYY/MM */
  asof: string;
  /** 來源投信（例「元大投信」）、「投信投顧公會季報」或美股發行商（例「Invesco 官網」） */
  src?: string;
  /** 被動式持股的換算口徑（weight／qty／quarterly1pct） */
  basis?: FullHoldingBasis;
  /** kind === 'us' 時的揭露口徑（full＝全部持股；top25＝僅前 25 大） */
  usBasis?: UsEtfHoldingBasis;
  /** basis === 'qty' 時的分母口徑（nav＝淨值；stock＝股票部位合計 100%） */
  denom?: QtyDenom;
  /** 代號 → 名稱、佔淨值 %（公會月報／季報另保留資產類型 type，供穿透時排除債券／連結型 ETF） */
  w: Map<string, { name: string; pct: number; type?: string }>;
  /** 這份資料涵蓋的淨值合計 %（前十大通常 40～70%） */
  covered: number;
}

/** 讀取美股 ETF 官網成分股，將成分代號轉成「TICKER US」合併鍵供持股健檢與明細展開共用。 */
export function usHoldingsOf(
  code: string,
  usHoldings: UsEtfHoldingsData | null | undefined,
): HoldingSet | null {
  const entry = lookupUsEtfHoldings(usHoldings, code);
  if (!entry || !entry.rows.length) return null;
  const w = new Map<string, { name: string; pct: number; type?: string }>();
  for (const [rawTicker, rawName, pct] of entry.rows) {
    let ticker = rawTicker.trim().toUpperCase();
    if (!ticker || !(pct > 0)) continue;
    // BRK B 這類空白分隔股別先轉成點號，再統一補上 US 交易所後綴
    ticker = ticker.replace(/^([A-Z0-9]{1,5})\s+([A-Z])$/, '$1.$2');
    const key = /\s+[A-Z][A-Z0-9]$/.test(ticker) ? ticker : `${ticker} US`;
    const name = rawName.trim() || ticker;
    const prev = w.get(key);
    w.set(key, {
      name: prev && prev.name.length <= name.length ? prev.name : name,
      pct: (prev?.pct ?? 0) + pct,
    });
  }
  if (!w.size) return null;
  return {
    code: code.trim().toUpperCase(),
    kind: 'us',
    asof: entry.asof,
    src: entry.src,
    usBasis: entry.basis,
    w,
    covered: sumPct(w),
  };
}

export function holdingsOf(
  code: string,
  top10: Top10Data | null,
  active: ActiveData | null,
  full: FullHoldingsData | null = null,
): HoldingSet | null {
  const daily = active?.etfs[code];
  if (daily && daily.holdings.length) {
    const w = new Map<string, { name: string; pct: number; type?: string }>();
    for (const [c, n, , pct] of daily.holdings) {
      if (!c || !isStock(n) || !(pct > 0)) continue;
      const prev = w.get(c);
      w.set(c, { name: prev && prev.name.length <= n.length ? prev.name : n, pct: (prev?.pct ?? 0) + pct });
    }
    return { code, kind: 'daily', asof: daily.asof, w, covered: sumPct(w) };
  }

  const f = full ? lookupFullHoldings(full, code) : undefined;
  if (f && f.basis !== 'quarterly1pct' && f.holdings.length) {
    const w = new Map<string, { name: string; pct: number; type?: string }>();
    for (const r of f.holdings) {
      const [c, n, , pct] = r;
      const type = r[4];
      if (!c || !isStock(n) || !(pct > 0)) continue;
      const prev = w.get(c);
      w.set(c, {
        name: prev && prev.name.length <= n.length ? prev.name : n,
        pct: (prev?.pct ?? 0) + pct,
        type: prev?.type || type || undefined,
      });
    }
    if (w.size) {
      return {
        code,
        kind: 'pcf',
        asof: f.asof,
        src: f.src,
        basis: f.basis,
        ...(f.denom ? { denom: f.denom } : {}),
        w,
        covered: sumPct(w),
      };
    }
  }

  let monthlySet: HoldingSet | null = null;
  const m = top10 ? lookupMonthly(top10, code) : undefined;
  if (m && m.rows.length) {
    const w = new Map<string, { name: string; pct: number; type?: string }>();
    for (const [, type, sid, name, pct] of m.rows) {
      if (sid && pct !== null && pct > 0 && isStock(name)) {
        const prev = w.get(sid);
        w.set(sid, { name, pct: (prev?.pct ?? 0) + pct, type: prev?.type || type || undefined });
      }
    }
    if (w.size) {
      const ym = top10!.meta?.ym ?? '';
      monthlySet = {
        code,
        kind: 'monthly',
        asof: ym ? `${ym.slice(0, 4)}/${ym.slice(4)}` : '',
        w,
        covered: sumPct(w),
      };
    }
  }

  if (f && f.basis === 'quarterly1pct' && f.holdings.length) {
    const w = new Map<string, { name: string; pct: number; type?: string }>();
    for (const r of f.holdings) {
      const [c, n, , pct] = r;
      const type = r[4];
      if (!c || !isStock(n) || !(pct > 0)) continue;
      const prev = w.get(c);
      w.set(c, {
        name: prev && prev.name.length <= n.length ? prev.name : n,
        pct: (prev?.pct ?? 0) + pct,
        type: prev?.type || type || undefined,
      });
    }
    const qCovered = sumPct(w);
    if (w.size && (!monthlySet || qCovered > monthlySet.covered)) {
      return {
        code,
        kind: 'quarterly',
        asof: f.asof,
        src: f.src,
        basis: f.basis,
        w,
        covered: qCovered,
      };
    }
  }

  return monthlySet;
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
