/* 定期定額／單筆投入的歷史回測，以及退休試算。
 *
 * 全部是純函式 —— 沒有 fetch、沒有 DOM、沒有日期依賴，所以 tests/backtest.test.ts
 * 可以直接對真實邏輯跑數字，而不是對著模擬物件驗證。
 *
 * ## 為什麼要有自己的價格資料，不能用績效圖那份
 *
 * 績效圖用的是還原股價（etl:adj_close），那份資料已經把配息當成「除息當天自動
 * 以收盤價全部再投入」了。拿它回測，「領現金」跟「股息再投入」會算出一模一樣的
 * 結果，也做不出「當月配息後才買進」這種時點選擇 —— 而那正是這個計算機的重點。
 *
 * 所以 scripts/fetch_calc.py 另外產一份「只還原分割、不還原配息」的月頻價格，
 * 外加每個月的除息金額。配息在這裡是真的現金流。
 */

/** scripts/fetch_calc.py 產出的單檔資料。 */
export interface CalcSeries {
  code: string;
  name: string;
  freq: string;
  /** 在共用 months[] 裡的起始位置 */
  first: number;
  /** 每月第一個交易日收盤價（只還原分割） */
  p: (number | null)[];
  /** 該月除息金額合計，每股 */
  d: number[];
  /** 該月最後一次除息當天的收盤價；沒配息為 null */
  q: (number | null)[];
  last: { date: string; close: number };
  splits: { date: string; ratio: number }[];
}

export interface CalcIndex {
  months: string[];
  codes: Record<string, { first: string; ttmYield: number | null; payouts: number }>;
}

/** 買進時點。 */
export type Timing =
  /** 每月第一個交易日就扣款 —— 一般券商定期定額的預設 */
  | 'monthStart'
  /** 等這個月除息之後才買。沒配息的月份仍在月初買 */
  | 'afterDividend';

export interface BacktestInput {
  series: CalcSeries;
  months: string[];
  /** 'YYYY-MM'；留空表示從這檔最早有資料的月份開始 */
  from?: string;
  to?: string;
  /** 起始月一次投入的金額 */
  lump: number;
  /** 每月定期定額金額 */
  monthly: number;
  timing: Timing;
  /** 配息是否買回同一檔 */
  reinvest: boolean;
  /** 買進手續費率（%），台股公定 0.1425，多數券商有折扣 */
  feeRate: number;
  /** 每筆最低手續費（元） */
  feeMin: number;
  /** 只買整股，餘額留到下個月 —— 券商定期定額的實際行為 */
  wholeShares: boolean;
  /** 配息所得稅率（%）。台灣 ETF 配息裡的收益平準金不課稅，所以預設 0 */
  divTaxRate: number;
  /** 單次配息達 20,000 元時課二代健保補充保費 2.11% */
  nhiSupplement: boolean;
}

export interface MonthRow {
  month: string;
  /** 當月實際買進的價格 */
  price: number;
  /** 當月投入的本金（不含再投入的配息） */
  contribution: number;
  /** 當月領到的配息，稅後 */
  dividend: number;
  tax: number;
  fee: number;
  shares: number;
  /** 期末市值（不含閒置現金） */
  value: number;
  /** 累計投入本金 */
  invested: number;
  /** 買不滿一股留下來的零頭，加上已領出的配息 */
  cash: number;
}

export interface BacktestResult {
  rows: MonthRow[];
  months: number;
  years: number;
  totalInvested: number;
  finalShares: number;
  /** 持股市值 */
  marketValue: number;
  /** 閒置現金：零頭 + 已領出的配息 */
  cash: number;
  /** 其中屬於「領出來沒有再投入」的配息 */
  dividendCash: number;
  /** marketValue + cash */
  finalValue: number;
  totalDividend: number;
  totalTax: number;
  totalFee: number;
  totalReturnPct: number;
  /** 年化報酬率（內部報酬率，把每月投入的時間價值算進去） */
  annualizedPct: number | null;
  /** 只看價差、不含配息的年化 —— 用來看配息貢獻了多少 */
  lastPrice: number;
  lastDate: string;
}

/** 二代健保補充保費費率。單次給付達 20,000 元才課。 */
const NHI_RATE = 0.0211;
const NHI_THRESHOLD = 20_000;

const clampIndex = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));

/** 在共用 months[] 裡找 'YYYY-MM' 的位置；找不到回傳 -1。 */
export function monthIndex(months: string[], m: string | undefined): number {
  if (!m) return -1;
  return months.indexOf(m);
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const { series: s, months } = input;
  const n = s.p.length;

  // 這檔自己的資料範圍（絕對索引）
  const lo = s.first;
  const hi = s.first + n - 1;

  let a = input.from ? monthIndex(months, input.from) : lo;
  let b = input.to ? monthIndex(months, input.to) : hi;
  if (a < 0) a = lo;
  if (b < 0) b = hi;
  a = clampIndex(Math.max(a, lo), months.length);
  b = clampIndex(Math.min(b, hi), months.length);

  const rows: MonthRow[] = [];
  let shares = 0;
  // 兩種閒置現金要分開。spare 是買不滿一股的零頭，下個月會併進去繼續買；
  // divCash 是選擇「領現金」時領出來的配息，那是使用者拿去花的錢，
  // 不該被下個月的扣款自動買回去 —— 混在一起的話「領現金」會悄悄變成再投入。
  let spare = 0;
  let divCash = 0;
  let invested = 0;
  let totalDividend = 0;
  let totalTax = 0;
  let totalFee = 0;

  /** 這個月的手續費：成交金額 × 費率，但不低於最低收費。 */
  const feeOf = (gross: number) =>
    gross <= 0 ? 0 : Math.max(input.feeMin, (gross * input.feeRate) / 100);

  let monthFee = 0;

  /**
   * 把 amount 加上手上的零頭，在 price 買進。買不滿的留成現金。
   *
   * 費率與最低收費同時存在時沒辦法一步解出股數：先假設走費率，如果算出來的
   * 手續費不到最低收費，改用「扣掉最低收費後剩下的錢」重算。整股模式再往下取整，
   * 取整後偶爾還是會因為最低收費超出預算，所以留一次遞減的餘地。
   */
  const buy = (amount: number, price: number) => {
    const avail = amount + spare;
    if (avail <= 0 || !(price > 0)) {
      spare = avail;
      return;
    }
    const r = input.feeRate / 100;
    let sh = avail / (price * (1 + r));
    if (sh * price * r < input.feeMin) {
      sh = (avail - input.feeMin) / price;
    }
    if (input.wholeShares) sh = Math.floor(sh);
    while (sh > 0 && sh * price + feeOf(sh * price) > avail + 1e-9) {
      sh = input.wholeShares ? sh - 1 : sh * 0.999;
    }
    if (!(sh > 0)) {
      spare = avail;
      return;
    }
    const gross = sh * price;
    const fee = feeOf(gross);
    shares += sh;
    spare = avail - gross - fee;
    monthFee += fee;
    totalFee += fee;
  };

  /** 領息：課稅後決定再投入還是留現金。回傳稅後金額與稅額。 */
  const collect = (perShare: number, reinvestPrice: number) => {
    const gross = shares * perShare;
    if (gross <= 0) return { net: 0, tax: 0 };
    let tax = (gross * input.divTaxRate) / 100;
    if (input.nhiSupplement && gross >= NHI_THRESHOLD) tax += gross * NHI_RATE;
    const net = gross - tax;
    totalDividend += net;
    totalTax += tax;
    if (input.reinvest) buy(net, reinvestPrice);
    else divCash += net;
    return { net, tax };
  };

  for (let i = a; i <= b; i++) {
    const k = i - s.first;
    const open = s.p[k];
    const perShare = s.d[k] ?? 0;
    const exPrice = s.q[k] ?? open;
    monthFee = 0;

    // 停牌或資料缺漏的月份：什麼都不做，本金也不投進去，免得用錯價格算股數
    if (open === null || !(open > 0)) continue;

    const contribution = input.monthly + (i === a ? input.lump : 0);
    invested += contribution;

    let paid = { net: 0, tax: 0 };

    if (input.timing === 'monthStart') {
      // 月初就扣款，除息日在月中，所以這個月新買的股票也領得到這次配息
      buy(contribution, open);
      paid = collect(perShare, exPrice ?? open);
    } else {
      // 等除息之後才買：這次配息只有「本月買進之前」就持有的股數領得到，
      // 領到的錢跟當月扣款一起買在除息後的價格。這是使用者要的那個模式。
      paid = collect(perShare, exPrice ?? open);
      buy(contribution, perShare > 0 ? (exPrice ?? open) : open);
    }

    const price = input.timing === 'afterDividend' && perShare > 0
      ? (exPrice ?? open) : open;

    rows.push({
      month: months[i],
      price,
      contribution,
      dividend: paid.net,
      tax: paid.tax,
      fee: monthFee,
      shares,
      value: shares * (i === hi ? s.last.close : (s.p[k + 1] ?? price)),
      invested,
      cash: spare + divCash,
    });
  }

  // 期末一律用最新收盤價評價，而不是「下個月月初價」—— 這樣畫出來的最後一點
  // 才跟使用者今天看到的市值一致。
  const lastPrice = s.last.close;
  if (rows.length) {
    const tail = rows[rows.length - 1];
    tail.value = tail.shares * lastPrice;
  }

  const marketValue = shares * lastPrice;
  const cash = spare + divCash;
  const finalValue = marketValue + cash;
  const monthsCount = rows.length;
  const years = monthsCount / 12;

  return {
    rows,
    months: monthsCount,
    years,
    totalInvested: invested,
    finalShares: shares,
    marketValue,
    cash,
    dividendCash: divCash,
    finalValue,
    totalDividend,
    totalTax,
    totalFee,
    totalReturnPct: invested > 0 ? ((finalValue - invested) / invested) * 100 : 0,
    annualizedPct: irrAnnualized(rows, finalValue),
    lastPrice,
    lastDate: s.last.date,
  };
}

/**
 * 內部報酬率（年化）。
 *
 * 定期定額不能用「總報酬 ÷ 年數」—— 最後一個月才投進去的錢只放了一個月，
 * 跟第一個月就投入的不能算同一個權重。這裡解的是讓所有現金流現值歸零的月利率。
 *
 * 用二分法而不是牛頓法：現金流全負後面一正，函數單調，二分保證收斂，
 * 也不會像牛頓法那樣在極端輸入下跑掉。
 *
 * 虧到期末市值連最後一次扣款都不如時，現金流從頭到尾都是負的、沒有變號，
 * 內部報酬率在數學上不存在 —— 這種情況回傳 null，讓畫面顯示「—」，
 * 而不是硬掰一個數字出來。
 */
export function irrAnnualized(rows: MonthRow[], finalValue: number): number | null {
  if (rows.length < 2) return null;
  const flows = rows.map(r => -r.contribution);
  flows[flows.length - 1] += finalValue;
  if (!flows.some(f => f > 0) || !flows.some(f => f < 0)) return null;

  const npv = (rate: number) =>
    flows.reduce((acc, f, i) => acc + f / Math.pow(1 + rate, i), 0);

  // 月利率 -99% ~ +100% 已經涵蓋任何真實情況
  let lo = -0.99;
  let hi = 1.0;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const monthly = (lo + hi) / 2;
  const annual = (Math.pow(1 + monthly, 12) - 1) * 100;
  return Number.isFinite(annual) ? annual : null;
}

/* ── 退休試算（往前推估，不是回測） ─────────────────────────── */

export interface ProjectInput {
  /** 目前已有的資產 */
  initial: number;
  /** 每月投入 */
  monthly: number;
  /** 每年調升投入金額的比例（%），例如隨加薪 */
  monthlyGrowthPct: number;
  /** 年數 */
  years: number;
  /** 假設年化報酬率（%） */
  returnPct: number;
  /** 通膨率（%），用來把結果換算成今天的購買力 */
  inflationPct: number;
  /** 退休後的年提領率（%），4% 法則預設 4 */
  withdrawPct: number;
  /** 殖利率（%）。再投入時只用來算退休後能靠配息領多少；
      不再投入時，它同時決定每年有多少報酬是以現金形式離開組合 */
  yieldPct: number;
  /**
   * 配息是否再投入。
   *
   * 預設 true，而且這是原本唯一的行為 —— 因為 returnPct 帶入的是我們自己算的
   * 年化報酬，那是用還原股價（etl:adj_close）算的**含息總報酬**，本來就假設
   * 配息在除息當天全額買回。所以「有沒有考慮股息再投入」的答案一直是「有」，
   * 只是畫面上看不出來，會讓人以為漏掉了。
   *
   * 設成 false 時，組合只以「總報酬 − 殖利率」成長，配息每月以現金形式取出，
   * 累積在 dividendCash 裡不再產生複利。
   */
  reinvest: boolean;
}

export interface ProjectYear {
  year: number;
  invested: number;
  /** 組合市值 */
  value: number;
  /** 累積領出的配息現金（再投入時為 0） */
  cash: number;
  /** (value + cash) 換算成今天購買力 */
  real: number;
}

export interface ProjectResult {
  rows: ProjectYear[];
  /** 期末的組合市值（不含已領出的配息現金） */
  finalValue: number;
  finalReal: number;
  /** 選擇不再投入時，累積領到的配息現金；再投入時為 0 */
  dividendCash: number;
  /** finalValue + dividendCash */
  total: number;
  totalReal: number;
  totalInvested: number;
  gain: number;
  /** 依提領率，退休後每月可領（名目） */
  monthlyWithdraw: number;
  /** 同上，換算成今天購買力 */
  monthlyWithdrawReal: number;
  /** 只花配息、不動本金的話每月可領 */
  monthlyDividend: number;
  monthlyDividendReal: number;
}

export function project(input: ProjectInput): ProjectResult {
  // 不再投入時，配息那一段報酬是以現金離開組合的，所以組合只剩價格成長。
  const growthPct = input.reinvest
    ? input.returnPct
    : input.returnPct - input.yieldPct;
  const rm = Math.pow(1 + growthPct / 100, 1 / 12) - 1;
  const divRate = input.reinvest ? 0 : input.yieldPct / 100 / 12;

  const years = Math.max(0, Math.round(input.years));
  let value = input.initial;
  let invested = input.initial;
  let divCash = 0;
  let monthly = input.monthly;
  const rows: ProjectYear[] = [];

  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      // 月初投入，當月就開始複利
      value = (value + monthly) * (1 + rm);
      // 配息以當月市值計算後取出，不再產生複利
      divCash += value * divRate;
      invested += monthly;
    }
    monthly *= 1 + input.monthlyGrowthPct / 100;
    const deflator = Math.pow(1 + input.inflationPct / 100, y);
    rows.push({
      year: y, invested, value, cash: divCash,
      real: (value + divCash) / deflator,
    });
  }

  const deflator = Math.pow(1 + input.inflationPct / 100, years);
  const withdraw = (value * input.withdrawPct) / 100 / 12;
  const dividend = (value * input.yieldPct) / 100 / 12;
  const total = value + divCash;

  return {
    rows,
    finalValue: value,
    finalReal: value / deflator,
    dividendCash: divCash,
    total,
    totalReal: total / deflator,
    totalInvested: invested,
    gain: total - invested,
    monthlyWithdraw: withdraw,
    monthlyWithdrawReal: withdraw / deflator,
    monthlyDividend: dividend,
    monthlyDividendReal: dividend / deflator,
  };
}
