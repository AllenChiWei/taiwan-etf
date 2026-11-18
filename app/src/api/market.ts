/* 兩份部署時產生的小檔（2026-11-18）：個股頁、首頁不用為了幾個數字去抓 1 MB 的 chips.json。
 *  - margin_state.json：每檔融資成本線與最新一天的融資維持率 {d, c, m}（個股頁用 m）
 *  - market_temp.json：首頁的市場溫度 {keep, dist, ma}
 * 缺檔（404、那次部署沒產生）回 null，畫面就不顯示，不當成錯誤。 */

const BASE = import.meta.env.BASE_URL;

export interface MarginState {
  d: string;
  /** 代號 → 那天的融資維持率（%，自算） */
  m: Record<string, number>;
}

export interface MarketTemp {
  /** [日期, 大盤維持率%, 1＝證交所公布／0＝換算] */
  keep?: [string, number, number];
  /** [日期, 融資股數, 維持率 < 130% 家數, 占比%, 比幾 % 的歷史日子多] */
  dist?: [string, number, number, number, number];
  /** [日期, 站上 20 日線 %, 站上 60 日線 %] */
  ma?: [string, number, number];
}

async function getOptional<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}data/${path}`, { signal, cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

let stateP: Promise<MarginState | null> | null = null;

/** 同一次瀏覽只抓一次（換看別檔個股不重抓） */
export function fetchMarginState(): Promise<MarginState | null> {
  if (!stateP) stateP = getOptional<MarginState>('margin_state.json').then(s => (s && s.m ? s : null));
  return stateP;
}

export function fetchMarketTemp(signal?: AbortSignal): Promise<MarketTemp | null> {
  return getOptional<MarketTemp>('market_temp.json', signal);
}
