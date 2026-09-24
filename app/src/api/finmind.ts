/* 個股財報：打開個股時由瀏覽器直接向 FinMind 抓三張表。
 *
 * 為什麼在瀏覽器抓、不在部署時抓：全市場 2,000 檔 × 三張表是六千個請求，FinMind
 * 免費層一小時 300 次，部署時抓要跑二十小時；而使用者一次只看一檔。FinMind 的 API
 * 允許任何網站從瀏覽器呼叫（Access-Control-Allow-Origin: *），額度算在使用者自己的
 * IP 上。CSP 的 connect-src 為此放行了 api.finmindtrade.com（vite-plugins.ts）。
 *
 * 同一個分頁裡看過的就記住，切回來不重抓。
 */

import type { FmRow } from '../lib/fundamentals.ts';

const API = 'https://api.finmindtrade.com/api/v4/data';
const cache = new Map<string, Promise<FmSet>>();

export interface FmSet { income: FmRow[]; balance: FmRow[]; cashflow: FmRow[] }

async function one(dataset: string, code: string, start: string, signal?: AbortSignal): Promise<FmRow[]> {
  const url = `${API}?${new URLSearchParams({ dataset, data_id: code, start_date: start })}`;
  const res = await fetch(url, { signal });
  if (res.status === 402) throw new Error('FinMind 免費額度這一小時用完了，稍後再試');
  if (!res.ok) throw new Error(`FinMind 回應 HTTP ${res.status}`);
  const d = (await res.json()) as { msg?: string; data?: FmRow[] };
  if (d.msg !== 'success') throw new Error(`FinMind：${d.msg ?? '沒有資料'}`);
  return (d.data ?? []).map(r => ({ date: r.date, type: r.type, value: Number(r.value) }));
}

/** 近三年多一季（湊得出八季的 TTM 與一年前的平均餘額）。 */
export function fetchFundamentals(code: string, signal?: AbortSignal): Promise<FmSet> {
  const hit = cache.get(code);
  if (hit) return hit;
  const start = `${new Date().getFullYear() - 3}-01-01`;
  const p = Promise.all([
    one('TaiwanStockFinancialStatements', code, start, signal),
    one('TaiwanStockBalanceSheet', code, start, signal),
    one('TaiwanStockCashFlowsStatement', code, start, signal),
  ]).then(([income, balance, cashflow]) => ({ income, balance, cashflow }));
  cache.set(code, p);
  p.catch(() => cache.delete(code));                // 失敗的不要記住，下次再試
  return p;
}
