/* 主動式 ETF 的持股與換股。純函式，沒有 React。
 *
 * 資料來自 scripts/fetch_active_holdings.py（各投信官網每日公告的持股）。
 * 判斷加碼減碼時扣掉當天的資金進出：每筆換股紀錄帶著 f（持股整體同比例伸縮了多少），
 * 如果經理人把資金同比例攤進每一檔，那不是看好誰。實測這幾檔的 f 一直是 0（股數多半
 * 不動、資金先放現金），所以這是保險，見 scripts/fetch_active_holdings.py 的 flow_ratio。
 */

/** [代號, 名稱, 股數, 權重%] */
export type Holding = [string, string, number, number];
/** [代號, 名稱, 前股數, 股數, 權重%, 當日均價（2026-10-26 起；海外、期貨、舊資料沒有）] */
export type ChangeItem = [string, string, number, number, number, (number | null)?];

export interface ChangeDay {
  /** 持股對應的交易日 */
  d: string;
  /** 比較的前一次 */
  p: string;
  /** 當天資金進出讓持股整體伸縮的比例（0.004 = 同比例多了 0.4%） */
  f: number;
  items: ChangeItem[];
  /** 估值 [買進, 賣出]（元）＝股數變化 × 當日均價，只算有台股價格的 */
  v?: [number, number];
}

/** 持股損益帳本（移動平均成本）：pos＝{代號: [股數, 成本, 已實現]}，done＝出清的 [代號, 名稱, 已實現, 日期] */
export interface Book {
  since: string;
  asof: string;
  pos: Record<string, [number, number, number]>;
  real: number;
  done: [string, string, number, string][];
}

export interface ActiveEtf {
  name: string;
  issuer: string;
  /** 市值（億元）；舊資料沒有 */
  cap?: number | null;
  /** 是否在主動式股票型市值前十 */
  top?: boolean;
  asof: string;
  holdings: Holding[];
  changes: ChangeDay[];
  book?: Book;
}

export interface ActiveData {
  meta: {
    updated: string;
    minChange: number;
    blocked: { code: string; name: string; issuer?: string; reason: string;
               cap?: number | null; top?: boolean }[];
    /** 今天的市值前十（代號） */
    top?: string[];
    source: string;
    errors: string[];
  };
  etfs: Record<string, ActiveEtf>;
  /** 各標的最近一次收盤（d＝最新的價格日） */
  last?: { d: string | null; px: Record<string, number> };
}

/** 換股之後到最新收盤的漲跌（0.05 = +5%）；沒有均價或收盤時 null。 */
export function afterReturn(item: ChangeItem, last?: ActiveData['last']): number | null {
  const p = item[5];
  const c = last?.px[item[0]];
  return p && c ? c / p - 1 : null;
}

export interface Scorecard {
  /** 買進（新增＋加碼）的金額加權漲跌、估值（元）、筆數 */
  buy: { ret: number | null; value: number; n: number };
  /** 賣出（剔除＋減碼）之後的漲跌：正的代表賣早了 */
  sell: { ret: number | null; value: number; n: number };
  /** 統計範圍（最早、最晚換股日） */
  from: string | null;
  to: string | null;
}

/**
 * 換股成效：近期每一筆換股，從當天均價到最新收盤的漲跌，用「股數變化 × 均價」加權。
 * 只回答「經理人買的有沒有漲、賣的有沒有跌」，不是 ETF 的報酬；張數變化可能含申購贖回。
 */
export function scorecard(etf: ActiveEtf, last?: ActiveData['last'], days = 60): Scorecard {
  const acc = { buy: { pnl: 0, value: 0, n: 0 }, sell: { pnl: 0, value: 0, n: 0 } };
  const chs = etf.changes.slice(-days);
  for (const ch of chs) {
    for (const it of ch.items) {
      const p = it[5];
      const c = last?.px[it[0]];
      if (!p || !c) continue;
      const dv = it[3] - it[2];
      const side = dv > 0 ? acc.buy : acc.sell;
      side.value += Math.abs(dv) * p;
      side.pnl += Math.abs(dv) * (c - p);
      side.n += 1;
    }
  }
  const fin = (s: { pnl: number; value: number; n: number }) =>
    ({ ret: s.value ? s.pnl / s.value : null, value: s.value, n: s.n });
  return { buy: fin(acc.buy), sell: fin(acc.sell), from: chs[0]?.d ?? null, to: chs[chs.length - 1]?.d ?? null };
}

export interface BookRow { code: string; name: string; shares: number; cost: number; value: number; unreal: number; real: number }

/** 持股損益帳本 → 未實現（收盤市值 − 成本）、已實現、各標的明細（沒有收盤價的不算）。 */
export function bookSummary(etf: ActiveEtf, last?: ActiveData['last']) {
  const b = etf.book;
  if (!b) return null;
  const names = new Map(etf.holdings.map(h => [h[0], h[1]] as [string, string]));
  const rows: BookRow[] = [];
  for (const [code, [shares, cost, real]] of Object.entries(b.pos)) {
    const c = last?.px[code];
    if (!c) continue;
    const value = shares * c;
    rows.push({ code, name: names.get(code) ?? code, shares, cost, value, unreal: value - cost, real });
  }
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const unreal = rows.reduce((a, r) => a + r.unreal, 0);
  rows.sort((x, y) => Math.abs(y.unreal + y.real) - Math.abs(x.unreal + x.real));
  return { since: b.since, asof: last?.d ?? b.asof, cost, unreal, real: b.real, pct: cost ? (unreal + b.real) / cost : 0, rows, done: b.done };
}

export type ChangeKind = 'new' | 'out' | 'add' | 'cut';

export const KIND_LABEL: Record<ChangeKind, string> = {
  new: '新增', out: '剔除', add: '加碼', cut: '減碼',
};

/** 一筆變動是哪一種。加碼／減碼看的是扣掉資金進出之後的方向。 */
export function kindOf(item: ChangeItem, flow: number): ChangeKind {
  const [, , a, b] = item;
  if (!a) return 'new';
  if (!b) return 'out';
  return b / (a * (1 + flow)) >= 1 ? 'add' : 'cut';
}

/**
 * 扣掉資金進出之後的股數變化比例（0.12 = 多買了 12%）。新增與剔除回 null ——
 * 從 0 開始或變成 0 沒有「多少百分比」可講。
 */
export function netChange(item: ChangeItem, flow: number): number | null {
  const [, , a, b] = item;
  if (!a || !b) return null;
  return b / (a * (1 + flow)) - 1;
}

/** 最新一次換股，沒有紀錄時 null。 */
export function latestChange(etf: ActiveEtf): ChangeDay | null {
  return etf.changes.length ? etf.changes[etf.changes.length - 1] : null;
}

/** 依種類分組，組內依變動幅度（新增／剔除依權重）排。 */
export function groupChanges(day: ChangeDay): Record<ChangeKind, ChangeItem[]> {
  const out: Record<ChangeKind, ChangeItem[]> = { new: [], out: [], add: [], cut: [] };
  for (const it of day.items) out[kindOf(it, day.f)].push(it);
  const mag = (it: ChangeItem) => Math.abs(netChange(it, day.f) ?? 0);
  out.add.sort((x, y) => mag(y) - mag(x));
  out.cut.sort((x, y) => mag(y) - mag(x));
  out.new.sort((x, y) => y[4] - x[4]);
  return out;
}

export interface Consensus {
  code: string;
  name: string;
  /** 買進（新增或加碼）的 ETF 代號 */
  buy: string[];
  /** 賣出（剔除或減碼）的 ETF 代號 */
  sell: string[];
}

/**
 * 各檔「最新一次換股」合起來看：同一檔股票被幾檔主動式 ETF 同時買或賣。
 *
 * 只看各自的最新一次，而且日期要是全體最新的那一天（落後的那幾檔不算），
 * 否則會把上週的加碼跟今天的減碼混成一格。依參與的 ETF 數排序。
 */
export function consensus(data: ActiveData): { date: string | null; rows: Consensus[] } {
  const latest = Object.values(data.etfs)
    .map(e => latestChange(e)?.d)
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop() ?? null;
  if (!latest) return { date: null, rows: [] };
  const map = new Map<string, Consensus>();
  for (const [code, etf] of Object.entries(data.etfs)) {
    const day = latestChange(etf);
    if (!day || day.d !== latest) continue;
    for (const it of day.items) {
      const k = kindOf(it, day.f);
      const row = map.get(it[0]) ?? { code: it[0], name: it[1], buy: [], sell: [] };
      (k === 'new' || k === 'add' ? row.buy : row.sell).push(code);
      map.set(it[0], row);
    }
  }
  const rows = [...map.values()]
    .filter(r => r.buy.length + r.sell.length >= 2)
    .sort((a, b) => (b.buy.length + b.sell.length) - (a.buy.length + a.sell.length)
      || b.buy.length - a.buy.length);
  return { date: latest, rows };
}

/**
 * 股數的顯示：期貨用口、台股用張（1000 股）、海外股票用股。
 *
 * 期貨要看名稱而不是代號：海外股票的代號也是英文字母（美股 ticker），只看「代號
 * 不是數字」會把整排美股顯示成幾口。
 */
export function sharesLabel(code: string, shares: number, name = ''): string {
  const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
  if (/期貨|期指/.test(name)) return `${nf.format(shares)} 口`;
  if (/^\d{4,6}[A-Z]?$/.test(code)) return `${nf.format(shares / 1000)} 張`;
  return `${nf.format(shares)} 股`;
}

/* ── 市值前十大合計持股 ─────────────────────────────────────
 *
 * 站主要的是「這十檔主動式 ETF 合起來，錢最多放在哪十檔股票」。所以不是平均權重，
 * 而是每檔 ETF 的「權重 × 市值」加總 —— 大檔的 ETF 份量本來就比較重。
 * 國泰、富邦那幾檔沒有每日持股，算不進去，回傳裡另外列出它們佔多少市值。
 */

export interface AggRow {
  code: string;
  name: string;
  /** 合計持有市值（億元） */
  amount: number;
  /** 佔納入計算的 ETF 合計市值（%） */
  share: number;
  /** 持有它的 ETF 代號 */
  etfs: string[];
}

export interface Aggregate {
  rows: AggRow[];
  /** 納入計算的 ETF 與其市值（億元） */
  included: { code: string; name: string; cap: number }[];
  /** 在市值前十、但沒有每日持股的 */
  missing: { code: string; name: string; cap: number | null; reason: string }[];
}

/** 期貨部位不算（台指期是避險或曝險調整，不是「持有哪檔股票」）。 */
function isStock(name: string): boolean {
  return !/期貨|期指/.test(name);
}

export function aggregateTop(data: ActiveData, limit = 10): Aggregate {
  const included: Aggregate['included'] = [];
  const map = new Map<string, AggRow>();
  for (const [code, e] of Object.entries(data.etfs)) {
    if (!e.top || !e.cap) continue;
    included.push({ code, name: e.name, cap: e.cap });
    for (const [c, n, , w] of e.holdings) {
      if (!isStock(n) || !(w > 0)) continue;
      const row = map.get(c) ?? { code: c, name: n, amount: 0, share: 0, etfs: [] };
      // 各家寫法不同（台灣積體／台積電），留最短的那個
      if (n.length < row.name.length) row.name = n;
      row.amount += (w / 100) * e.cap;
      row.etfs.push(code);
      map.set(c, row);
    }
  }
  const total = included.reduce((a, x) => a + x.cap, 0);
  const rows = [...map.values()]
    .map(r => ({ ...r, share: total ? (r.amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
  const missing = (data.meta.blocked ?? [])
    .filter(b => b.top)
    .map(b => ({ code: b.code, name: b.name, cap: b.cap ?? null, reason: b.reason }));
  included.sort((a, b) => b.cap - a.cap);
  return { rows, included, missing };
}
