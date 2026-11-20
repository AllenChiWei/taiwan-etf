/* 結算價預測的即時加權指數：經過我們自己的 Cloudflare Worker（cloudflare/settle-proxy）。
 * 證交所看盤與 Yahoo 都沒有 CORS，網頁不能直接讀，所以要轉接；CSP 的 connect-src 為此放行這個網域。 */

/** Worker 網址。部署在 Cloudflare（使用者帳號），換網址時同步改 vite-plugins.ts 的 connect-src。 */
export const SETTLE_ORIGIN = 'https://twetf-settle.weiwei840c.workers.dev';
export const SETTLE_API = `${SETTLE_ORIGIN}/taiex`;

export interface TaiexLive {
  ok: boolean;
  src: 'mis' | 'yahoo';
  /** YYYYMMDD */
  d: string;
  /** HH:MM:SS（證交所揭示時間） */
  t: string;
  /** 最新加權指數 */
  z: number;
  /** 昨收 */
  y: number | null;
  /** 12:55 以後每分鐘的收盤（時間標在那一分鐘結束）：[HHMMSS, 指數] */
  bars: Array<[number, number]>;
}

/**
 * 證交所每 5 秒加權指數（MI_5MINS_INDEX，有 CORS，收盤後才公布）→ 13:00～13:30 的點。
 * 收盤後網頁有內插時用它校正成和期交所一樣的算法。還沒公布回 null。date：YYYYMMDD。
 */
export async function fetchTaiex5s(date: string, signal?: AbortSignal): Promise<Array<{ sec: number; v: number }> | null> {
  const res = await fetch(`https://www.twse.com.tw/exchangeReport/MI_5MINS_INDEX?response=json&date=${date}`, { signal, cache: 'no-store' });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { stat?: string; data?: string[][] } | null;
  if (j?.stat !== 'OK' || !Array.isArray(j.data)) return null;
  const out: Array<{ sec: number; v: number }> = [];
  for (const r of j.data) {
    const t = String(r[0] ?? '');
    if (t < '13:00:00' || t > '13:30:00') continue;
    const [h, m, s] = t.split(':').map(Number);
    const v = parseFloat(String(r[1] ?? '').replace(/,/g, ''));
    if (v > 0) out.push({ sec: h * 3600 + m * 60 + s, v });
  }
  return out.some(p => p.sec >= 13 * 3600 + 30 * 60) ? out : null;   // 要有 13:30 收盤那筆才算公布完整
}

export async function fetchTaiexLive(signal?: AbortSignal): Promise<TaiexLive> {
  let res: Response;
  try {
    res = await fetch(SETTLE_API, { signal, cache: 'no-store' });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error('連不上即時指數（轉接站）');
  }
  const j = (await res.json().catch(() => null)) as TaiexLive | null;
  if (!res.ok || !j?.ok || !(j.z > 0)) throw new Error(`即時指數暫時抓不到（HTTP ${res.status}）`);
  return j;
}
