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
  /** 近 3 個月市價報酬率 */
  r3: string;
  /** 近 6 個月市價報酬率 */
  r6: string;
  /** 近 1 年市價報酬率 */
  r12: string;
  /** 近 3 年市價報酬率（累積，非年化）*/
  r36: string;
  sec: SectionId;
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
  /** 報酬率／殖利率的市場快照日期 MM/DD，可能是空字串 */
  snapshot: string;
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
export type NumericKey = 'yield' | 'r3' | 'r6' | 'r12' | 'r36';

export interface Filters {
  q: string;
  cust: string;
  freq: string;
  sec: string;
}
