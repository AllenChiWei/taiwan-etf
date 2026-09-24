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

/**
 * FinMind 額度用完時回 HTTP 402，但**那個回應沒有 Access-Control-Allow-Origin**，
 * 瀏覽器只丟出一個籠統的 TypeError「Failed to fetch」，拿不到狀態碼。所以連線層的
 * 失敗一律翻成使用者看得懂的話 —— 實際最常見的原因就是額度（免費層每個網路每小時
 * 300 次，同一個網路上其他程式也算在內）。2026-09-24 站主就撞到過一次。
 */
async function get(url: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error('FinMind 暫時連不上，多半是你這個網路這一小時的免費查詢次數用完了'
      + '（每小時 300 次），大約一小時內會恢復，稍後再試');
  }
}

const cache = new Map<string, Promise<FmSet>>();

export interface FmSet { income: FmRow[]; balance: FmRow[]; cashflow: FmRow[] }

async function one(dataset: string, code: string, start: string, signal?: AbortSignal): Promise<FmRow[]> {
  const url = `${API}?${new URLSearchParams({ dataset, data_id: code, start_date: start })}`;
  const res = await get(url, signal);
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
  const res = await get(url, signal);
  if (res.status === 402) throw new Error('FinMind 免費額度這一小時用完了，稍後再試');
  if (!res.ok) throw new Error(`FinMind 回應 HTTP ${res.status}`);
  const d = (await res.json()) as { msg?: string; data?: T[] };
  if (d.msg !== 'success') throw new Error(`FinMind：${d.msg ?? '沒有資料'}`);
  return d.data ?? [];
}

const usCache = new Map<string, Promise<UsPriceRow[]>>();
const US_KEY = (code: string) => `twetf.usprice.${code}`;

interface SavedUs { fetched: string; rows: UsPriceRow[] }

function loadUs(code: string): SavedUs | null {
  try { return JSON.parse(localStorage.getItem(US_KEY(code)) ?? 'null'); } catch { return null; }
}

/**
 * 近 15 個月的日價（湊得出近 12 個月的配息，也看得到上一年同一次）。
 *
 * 跟匯率一樣存在 localStorage：同一天抓過就不再打 FinMind，抓不到時（多半是這個網路
 * 的免費額度用完）沿用上次的 —— 配息一年才幾次，舊幾天的價格不影響試算，總比整檔
 * 顯示錯誤好。2026-09-24 站主的 QYLG 就是額度被同網路的其他程式用光而整天抓不到。
 */
export function fetchUsPrices(code: string): Promise<UsPriceRow[]> {
  const hit = usCache.get(code);
  if (hit) return hit;
  const today = new Date().toISOString().slice(0, 10);
  const saved = loadUs(code);
  if (saved && saved.fetched === today && saved.rows.length) return Promise.resolve(saved.rows);

  const d = new Date();
  d.setMonth(d.getMonth() - 15);
  const p = rows<UsPriceRow>('USStockPrice', code, d.toISOString().slice(0, 10))
    .then(r => {
      const out = r.map(x => ({ date: x.date, Close: Number(x.Close), Adj_Close: Number(x.Adj_Close) }));
      try { localStorage.setItem(US_KEY(code), JSON.stringify({ fetched: today, rows: out })); } catch { /* 忽略 */ }
      return out;
    })
    .catch(err => {
      if (saved && saved.rows.length) return saved.rows;
      throw err;
    });
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
