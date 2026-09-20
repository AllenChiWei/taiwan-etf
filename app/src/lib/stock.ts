/* 個股頁的型別與純計算。沒有 React，tests/ 直接跑這裡的真函式。
 *
 * 這一頁的數字有兩個容易搞錯的地方，兩個都在這裡處理掉：
 *
 * 1. **季報是累計數**。公開資訊觀測站的綜合損益表給的是年初到該季底的累計：
 *    Q2 是上半年、Q3 是前三季。當成單季會差一倍。`singleQuarter()` 在歷史裡
 *    有連續兩期時把它還原成單季。
 * 2. **單位是千元**。財報數字全是千元，籌碼的買賣超是「股」，融資融券是「張」。
 *    換算集中在這裡，畫面只管顯示。
 */

export interface StockInfo {
  name: string;
  full?: string;
  market: string;
  industry?: string;
  capital?: number | null;
  listed?: string;
  chair?: string;
  site?: string;
}

/** 一期財報。金額單位都是千元；p 是 '2026Q2' 這種期別。 */
export interface Quarter {
  p: string;
  rev?: number | null;
  gp?: number | null;
  op?: number | null;
  pre?: number | null;
  ni?: number | null;
  eps?: number | null;
  ca?: number | null;
  cl?: number | null;
  ta?: number | null;
  tl?: number | null;
  eq?: number | null;
  /** 每股參考淨值（元） */
  bv?: number | null;
}

/** 一個月的營收。rev/cum 是千元，mom/yoy/cumYoy 是百分比。 */
export interface Month {
  p: string;
  rev?: number | null;
  mom?: number | null;
  yoy?: number | null;
  cum?: number | null;
  cumYoy?: number | null;
}

export interface StockChips {
  date: string | null;
  days: string[];
  /** 每日 [外資, 投信, 自營] 買賣超股數；當天沒資料是 null */
  inst: Array<[number, number, number] | null>;
  /** 融資餘額 mb、融券餘額 sb（張），上櫃另有融資使用率 use（%） */
  margin?: { mb?: number | null; sb?: number | null; use?: number | null } | null;
  /** 外資及陸資持股比率（%） */
  qfii?: number | null;
  /** 集保：400 張以上 big、1000 張以上 huge、股東人數 holders */
  tdcc?: { big?: number | null; huge?: number | null; holders?: number | null } | null;
  tdccDate?: string | null;
}

export interface StockData {
  code: string;
  info: StockInfo;
  q: Quarter[];
  m: Month[];
  chips: StockChips;
}

export interface StockIndexRow { c: string; n: string; m: string; i: string }

export interface StockIndex {
  meta: {
    updated: string;
    chipsDate: string | null;
    tdccDate: string | null;
    stocks: number;
    quarters: string[];
    months: string[];
    source: string;
    note: string;
    errors: string[];
  };
  stocks: StockIndexRow[];
}

/* ── 期別 ───────────────────────────────────────────────── */

/** '2026Q2' -> {year: 2026, q: 2}；格式不對回 null。 */
export function parsePeriod(p: string): { year: number; q: number } | null {
  const m = /^(\d{4})Q([1-4])$/.exec(p ?? '');
  if (!m) return null;
  return { year: Number(m[1]), q: Number(m[2]) };
}

/** 累計期間的說法。Q1 沒有「累計」可言，就直接叫第一季。 */
export function periodLabel(p: string): string {
  const parsed = parsePeriod(p);
  if (!parsed) return p;
  const { year, q } = parsed;
  if (q === 1) return `${year} 第一季`;
  if (q === 2) return `${year} 上半年（累計）`;
  if (q === 3) return `${year} 前三季（累計）`;
  return `${year} 全年（累計）`;
}

const CUMULATIVE_FIELDS = ['rev', 'gp', 'op', 'pre', 'ni', 'eps'] as const;

/**
 * 把累計數還原成單季。
 *
 * Q1 本身就是單季，直接回傳。其餘要拿同一年的前一季來相減，沒有前一季就回 null
 * —— 這是「算不出來」，不是 0。資產負債表的欄位是時點數，原樣保留不相減。
 */
export function singleQuarter(rows: Quarter[], period: string): Quarter | null {
  const parsed = parsePeriod(period);
  const cur = rows.find(r => r.p === period);
  if (!parsed || !cur) return null;
  if (parsed.q === 1) return cur;

  const prevKey = `${parsed.year}Q${parsed.q - 1}`;
  const prev = rows.find(r => r.p === prevKey);
  if (!prev) return null;

  const out: Quarter = { ...cur };
  for (const k of CUMULATIVE_FIELDS) {
    const a = cur[k];
    const b = prev[k];
    out[k] = (a === null || a === undefined || b === null || b === undefined)
      ? null
      : Math.round((a - b) * 100) / 100;
  }
  return out;
}

/* ── 比率 ───────────────────────────────────────────────── */

/** a/b 的百分比。分母是 0、負數或缺值時回 null —— 那種比率沒有意義。 */
export function pct(a: number | null | undefined, b: number | null | undefined):
number | null {
  if (a === null || a === undefined || !b || b <= 0) return null;
  return Math.round((a / b) * 10000) / 100;
}

export interface Ratios {
  /** 毛利率 */
  gm: number | null;
  /** 營業利益率 */
  om: number | null;
  /** 稅後純益率 */
  pm: number | null;
  /** 負債比 */
  debt: number | null;
  /** 流動比 */
  current: number | null;
  /** 股東權益報酬率的近似：本期淨利 / 權益（累計期間，不年化） */
  roe: number | null;
}

/**
 * 從損益表與資產負債表算比率。
 *
 * 刻意不抓證交所的「營益分析」那份：櫃買沒有對應端點，而這三個比率就是除法。
 * 自己算可以保證上市與上櫃一致。ROE 不年化 —— 累計期間長度不同，年化要多一個
 * 假設，而畫面上已經寫明是哪一段期間。
 */
export function ratios(q: Quarter | null): Ratios {
  if (!q) return { gm: null, om: null, pm: null, debt: null, current: null, roe: null };
  return {
    gm: pct(q.gp, q.rev),
    om: pct(q.op, q.rev),
    pm: pct(q.ni, q.rev),
    debt: pct(q.tl, q.ta),
    current: pct(q.ca, q.cl),
    roe: pct(q.ni, q.eq),
  };
}

/* ── 籌碼 ───────────────────────────────────────────────── */

/** 一股 = 0.001 張。買賣超公佈的是股數，畫面講張。 */
export function toLots(shares: number | null | undefined): number | null {
  if (shares === null || shares === undefined) return null;
  return shares / 1000;
}

export interface InstSum { foreign: number; trust: number; dealer: number; days: number }

/**
 * 近 n 個交易日的三大法人合計（股數）。
 *
 * 沒有資料的日子跳過而不是當成 0，並回報實際累計了幾天 —— 畫面要能說
 * 「近 5 日（實際 4 天）」，不然使用者會以為某天法人剛好沒動作。
 */
export function sumInst(chips: StockChips, n: number): InstSum {
  const out: InstSum = { foreign: 0, trust: 0, dealer: 0, days: 0 };
  const rows = chips.inst.slice(-n);
  for (const r of rows) {
    if (!r) continue;
    out.foreign += r[0] ?? 0;
    out.trust += r[1] ?? 0;
    out.dealer += r[2] ?? 0;
    out.days += 1;
  }
  return out;
}

/** 每日合計（三家相加），給走勢圖用；沒資料的日子是 null。 */
export function instTotals(chips: StockChips): Array<number | null> {
  return chips.inst.map(r => (r ? (r[0] ?? 0) + (r[1] ?? 0) + (r[2] ?? 0) : null));
}

/* ── 顯示 ───────────────────────────────────────────────── */

/**
 * 千元 -> 好讀的中文金額。
 *
 * 台灣講金額用億與萬，不用 K/M/B。1 千元 = 1000 元，所以億是 1e5 千元。
 */
export function moneyFromThousands(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  // 1 億元 = 100,000 千元、1 兆元 = 1,000,000,000 千元。
  // 這兩個常數寫錯十倍時畫面看起來仍然「正常」（只是數字大了十倍），
  // 所以測試用台積電的實際數字釘住：2,404,483,690 千元 = 2.40 兆。
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} 兆`;
  if (abs >= 1e5) return `${(v / 1e5).toFixed(1)} 億`;
  return `${Math.round(v).toLocaleString('zh-TW')} 千元`;
}

/** 元 -> 億/萬。股本與市值用得到。 */
export function moneyFromYuan(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)} 億`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(1)} 萬`;
  return `${Math.round(v).toLocaleString('zh-TW')} 元`;
}

/** '19940905' -> '1994-09-05'。 */
export function isoDate(compact: string | null | undefined): string {
  const s = (compact ?? '').trim();
  if (!/^\d{8}$/.test(s)) return '—';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`;
}

/* ── 營收排行 ───────────────────────────────────────────── */

export interface RankRow {
  c: string; n: string; m: string; i: string;
  rev: number | null;
  yoy: number | null;
  mom: number | null;
  cum: number | null;
  cumYoy: number | null;
}

export interface Ranking {
  meta: { period: string | null; count: number; updated: string; source: string };
  rows: RankRow[];
}

export type RankKey = 'yoy' | 'mom' | 'rev' | 'cumYoy';

export interface RankOptions {
  key: RankKey;
  /** 由高到低（預設）或由低到高 */
  asc?: boolean;
  /** 市場：'' 全部 / '上市' / '上櫃' */
  market?: string;
  /** 營收門檻（千元）。見下方說明，預設值由呼叫端決定 */
  minRev?: number;
  limit?: number;
}

/**
 * 成長率的「基期」：從本期金額與成長率反推上一期。
 *
 * 排行榜被洗掉的真正原因不是公司小，而是**基期近零**：建設公司依完工比例認列，
 * 去年同月可能只有幾十萬，今年 8.9 億就變成 +2,630,241%。這種數字沒有解讀價值。
 * 光用本期營收當門檻擋不住它們 —— 它們的本期營收很大。
 */
export function impliedBase(value: number | null | undefined,
                            growthPct: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (growthPct === null || growthPct === undefined) return null;
  const factor = 1 + growthPct / 100;
  if (factor <= 0) return null;                 // 由負轉正之類，比較基礎不成立
  return value / factor;
}

/**
 * 營收排行。
 *
 * 門檻同時套在本期與基期上：兩期都要有實質營收，年增率才有意義。沒有該項數值的
 * （例如當月沒公告）直接排除，不要當成 0 —— 0% 成長與「沒有資料」是兩件事。
 */
export function rankRevenue(rows: RankRow[], opts: RankOptions): RankRow[] {
  const { key, asc = false, market = '', minRev = 0, limit } = opts;
  const out = rows.filter(r => {
    if (market && r.m !== market) return false;
    if (r[key] === null || r[key] === undefined) return false;
    if (!minRev) return true;
    const value = key === 'cumYoy' ? r.cum : r.rev;
    if ((value ?? 0) < minRev) return false;
    if (key === 'rev') return true;
    const base = impliedBase(value, r[key] as number);
    return base !== null && base >= minRev;
  });
  out.sort((a, b) => {
    const av = a[key] as number;
    const bv = b[key] as number;
    return asc ? av - bv : bv - av;
  });
  return limit ? out.slice(0, limit) : out;
}

/* ── 創新高／新低與漲跌幅 ───────────────────────────────── */

/** 一個窗口（150／200／250 日）的位階。h/l 已換算成原始股價的尺度。 */
export interface HighWindow {
  h: number;
  l: number;
  /** 距高點幾 %（負數） */
  fh: number;
  /** 距低點幾 %（正數） */
  fl: number;
  nh: 0 | 1;
  nl: 0 | 1;
  days: number;
}

export interface HighRow {
  c: string; n: string;
  /** '上市' / '上櫃' / 'ETF' */
  k: string;
  p: number;
  days: number;
  /** 以窗口天數（字串）為鍵：'150' / '200' / '250' */
  w: Record<string, HighWindow>;
  /** 一週／一月／一季／半年的漲跌幅（%）；資料不足時是 null */
  r5?: number | null;
  r20?: number | null;
  r60?: number | null;
  r120?: number | null;
}

export interface Highs {
  meta: {
    date: string; updated: string;
    windows: number[];
    defaultWindow: number;
    returns: string[];
    count: number;
    /** 以窗口天數為鍵的家數 */
    newHighs: Record<string, number>;
    newLows: Record<string, number>;
    source: string; note: string;
  };
  rows: HighRow[];
}

export type HighView = 'high' | 'near' | 'low';

/** 「接近高點」的界線：距高點 5% 以內。再遠就不算「接近」了。 */
export const NEAR_PCT = -5;

export interface HighOptions {
  view: HighView;
  /** 窗口天數，例如 200 */
  window: number;
  /** 類別：'' 全部 / '上市' / '上櫃' / 'ETF' */
  kind?: string;
  limit?: number;
}

/**
 * 依檢視方式與窗口挑出要顯示的列。
 *
 * 'near'（接近高點）= 還沒創新高、但距高點 5% 以內。兩個條件都要：排除已創新高的
 * （那些在 'high' 那一頁），也排除距高點 40% 的 —— 那不叫接近，不設界線的話這個
 * 檢視就是「除了新高以外的全市場」，等於沒有篩選。
 *
 * 沒有那個窗口資料的（上市不到那麼久）直接略過，不要當成「沒創新高」。
 */
export function filterHighs(rows: HighRow[], opts: HighOptions): HighRow[] {
  const { view, window: win, kind = '', limit } = opts;
  const key = String(win);
  const at = (r: HighRow) => r.w?.[key];
  let out = rows.filter(r => (!kind || r.k === kind) && at(r));
  if (view === 'high') {
    out = out.filter(r => at(r)!.nh === 1).sort((a, b) => b.p - a.p);
  } else if (view === 'low') {
    out = out.filter(r => at(r)!.nl === 1).sort((a, b) => at(a)!.fl - at(b)!.fl);
  } else {
    out = out.filter(r => at(r)!.nh === 0 && at(r)!.fh >= NEAR_PCT)
      .sort((a, b) => at(b)!.fh - at(a)!.fh);
  }
  return limit ? out.slice(0, limit) : out;
}

/* ── 漲跌幅排行 ─────────────────────────────────────────── */

export type ReturnKey = 'r5' | 'r20' | 'r60' | 'r120';

export const RETURN_LABELS: Record<ReturnKey, string> = {
  r5: '一週',
  r20: '一月',
  r60: '一季',
  r120: '半年',
};

export interface ReturnOptions {
  key: ReturnKey;
  /** 由高到低（預設）；跌幅排行就是把它設成 true */
  asc?: boolean;
  kind?: string;
  /** 最低股價（元）。銅板股的百分比跳動大，門檻讓使用者自己決定 */
  minPrice?: number;
  limit?: number;
}

/**
 * 漲跌幅排行。
 *
 * 沒有該期間報酬的（上市不足那麼多交易日）排除而不是當成 0 —— 新股上市首月常常
 * 漲很多，混進「近半年漲幅」會是誤導。
 */
export function rankReturns(rows: HighRow[], opts: ReturnOptions): HighRow[] {
  const { key, asc = false, kind = '', minPrice = 0, limit } = opts;
  const out = rows.filter(r => {
    if (kind && r.k !== kind) return false;
    if (minPrice && r.p < minPrice) return false;
    const v = r[key];
    return v !== null && v !== undefined;
  });
  out.sort((a, b) => {
    const av = a[key] as number;
    const bv = b[key] as number;
    return asc ? av - bv : bv - av;
  });
  return limit ? out.slice(0, limit) : out;
}

/* ── 個股看板 ───────────────────────────────────────────── */

/**
 * 每日三家分開的買賣超（張），給柱狀圖用。
 *
 * `instTotals` 只回三家相加的合計，看不出是誰在買 —— 而「外資買、投信賣」跟
 * 「三家都買」是完全不同的故事，那正是這種圖要回答的。沒資料的日子留 null，
 * 不要當成 0（那天可能只是還沒公佈）。
 */
export interface InstDay {
  date: string;
  foreign: number | null;
  trust: number | null;
  dealer: number | null;
  /** 三家相加 */
  total: number | null;
}

export function instDaily(chips: StockChips): InstDay[] {
  return chips.days.map((date, i) => {
    const r = chips.inst[i];
    if (!r) return { date, foreign: null, trust: null, dealer: null, total: null };
    const f = toLots(r[0]);
    const t = toLots(r[1]);
    const d = toLots(r[2]);
    return {
      date, foreign: f, trust: t, dealer: d,
      total: (f ?? 0) + (t ?? 0) + (d ?? 0),
    };
  });
}

export interface PeriodReturn {
  key: 'r5' | 'r20' | 'r60' | 'r120';
  label: string;
  value: number | null;
}

export const PERIOD_LABELS: PeriodReturn[] = [
  { key: 'r5', label: '一週', value: null },
  { key: 'r20', label: '一月', value: null },
  { key: 'r60', label: '一季', value: null },
  { key: 'r120', label: '半年', value: null },
];

/** 把 highs 的那一列攤成畫面要的四段漲跌幅。期間不足的維持 null。 */
export function periodReturns(row: HighRow | null): PeriodReturn[] {
  return PERIOD_LABELS.map(p => ({
    ...p,
    value: row ? (row[p.key] ?? null) : null,
  }));
}

export interface Position {
  window: number;
  /** 最新收盤 */
  price: number;
  high: number;
  low: number;
  /** 距高點（負數代表還在高點下方） */
  fromHigh: number;
  /** 距低點 */
  fromLow: number;
  /** 收盤價在區間裡的位置，0 = 在低點、100 = 在高點 */
  pos: number;
  isHigh: boolean;
  isLow: boolean;
}

/**
 * 價格在這個窗口的高低區間裡站在哪裡。
 *
 * 注意 `p` 是原始收盤價、`h`／`l` 是**還原股價**的高低點（見 highs.json 的 note），
 * 所以位置要用 fh／fl 反推，不能直接拿 p 去跟 h、l 比 —— 除過權息的標的會算歪。
 */
export function position(row: HighRow | null, window: number): Position | null {
  const w = row?.w?.[String(window)];
  if (!row || !w) return null;
  // fh = (收盤 − 高點) / 高點 × 100（負或 0）、fl = (收盤 − 低點) / 低點 × 100
  const span = w.h - w.l;
  const price = w.l * (1 + w.fl / 100);
  const pos = span > 0 ? ((price - w.l) / span) * 100 : 100;
  return {
    window, price: row.p, high: w.h, low: w.l,
    fromHigh: w.fh, fromLow: w.fl,
    pos: Math.max(0, Math.min(100, pos)),
    isHigh: w.nh === 1, isLow: w.nl === 1,
  };
}
