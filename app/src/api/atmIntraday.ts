/* 盤中價平和的存取層：index.json 列出日期，每個交易日一個檔。
 * 跟這個站其他資料一樣容許 404（還沒產生過時整區顯示說明，而不是報錯）。 */

import type { AtmDay, AtmIntradayIndex } from '../lib/atmIntraday.ts';

const BASE = `${import.meta.env.BASE_URL}data/atm_intraday/`;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const res = await fetch(url, { signal, cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`取得盤中價平和失敗（HTTP ${res.status}）`);
  return (await res.json()) as T;
}

export function fetchIntradayIndex(signal?: AbortSignal) {
  return getJson<AtmIntradayIndex>(`${BASE}index.json`, signal);
}

const cache = new Map<string, Promise<AtmDay | null>>();

/** 同一天只抓一次（切換系列、間隔時不必重抓）。 */
export function fetchIntradayDay(date: string, signal?: AbortSignal): Promise<AtmDay | null> {
  if (!cache.has(date)) {
    const p = getJson<AtmDay>(`${BASE}${date}.json`, signal).catch(e => {
      cache.delete(date);
      throw e;
    });
    cache.set(date, p);
  }
  return cache.get(date)!;
}
