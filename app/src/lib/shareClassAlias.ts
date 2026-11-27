/* 海外同公司不同股別（A／B／C 股、普通股／特別股）與台灣公司美國 ADR 對照表。
 *
 * 為什麼不在 isinTicker.ts 合併？
 * isinTicker.ts 記錄的是「ISIN → 該證券本身的代號與交易所」（GOOG 與 GOOGL、TSM 與 2330 是不同證券），
 * 保持 1 對 1 才能正確對齊原始成分；同公司多股別與台灣公司 ADR 併回台股屬於曝險層的合併，集中在這裡處理，
 * 讓 ETF 月報（ISIN）、主動式每日持股與直接持有的美股個股共用同一套代表鍵。
 *
 * 鍵格式皆為正規化後的「代號 交易所」（例如 BRK/B 已先轉為 BRK.B、UW／UN 已先轉為 US）。
 */

/** 非代表股別鍵 → 代表股別鍵（同公司不同股別合併為同一列曝險）。 */
export const SHARE_CLASS_ALIAS: Record<string, string> = {
  'GOOG US': 'GOOGL US',      // Alphabet C 股 → A 股
  'BRK.A US': 'BRK.B US',     // Berkshire Hathaway A 股 → B 股
  'FOX US': 'FOXA US',        // Fox Corp B 股 → A 股
  'NWS US': 'NWSA US',        // News Corp B 股 → A 股
  'ZG US': 'Z US',            // Zillow Group A 股 → C 股
  'UA US': 'UAA US',          // Under Armour C 股 → A 股
  'LBRDA US': 'LBRDK US',     // Liberty Broadband A 股 → C 股
  'LEN.B US': 'LEN US',       // Lennar B 股 → A 股
  'HEI.A US': 'HEI US',       // HEICO A 股 → 普通股
  'BF.A US': 'BF.B US',       // Brown-Forman A 股 → B 股
  'MOG.B US': 'MOG.A US',     // Moog B 股 → A 股
  '005935 KS': '005930 KS',   // 三星電子特別股 → 普通股
};

/** 已知多股別標的的股別中文標籤（供展開來源明細時標示各股別比重）。 */
export const SHARE_CLASS_LABEL: Record<string, string> = {
  'GOOGL US': 'A 股',
  'GOOG US': 'C 股',
  'BRK.A US': 'A 股',
  'BRK.B US': 'B 股',
  'FOXA US': 'A 股',
  'FOX US': 'B 股',
  'NWSA US': 'A 股',
  'NWS US': 'B 股',
  'ZG US': 'A 股',
  'Z US': 'C 股',
  'UAA US': 'A 股',
  'UA US': 'C 股',
  'LBRDA US': 'A 股',
  'LBRDK US': 'C 股',
  'LEN US': 'A 股',
  'LEN.B US': 'B 股',
  'HEI US': '普通股',
  'HEI.A US': 'A 股',
  'BF.A US': 'A 股',
  'BF.B US': 'B 股',
  'MOG.A US': 'A 股',
  'MOG.B US': 'B 股',
  '005930 KS': '普通股',
  '005935 KS': '特別股',
};

const SHARE_CLASS_ORDER: Record<string, number> = {
  台股: 0,
  普通股: 0,
  'A 股': 1,
  'B 股': 2,
  'C 股': 3,
  特別股: 4,
};

/** 股別顯示排序：台股／普通股 → A 股 → B 股 → C 股 → 特別股，確保來源明細呈現一致。 */
export function shareClassRank(label: string): number {
  return SHARE_CLASS_ORDER[label] ?? 99;
}

/** 依正規化後的「代號 交易所」查代表鍵與股別標籤。 */
export function resolveShareClass(normalizedKey: string): {
  canonicalKey: string;
  canonicalCode: string;
  classLabel: string | undefined;
} {
  const canonicalKey = SHARE_CLASS_ALIAS[normalizedKey] ?? normalizedKey;
  const sp = canonicalKey.lastIndexOf(' ');
  const canonicalCode = sp > 0 ? canonicalKey.slice(0, sp) : canonicalKey;
  return {
    canonicalKey,
    canonicalCode,
    classLabel: SHARE_CLASS_LABEL[normalizedKey],
  };
}

/**
 * 台灣公司美國 ADR 正規化鍵 → 對應台股代號。
 *
 * 持股健檢計算的是市值曝險（持有市值 × 佔淨值%），ADR 與台股普通股的換算比例
 * （例如 1 TSM ADR ＝ 5 股 2330）不影響市值金額，因此直接併回台股列計算。
 */
export const TW_ADR_TO_TW: Record<string, string> = {
  'TSM US': '2330', // 台積電 ADR
  'UMC US': '2303', // 聯電 ADR
  'ASX US': '3711', // 日月光投控 ADR
  'CHT US': '2412', // 中華電 ADR
};

/** 台灣公司 ADR 對應的預設台股簡稱（stock_dividends 未載入或未提供時的後備名稱）。 */
export const TW_ADR_NAME: Record<string, string> = {
  '2330': '台積電',
  '2303': '聯電',
  '3711': '日月光投控',
  '2412': '中華電',
};

export interface TwAdrTarget {
  /** 對應的台股代號（例如 2330） */
  twCode: string;
  /** 預設台股簡稱（例如 台積電） */
  twName: string;
  /** 美國 ADR 簡短代號（例如 TSM） */
  adrCode: string;
}

/** 依正規化後的「代號 交易所」判斷是否為台灣公司美國 ADR；命中時回傳對應台股資訊。 */
export function resolveTwAdr(normalizedKey: string): TwAdrTarget | null {
  const twCode = TW_ADR_TO_TW[normalizedKey];
  if (!twCode) return null;
  const sp = normalizedKey.lastIndexOf(' ');
  const adrCode = sp > 0 ? normalizedKey.slice(0, sp) : normalizedKey;
  return {
    twCode,
    twName: TW_ADR_NAME[twCode] ?? twCode,
    adrCode,
  };
}
