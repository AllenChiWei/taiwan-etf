/* 被動式 ETF 全部持股（投信每日申購買回清單＋投信投顧公會季報持股 1% 以上）。純函式，沒有 React。
 *
 * 由 scripts/fetch_etf_holdings.py 寫入 app/public/data/etf_holdings.json（只存最新一天，不累積）。
 * 持股列格式與 active_holdings.ts 相容：[代號, 名稱, 股數, 權重%, 選填資產類型?]。
 */

/** [代號, 名稱, 股數, 權重%, 選填資產類型（公會季報用，同 top10 標的種類）] */
export type FullHoldingRow =
  | [string, string, number, number]
  | [string, string, number, number, string];

/** weight＝投信直接給權重；qty＝投信只給申購股數，以收盤價換算；quarterly1pct＝公會季報持股 1% 以上 */
export type FullHoldingBasis = 'weight' | 'qty' | 'quarterly1pct';

/** basis === 'qty' 時的分母口徑：nav＝依 PCF 淨值換算；stock＝以股票部位合計為 100% */
export type QtyDenom = 'nav' | 'stock';

export interface FullHoldingEtf {
  name: string;
  /** 投信申購買回清單為 YYYY-MM-DD；公會季報為 YYYYQ#（例 2026Q3） */
  asof: string;
  /** 來源投信名稱（例「元大投信」、「群益投信」）或「投信投顧公會季報」 */
  src: string;
  basis: FullHoldingBasis;
  /** 僅 basis === 'qty' 時出現 */
  denom?: QtyDenom;
  holdings: FullHoldingRow[];
}

export interface FullHoldingsData {
  meta: {
    updated: string;
    counts?: Record<string, number>;
    pcfCount?: number;
    quarterlyCount?: number;
    quarterlyAsof?: string | null;
    requests?: number;
    source: string;
    errors?: string[];
  };
  etfs: Record<string, FullHoldingEtf>;
}

/**
 * 雙幣別分級代號（00625K、00687C）跟本尊是同一檔基金，查不到時退回去掉 K／C 結尾的代號。
 * 不退回 A／L／R／B 等字尾，避免把主動式或槓反誤對到不同基金。
 */
export function lookupFullHoldings(data: FullHoldingsData, code: string): FullHoldingEtf | undefined {
  return data.etfs[code] ?? (/[KC]$/.test(code) ? data.etfs[code.slice(0, -1)] : undefined);
}
