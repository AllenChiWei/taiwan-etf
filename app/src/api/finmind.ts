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
import { dailyMidRates, latestMidRate } from '../lib/usDividend.ts';
import type { PerRow, PriceRow } from '../lib/valuation.ts';
import { DEFENSIVE_YEARS, shiftDays, todayTaipei, type FinMindDividendRow } from '../lib/defensive.ts';

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

/* ── 個股估值（本益比河流圖）────────────────────────────────
 * 每日本益比／淨值比／殖利率加收盤價，兩個請求。FinMind 的本益比從 2015 年起，
 * 抓 11 年才湊得出「近 10 年」。一樣是瀏覽器抓、同一個分頁記住。
 */

export interface ValSet { per: PerRow[]; price: PriceRow[] }

const valCache = new Map<string, Promise<ValSet>>();

export function fetchValuation(code: string, signal?: AbortSignal): Promise<ValSet> {
  const hit = valCache.get(code);
  if (hit) return hit;
  const start = `${new Date().getFullYear() - 11}-01-01`;
  const p = Promise.all([
    rows<PerRow>('TaiwanStockPER', code, start, signal),
    rows<PriceRow>('TaiwanStockPrice', code, start, signal),
  ]).then(([per, price]) => ({
    per: per.map(r => ({ date: r.date, PER: Number(r.PER), PBR: Number(r.PBR), dividend_yield: Number(r.dividend_yield) })),
    price: price.map(r => ({ date: r.date, close: Number(r.close) })),
  }));
  valCache.set(code, p);
  p.catch(() => valCache.delete(code));
  return p;
}

/* ── 民生股自選存股（10 年殖利率／本益比／淨值比區間）────────
 * 與 scripts/fetch_defensive.py 用同一組三個端點與起算視窗（近 10 年 PER、近 400 天股價、2000 起股利）。
 * 由瀏覽器直打 FinMind，額度算在瀏覽者自己的 IP，不佔 CI 每日更新額度。
 */

export interface DefensiveFinMindInputs {
  per: PerRow[];
  price: PriceRow[];
  dividend: FinMindDividendRow[];
}

const defCache = new Map<string, Promise<DefensiveFinMindInputs>>();

export function clearDefensiveInputCache(code?: string): void {
  if (code) defCache.delete(code);
  else defCache.clear();
}

export function fetchDefensiveInputs(code: string, signal?: AbortSignal): Promise<DefensiveFinMindInputs> {
  const hit = defCache.get(code);
  if (hit) return hit;
  const today = todayTaipei();
  const startPer = shiftDays(today, -365 * DEFENSIVE_YEARS);
  const startPx = shiftDays(today, -400);
  const p = Promise.all([
    rows<PerRow>('TaiwanStockPER', code, startPer, signal),
    rows<PriceRow>('TaiwanStockPrice', code, startPx, signal),
    rows<FinMindDividendRow>('TaiwanStockDividend', code, '2000-01-01', signal),
  ]).then(([per, price, dividend]) => ({
    per: per.map(r => ({ date: r.date, PER: Number(r.PER), PBR: Number(r.PBR), dividend_yield: Number(r.dividend_yield) })),
    price: price.map(r => ({ date: r.date, close: Number(r.close) })),
    dividend: dividend.map(r => ({
      date: r.date ?? '',
      CashEarningsDistribution: Number(r.CashEarningsDistribution ?? 0),
      CashStatutorySurplus: Number(r.CashStatutorySurplus ?? 0),
      CashExDividendTradingDate: r.CashExDividendTradingDate ?? '',
    })),
  }));
  defCache.set(code, p);
  p.catch(() => defCache.delete(code));
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
      if (out.length > 0) {
        try { localStorage.setItem(US_KEY(code), JSON.stringify({ fetched: today, rows: out })); } catch { /* 忽略 */ }
      } else {
        // 查不到價格的代號不留快取，避免打錯代號污染 localStorage 或暫時空值被鎖死
        usCache.delete(code);
      }
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

/* ── 市值走勢：台股近 15 個月日收盤價與美元歷史匯率 ────────────
 * 沿用與美股日價相同的瀏覽器端 localStorage 每日快取機制：
 * 同一天抓過不重打 FinMind，抓不到（如額度用完）退回上次快取，僅在進入「市值走勢」分頁時才呼叫。
 */

const twPriceCache = new Map<string, Promise<PriceRow[]>>();
const TW_PRICE_KEY = (code: string) => `twetf.twprice.${code}`;

interface SavedCompactRows {
  fetched: string;
  rows: Array<[string, number]>;
}

function loadSavedCompact(key: string): SavedCompactRows | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as { fetched?: unknown; rows?: unknown };
    if (typeof o.fetched !== 'string' || !Array.isArray(o.rows)) return null;
    const cleaned: Array<[string, number]> = [];
    for (const item of o.rows) {
      if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'number' && item[1] > 0) {
        cleaned.push([item[0], item[1]]);
      }
    }
    return { fetched: o.fetched, rows: cleaned };
  } catch {
    return null;
  }
}

/** 台股（ETF 與上市櫃個股）近 15.5 個月每日收盤價，同一台北日快取於 localStorage。 */
export function fetchTwPrices(code: string, signal?: AbortSignal): Promise<PriceRow[]> {
  const normCode = code.trim().toUpperCase();
  const hit = twPriceCache.get(normCode);
  if (hit) return hit;

  const today = todayTaipei();
  const saved = loadSavedCompact(TW_PRICE_KEY(normCode));
  if (saved && saved.fetched === today && saved.rows.length > 0) {
    return Promise.resolve(saved.rows.map(([date, close]) => ({ date, close })));
  }

  const start = shiftDays(today, -470);
  const p = rows<PriceRow>('TaiwanStockPrice', normCode, start, signal)
    .then(list => {
      const byDate = new Map<string, number>();
      for (const r of list) {
        if (typeof r.date !== 'string' || r.date.length < 10) continue;
        const c = Number(r.close);
        if (Number.isFinite(c) && c > 0) byDate.set(r.date.slice(0, 10), c);
      }
      const pairs = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const out = pairs.map(([date, close]) => ({ date, close }));
      if (pairs.length > 0) {
        try {
          localStorage.setItem(TW_PRICE_KEY(normCode), JSON.stringify({ fetched: today, rows: pairs }));
        } catch { /* 無痕模式或容量滿 */ }
      } else {
        twPriceCache.delete(normCode);
      }
      return out;
    })
    .catch(err => {
      twPriceCache.delete(normCode);
      if (signal?.aborted) throw err;
      if (saved && saved.rows.length > 0) {
        return saved.rows.map(([date, close]) => ({ date, close }));
      }
      throw err;
    });
  twPriceCache.set(normCode, p);
  return p;
}

/** 發行量加權股價指數（未含息，FinMind TaiwanStockPrice data_id=TAIEX），沿用每日快取與降級備援。 */
export function fetchTaiexPrices(signal?: AbortSignal): Promise<PriceRow[]> {
  return fetchTwPrices('TAIEX', signal);
}

interface TotalReturnRow {
  date: string;
  stock_id?: string;
  price?: number;
  close?: number;
}

const TAIEX_TR_KEY = 'twetf.taiex.tr';
let taiexTrCache: Promise<PriceRow[]> | null = null;

/** 發行量加權股價報酬指數（含息，FinMind TaiwanStockTotalReturnIndex data_id=TAIEX），每日快取於 localStorage。 */
export function fetchTaiexTotalReturn(signal?: AbortSignal): Promise<PriceRow[]> {
  if (taiexTrCache) return taiexTrCache;

  const today = todayTaipei();
  const saved = loadSavedCompact(TAIEX_TR_KEY);
  if (saved && saved.fetched === today && saved.rows.length > 0) {
    return Promise.resolve(saved.rows.map(([date, close]) => ({ date, close })));
  }

  const start = shiftDays(today, -470);
  const p = rows<TotalReturnRow>('TaiwanStockTotalReturnIndex', 'TAIEX', start, signal)
    .then(list => {
      // 若 API 同時回傳多個指數（例如 TAIEX 與 TPEx），只留 TAIEX 避免覆蓋
      const hasTaiexId = list.some(r => r.stock_id === 'TAIEX');
      const byDate = new Map<string, number>();
      for (const r of list) {
        if (hasTaiexId && r.stock_id !== 'TAIEX') continue;
        if (typeof r.date !== 'string' || r.date.length < 10) continue;
        const c = Number(r.price ?? r.close);
        if (Number.isFinite(c) && c > 0) byDate.set(r.date.slice(0, 10), c);
      }
      const pairs = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const out = pairs.map(([date, close]) => ({ date, close }));
      if (pairs.length > 0) {
        try {
          localStorage.setItem(TAIEX_TR_KEY, JSON.stringify({ fetched: today, rows: pairs }));
        } catch { /* 無痕模式或容量滿 */ }
      } else {
        taiexTrCache = null;
      }
      return out;
    })
    .catch(err => {
      taiexTrCache = null;
      if (signal?.aborted) throw err;
      if (saved && saved.rows.length > 0) {
        return saved.rows.map(([date, close]) => ({ date, close }));
      }
      throw err;
    });
  taiexTrCache = p;
  return p;
}

const FX_HIST_KEY = 'twetf.usdtwd.hist';
let fxHistCache: Promise<{ rows: Array<{ date: string; rate: number }>; stale: boolean }> | null = null;

/** 美元兌台幣近 15.5 個月歷史即期買賣中價。同一日不重抓，抓不到退回舊快取或最近一筆匯率。 */
export function fetchUsdTwdHistory(
  signal?: AbortSignal,
): Promise<{ rows: Array<{ date: string; rate: number }>; stale: boolean }> {
  if (fxHistCache) return fxHistCache;

  const today = todayTaipei();
  const saved = loadSavedCompact(FX_HIST_KEY);
  if (saved && saved.fetched === today && saved.rows.length > 0) {
    return Promise.resolve({
      rows: saved.rows.map(([date, rate]) => ({ date, rate })),
      stale: false,
    });
  }

  const start = shiftDays(today, -470);
  const p = rows<FxRow>('TaiwanExchangeRate', 'USD', start, signal)
    .then(list => {
      const out = dailyMidRates(list);
      if (out.length === 0) throw new Error('FinMind 沒有歷史匯率資料');
      const pairs: Array<[string, number]> = out.map(x => [x.date, x.rate]);
      try {
        localStorage.setItem(FX_HIST_KEY, JSON.stringify({ fetched: today, rows: pairs }));
      } catch { /* 無痕模式或容量滿 */ }
      return { rows: out, stale: false };
    })
    .catch(async err => {
      fxHistCache = null;
      if (signal?.aborted) throw err;
      if (saved && saved.rows.length > 0) {
        return { rows: saved.rows.map(([date, rate]) => ({ date, rate })), stale: true };
      }
      try {
        const latest = await fetchUsdTwd();
        return { rows: [{ date: latest.date, rate: latest.rate }], stale: true };
      } catch {
        throw err;
      }
    });
  fxHistCache = p;
  return p;
}
