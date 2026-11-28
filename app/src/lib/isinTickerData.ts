/* 執行時載入的 ISIN →「代號 交易所」對照表（app/public/data/isin_ticker.json）解析與合併。
 *
 * 純函式，沒有 React、沒有 fetch，供 Node 測試與 api/extras.ts 共用。
 * 不直接匯入 isinTicker.ts，避免 api/extras.ts 被其他頁面載入時順帶打包 396 筆靜態表。
 */

export interface IsinTickerMeta {
  updated: string;
  count: number;
}

export interface IsinTickerData {
  meta: IsinTickerMeta;
  map: Record<string, string>;
  miss?: Record<string, string>;
}

const ISIN_KEY_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

function isIsinTickerData(
  v: IsinTickerData | Readonly<Record<string, string>>,
): v is IsinTickerData {
  return (
    'map' in v
    && typeof v.map === 'object'
    && v.map !== null
    && !Array.isArray(v.map)
  );
}

/**
 * 驗證並解析 isin_ticker.json 的原始內容。
 * 缺檔、格式不符或 map 不是物件時回 null；略過單筆異常鍵值不影響其餘對照。
 */
export function parseIsinTickerData(raw: unknown): IsinTickerData | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as { meta?: unknown; map?: unknown; miss?: unknown };
  if (typeof obj.map !== 'object' || obj.map === null || Array.isArray(obj.map)) return null;

  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj.map as Record<string, unknown>)) {
    if (typeof v !== 'string') continue;
    const isin = k.trim().toUpperCase();
    const pair = v.trim().toUpperCase();
    if (!ISIN_KEY_RE.test(isin) || !pair) continue;
    map[isin] = pair;
  }

  const metaRaw = (typeof obj.meta === 'object' && obj.meta !== null && !Array.isArray(obj.meta)
    ? obj.meta
    : {}) as Record<string, unknown>;
  const meta: IsinTickerMeta = {
    updated: typeof metaRaw.updated === 'string' ? metaRaw.updated : '',
    count: typeof metaRaw.count === 'number' && Number.isFinite(metaRaw.count)
      ? metaRaw.count
      : Object.keys(map).length,
  };

  let miss: Record<string, string> | undefined;
  if (typeof obj.miss === 'object' && obj.miss !== null && !Array.isArray(obj.miss)) {
    miss = {};
    for (const [k, v] of Object.entries(obj.miss as Record<string, unknown>)) {
      if (typeof v !== 'string') continue;
      const isin = k.trim().toUpperCase();
      const d = v.trim();
      if (ISIN_KEY_RE.test(isin) && d) miss[isin] = d;
    }
  }

  return miss ? { meta, map, miss } : { meta, map };
}

/**
 * 合併內建後備表（isinTicker.ts）與執行時載入的資料檔（isin_ticker.json）。
 * 缺檔或為空時完整保留內建對照；同一 ISIN 兩邊都有時以較新的資料檔為準。
 */
export function mergeIsinTickerMap(
  base: Readonly<Record<string, string>>,
  extra?: IsinTickerData | Readonly<Record<string, string>> | null,
): Record<string, string> {
  const extraMap = !extra ? null : isIsinTickerData(extra) ? extra.map : extra;
  const merged: Record<string, string> = { ...base };
  if (!extraMap) return merged;
  for (const [k, v] of Object.entries(extraMap)) {
    if (typeof v !== 'string') continue;
    const isin = k.trim().toUpperCase();
    const pair = v.trim().toUpperCase();
    if (ISIN_KEY_RE.test(isin) && pair) merged[isin] = pair;
  }
  return merged;
}
