/* 美股個股清單（app/public/data/us_stocks.json）解析與自由輸入美股代號驗證。
 *
 * 純函式，沒有 React、沒有 fetch，供 Node 測試（tests/usStocks.test.ts）直接驗證。
 * 清單在部署時由 scripts/fetch_us_stocks.py 從 FinMind USStockInfo 產生；
 * 缺檔時前端回傳 null，仍可透過 parseCustomUsTicker 直接輸入美股代號向 FinMind 查詢。
 */

/** us_stocks.json 單筆精簡格式：[代號, 名稱, 市值(美元)] */
export type UsStockTuple = [code: string, name: string, mcap: number];

export interface UsStockItem {
  code: string;
  name: string;
  /** 市值（美元），僅供排序參考 */
  mcap: number;
}

export interface UsStocksMeta {
  updated: string;
  asof?: string;
  count?: number;
  minMarketCap?: number;
  source: string;
}

export interface UsStocksDataset {
  meta: UsStocksMeta;
  stocks: UsStockItem[];
}

/**
 * 驗證並解析 us_stocks.json 的原始內容。
 * 檔案缺漏、格式不符或 stocks 非陣列時回 null，略過單筆異常列不影響其餘清單。
 */
export function parseUsStocksDataset(raw: unknown): UsStocksDataset | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as { meta?: unknown; stocks?: unknown };
  if (!Array.isArray(obj.stocks)) return null;

  const metaRaw = (typeof obj.meta === 'object' && obj.meta !== null ? obj.meta : {}) as Record<string, unknown>;
  const meta: UsStocksMeta = {
    updated: typeof metaRaw.updated === 'string' ? metaRaw.updated : '',
    source: typeof metaRaw.source === 'string' ? metaRaw.source : 'FinMind USStockInfo',
    ...(typeof metaRaw.asof === 'string' ? { asof: metaRaw.asof } : {}),
    ...(typeof metaRaw.count === 'number' && Number.isFinite(metaRaw.count) ? { count: metaRaw.count } : {}),
    ...(typeof metaRaw.minMarketCap === 'number' && Number.isFinite(metaRaw.minMarketCap)
      ? { minMarketCap: metaRaw.minMarketCap } : {}),
  };

  const seen = new Set<string>();
  const stocks: UsStockItem[] = [];
  for (const row of obj.stocks) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const code = typeof row[0] === 'string' ? row[0].trim().toUpperCase() : '';
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const rawName = typeof row[1] === 'string' ? row[1].trim() : '';
    const mcap = typeof row[2] === 'number' && Number.isFinite(row[2]) && row[2] >= 0 ? row[2] : 0;
    stocks.push({ code, name: rawName || code, mcap });
  }

  return { meta, stocks };
}

/** 建立美股個股「代號 → 名稱」對照表。 */
export function usStockNameMap(data: UsStocksDataset | null): Map<string, string> {
  return new Map(data ? data.stocks.map(s => [s.code, s.name] as const) : []);
}

// 美股代號以英文字母開頭、1～6 碼，可含數字與 .／-（排除 2330、0050、2887E 等台股代號）
const CUSTOM_US_TICKER_RE = /^[A-Z][A-Z0-9.-]{0,5}$/;

/**
 * 判斷使用者搜尋字串是否像美股代號（英文字母開頭、英數與 .／-、1～6 碼）。
 * 合法時回傳大寫代號，否則回 null。
 */
export function parseCustomUsTicker(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (!s || s.length > 6) return null;
  if (!CUSTOM_US_TICKER_RE.test(s)) return null;
  if (/[.-]$/.test(s) || /[.-]{2}/.test(s)) return null;
  return s;
}
