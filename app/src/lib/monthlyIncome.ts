/* 月領試算：每個月想領 X 元，要買幾張（2026-10-26 站主要求，和短影音同一套算法）。純函式，沒有 React。
 *
 * 年配息用「最近一年實際配發」：每年配 n 次就取最近 n 次加總（季配 4、月配 12）。
 * 不用「最近一次 × 次數」：今年配息大幅成長時會高估（0056 最近一次年化 12%，實配只有 8.8%）。
 * 二代健保補充保費：只有配息裡的「股利所得」「利息所得」要扣，各自單筆 ≥ 2 萬元扣 2.11%
 * （每次領的金額用最近一次配息估）。收益平準金、已實現資本利得（掩護性買權的選擇權權利金也在這）
 * 不扣、也不課所得稅 —— 2026-10-27 站主指出 00406A 不用扣，查集保才發現 0056 也有 82% 是資本利得。
 * 組成用集保 ETF 觀測站最近一次公告（div_mix.json）；沒公告的不猜，畫面寫「組成未公告」。
 */

export const NHI_THRESHOLD = 20000;
export const NHI_RATE = 0.0211;

/** 配息組成占比（%）：股利所得、利息所得、收益平準金、已實現資本利得、其他所得 */
export interface DivMix { date: string; d: number[] }
export interface DivMixData { meta: { source: string; generated: string; count: number }; mix: Record<string, DivMix> }

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
  /** 每次會不會被扣二代健保；null＝配息組成未公告，不知道 */
  nhi: boolean | null;
  /** 一年被扣的補充保費估計 */
  nhiYear: number;
  /** 配息裡股利＋利息所得占幾 %（要扣健保、課所得稅的部分）；null＝未公告 */
  taxPct: number | null;
  /** 最近一次除息日 */
  lastDate: string;
  /** 上市未滿一年、配息次數不到一年份：年配息＝平均每次 × 一年次數（推估） */
  estimated: boolean;
  /** 實際用到的配息次數 */
  paid: number;
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
                          price: number | null | undefined, monthly: number, mix?: DivMix | null): IncomeRow | null {
  if (!events || !events.length || !price || price <= 0 || monthly <= 0) return null;
  const n = perYearOf(freq, events);
  const recent = events.slice(-n);
  const estimated = recent.length < n;
  // 新上市的主動式 ETF 只配過幾次：直接加總會把幾個月的配息當成一整年，張數高估好幾倍
  const annual = recent.reduce((a, e) => a + e[1], 0) * (estimated ? n / recent.length : 1);
  if (!(annual > 0)) return null;
  const lots = Math.ceil((monthly * 12) / annual / 1000);
  const shares = lots * 1000;
  const last = events[events.length - 1];
  const perPayment = shares * last[1];
  // 股利所得、利息所得分開看門檻（補充保費是按所得類別逐筆扣）
  const parts = mix ? mix.d.slice(0, 2).map(p => p / 100) : [];
  const nhiYear = parts.reduce((a, p) => a + (perPayment * p >= NHI_THRESHOLD ? shares * annual * p * NHI_RATE : 0), 0);
  return {
    code, name, freq, price, perYear: n, annual, yieldPct: (annual / price) * 100, lots, capital: shares * price,
    perPayment, nhi: mix ? nhiYear > 0 : null, nhiYear, taxPct: mix ? (mix.d[0] ?? 0) + (mix.d[1] ?? 0) : null,
    lastDate: last[0], estimated, paid: recent.length,
  };
}

/** 熱門高股息與月配 ETF＋站主指定的主動式（預設比較名單） */
export const DEFAULT_CODES = ['0056', '00878', '00919', '00929', '00713', '00934', '00939', '00940',
  '00400A', '00401A', '00404A', '00406A', '00981A'];
