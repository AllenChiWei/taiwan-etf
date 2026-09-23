/* 主動式 ETF 的持股與換股。純函式，沒有 React。
 *
 * 資料來自 scripts/fetch_active_holdings.py（各投信官網每日公告的持股）。
 * 判斷加碼減碼時扣掉當天的資金進出：每筆換股紀錄帶著 f（持股整體同比例伸縮了多少），
 * 如果經理人把資金同比例攤進每一檔，那不是看好誰。實測這幾檔的 f 一直是 0（股數多半
 * 不動、資金先放現金），所以這是保險，見 scripts/fetch_active_holdings.py 的 flow_ratio。
 */

/** [代號, 名稱, 股數, 權重%] */
export type Holding = [string, string, number, number];
/** [代號, 名稱, 前股數, 股數, 權重%] */
export type ChangeItem = [string, string, number, number, number];

export interface ChangeDay {
  /** 持股對應的交易日 */
  d: string;
  /** 比較的前一次 */
  p: string;
  /** 當天資金進出讓持股整體伸縮的比例（0.004 = 同比例多了 0.4%） */
  f: number;
  items: ChangeItem[];
}

export interface ActiveEtf {
  name: string;
  issuer: string;
  asof: string;
  holdings: Holding[];
  changes: ChangeDay[];
}

export interface ActiveData {
  meta: {
    updated: string;
    minChange: number;
    blocked: { code: string; name: string; issuer: string; reason: string }[];
    source: string;
    errors: string[];
  };
  etfs: Record<string, ActiveEtf>;
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
