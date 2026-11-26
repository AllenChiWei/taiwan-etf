/* 海外同公司不同股別（A／B／C 股、普通股／特別股）對照表。
 *
 * 為什麼不在 isinTicker.ts 合併？
 * isinTicker.ts 記錄的是「ISIN → 該證券本身的代號與交易所」（GOOG 與 GOOGL 是不同證券），
 * 保持 1 對 1 才能正確對齊原始成分；同一家公司不同股別屬於曝險層的合併，集中在這裡處理，
 * 讓 ETF 月報（ISIN）、主動式每日持股與直接持有的美股個股共用同一套代表鍵。
 *
 * 鍵格式皆為正規化後的「代號 交易所」（例如 BRK/B 已先轉為 BRK.B、UW 已先轉為 US）。
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
  普通股: 0,
  'A 股': 1,
  'B 股': 2,
  'C 股': 3,
  特別股: 4,
};

/** 股別顯示排序：普通股 → A 股 → B 股 → C 股 → 特別股，確保來源明細呈現一致。 */
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
