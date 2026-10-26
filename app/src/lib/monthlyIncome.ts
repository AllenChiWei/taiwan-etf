/* 月領試算：每個月想領 X 元，要買幾張（2026-10-26 站主要求，和短影音同一套算法）。純函式，沒有 React。
 *
 * 年配息用「最近一年實際配發」：每年配 n 次就取最近 n 次加總（季配 4、月配 12）。
 * 不用「最近一次 × 次數」：今年配息大幅成長時會高估（0056 最近一次年化 12%，實配只有 8.8%）。
 * 二代健保補充保費：單筆股利 ≥ 2 萬元扣 2.11%（每次領的金額用最近一次配息估）。
 */

export const NHI_THRESHOLD = 20000;
export const NHI_RATE = 0.0211;

export interface IncomeRow {
  code: string;
  name: string;
  freq: string;
  price: number;
  /** 每年配息次數 */
  perYear: number;
  /** 最近一年實配（每股） */
  annual: number;
  /** 實配殖利率 % */
  yieldPct: number;
  lots: number;
  capital: number;
  /** 每次大約領多少（最近一次配息 × 股數） */
  perPayment: number;
  /** 每次會不會被扣二代健保 */
  nhi: boolean;
  /** 一年被扣的補充保費估計 */
  nhiYear: number;
  /** 最近一次除息日 */
  lastDate: string;
}

const PER_YEAR: Record<string, number> = { 月配: 12, 雙月配: 6, 季配: 4, 半年配: 2, 年配: 1 };

export function perYearOf(freq: string, events: [string, number, number][]): number {
  if (PER_YEAR[freq]) return PER_YEAR[freq];
  // 頻率不明：數最近 365 天內的除息次數
  const last = events.length ? new Date(events[events.length - 1][0]) : null;
  if (!last) return 0;
  const from = new Date(last.getTime() - 365 * 864e5);
  return events.filter(e => new Date(e[0]) > from).length || 1;
}

export function incomeRow(code: string, name: string, freq: string, events: [string, number, number][] | undefined,
                          price: number | null | undefined, monthly: number): IncomeRow | null {
  if (!events || !events.length || !price || price <= 0 || monthly <= 0) return null;
  const n = perYearOf(freq, events);
  const recent = events.slice(-n);
  const annual = recent.reduce((a, e) => a + e[1], 0);
  if (!(annual > 0)) return null;
  const lots = Math.ceil((monthly * 12) / annual / 1000);
  const shares = lots * 1000;
  const last = events[events.length - 1];
  const perPayment = shares * last[1];
  const nhi = perPayment >= NHI_THRESHOLD;
  return {
    code, name, freq, price, perYear: n, annual, yieldPct: (annual / price) * 100, lots, capital: shares * price,
    perPayment, nhi, nhiYear: nhi ? shares * annual * NHI_RATE : 0, lastDate: last[0],
  };
}

/** 熱門高股息與月配 ETF（預設比較名單） */
export const DEFAULT_CODES = ['0056', '00878', '00919', '00929', '00713', '00934', '00939', '00940'];
