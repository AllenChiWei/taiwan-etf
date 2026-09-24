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
import type { UsPriceRow, FxRow } from '../lib/usDividend.ts';
import { latestMidRate } from '../lib/usDividend.ts';

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

/* ── 配息試算的美股 ETF ─────────────────────────────────────
 * 同樣由瀏覽器直接抓：每加入一檔是一個請求，匯率一天一個（存在 localStorage）。
 * 部署流程完全不碰，額度算在瀏覽者自己的 IP。
 */


async function rows<T>(dataset: string, code: string, start: string, signal?: AbortSignal): Promise<T[]> {
  const url = `${API}?${new URLSearchParams({ dataset, data_id: code, start_date: start })}`;
  const res = await fetch(url, { signal });
  if (res.status === 402) throw new Error('FinMind 免費額度這一小時用完了，稍後再試');
  if (!res.ok) throw new Error(`FinMind 回應 HTTP ${res.status}`);
  const d = (await res.json()) as { msg?: string; data?: T[] };
  if (d.msg !== 'success') throw new Error(`FinMind：${d.msg ?? '沒有資料'}`);
  return d.data ?? [];
}

const usCache = new Map<string, Promise<UsPriceRow[]>>();

/** 近 15 個月的日價（湊得出近 12 個月的配息，也看得到上一年同一次）。 */
export function fetchUsPrices(code: string): Promise<UsPriceRow[]> {
  const hit = usCache.get(code);
  if (hit) return hit;
  const d = new Date();
  d.setMonth(d.getMonth() - 15);
  const p = rows<UsPriceRow>('USStockPrice', code, d.toISOString().slice(0, 10))
    .then(r => r.map(x => ({ date: x.date, Close: Number(x.Close), Adj_Close: Number(x.Adj_Close) })));
  usCache.set(code, p);
  p.catch(() => usCache.delete(code));
  return p;
}

const FX_KEY = 'twetf.usdtwd';

/** 美元兌台幣（台銀即期買賣中價）。同一天抓過就用存著的，抓不到時退回上一次的。 */
export async function fetchUsdTwd(): Promise<{ date: string; rate: number; stale: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  let saved: { date: string; rate: number; fetched: string } | null = null;
  try { saved = JSON.parse(localStorage.getItem(FX_KEY) ?? 'null'); } catch { /* 忽略 */ }
  if (saved && saved.fetched === today && saved.rate > 0) return { date: saved.date, rate: saved.rate, stale: false };

  try {
    const start = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const fx = latestMidRate(await rows<FxRow>('TaiwanExchangeRate', 'USD', start));
    if (!fx) throw new Error('FinMind 沒有匯率資料');
    try { localStorage.setItem(FX_KEY, JSON.stringify({ ...fx, fetched: today })); } catch { /* 忽略 */ }
    return { ...fx, stale: false };
  } catch (err) {
    if (saved && saved.rate > 0) return { date: saved.date, rate: saved.rate, stale: true };
    throw err;
  }
}
