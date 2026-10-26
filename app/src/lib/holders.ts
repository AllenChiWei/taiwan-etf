/* 股票反查 ETF 與主動式經理人排行（2026-10-26 站主要求，參考籌碼小宇）。純函式，沒有 React。
 *
 * 反查的兩個來源（同一檔 ETF 新的優先）：
 *   1. active_holdings.json —— 主動式 ETF 每日完整持股（所有持股都查得到）
 *   2. top10.json —— 公會月報「前十大」：只看得到前十大，排在十名以外的持有查不到，畫面要講清楚
 */

import type { ActiveData, ActiveEtf } from './active.ts';
import { bookSummary, scorecard, kindOf, KIND_LABEL } from './active.ts';
import type { Top10Data } from './top10.ts';

export interface Holder {
  etf: string;
  /** ETF 簡稱（etfs.json 有就用它，否則用來源裡的名稱） */
  name: string;
  weight: number | null;
  kind: 'daily' | 'monthly';
  asof: string;
  /** 每日持股才有：股數 */
  shares?: number;
  /** 主動式最近一次對這檔的動作（新增／加碼／減碼／剔除）與日期 */
  last?: { kind: string; d: string };
}

export function holdersOf(stock: string, monthly: Top10Data | null, active: ActiveData | null,
                          names: Record<string, string> = {}): Holder[] {
  const out = new Map<string, Holder>();
  for (const [etf, e] of Object.entries(active?.etfs ?? {})) {
    const h = e.holdings.find(x => x[0] === stock);
    const last = lastAction(e, stock);
    if (!h && !last) continue;
    if (!h && last && last.kind !== KIND_LABEL.out) continue;
    out.set(etf, {
      etf, name: names[etf] ?? e.name, weight: h ? h[3] : 0, kind: 'daily', asof: e.asof,
      shares: h ? h[2] : 0, last,
    });
  }
  if (monthly) {
    const ym = monthly.meta.ym;
    for (const [etf, e] of Object.entries(monthly.etfs)) {
      if (out.has(etf)) continue;
      const r = e.rows.find(x => x[2] === stock);
      if (!r) continue;
      out.set(etf, { etf, name: names[etf] ?? e.name, weight: r[4], kind: 'monthly', asof: `${ym.slice(0, 4)}/${ym.slice(4)}` });
    }
  }
  return [...out.values()].sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
}

/** 主動式 ETF 最近一次對這檔股票的動作（近 60 次換股內） */
function lastAction(e: ActiveEtf, stock: string): { kind: string; d: string } | undefined {
  for (let i = e.changes.length - 1; i >= 0; i--) {
    const ch = e.changes[i];
    const it = ch.items.find(x => x[0] === stock);
    if (it) return { kind: KIND_LABEL[kindOf(it, ch.f)], d: ch.d };
  }
  return undefined;
}

export interface BoardRow {
  code: string;
  name: string;
  cap: number | null;
  /** 買進（新增＋加碼）之後的金額加權漲跌 */
  buy: number | null;
  /** 賣出（剔除＋減碼）之後的漲跌 */
  sell: number | null;
  /** 選股力＝買進之後 − 賣出之後（正的代表買的比賣的漲得多） */
  edge: number | null;
  n: number;
  /** 持股損益（合計 ÷ 成本），帳本起算日 */
  pnl: number | null;
  since: string | null;
}

/** 主動式經理人排行：依選股力排序；換股筆數太少（< minTrades）的排在最後、標不足 */
export function managerBoard(data: ActiveData, minTrades = 10): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const [code, e] of Object.entries(data.etfs)) {
    const sc = scorecard(e, data.last);
    const bk = bookSummary(e, data.last);
    const n = sc.buy.n + sc.sell.n;
    const edge = sc.buy.ret != null && sc.sell.ret != null ? sc.buy.ret - sc.sell.ret : null;
    rows.push({
      code, name: e.name, cap: e.cap ?? null, buy: sc.buy.ret, sell: sc.sell.ret, edge, n,
      pnl: bk && bk.since !== bk.asof ? bk.pct : null, since: bk?.since ?? null,
    });
  }
  const rank = (r: BoardRow) => (r.edge == null || r.n < minTrades ? -Infinity : r.edge);
  return rows.sort((a, b) => rank(b) - rank(a) || (b.cap ?? 0) - (a.cap ?? 0));
}
