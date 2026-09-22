/** 一檔 ETF。欄位名稱與 scripts/build_data.py 產生的 etfs.json 一致。 */
export interface Etf {
  code: string;
  name: string;
  /** 保管銀行，無資料時是全形破折號 — */
  cust: string;
  /** 配息頻率：月配 / 雙月配 / 季配 / 半年配 / 年配 / — */
  freq: FreqLabel;
  /** 殖利率，數字字串或 'N/A' */
  yield: string;
  /**
   * yield 是年化推估而不是實際近 12 個月：配息史不滿一年的標的，用「最近一次配息
   * × 每年次數」估算（fetch_yields.py 的 est）。畫面上一定要標出來，否則推估值
   * 跟真實發生過的金額混在同一欄裡看不出差別。滿一年的沒有這個欄位。
   */
  yest?: boolean;
  /** 近 3 個月市價報酬率 */
  r3: string;
  /** 近 6 個月市價報酬率 */
  r6: string;
  /** 近 1 年市價報酬率 */
  r12: string;
  /** 近 3 年市價報酬率（累積，非年化）*/
  r36: string;
  /** 近 5 年市價報酬率（累積，非年化）*/
  r60: string;
  sec: SectionId;
  /** 主動式 ETF（名稱以「主動」開頭）。跨分區的屬性，不是一個分區 ——
      主動債券 ETF 同時屬於「債券ETF」與「主動」。 */
  act: boolean;
}

export type SectionId =
  | 'cat-domestic'
  | 'cat-foreign'
  | 'cat-bond'
  | 'cat-leveraged'
  | 'cat-futures'
  | 'cat-leveraged-futures';

export type FreqLabel = '月配' | '雙月配' | '季配' | '半年配' | '年配' | '—';

export interface Section {
  id: SectionId;
  title: string;
  count: number;
}

export interface EtfMeta {
  /** 資料產生日期 YYYY-MM-DD */
  updated: string;
  /** 報酬率的資料日期（FinLab 的最後交易日，YYYY-MM-DD），可能是空字串 */
  snapshot: string;
  /** 殖利率的報價日期（MoneyDJ，MM/DD），可能是空字串 */
  yieldAsof?: string;
  total: number;
  source: string;
  generated_by?: string;
}

export interface EtfDataset {
  meta: EtfMeta;
  sections: Section[];
  custodians: string[];
  frequencies: FreqLabel[];
  etfs: Etf[];
}

/** 可排序的數值欄位。 */
export type NumericKey = 'yield' | 'r3' | 'r6' | 'r12' | 'r36' | 'r60';

export interface Filters {
  q: string;
  cust: string;
  freq: string;
  sec: string;
  /** '' 全部 / 'active' 只看主動 / 'passive' 只看被動 */
  act: string;
}

// ---- 美股 ETF ----------------------------------------------------------------
// 與台股那份刻意不共用型別：欄位不同（沒有保管銀行／配息／殖利率，多了成交金額），
// 硬湊成一個型別只會讓兩邊都長出一堆可選欄位。

/** 一檔美股 ETF。欄位名稱與 scripts/fetch_us_etfs.py 產生的 us_etfs.json 一致。 */
export interface UsEtf {
  /** 交易代號，例如 SPY */
  code: string;
  name: string;
  /** 上市交易所代碼（Nasdaq Trader 的 Listing Exchange，如 P=NYSE Arca、Q=Nasdaq） */
  exch: string;
  /** 近 3 個月累積總報酬（含息再投資），或 'N/A' */
  r3: string;
  r6: string;
  r12: string;
  /** 近 3 年累積總報酬，成立未滿三年為 'N/A' */
  r36: string;
  /** 近 5 年累積總報酬 */
  r60: string;
  /** 近 60 個交易日的日均成交金額（美元） */
  adv: number;
  /** adv 達到 meta.liquidMinAdv，且歷史長度夠算近 3 月報酬（meta.liquidMinDays） */
  liquid: boolean;
}

export interface UsEtfMeta {
  updated: string;
  /** 價格資料的最後交易日 YYYY-MM-DD */
  asof: string;
  total: number;
  liquid: number;
  liquidMinAdv: number;
  /** liquid 另外要求的最少價格點數；舊資料沒有這個欄位 */
  liquidMinDays?: number;
  source: string;
  note?: string;
  generated_by?: string;
}

export interface UsEtfDataset {
  meta: UsEtfMeta;
  etfs: UsEtf[];
}

/** 美股表格可排序的數值欄位。 */
export type UsNumericKey = 'adv' | 'r3' | 'r6' | 'r12' | 'r36' | 'r60';
