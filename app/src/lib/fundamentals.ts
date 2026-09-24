/* 個股財務分析：杜邦 ROE、經營效率、獲利能力、財務結構、現金流。純函式，沒有 React。
 *
 * 資料是 FinMind 的三張財報，由瀏覽器在打開個股時直接抓（api/finmind.ts）。
 * 三張表的「期間」不一樣，這是這一頁最容易算錯的地方：
 *
 *   損益表    TaiwanStockFinancialStatements  **單季**（台積電 2026-06-30 營收 1.27 兆，是 Q2 一季）
 *   資產負債表 TaiwanStockBalanceSheet         **時點**（季底的餘額）
 *   現金流量表 TaiwanStockCashFlowsStatement   **年初累計**（Q2 = 上半年），要減掉前一季才是單季
 *
 * 比率一律用「近四季合計（TTM）」的流量，除以「期初與期末的平均」餘額 ——
 * 只用單季會被季節性帶著跑，只用期末餘額會讓成長快的公司周轉率看起來偏低。
 * 單位是元（FinMind 已經換算好，不是觀測站的千元）。
 */

export interface FmRow { date: string; type: string; value: number }

export interface FundQuarter {
  /** 季底日 YYYY-MM-DD */
  date: string;
  /** 2026Q2 */
  label: string;
  rev: number | null; cogs: number | null; gp: number | null; op: number | null;
  /** 歸屬母公司的淨利 */
  ni: number | null;
  eps: number | null;
  ta: number | null; tl: number | null;
  /** 歸屬母公司的權益 */
  eq: number | null;
  ca: number | null; cl: number | null;
  inv: number | null; ar: number | null; ap: number | null; cash: number | null;
  /** 單季營業現金流、單季資本支出（正數） */
  ocf: number | null; capex: number | null;
}

function byDate(rows: FmRow[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!out.has(r.date)) out.set(r.date, new Map());
    out.get(r.date)!.set(r.type, r.value);
  }
  return out;
}

function label(date: string): string {
  const q = Math.ceil(Number(date.slice(5, 7)) / 3);
  return `${date.slice(0, 4)}Q${q}`;
}

/**
 * 三張表 -> 每季一筆。現金流量表是年初累計，這裡減掉同年前一季變成單季；
 * 前一季缺資料的那一季（例如回溯的最早一季不是 Q1）無法還原，留 null。
 */
export function parseQuarters(income: FmRow[], balance: FmRow[], cashflow: FmRow[]): FundQuarter[] {
  const inc = byDate(income);
  const bal = byDate(balance);
  const cf = byDate(cashflow);
  const dates = [...new Set([...inc.keys(), ...bal.keys()])].sort();
  const g = (m: Map<string, number> | undefined, ...keys: string[]) => {
    for (const k of keys) { const v = m?.get(k); if (v !== undefined && Number.isFinite(v)) return v; }
    return null;
  };

  const single = (date: string, key: string, sign = 1): number | null => {
    const ytd = g(cf.get(date), key);
    if (ytd === null) return null;
    if (date.slice(5, 7) === '03') return sign * ytd;              // Q1 就是單季
    const prevDate = prevQuarterEnd(date);
    const prev = g(cf.get(prevDate), key);
    return prev === null ? null : sign * (ytd - prev);
  };

  return dates.map(date => {
    const i = inc.get(date);
    const b = bal.get(date);
    return {
      date, label: label(date),
      rev: g(i, 'Revenue'),
      cogs: g(i, 'CostOfGoodsSold'),
      gp: g(i, 'GrossProfit'),
      op: g(i, 'OperatingIncome'),
      // FinMind 損益表裡這個名字指的是「淨利歸屬於母公司業主」，不是權益
      ni: g(i, 'EquityAttributableToOwnersOfParent', 'IncomeAfterTaxes', 'IncomeAfterTax'),
      eps: g(i, 'EPS'),
      ta: g(b, 'TotalAssets'),
      tl: g(b, 'Liabilities'),
      eq: g(b, 'EquityAttributableToOwnersOfParent', 'Equity'),
      ca: g(b, 'CurrentAssets'),
      cl: g(b, 'CurrentLiabilities'),
      inv: g(b, 'Inventories'),
      ar: g(b, 'AccountsReceivableNet'),
      ap: g(b, 'AccountsPayable'),
      cash: g(b, 'CashAndCashEquivalents'),
      ocf: single(date, 'CashFlowsFromOperatingActivities'),
      // 購置不動產廠房設備是負的現金流，轉成正數的「資本支出」
      capex: single(date, 'PropertyAndPlantAndEquipment', -1),
    };
  });
}

/** 同一年的前一季季底：06-30 -> 03-31、09-30 -> 06-30、12-31 -> 09-30。 */
export function prevQuarterEnd(date: string): string {
  const y = date.slice(0, 4);
  const m = date.slice(5, 7);
  return m === '06' ? `${y}-03-31` : m === '09' ? `${y}-06-30` : m === '12' ? `${y}-09-30` : '';
}

export interface Ratios {
  label: string;
  /** 杜邦：ROE = 淨利率 × 資產週轉率 × 權益乘數（全部 TTM） */
  roe: number | null; netMargin: number | null; assetTurnover: number | null; equityMultiplier: number | null;
  roa: number | null;
  /** 單季毛利率、營益率、淨利率（%） */
  gm: number | null; om: number | null; nm: number | null;
  /** 存貨週轉率（次）與天數、應收／應付天數、現金轉換循環 */
  invTurnover: number | null; dio: number | null; dso: number | null; dpo: number | null; ccc: number | null;
  current: number | null; quick: number | null; debt: number | null;
  /** TTM：營業現金流、資本支出、自由現金流（元），以及營業現金流 ÷ 淨利 */
  ocf: number | null; capex: number | null; fcf: number | null; cashQuality: number | null;
  /** TTM 營收與淨利（元），給大數字用 */
  revTtm: number | null; niTtm: number | null;
}

const div = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const pct = (v: number | null) => (v === null ? null : v * 100);

function sum4(qs: FundQuarter[], i: number, key: keyof FundQuarter): number | null {
  if (i < 3) return null;
  let s = 0;
  for (let k = i - 3; k <= i; k++) {
    const v = qs[k][key] as number | null;
    if (v === null) return null;
    s += v;
  }
  return s;
}

/** 期初與期末的平均：這一季與四季前（一年前）。四季前沒資料就只用這一季。 */
function avg(qs: FundQuarter[], i: number, key: keyof FundQuarter): number | null {
  const now = qs[i][key] as number | null;
  if (now === null) return null;
  const before = i >= 4 ? (qs[i - 4][key] as number | null) : null;
  return before === null ? now : (now + before) / 2;
}

/**
 * 每一季的比率。前三季湊不滿四季 TTM，那些欄位是 null。
 * 季別要連續 —— 中間缺一季的話 TTM 會把五個月當一年，所以缺季時同樣回 null。
 */
export function computeRatios(qs: FundQuarter[]): Ratios[] {
  return qs.map((q, i) => {
    const contiguous = i >= 3 && [1, 2, 3].every(k => prevQuarterEndAny(qs[i - k + 1].date) === qs[i - k].date);
    const t = (key: keyof FundQuarter) => (contiguous ? sum4(qs, i, key) : null);
    const revTtm = t('rev'); const cogsTtm = t('cogs'); const niTtm = t('ni');
    const ocf = t('ocf'); const capex = t('capex');
    const ta = avg(qs, i, 'ta'); const eq = avg(qs, i, 'eq');
    const inv = avg(qs, i, 'inv'); const ar = avg(qs, i, 'ar'); const ap = avg(qs, i, 'ap');
    const invTurnover = div(cogsTtm, inv);
    const dio = invTurnover ? 365 / invTurnover : null;
    const dso = div(ar, revTtm) === null ? null : 365 * div(ar, revTtm)!;
    const dpo = div(ap, cogsTtm) === null ? null : 365 * div(ap, cogsTtm)!;
    return {
      label: q.label,
      roe: pct(div(niTtm, eq)),
      netMargin: pct(div(niTtm, revTtm)),
      assetTurnover: div(revTtm, ta),
      equityMultiplier: div(ta, eq),
      roa: pct(div(niTtm, ta)),
      gm: pct(div(q.gp, q.rev)), om: pct(div(q.op, q.rev)), nm: pct(div(q.ni, q.rev)),
      invTurnover, dio, dso, dpo,
      ccc: dio !== null && dso !== null && dpo !== null ? dio + dso - dpo : null,
      current: div(q.ca, q.cl),
      quick: q.ca !== null && q.inv !== null ? div(q.ca - q.inv, q.cl) : null,
      debt: pct(div(q.tl, q.ta)),
      ocf, capex,
      fcf: ocf !== null && capex !== null ? ocf - capex : null,
      cashQuality: div(ocf, niTtm),
      revTtm, niTtm,
    };
  });
}

/** 任何一季的前一季季底（跨年：03-31 -> 前一年 12-31）。 */
export function prevQuarterEndAny(date: string): string {
  if (date.slice(5, 7) === '03') return `${Number(date.slice(0, 4)) - 1}-12-31`;
  return prevQuarterEnd(date);
}

/** 跟一年前（四季前）比的變化。沒有就 null。 */
export function yoyDelta(rows: Ratios[], key: keyof Ratios): number | null {
  const n = rows.length;
  if (n < 5) return null;
  const a = rows[n - 1][key]; const b = rows[n - 5][key];
  return typeof a === 'number' && typeof b === 'number' ? a - b : null;
}

export interface DupontDriver {
  key: 'netMargin' | 'assetTurnover' | 'equityMultiplier';
  /** 對 ROE 變化的貢獻比例（%）；三個加起來 100 */
  share: number;
  /** 這個因子本身變大還是變小 */
  up: boolean;
}

/**
 * ROE 比一年前的變化，是哪個因子推動的。
 *
 * ROE = 淨利率 × 週轉率 × 乘數，取對數後變成相加：
 *   Δln ROE = Δln 淨利率 + Δln 週轉率 + Δln 乘數
 * 所以各因子的對數變化佔總和的比例，就是它的貢獻 —— 不受先後順序影響
 * （用「先換淨利率再換週轉率」的替代法，順序一換答案就變）。
 * 用絕對值算比例，方向另外標，免得一個變大一個變小互相抵銷成 0。
 */
export function dupontDrivers(now: Ratios, before: Ratios): DupontDriver[] | null {
  const keys = ['netMargin', 'assetTurnover', 'equityMultiplier'] as const;
  const d = keys.map(k => {
    const a = now[k]; const b = before[k];
    return a && b && a > 0 && b > 0 ? Math.log(a / b) : null;
  });
  if (d.some(x => x === null)) return null;
  const total = d.reduce<number>((s, x) => s + Math.abs(x!), 0);
  if (total === 0) return null;
  return keys.map((k, i) => ({ key: k, share: (Math.abs(d[i]!) / total) * 100, up: d[i]! > 0 }));
}
