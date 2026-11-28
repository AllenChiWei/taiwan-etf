/* 美股 ETF 官網成分股（app/public/data/us_etf_holdings.json）型別、解析與來源格式。
 *
 * 純函式，沒有 React、沒有 fetch，供 Node 測試、api/extras.ts、lib/overlap.ts 與 lib/portfolioXray.ts 共用。
 * 由 scripts/fetch_us_etf_holdings.py 寫入（只存最新，目前收錄 QQQ、QQQM、QQQI、SPYI）。
 */

/** [美股代號, 公司名稱, 權重%] */
export type UsEtfHoldingRow = [string, string, number];

/** full＝官網全部持股（Invesco）；top25＝官網僅公開前 25 大（NEOS） */
export type UsEtfHoldingBasis = 'full' | 'top25';

export interface UsEtfHoldingEntry {
  /** YYYY-MM-DD */
  asof: string;
  /** 來源標示，例如「Invesco 官網」、「NEOS 官網」 */
  src: string;
  basis: UsEtfHoldingBasis;
  rows: UsEtfHoldingRow[];
}

export interface UsEtfHoldingsData {
  meta: {
    updated: string;
    count?: number;
    source?: string;
    errors?: string[];
  };
  etfs: Record<string, UsEtfHoldingEntry>;
}

/** 驗證並解析 us_etf_holdings.json；缺檔或格式錯誤回 null，略過單列異常不影響其他檔。 */
export function parseUsEtfHoldingsData(raw: unknown): UsEtfHoldingsData | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as { meta?: unknown; etfs?: unknown };
  if (typeof obj.etfs !== 'object' || obj.etfs === null || Array.isArray(obj.etfs)) return null;

  const etfs: Record<string, UsEtfHoldingEntry> = {};
  for (const [rawCode, rawEntry] of Object.entries(obj.etfs as Record<string, unknown>)) {
    const code = rawCode.trim().toUpperCase();
    if (!code || typeof rawEntry !== 'object' || rawEntry === null || Array.isArray(rawEntry)) continue;
    const e = rawEntry as Record<string, unknown>;
    const asof = typeof e.asof === 'string' ? e.asof.trim() : '';
    const src = typeof e.src === 'string' ? e.src.trim() : '';
    const basis: UsEtfHoldingBasis | null = e.basis === 'full' || e.basis === 'top25' ? e.basis : null;
    if (!basis || !Array.isArray(e.rows)) continue;

    const rows: UsEtfHoldingRow[] = [];
    for (const r of e.rows) {
      if (!Array.isArray(r) || r.length < 3) continue;
      const ticker = typeof r[0] === 'string' ? r[0].trim().toUpperCase() : '';
      const name = typeof r[1] === 'string' ? r[1].trim() : '';
      const w = typeof r[2] === 'number' ? r[2] : Number.NaN;
      if (!ticker || !Number.isFinite(w) || !(w > 0 && w <= 100)) continue;
      rows.push([ticker, name || ticker, w]);
    }
    if (!rows.length) continue;
    etfs[code] = { asof, src: src || '官網', basis, rows };
  }

  const metaRaw = (typeof obj.meta === 'object' && obj.meta !== null && !Array.isArray(obj.meta)
    ? obj.meta
    : {}) as Record<string, unknown>;
  return {
    meta: {
      updated: typeof metaRaw.updated === 'string' ? metaRaw.updated : '',
      count: typeof metaRaw.count === 'number' && Number.isFinite(metaRaw.count)
        ? metaRaw.count
        : Object.keys(etfs).length,
      ...(typeof metaRaw.source === 'string' ? { source: metaRaw.source } : {}),
    },
    etfs,
  };
}

export function lookupUsEtfHoldings(
  data: UsEtfHoldingsData | null | undefined,
  code: string,
): UsEtfHoldingEntry | undefined {
  if (!data) return undefined;
  return data.etfs[code.trim().toUpperCase()];
}

/**
 * 格式化美股 ETF 成分股來源標示：
 * - full：「Invesco 官網 2026-11-25（全部 106 檔）」
 * - top25：「NEOS 官網 2026-11-30（前 25 大）」
 */
export function formatUsHoldingsSource(
  src: string,
  asof: string,
  basis: UsEtfHoldingBasis,
  stockCount?: number,
): string {
  const head = [src.trim() || '官網', asof.trim()].filter(Boolean).join(' ');
  // 2026-11-28 Claude 實測：NEOS 官網表格只列前 10 大（不是 25）→ 依實際檔數標示
  if (basis === 'top25') return stockCount && stockCount > 0 ? `${head}（前 ${stockCount} 大）` : `${head}（官網公開的前幾大）`;
  return stockCount && stockCount > 0 ? `${head}（全部 ${stockCount} 檔）` : `${head}（全部持股）`;
}
