/* 期貨對帳單（已實現損益）的解析與統計。純函式，沒有 React、沒有檔案 I/O。
 *
 * **檔案不會離開瀏覽器。** 這一頁做的是把使用者自己的對帳單在本機算一遍；
 * 這個網站沒有後端，也不該有人的交易紀錄經過任何伺服器。解析與統計都在
 * 這個模組裡，呼叫端只負責把檔案讀成二維陣列。
 *
 * ## 元大期貨「已實現損益」的兩種版面
 *
 * 一般版（18 欄，EX0651）：
 *   0 結算日期   1 交易所   2 商品名稱   3 口數
 *   4 交易日期(買) 5 委託單號 6 B/S  7 成交價
 *   8 交易日期(賣) 9 委託單號 10 B/S 11 成交價
 *   12 幣別  13 平倉損益  14 手續費  15 期交稅  16 合計損益  17 備註
 *
 * 含時間版（20 欄，EX0659）：
 *   0 結算日期  1 商品名稱  2 口數
 *   3 日期 4 時間 5 單號 6 B/S 7 成交價   （買）
 *   8 日期 9 時間 10 單號 11 B/S 12 成交價 （賣）
 *   13 平倉損益 14 手續費 15 期交稅 16 合計損益 17 備註 18 幣別 19 交易所
 *
 * **兩種版面都是「買在前、賣在後」，不是「開倉在前」。** 2026 年的 2705 筆裡，
 * 有平倉的 2690 筆全部是 B 在前 —— 放空的單也一樣。開倉方向要比兩邊的
 * 日期（含時間版再比時間）：早的那一邊是開倉。同一天又沒有時間的，分不出來。
 * 只有到期結算（平倉那邊整個空白）的列，第一個 B/S 才是開倉方向。
 *
 * 標題空白的那幾欄只能靠位置取。這種解析最容易在對方改版時默默給出錯的
 * 數字，所以 parseSheet 會逐列驗證「平倉損益 − 手續費 − 期交稅 = 合計損益」，
 * 對不上的比例太高就直接報錯 —— 寧可說「看不懂這份檔案」，也不要安靜地
 * 算出一份錯的績效。
 */

/** 三種交易方式。 */
export type Strategy = '程式' | '主觀' | '選擇權';
export const STRATEGIES: Strategy[] = ['程式', '主觀', '選擇權'];
export const STRATEGY_LABEL: Record<Strategy, string> = {
  程式: '程式交易', 主觀: '主觀交易', 選擇權: '選擇權',
};

/** 選擇權的兩種用途。 */
export type OptKind = '賣方' | '避險';
export const OPT_KIND_LABEL: Record<OptKind, string> = {
  賣方: '賣方策略', 避險: '避險（買方）',
};

/** 程式交易只做這兩種商品；其餘期貨都算主觀交易。 */
export const PROGRAM_BASES = ['小台指', '小電子'] as const;

export interface Trade {
  /** 每列內容的雜湊（同內容的第 n 列加上 #n），跨檔去重與手動標記用。
   *  是雜湊不是原文 —— 手動標記會存進 localStorage，不該把交易金額存進去。 */
  id: string;
  /** 結算日 */
  date: string;
  /** YYYY-MM */
  month: string;
  /** YYYY */
  year: string;
  /** 原始商品名稱，例如 小台指202601 */
  product: string;
  /** 併月份與小型之後的商品，例如 小台指、台指選擇權 */
  base: string;
  lots: number;
  /** 開倉方向。sideKnown 為 false 時是推定的 */
  side: '多' | '空';
  /** false：同一天買賣、檔案又沒有時間，分不出哪一邊先 */
  sideKnown: boolean;
  /** 開、平倉在同一個交易日 */
  dayTrade: boolean;
  /** 開倉價、平倉價（到期結算沒有平倉價時是 0） */
  openPrice: number;
  closePrice: number;
  buyPrice: number;
  /** 到期結算時沒有賣出那一邊 */
  sellPrice: number | null;
  /** 平倉損益（未扣成本） */
  gross: number;
  fee: number;
  tax: number;
  /** 合計損益（已扣成本） */
  net: number;
  note: string;
  isOption: boolean;
  /** 選擇權的買權／賣權；期貨沒有 */
  cp?: 'C' | 'P';
  strategy: Strategy;
  /** 只有台指選擇權有；由 classifyOptions 填 */
  optKind?: OptKind;
  /** optKind 是靠價格推定的（方向分不出來） */
  optGuess?: boolean;
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

/** 儲存格 -> ISO 日期。Excel 序號或 2026/01/02 這種文字都吃；空的回 null。 */
function cellDate(v: unknown): string | null {
  if (typeof v === 'number') return excelDate(v);
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return excelDate(Number(s));
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

/** 儲存格 -> 一天中的比例（0.5 = 中午）。夜盤過午夜會大於 1，照樣能比大小。 */
function cellTime(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  return m ? (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) / 86400 : null;
}

/**
 * 商品名稱 -> 分組用的名稱。
 *
 * 三種形態，順序不能換（選擇權的樣式比期貨嚴格，要先比）：
 *   月選 台指32000202603P -> 台指選擇權
 *   週選 台指W437300P04   -> 台指選擇權（週三到期）
 *        台指F147000P10   -> 台指選擇權（週五到期）
 *   期貨 小台指202601      -> 小台指
 *
 * 含時間版的名稱在月份前面有空白（小台指 202610），先把空白拿掉。
 *
 * **小型股票期貨併回本尊**（小型國巨 -> 國巨），但「小台指」「小電子」不是
 * 「小型」開頭，不受影響 —— 它們跟大台、大電子的契約規格不同，本來就該分開看。
 */
export function baseProduct(name: string): string {
  const n = String(name ?? '').replace(/\s+/g, '');
  if (!n) return '';
  let m = /^(.+?)\d{4,6}\d{6}[CP]$/.exec(n);
  if (m) return `${optRoot(m[1])}選擇權`;
  m = /^(.+?)\d{5,6}[CP]\d{1,2}$/.exec(n);
  if (m) return `${optRoot(m[1].replace(/[WwFf]\d?$/, ''))}選擇權`;
  // 股票期貨是「小型智邦-202605」，月份前面還有一個連字號 —— 只去掉六位數字
  // 會留下「智邦-」。實際檔案裡兩種寫法都有（小台指202601 沒有連字號）。
  let base = n.replace(/-?\d{6}$/, '').replace(/[-－]+$/, '').trim();
  if (base.startsWith('小型')) base = base.slice(2);
  return base;
}

/** 2022 年的檔案有一筆英文代號的台指選擇權（TX...C）。 */
const optRoot = (s: string) => (/^TX/i.test(s) ? '台指' : s.trim());

/** 商品 -> 交易方式。程式交易只有小台指、小電子；台指選擇權另算；其餘都是主觀。 */
export function strategyOf(base: string): Strategy {
  if (base === '台指選擇權') return '選擇權';
  if ((PROGRAM_BASES as readonly string[]).includes(base)) return '程式';
  return '主觀';
}

const isOptionBase = (base: string) => base.endsWith('選擇權');

/** 月選的 C／P 在最後（台指32000202603P），週選在月份前面（台指W437300P04）。 */
export function callPut(name: string): 'C' | 'P' | undefined {
  const m = /([CP])\d{0,2}$/.exec(String(name ?? '').replace(/\s+/g, ''));
  return m ? (m[1] as 'C' | 'P') : undefined;
}

const num = (v: unknown): number => {
  const s = String(v ?? '').trim().replace(/,/g, '');
  const f = Number(s);
  return Number.isFinite(f) ? f : 0;
};

export class StatementError extends Error {}

/** 欄位位置。標題空白的那幾欄只能靠位置取。 */
interface Layout {
  date: number; product: number; lots: number;
  buyDate: number; buyTime: number | null; buyOrder: number; buyBs: number; buyPrice: number;
  sellDate: number; sellTime: number | null; sellOrder: number; sellPrice: number;
  gross: number; fee: number; tax: number; net: number; note: number;
}

const LAYOUT_PLAIN: Layout = {
  date: 0, product: 2, lots: 3,
  buyDate: 4, buyTime: null, buyOrder: 5, buyBs: 6, buyPrice: 7,
  sellDate: 8, sellTime: null, sellOrder: 9, sellPrice: 11,
  gross: 13, fee: 14, tax: 15, net: 16, note: 17,
};

const LAYOUT_TIMED: Layout = {
  date: 0, product: 1, lots: 2,
  buyDate: 3, buyTime: 4, buyOrder: 5, buyBs: 6, buyPrice: 7,
  sellDate: 8, sellTime: 9, sellOrder: 10, sellPrice: 12,
  gross: 13, fee: 14, tax: 15, net: 16, note: 17,
};

/** 允許的湊帳誤差（元）。四捨五入的 1 元要放過，差 10 元就是抓錯欄。 */
const SUM_TOLERANCE = 1;

/** cyrb53：53 位元的字串雜湊，幾千筆交易不會撞。 */
export function hash(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const cell = (r: unknown[], i: number) => String(r[i] ?? '').trim();

/**
 * 把試算表的二維陣列解析成交易列表。
 *
 * rows 可以來自 SheetJS 的 sheet_to_json({ header: 1 })，或 CSV 切出來的陣列。
 * 回傳的交易還沒分選擇權的賣方／避險，那一步在 classifyOptions（門檻可以調）。
 */
export function parseSheet(rows: unknown[][]): Trade[] {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new StatementError('這份檔案是空的');
  }
  let head = -1;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const text = (rows[i] ?? []).map(v => String(v ?? '')).join('');
    if (text.includes('商品') || text.includes('結算')) { head = i; break; }
  }
  const headCells = head >= 0 ? (rows[head] ?? []).map(v => String(v ?? '').trim()) : [];
  // 含時間版：第二欄就是商品名稱，而且有「時間」欄
  const L = headCells.includes('時間') && headCells[1] === '商品名稱' ? LAYOUT_TIMED : LAYOUT_PLAIN;

  const out: Trade[] = [];
  const seen = new Map<string, number>();
  let mismatched = 0;
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const product = cell(r, L.product).replace(/\s+/g, '');
    if (!product || product === '商品名稱') continue;

    const gross = num(r[L.gross]);
    const fee = num(r[L.fee]);
    const tax = num(r[L.tax]);
    const net = num(r[L.net]);
    if (Math.abs(gross - fee - tax - net) > SUM_TOLERANCE) mismatched += 1;

    const date = cellDate(r[L.date]) ?? cell(r, L.date).slice(0, 10);
    const buyDate = cellDate(r[L.buyDate]);
    const sellDate = cellDate(r[L.sellDate]);
    const buyPrice = num(r[L.buyPrice]);
    const sellRaw = cell(r, L.sellPrice);
    const settled = !sellDate && !sellRaw;      // 到期結算：平倉那邊整個空白

    // 開倉方向：見檔頭說明。到期結算看第一個 B/S；其餘比日期，再比時間
    let side: '多' | '空' = '多';
    let sideKnown = true;
    if (settled) {
      side = cell(r, L.buyBs).toUpperCase() === 'S' ? '空' : '多';
    } else if (buyDate && sellDate && buyDate !== sellDate) {
      side = buyDate < sellDate ? '多' : '空';
    } else {
      const bt = L.buyTime === null ? null : cellTime(r[L.buyTime]);
      const st = L.sellTime === null ? null : cellTime(r[L.sellTime]);
      if (bt !== null && st !== null && bt !== st) side = bt < st ? '多' : '空';
      else sideKnown = false;
    }
    const sellPrice = settled ? null : num(r[L.sellPrice]);
    // 到期結算那列只有一邊，價格放在第一組欄位
    const openPrice = settled ? buyPrice : side === '多' ? buyPrice : (sellPrice ?? 0);
    const closePrice = settled ? 0 : side === '多' ? (sellPrice ?? 0) : buyPrice;

    const base = baseProduct(product);
    const isOption = isOptionBase(base);
    // 指紋用整理過的欄位，不用原始儲存格：兩種版面的同一筆交易要對得上
    // （含時間版的單號前面多一個 #、商品名稱多空白）
    const order = (i: number) => cell(r, i).replace(/^#/, '');
    const fp = hash([date, product, num(r[L.lots]), buyDate, order(L.buyOrder), buyPrice,
      sellDate, order(L.sellOrder), sellRaw, cell(r, L.buyBs), gross, fee, tax, net].join('|'));
    const k = (seen.get(fp) ?? 0) + 1;
    seen.set(fp, k);

    out.push({
      id: `${fp}#${k}`,
      date, month: date.slice(0, 7), year: date.slice(0, 4),
      product, base,
      lots: Math.max(1, Math.abs(Math.round(num(r[L.lots])))),
      side, sideKnown,
      dayTrade: settled ? buyDate === date : !!buyDate && buyDate === sellDate,
      openPrice, closePrice, buyPrice, sellPrice,
      gross, fee, tax, net,
      note: cell(r, L.note),
      isOption,
      ...(isOption ? { cp: callPut(product) } : {}),
      strategy: strategyOf(base),
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

/**
 * 合併好幾份對帳單。期間重疊的部分只算一次。
 *
 * 同一份檔案裡本來就有完全一樣的兩列（同價同口數的兩筆單），不能直接去重。
 * 所以每一種內容取「單一檔案裡出現最多的次數」：A 檔有 2 列、B 檔有 2 列
 * 同樣的內容，合併後還是 2 列，而不是 4 列或 1 列（Trade.id 帶著第幾次出現）。
 * 一般版與含時間版的同一筆交易也認得出來。
 */
export function mergeTrades(files: Trade[][]): Trade[] {
  const keep = new Map<string, Trade>();
  for (const list of files) {
    for (const t of list) {
      const old = keep.get(t.id);
      // 同一筆在含時間版裡分得出方向，就用那一份
      if (!old || (!old.sideKnown && t.sideKnown)) keep.set(t.id, t);
    }
  }
  // 依結算日排；同一天保留原本的順序（Array.prototype.sort 是穩定的）
  return [...keep.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* ── 選擇權：賣方策略或避險 ──────────────────────────────── */

export interface OptionRule {
  /** 賣價落在這個區間（含）才推定為賣方策略 */
  sellMin: number;
  sellMax: number;
  /** 使用者手動指定，key 是 Trade.id */
  overrides?: Record<string, OptKind>;
}

/**
 * 使用者說「大致上賣 15 點左右」；2026 年分得出方向的賣方開倉落在 9～18.5 點。
 * 上限放到 30 會把「買 20、賣 25」這種像是買方的當沖也算成賣方，所以收在 20。
 */
export const DEFAULT_OPTION_RULE: OptionRule = { sellMin: 8, sellMax: 20 };

/**
 * 台指選擇權分成賣方策略與避險。
 *
 *   1. 手動指定的優先。
 *   2. 方向分得出來：先賣（空）就是賣方策略，先買（多）就是避險。
 *      不看價格 —— 使用者也會買 15 點左右的選擇權當避險，只看價格會分錯。
 *   3. 方向分不出來（同一天買賣、檔案沒有時間）：賣價落在 sellMin～sellMax
 *      推定為賣方，其餘推定為避險，並標 optGuess。
 */
export function classifyOptions(trades: Trade[], rule: OptionRule = DEFAULT_OPTION_RULE): Trade[] {
  return trades.map(t => {
    if (t.strategy !== '選擇權') return t;
    const manual = rule.overrides?.[t.id];
    if (manual) return { ...t, optKind: manual, optGuess: false };
    if (t.sideKnown) return { ...t, optKind: t.side === '空' ? '賣方' : '避險', optGuess: false };
    const sp = t.sellPrice ?? 0;
    const seller = sp >= rule.sellMin && sp <= rule.sellMax;
    return {
      ...t,
      optKind: seller ? '賣方' : '避險',
      optGuess: true,
      // 推定的方向也跟著改，明細的開／平倉價才對得上
      side: seller ? '空' : '多',
      openPrice: seller ? sp : t.buyPrice,
      closePrice: seller ? t.buyPrice : sp,
    };
  });
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
  /** 最大回撤，負數（逐筆累計） */
  maxDrawdown: number;
  /** 報酬回撤比＝總損益 ÷ |最大回撤|。沒有回撤時是 null */
  recovery: number | null;
  best: number;
  worst: number;
  lots: number;
  /** 有交易的結算日數 */
  days: number;
  /** 賺錢的結算日佔比 0–1 */
  dayWinRate: number;
}

const EMPTY: Stats = {
  n: 0, nWin: 0, nLoss: 0, winRate: 0, avgWin: 0, avgLoss: 0,
  payoff: null, profitFactor: null, expectancy: 0,
  gross: 0, fee: 0, tax: 0, net: 0, costRatio: null,
  maxLossStreak: 0, maxWinStreak: 0, maxDrawdown: 0, recovery: null,
  best: 0, worst: 0, lots: 0, days: 0, dayWinRate: 0,
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
  const perDay = new Map<string, number>();
  for (const t of trades) {
    if (t.net < 0) { lossStreak += 1; winStreak = 0; }
    else if (t.net > 0) { winStreak += 1; lossStreak = 0; }
    else { lossStreak = 0; winStreak = 0; }
    maxLoss = Math.max(maxLoss, lossStreak);
    maxWin = Math.max(maxWin, winStreak);
    cum += t.net;
    peak = Math.max(peak, cum);
    mdd = Math.min(mdd, cum - peak);
    perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.net);
  }

  const gross = sum(trades.map(t => t.gross));
  const fee = sum(trades.map(t => t.fee));
  const tax = sum(trades.map(t => t.tax));
  const net = sum(trades.map(t => t.net));
  const dayVals = [...perDay.values()];
  return {
    n, nWin: wins.length, nLoss: losses.length,
    winRate: wins.length / n,
    avgWin, avgLoss,
    payoff: avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    profitFactor: totalLoss > 0 ? totalWin / totalLoss : null,
    expectancy: net / n,
    gross, fee, tax, net,
    costRatio: gross > 0 ? (fee + tax) / gross : null,
    maxLossStreak: maxLoss, maxWinStreak: maxWin,
    maxDrawdown: mdd,
    recovery: mdd < 0 ? net / Math.abs(mdd) : null,
    best: Math.max(...trades.map(t => t.net)),
    worst: Math.min(...trades.map(t => t.net)),
    lots: sum(trades.map(t => t.lots)),
    days: dayVals.length,
    dayWinRate: dayVals.filter(v => v > 0).length / dayVals.length,
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

/**
 * 依結算日累計的損益曲線，好幾條共用同一條日期軸 —— 三種交易方式才能放在
 * 同一張圖上比。某條線在那天沒有交易就沿用前一天的累計值。
 */
export interface DailyCurves { dates: string[]; series: Array<{ key: string; values: number[] }> }

export function dailyCurves(groups: Array<{ key: string; trades: Trade[] }>): DailyCurves {
  const dateSet = new Set<string>();
  for (const g of groups) for (const t of g.trades) dateSet.add(t.date);
  const dates = [...dateSet].sort();
  const series = groups.map(g => {
    const perDay = new Map<string, number>();
    for (const t of g.trades) perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.net);
    let cum = 0;
    return { key: g.key, values: dates.map(d => (cum += perDay.get(d) ?? 0)) };
  });
  return { dates, series };
}

/** 回撤曲線：每天的累計損益距離之前最高點多遠（≤ 0）。 */
export function drawdownSeries(values: number[]): number[] {
  let peak = 0;
  return values.map(v => { peak = Math.max(peak, v); return v - peak; });
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

/** 依年度分組，由舊到新。 */
export function byYear(trades: Trade[]): Group[] {
  return groupBy(trades, t => t.year).sort((a, b) => (a.key < b.key ? -1 : 1));
}

/**
 * 月績效表：一年一列，1～12 月各一格，加上全年合計。
 * 那個月沒有交易的格子是 null（不是 0 —— 沒做跟打平不一樣）。
 */
export interface MonthRow { year: string; months: Array<number | null>; total: number }

export function monthMatrix(trades: Trade[]): MonthRow[] {
  const m = new Map<string, Array<number | null>>();
  for (const t of trades) {
    if (!m.has(t.year)) m.set(t.year, Array(12).fill(null));
    const row = m.get(t.year)!;
    const i = Number(t.month.slice(5, 7)) - 1;
    if (i >= 0 && i < 12) row[i] = (row[i] ?? 0) + t.net;
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([year, months]) => ({
      year, months, total: months.reduce<number>((s, v) => s + (v ?? 0), 0),
    }));
}

/* ── 選擇權專用指標 ──────────────────────────────────── */

/** 台指選擇權每點 50 元。 */
export const TXO_POINT = 50;

export interface OptionMetrics {
  /** 開倉的權利金總額（元）：賣方是收進來的，避險是付出去的 */
  premium: number;
  /** 開倉均價（點，依口數加權） */
  avgPrice: number;
  /** 賣方：合計損益 ÷ 收到的權利金 —— 權利金留下了幾成 */
  keepRate: number | null;
  /** 避險：(付出的權利金 ＋ 平倉損益) ÷ 付出的權利金 —— 花出去的錢收回幾成 */
  recoverRate: number | null;
  /** 放到結算（未履約／履約結算）的筆數，以及其中賺錢的 */
  settled: number;
  settledWin: number;
  /** 最大單筆虧損 ÷ 平均獲利：一次大賠要幾筆小賺才補得回來 */
  tailRatio: number | null;
  /** 有交易的月數，以及平均每月損益 */
  months: number;
  perMonth: number;
}

export function optionMetrics(trades: Trade[]): OptionMetrics {
  const lots = trades.reduce((a, t) => a + t.lots, 0);
  const pts = trades.reduce((a, t) => a + t.openPrice * t.lots, 0);
  const premium = pts * TXO_POINT;
  const gross = trades.reduce((a, t) => a + t.gross, 0);
  const net = trades.reduce((a, t) => a + t.net, 0);
  const settledList = trades.filter(t => t.sellPrice === null);
  const wins = trades.filter(t => t.net > 0);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.net, 0) / wins.length : 0;
  const worst = trades.length ? Math.min(...trades.map(t => t.net)) : 0;
  const months = new Set(trades.map(t => t.month)).size;
  return {
    premium,
    avgPrice: lots ? pts / lots : 0,
    keepRate: premium > 0 ? net / premium : null,
    recoverRate: premium > 0 ? (premium + gross) / premium : null,
    settled: settledList.length,
    settledWin: settledList.filter(t => t.net > 0).length,
    tailRatio: worst < 0 && avgWin > 0 ? Math.abs(worst) / avgWin : null,
    months,
    perMonth: months ? net / months : 0,
  };
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
