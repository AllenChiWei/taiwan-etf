/* 試算資料的索引（calc/index.json）。
 *
 * 試算頁與配息頁都需要它，所以抽成一個 hook —— 兩頁各寫一份 useEffect 的話，
 * 錯誤訊息與載入狀態遲早會長得不一樣。
 *
 * 這份資料是部署時產生的，FinLab 額度用完那天會缺席，所以 error 是正常狀態之一，
 * 不是例外。
 */

import { useEffect, useState } from 'react';
import type { CalcIndex } from '../lib/backtest';

export interface CalcIndexState {
  index: CalcIndex | null;
  error: string | null;
  loading: boolean;
}

export function useCalcIndex(): CalcIndexState {
  const [index, setIndex] = useState<CalcIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/calc/index.json`,
          { signal: ac.signal, cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: CalcIndex) => { if (!ac.signal.aborted) setIndex(d); })
      .catch((e: Error) => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, []);

  return { index, error, loading: !index && !error };
}
