/* 期貨對帳單（已實現損益）的解析與統計。純函式，沒有 React、沒有檔案 I/O。
 *
 * **檔案不會離開瀏覽器。** 這一頁做的是把使用者自己的對帳單在本機算一遍；
 * 這個網站沒有後端，也不該有人的交易紀錄經過任何伺服器。解析與統計都在
 * 這個模組裡，呼叫端只負責把檔案讀成二維陣列。
 *
 * ## 元大期貨「已實現損益」的欄位
 *
 *   0 結算日期   1 交易所   2 商品名稱   3 口數
 *   4 交易日期(開) 5 委託單號 6 B/S(開)  7 成交價(開)
 *   8 交易日期(平) 9 委託單號 10 B/S(平) 11 成交價(平)
 *   12 幣別  13 平倉損益  14 手續費  15 期交稅  16 合計損益  17 備註
 *
 * **欄 7、11、13～16 的標題是空白的**，只能靠位置取。這種解析最容易在對方改版時
 * 默默給出錯的數字，所以 parseSheet 會逐列驗證
 * 「平倉損益 − 手續費 − 期交稅 = 合計損益」，對不上的比例太高就直接報錯 ——
 * 寧可說「看不懂這份檔案」，也不要安靜地算出一份錯的績效。
 */

export interface Trade {
  /** 結算日 */
  date: string;
  /** 原始商品名稱，例如 小台指202601 */
  product: string;
  /** 併月份與小型之後的商品，例如 小台指、台指選擇權 */
  base: string;
  lots: number;
  /** 開倉方向 */
  side: '多' | '空';
  openPrice: number;
  closePrice: number;
  /** 平倉損益（未扣成本） */
  gross: number;
  fee: number;
  tax: number;
  /** 合計損益（已扣成本） */
  net: number;
  /** YYYY-MM */
  month: string;
}

/**
 * Excel 日期序號 -> ISO 日期。
 *
 * 1900 閏年臭蟲：序號 60 對應不存在的 1900-02-29，所以 60 以後要少扣一天。
 */
export function excelDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const days = Math.floor(serial) - (serial > 59 ? 25569 : 25568);
  const d = new Date(days * 86400000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * 商品名稱 -> 分組用的名稱。
 *
 * 三種形態，順序不能換（選擇權的樣式比期貨嚴格，要先比）：
 *   月選 台指32000202603P -> 台指選擇權
 *   週選 台指W437300P04   -> 台指選擇權
 *   期貨 小台指202601      -> 小台指
 *
 * **小型股票期貨併回本尊**（小型國巨 -> 國巨），但「小台指」「小電子」不是
 * 「小型」開頭，不受影響 —— 它們跟大台、大電子的契約規格不同，本來就該分開看。
 */
export function baseProduct(name: string): string {
  const n = String(name ?? '').trim();
  if (!n) return '';
  let m = /^(.+?)\d{4,6}\d{6}[CP]$/.exec(n);
  if (m) return `${m[1].trim()}選擇權`;
  m = /^(.+?)\d{5,6}[CP]\d{1,2}$/.exec(n);
  if (m) return `${m[1].trim().replace(/[Ww]$/, '')}選擇權`;
  // 股票期貨是「小型智邦-202605」，月份前面還有一個連字號 —— 只去掉六位數字
  // 會留下「智邦-」。實際檔案裡兩種寫法都有（小台指202601 沒有連字號）。
  let base = n.replace(/-?\d{6}$/, '').replace(/[-－]+$/, '').trim();
  if (base.startsWith('小型')) base = base.slice(2);
  return base;
}

const num = (v: unknown): number => {
  const s = String(v ?? '').trim().replace(/,/g, '');
  const f = Number(s);
  return Number.isFinite(f) ? f : 0;
};

export class StatementError extends Error {}

/** 欄位位置。標題空白的那幾欄只能靠位置取。 */
const COL = {
  date: 0, product: 2, lots: 3,
  openBs: 6, openPrice: 7, closeBs: 10, closePrice: 11,
  gross: 13, fee: 14, tax: 15, net: 16,
} as const;

/** 允許的湊帳誤差（元）。四捨五入的 1 元要放過，差 10 元就是抓錯欄。 */
const SUM_TOLERANCE = 1;

/**
 * 把試算表的二維陣列解析成交易列表。
 *
 * rows 可以來自 SheetJS 的 sheet_to_json({ header: 1 })，或 CSV 切出來的陣列。
 */
export function parseSheet(rows: unknown[][]): Trade[] {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new StatementError('這份檔案是空的');
  }
  let head = 0;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const text = (rows[i] ?? []).map(v => String(v ?? '')).join('');
    if (text.includes('商品') || text.includes('結算')) { head = i; break; }
  }

  const out: Trade[] = [];
  let mismatched = 0;
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const product = String(r[COL.product] ?? '').trim();
    if (!product || product === '商品名稱') continue;

    const gross = num(r[COL.gross]);
    const fee = num(r[COL.fee]);
    const tax = num(r[COL.tax]);
    const net = num(r[COL.net]);
    if (Math.abs(gross - fee - tax - net) > SUM_TOLERANCE) mismatched += 1;

    const serial = num(r[COL.date]);
    const date = excelDate(serial) ?? String(r[COL.date] ?? '').trim().slice(0, 10);
    out.push({
      date,
      product,
      base: baseProduct(product),
      lots: Math.max(1, Math.abs(Math.round(num(r[COL.lots])))),
      side: String(r[COL.openBs] ?? '').trim().toUpperCase() === 'B' ? '多' : '空',
      openPrice: num(r[COL.openPrice]),
      closePrice: num(r[COL.closePrice]),
      gross, fee, tax, net,
      month: date.slice(0, 7),
    });
  }

  if (out.length === 0) throw new StatementError('這份檔案裡沒有交易紀錄');
  if (mismatched > out.length * 0.1) {
    throw new StatementError(
      `欄位對不上：${mismatched}/${out.length} 列的「平倉損益 − 手續費 − 期交稅」`
      + '不等於合計損益。這份檔案的格式可能跟元大期貨的已實現損益表不同。');
  }
  return out;
}

/* ── 統計 ──────────────────────────────────────────────── */

export interface Stats {
  n: number;
  nWin: number;
  nLoss: number;
  /** 勝率 0–1 */
  winRate: number;
  avgWin: number;
  /** 平均虧損，負數 */
  avgLoss: number;
  /** 賠率＝平均獲利 ÷ |平均虧損|。沒有虧損筆數時是 null */
  payoff: number | null;
  /** 獲利因子＝總獲利 ÷ 總虧損 */
  profitFactor: number | null;
  /** 期望值：每筆平均賺多少 */
  expectancy: number;
  gross: number;
  fee: number;
  tax: number;
  net: number;
  /** 成本（手續費＋稅）吃掉毛利的比例 0–1；毛利不是正的時候是 null */
  costRatio: number | null;
  maxLossStreak: number;
  maxWinStreak: number;
  /** 最大回撤，負數 */
  maxDrawdown: number;
  best: number;
  worst: number;
  lots: number;
}

const EMPTY: Stats = {
  n: 0, nWin: 0, nLoss: 0, winRate: 0, avgWin: 0, avgLoss: 0,
  payoff: null, profitFactor: null, expectancy: 0,
  gross: 0, fee: 0, tax: 0, net: 0, costRatio: null,
  maxLossStreak: 0, maxWinStreak: 0, maxDrawdown: 0, best: 0, worst: 0, lots: 0,
};

export function stats(trades: Trade[]): Stats {
  const n = trades.length;
  if (n === 0) return { ...EMPTY };

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const wins = trades.filter(t => t.net > 0).map(t => t.net);
  const losses = trades.filter(t => t.net < 0).map(t => t.net);

  const totalWin = sum(wins);
  const totalLoss = Math.abs(sum(losses));
  const avgWin = wins.length ? totalWin / wins.length : 0;
  const avgLoss = losses.length ? sum(losses) / losses.length : 0;

  let lossStreak = 0, winStreak = 0, maxLoss = 0, maxWin = 0;
  let cum = 0, peak = 0, mdd = 0;
  for (const t of trades) {
    if (t.net < 0) { lossStreak += 1; winStreak = 0; }
    else if (t.net > 0) { winStreak += 1; lossStreak = 0; }
    else { lossStreak = 0; winStreak = 0; }
    maxLoss = Math.max(maxLoss, lossStreak);
    maxWin = Math.max(maxWin, winStreak);
    cum += t.net;
    peak = Math.max(peak, cum);
    mdd = Math.min(mdd, cum - peak);
  }

  const gross = sum(trades.map(t => t.gross));
  const fee = sum(trades.map(t => t.fee));
  const tax = sum(trades.map(t => t.tax));
  return {
    n, nWin: wins.length, nLoss: losses.length,
    winRate: wins.length / n,
    avgWin, avgLoss,
    payoff: avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    profitFactor: totalLoss > 0 ? totalWin / totalLoss : null,
    expectancy: sum(trades.map(t => t.net)) / n,
    gross, fee, tax,
    net: sum(trades.map(t => t.net)),
    costRatio: gross > 0 ? (fee + tax) / gross : null,
    maxLossStreak: maxLoss, maxWinStreak: maxWin,
    maxDrawdown: mdd,
    best: Math.max(...trades.map(t => t.net)),
    worst: Math.min(...trades.map(t => t.net)),
    lots: sum(trades.map(t => t.lots)),
  };
}

/** 累計損益曲線，一筆交易一個點。 */
export interface EquityPoint { i: number; date: string; cum: number; net: number }

export function equityCurve(trades: Trade[]): EquityPoint[] {
  let cum = 0;
  return trades.map((t, i) => {
    cum += t.net;
    return { i, date: t.date, cum, net: t.net };
  });
}

export interface Group { key: string; trades: Trade[]; stats: Stats }

/** 依欄位分組並各自算一份統計，依總損益由大到小。 */
export function groupBy(trades: Trade[], pick: (t: Trade) => string): Group[] {
  const m = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = pick(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return [...m.entries()]
    .map(([key, ts]) => ({ key, trades: ts, stats: stats(ts) }))
    .sort((a, b) => b.stats.net - a.stats.net);
}

/** 依月份分組，由舊到新 —— 時間序列要照時間排，不是照金額。 */
export function byMonth(trades: Trade[]): Group[] {
  return groupBy(trades, t => t.month).sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** 單筆損益的分佈直方圖。bins 是等寬的，回傳每一格的區間與筆數。 */
export interface Bin { from: number; to: number; n: number }

export function histogram(trades: Trade[], bins = 20): Bin[] {
  if (trades.length === 0) return [];
  const vals = trades.map(t => t.net);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (lo === hi) return [{ from: lo, to: hi, n: vals.length }];
  const w = (hi - lo) / bins;
  const out: Bin[] = Array.from({ length: bins }, (_, i) => ({
    from: lo + i * w, to: lo + (i + 1) * w, n: 0,
  }));
  for (const v of vals) {
    const i = Math.min(bins - 1, Math.floor((v - lo) / w));
    out[i].n += 1;
  }
  return out;
}
