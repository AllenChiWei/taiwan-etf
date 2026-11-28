/* 持股穿透健檢（/dividend?view=xray）：把使用者在配息試算輸入的持股（twetf.holdings）
 * 依最新收盤市值展開 ETF 成分股，計算單一個股真實曝險排行，並交叉檢查低融資維持率、
 * 可轉債轉換賣壓、未來 14 天除息／法說／股東會與近期重大訊息。
 *
 * 純函式，沒有 React、沒有 fetch、沒有 localStorage 存取（由呼叫端讀入字串），
 * 讓 tests/portfolioXray.test.ts 可以直接在 Node 底下驗證。相對匯入保留 .ts 副檔名。
 */

import type { Etf } from '../types.ts';
import { mergeByCode, type AcctEntry } from './accounts.ts';
import { holdingLinkKind, type ActiveData } from './active.ts';
import type { FullHoldingBasis, FullHoldingsData, QtyDenom } from './fullHoldings.ts';
import type { Top10Data } from './top10.ts';
import { holdingsOf, usHoldingsOf, type HoldingSet, type HoldingSourceKind } from './overlap.ts';
import {
  formatUsHoldingsSource,
  parseUsEtfHoldingsData,
  type UsEtfHoldingBasis,
  type UsEtfHoldingsData,
} from './usEtfHoldings.ts';
import { ISIN_TICKER } from './isinTicker.ts';
import {
  mergeIsinTickerMap,
  parseIsinTickerData,
  type IsinTickerData,
  type IsinTickerMeta,
} from './isinTickerData.ts';
import {
  resolveShareClass,
  resolveTwAdr,
  SHARE_CLASS_ALIAS,
  SHARE_CLASS_LABEL,
  shareClassRank,
  TW_ADR_TO_TW,
} from './shareClassAlias.ts';
import type { StockDividendData, YieldData } from './dividend.ts';

export {
  formatUsHoldingsSource,
  mergeIsinTickerMap,
  parseIsinTickerData,
  parseUsEtfHoldingsData,
  SHARE_CLASS_ALIAS,
  SHARE_CLASS_LABEL,
  TW_ADR_TO_TW,
  type IsinTickerData,
  type IsinTickerMeta,
  type UsEtfHoldingBasis,
  type UsEtfHoldingsData,
};

/** 合併內建 ISIN_TICKER 與執行時載入的 isin_ticker.json；缺檔時直接沿用內建對照。 */
export function resolveIsinTickerMap(
  extra?: IsinTickerData | Readonly<Record<string, string>> | null,
): Readonly<Record<string, string>> {
  return extra ? mergeIsinTickerMap(ISIN_TICKER, extra) : ISIN_TICKER;
}
import {
  addDays, convPct, convertible, outPct,
  type CbBond, type CbData, type CbUpcoming,
} from './cb.ts';
import {
  allEvents, daysUntil,
  type CalEvent, type CalendarData,
} from './calendar.ts';
import type { Filing, NewsData } from './news.ts';

/** 風險／事件健檢預設的穿透曝險門檻（%）：過濾主動式 ETF 殘餘零股造成的雜訊。 */
export const MINOR_EXPOSURE_PCT = 0.5;

/** 結構同 api/market.ts 的 MarginState，避免 lib 層匯入含 import.meta.env 的 api 模組。 */
export interface MarginStateLite {
  d: string;
  /** 代號 → 當日融資維持率（%，XQ 平均成本推算） */
  m: Record<string, number>;
}

/** 驗證並解析 localStorage 的 twetf.holdings JSON 字串；損毀或非陣列一律回空陣列。 */
export function parseStoredHoldings(raw: string | null): AcctEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: AcctEntry[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;
      const code = typeof obj.code === 'string' ? obj.code.trim().toUpperCase() : '';
      const shares = typeof obj.shares === 'number' ? obj.shares : Number.NaN;
      if (!code || !Number.isFinite(shares) || shares <= 0) continue;
      const entry: AcctEntry = { code, shares };
      if (obj.m === 'us') {
        entry.m = 'us';
        if (obj.k === 'stock') entry.k = 'stock';
      }
      if (typeof obj.acct === 'string' && obj.acct.trim()) entry.acct = obj.acct.trim();
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

export interface PortfolioXrayInput {
  holdings: readonly AcctEntry[];
  etfs: readonly Etf[];
  top10: Top10Data | null;
  active: ActiveData | null;
  /** 選填：被動式 ETF 全部持股（投信每日申購買回清單＋公會季報 1% 以上） */
  full?: FullHoldingsData | null;
  /** 選填：美股 ETF 官網成分股（us_etf_holdings.json，僅在持有美股 ETF 時按需載入） */
  usHoldings?: UsEtfHoldingsData | null;
  yields: YieldData | null;
  stockDivs: StockDividendData | null;
  /** 美股最新收盤價（已換算為台幣，代號 → 台幣股價，涵蓋美股 ETF 與美股個股） */
  usPricesTwd?: ReadonlyMap<string, number>;
  /** 美股 ETF 名稱對照（代號 → 名稱） */
  usNames?: ReadonlyMap<string, string>;
  /** 美股個股名稱對照（代號 → 名稱） */
  usStockNames?: ReadonlyMap<string, string>;
  /** 選填：執行時載入的海外 ISIN →「代號 交易所」對照（isin_ticker.json），與內建 isinTicker.ts 合併 */
  isinMap?: IsinTickerData | Readonly<Record<string, string>> | null;
}

export type HoldingKind = 'stock' | 'etf' | 'us' | 'us-stock';
export type StockMarket = 'tw' | 'foreign';
export type PenetrationStatus = 'direct' | HoldingSourceKind | 'unpenetrable';
export type UnpenetrableReasonKind = 'bond' | 'us' | 'foreign' | 'derivative' | 'commodity' | 'missing';

export interface HoldingBreakdownRow {
  code: string;
  name: string;
  kind: HoldingKind;
  shares: number;
  price: number | null;
  /** 台幣市值；缺報價時為 null */
  value: number | null;
  /** 佔投組總市值（%）；缺報價時為 0 */
  pctOfPortfolio: number;
  status: PenetrationStatus;
  /** 每日／清單 YYYY-MM-DD、季報 YYYYQ# 或月報 YYYY/MM；直接持股與無法穿透時為 null */
  asof: string | null;
  /** 來源投信（pcf）、公會季報或美股發行商（us） */
  src?: string;
  basis?: FullHoldingBasis;
  usBasis?: UsEtfHoldingBasis;
  denom?: QtyDenom;
  /** 可穿透至個股（台股＋海外）的權重合計（佔該 ETF 淨值 %）；直接個股為 100，無法穿透為 0 */
  coveredPct: number;
  /** 實際展開出的個股總檔數（台股＋海外） */
  stockCount: number;
  /** 展開出的台股個股檔數 */
  twStockCount?: number;
  /** 展開出的海外個股檔數 */
  foreignStockCount?: number;
  /** 無法穿透或展開口徑說明 */
  note: string | null;
  unpenetrableKind?: UnpenetrableReasonKind;
}

export interface ShareClassPart {
  /** 該股別的正規化簡短代號（例如 GOOGL、GOOG、BRK.A、BRK.B、005935） */
  code: string;
  /** 股別中文標籤（例如 A 股、B 股、C 股、普通股、特別股） */
  label: string;
  /** 此股別在該來源中的權重（%）；直接持股為 100 */
  weight: number;
}

export interface ExposureSource {
  /** 來源代號（直接持股即為該股本身，ETF 為 ETF 代號） */
  code: string;
  name: string;
  kind: 'direct' | HoldingSourceKind;
  /** 該股在此來源中的權重（%）；直接持股為 100 */
  weightInSource: number;
  /** 此來源貢獻的曝險金額（台幣） */
  amount: number;
  /** 此來源貢獻的投組權重（%） */
  pctOfPortfolio: number;
  asof: string | null;
  src?: string;
  basis?: FullHoldingBasis;
  usBasis?: UsEtfHoldingBasis;
  /** 來源 ETF 展開出的股票成分總檔數（供美股官網顯示「全部 N 檔」） */
  sourceCount?: number;
  denom?: QtyDenom;
  /** 屬多股別合併標的或含台灣 ADR 時，記錄此來源包含的各股別／ADR 與權重（依順序排列） */
  shareClasses?: ShareClassPart[];
  /** 若此來源含台灣公司的美國 ADR（如 TSM→2330），記錄該 ADR 簡短代號（例如 TSM） */
  adrCode?: string;
}

/**
 * 格式化單一 ETF 來源的股別權重明細：
 * - 多股別合併：例如「A 股 5.92%＋C 股 5.55%＝11.47%」
 * - 單一股別：例如「C 股 3.42%」
 */
export function formatShareClasses(
  shareClasses: readonly ShareClassPart[],
  totalWeight: number,
  decimals = 2,
): string {
  const fmt = (n: number) => n.toFixed(decimals);
  if (shareClasses.length <= 1) {
    const only = shareClasses[0];
    return only ? `${only.label} ${fmt(only.weight)}%` : `${fmt(totalWeight)}%`;
  }
  const parts = shareClasses.map(c => `${c.label} ${fmt(c.weight)}%`).join('＋');
  return `${parts}＝${fmt(totalWeight)}%`;
}

export interface ExposureRow {
  /** 合併鍵（台股為 4 碼如 2330；海外對照成功為「代號 交易所」如 AAPL US；無對照為 ISIN） */
  code: string;
  /** 畫面顯示用簡短代號（台股如 2330；海外如 AAPL；無對照為原 ISIN） */
  displayCode: string;
  name: string;
  /** 市場歸屬：台股或海外 */
  market: StockMarket;
  /** 市場小標籤（台股／美股／日股／韓股／港股／陸股／越南／海外…） */
  marketLabel: string;
  /** true 代表海外成分查無 ticker 對照、仍以 ISIN 呈現 */
  isIsin?: boolean;
  /** true 代表此台股列包含台灣公司的美國 ADR 併入（例如 TSM 併入 2330） */
  hasAdr?: boolean;
  /** 合計曝險金額（台幣） */
  amount: number;
  /** 佔投組已定價總市值（%） */
  pct: number;
  directAmount: number;
  directPct: number;
  etfAmount: number;
  etfPct: number;
  /** 是否直接持有此檔股票 */
  isDirect: boolean;
  /** 是否有月報前十大 ETF 貢獻（或整體投組含月報 ETF 時屬下限） */
  fromMonthly: boolean;
  /** 依貢獻金額由大到小排列的來源明細 */
  sources: ExposureSource[];
}

export interface UnpricedHolding {
  code: string;
  name: string;
  kind: HoldingKind;
  shares: number;
  reason: string;
}

export interface PortfolioXrayResult {
  /** 合併多帳戶後的總持股檔數 */
  holdingCount: number;
  /** 成功取得報價並計入總市值分母的檔數 */
  pricedCount: number;
  /** 已定價投組總市值（台幣） */
  totalValue: number;
  /** 直接持有台股個股市值與佔比 */
  directStockValue: number;
  directStockPct: number;
  /** ETF 穿透辨識出的台股個股市值與佔比 */
  penetratedEtfValue: number;
  penetratedEtfPct: number;
  /** 海外個股總曝險市值與佔比（直接持有美股個股 ＋ ETF 穿透辨識出的海外個股） */
  foreignStockValue: number;
  foreignStockPct: number;
  /** 商品 ETF（黃金、白銀、原油等實物／商品期貨，沒有個股）市值與佔比 */
  commodityValue: number;
  commodityPct: number;
  /** 可穿透 ETF 中未揭露（前十大以外）／期貨與現金部分 */
  unrevealedEtfValue: number;
  unrevealedEtfPct: number;
  /** 無法穿透標的（債券、美股 ETF、槓反／期貨、尚無明細 ETF）市值與佔比 */
  unpenetrableValue: number;
  unpenetrablePct: number;
  /** 已辨識台股個股總曝險佔比＝directStockPct + penetratedEtfPct */
  knownTwPct: number;
  /** 前五大單一個股佔比合計（%） */
  top5Pct: number;
  /** 是否持有任何僅用月報前十大展開的 ETF（true 代表單股曝險為已知下限） */
  hasLowerBound: boolean;
  /** 投組中主動式每日持股使用到的日期（由舊到新去重） */
  dailyDates: string[];
  /** 投組中被動式投信申購買回清單使用到的日期（由舊到新去重） */
  pcfDates: string[];
  /** 投組中公會季報持股 1% 以上使用到的季別（YYYYQ#），未使用則 null */
  quarterlyAsof: string | null;
  /** 投組中公會月報前十大使用到的月份（YYYY/MM），未使用則 null */
  monthlyAsof: string | null;
  /** 投組中已穿透美股 ETF 使用到的日期（由舊到新去重） */
  usDates: string[];
  /** 是否持有僅揭露前 25 大的美股 ETF（如 NEOS QQQI／SPYI） */
  hasUsTop25: boolean;
  /** 是否有投信僅給股數、權重以股票部位合計 100% 換算的 ETF */
  hasQtyStockOnly: boolean;
  /** 投組內各持股權重資料日期是否不一致（例如每日持股與月報／季報並存） */
  hasDateMismatch: boolean;
  /** 單一個股真實曝險排行（金額由大到小，含台股與海外） */
  exposures: ExposureRow[];
  /** 每筆持股（合併帳戶後）的穿透狀態與覆蓋明細 */
  breakdown: HoldingBreakdownRow[];
  /** 缺報價、未計入總市值分母的持股 */
  unpriced: UnpricedHolding[];
  /** 直接持有標的（台股 ETF ＋ 台股個股）的投組佔比表，供行事曆與重訊比對 */
  directWeights: ReadonlyMap<string, { name: string; kind: HoldingKind; pct: number }>;
}

const ETF_CODE_RE = /^00\d{2,4}[A-Z]?$/;

function isDerivativeSec(sec: string | undefined): boolean {
  return sec === 'cat-leveraged' || sec === 'cat-futures' || sec === 'cat-leveraged-futures';
}

/** 美股商品 ETF 代號對照表（實物貴金屬／大宗商品期貨 ETF，本來就沒有個股）。 */
export const US_COMMODITY_ETFS: ReadonlySet<string> = new Set([
  // 黃金
  'GLD', 'IAU', 'GLDM', 'IAUM', 'SGOL', 'BAR', 'AAAU', 'OUNZ', 'PHYS',
  // 白銀／鉑金／鈀金／綜合貴金屬
  'SLV', 'SIVR', 'PSLV', 'PPLT', 'PALL', 'GLTR',
  // 綜合商品／能源／農產品／工業金屬
  'DBC', 'PDBC', 'GSG', 'BCI', 'COMT', 'USCI', 'CMDY',
  'USO', 'BNO', 'UNG', 'DBE',
  'DBA', 'CORN', 'WEAT', 'SOYB',
  'CPER', 'DBB',
]);

const US_COMMODITY_NAME_RE = /\b(?:gold|silver|platinum|palladium|commodit(?:y|ies)|oil|natural\s+gas)\b/i;
// 排除礦業／油氣開採／油服等持有公司股票的產業型 ETF（例：GDX Gold Miners、XOP Oil & Gas E&P、OIH Oil Services）
const US_COMMODITY_EQUITY_EXCLUDE_RE = /\b(?:miners?|mining|exploration|production|producers?|services?|equipment|equity|equities|stocks?|compan(?:y|ies))\b/i;

/** 判斷美股 ETF（m='us' 且非個股）是否為商品 ETF（持有實物或商品期貨，本來就沒有個股）。 */
export function isUsCommodityEtf(code: string, name?: string): boolean {
  const norm = code.trim().toUpperCase();
  if (!norm) return false;
  if (US_COMMODITY_ETFS.has(norm)) return true;
  if (!name) return false;
  return US_COMMODITY_NAME_RE.test(name) && !US_COMMODITY_EQUITY_EXCLUDE_RE.test(name);
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const FOREIGN_TICKER_RE = /^([A-Z0-9][A-Z0-9./-]{0,11})\s+([A-Z][A-Z0-9])$/;
const CJK_RE = /[\u4e00-\u9fff]/;

// 公會月報／季報的資產類型若屬債券、票券、基金、期貨或連結型 ETF，不展開成個股
const NON_STOCK_TYPE_RE = /公債|公司債|金融債|可轉債|債券|短期票券|票券|附買回|債|期貨|期指|選擇權|受益憑證|共同基金|境外基金|貨幣市場基金|基金|ETF/i;
// 沒有資產類型欄位時，依名稱排除常見債券寫法（如 US TREASURY 4.25% 2054、T 4 3/4 05/15/55）
const BOND_NAME_RE = /\b(TREASURY|T-BILL|BOND|NOTES?|DEBENTURE|MTN|COUPON|GILTS?)\b|公債|公司債|金融債|債券|\d+(?:\.\d+)?%\s*(?:\d{2,4}|\/)|(?:^|[\s(])V?\d{1,2}(?:\.\d+|\s+\d+\/\d+)?%?\s+(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/\d{2,4}(?:\b|$)/i;

// 交易所別名正規化（跟 scripts/gen_isin_ticker.py 一致，讓各投信的不同寫法合併成同一個鍵）
const EXCH_ALIAS: Record<string, string> = {
  US: 'US', UW: 'US', UN: 'US', UA: 'US', UQ: 'US', UP: 'US', UR: 'US', UF: 'US', UV: 'US', UD: 'US',
  JP: 'JP', JT: 'JP', JN: 'JP', JO: 'JP',
  KS: 'KS', KP: 'KS', KQ: 'KQ', KD: 'KQ',
  HK: 'HK',
  CH: 'CH', C1: 'CH', C2: 'CH', CG: 'CH', CS: 'CH', SH: 'CH', SZ: 'CH',
  CN: 'CN', CT: 'CN', CV: 'CN', TO: 'CN',
  LN: 'LN', LI: 'LN',
  GR: 'GR', GY: 'GR', GF: 'GR', GD: 'GR',
  FP: 'FP',
  NA: 'NA',
  SW: 'SW', SE: 'SW', VX: 'SW',
  IM: 'IM', SM: 'SM', SQ: 'SM', SS: 'SS', DC: 'DC', NO: 'NO', FH: 'FH', BB: 'BB', ID: 'ID', AV: 'AV',
  AU: 'AU', AT: 'AU',
  IN: 'IN', IS: 'IN', IB: 'IN',
  VN: 'VN', VH: 'VN', VM: 'VN',
  SP: 'SP',
  IT: 'IT',
  BZ: 'BZ', BS: 'BZ',
  MM: 'MM', MK: 'MK', TB: 'TB', IJ: 'IJ', PM: 'PM', SJ: 'SJ', NZ: 'NZ',
};

const EXCH_MARKET_LABEL: Record<string, string> = {
  US: '美股', JP: '日股', KS: '韓股', KQ: '韓股', HK: '港股', CH: '陸股',
  CN: '加股', LN: '英股', GR: '德股', FP: '法股', NA: '荷股', SW: '瑞股',
  AU: '澳股', IN: '印股', VN: '越南', SP: '星股', IM: '義股', SM: '西班牙',
  SS: '瑞典', DC: '丹麥', NO: '挪威', FH: '芬蘭', BB: '比利時', ID: '愛爾蘭',
  AV: '奧地利', IT: '以色列', BZ: '巴西', MM: '墨西哥', MK: '馬來西亞',
  TB: '泰國', IJ: '印尼', PM: '菲律賓', SJ: '南非', NZ: '紐西蘭',
};

// ISO 3166-1 國別碼（僅在 ISIN 查無 ticker 對照時用來判斷市場小標籤）
const ISIN_COUNTRY_LABEL: Record<string, string> = {
  US: '美股', JP: '日股', KR: '韓股', HK: '港股', CN: '陸股', CA: '加股',
  GB: '英股', DE: '德股', FR: '法股', NL: '荷股', CH: '瑞股', AU: '澳股',
  IN: '印股', VN: '越南', SG: '星股', IT: '義股', ES: '西班牙', SE: '瑞典',
  DK: '丹麥', NO: '挪威', FI: '芬蘭', BE: '比利時', IE: '愛爾蘭', AT: '奧地利',
  IL: '以色列', BR: '巴西', MX: '墨西哥', MY: '馬來西亞', TH: '泰國',
  ID: '印尼', PH: '菲律賓', ZA: '南非', NZ: '紐西蘭',
};

interface NormalizedForeignTicker {
  key: string;
  displayCode: string;
  rawDisplayCode: string;
  classLabel: string | undefined;
  marketLabel: string;
}

interface ParsedForeign extends NormalizedForeignTicker {
  isIsin: boolean;
}

function normalizeForeignTicker(
  rawTicker: string,
  rawExch: string,
): NormalizedForeignTicker | null {
  const exch = EXCH_ALIAS[rawExch.toUpperCase()];
  if (!exch) return null;
  let ticker = rawTicker.trim().toUpperCase();
  if (!ticker) return null;
  if (exch === 'HK' && /^\d+$/.test(ticker)) {
    ticker = ticker.replace(/^0+(?=\d)/, '');
  } else if (exch === 'US') {
    // 美股股別常見 BRK/B、BRK-B、BRK.B 三種寫法，先統一為點號再套股別對照
    ticker = ticker.replace(/\//g, '.').replace(/^([A-Z0-9]{1,5})-([A-Z])$/, '$1.$2');
  }
  const rawKey = `${ticker} ${exch}`;
  const { canonicalKey, canonicalCode, classLabel } = resolveShareClass(rawKey);
  return {
    key: canonicalKey,
    displayCode: canonicalCode,
    rawDisplayCode: ticker,
    classLabel,
    marketLabel: EXCH_MARKET_LABEL[exch] ?? '海外',
  };
}

function parseForeignComponent(
  rawSid: string,
  rawName: string,
  rowType?: string,
  isinLookup: Readonly<Record<string, string>> = ISIN_TICKER,
): ParsedForeign | null {
  if (rowType && NON_STOCK_TYPE_RE.test(rowType)) return null;
  const sid = rawSid.trim().toUpperCase();
  if (!sid) return null;

  // 1. 「代號 交易所」（主動式 ETF 每日持股常見格式，如 AAPL US、6857 JP、000660 KS）
  const tm = sid.match(FOREIGN_TICKER_RE);
  if (tm) {
    const norm = normalizeForeignTicker(tm[1], tm[2]);
    if (!norm) return null;
    return { ...norm, isIsin: false };
  }

  // 2. ISIN（公會月報前十大與季報格式，如 US0378331005、JP3122400009、VN000000VIC9）
  if (ISIN_RE.test(sid)) {
    // 排除歐洲債（XS）、美國公債／國庫券（US912／US9128）及債券類名稱
    if (sid.startsWith('XS') || sid.startsWith('US912')) return null;
    if (BOND_NAME_RE.test(rawName)) return null;
    const mapped = isinLookup[sid];
    if (mapped) {
      const mm = mapped.trim().toUpperCase().match(FOREIGN_TICKER_RE);
      if (mm) {
        const norm = normalizeForeignTicker(mm[1], mm[2]);
        if (norm) return { ...norm, isIsin: false };
      }
    }
    return {
      key: sid,
      displayCode: sid,
      rawDisplayCode: sid,
      classLabel: undefined,
      marketLabel: ISIN_COUNTRY_LABEL[sid.slice(0, 2)] ?? '海外',
      isIsin: true,
    };
  }

  return null;
}

/** 去掉海外公司名稱尾端的股別字樣（如 -CL A、Class C、-A、-PREF、特別股），讓合併後的代表列顯示公司名。 */
function stripShareClassSuffix(raw: string): string {
  let s = raw.trim();
  if (!s) return s;

  // 1. 括號內股別：(Class A)、(CL C)、(Pref)、(特別股)、(普通股)
  s = s.replace(
    /\s*[（(]\s*(?:(?:(?:CLASS|SERIES)\s+|(?:CL|SER)(?:\.\s*|\s+))[A-Z](?:\s+(?:SHARES?|SHS|STOCK|COMMON|ORD))?|PREF(?:ERRED)?|PFD|特別股|普通股|[ABC]\s*股)\s*[)）]\s*$/i,
    '',
  );

  // 2. 明確的 Class / CL / Series 標記：-CL A、-CLASS A SHARES、Class C、CL. B、Series A
  s = s.replace(
    /(?:\s*[-–—,/]\s*|\s+)(?:(?:COM(?:MON)?|ORD(?:INARY)?)\s+)?(?:(?:CLASS|SERIES)\s+|(?:CL|SER)(?:\.\s*|\s+))[A-Z](?:\s+(?:SHARES?|SHS|STOCK|COMMON|ORD))?\.?\s*$/i,
    '',
  );

  // 3. 破折號後單一字母股別：-A、- A、-B、-C、-K（僅限常見多股別字母，避免誤刪港股 -W/-S/-SW 等標記）
  s = s.replace(/\s*[-–—]\s*[ABCK]\s*$/i, '');

  // 4. 特別股與中文股別標記：-PREF、PREF、PREFERRED、PFD、特別股、普通股、A 股 / B 股 / C 股
  s = s.replace(/(?:\s*[-–—,/]\s*|\s+)(?:PREF(?:ERRED)?|PFD)\.?\s*$/i, '');
  s = s.replace(/\s*(?:特別股|普通股|[ABC]\s*股)\s*$/, '');

  return s.replace(/[.,;:\-\s]+$/, '').trim();
}

/** 整理海外個股名稱：有中文優先取中文（含括號內中文），去掉股別字樣，英文名僅做輕度標點整理。 */
export function cleanForeignName(raw: string): { name: string; hasCjk: boolean } {
  let s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return { name: '', hasCjk: false };

  // 1. 若有括號內含中文（如 "MICROSOFT CORP(微軟公司)"），優先取中文部分
  const cjkParen = s.match(/[（(]([^()（）]*[\u4e00-\u9fff][^()（）]*)[)）]/);
  if (cjkParen) {
    const inside = cjkParen[1].trim();
    const outside = s.replace(cjkParen[0], '').trim();
    const picked = CJK_RE.test(outside) ? outside : inside;
    const stripped = stripShareClassSuffix(picked);
    return { name: stripped || picked, hasCjk: true };
  }

  // 2. 本身已含中文（如「愛德萬測試」、「微軟(MSFT US)」、「Alphabet公司 Class C」），去掉末尾純英數代號括號與股別字樣
  if (CJK_RE.test(s)) {
    const noCode = s.replace(/\s*[（(][A-Za-z0-9.\s/-]{1,20}[)）]\s*$/, '').trim() || s;
    const stripped = stripShareClassSuffix(noCode);
    return { name: stripped || noCode, hasCjk: true };
  }

  // 3. 純英文名：去掉投信附帶代號、INC/CORP 等前後多餘標點與股別字樣，不過度改寫
  s = s
    .replace(/\.[A-Za-z0-9/-]{1,10}\s+[A-Za-z]{2}\s*$/i, '')
    .replace(/\s*[（(][A-Za-z0-9./-]{1,10}\s+[A-Za-z0-9]{2}[)）]\s*$/i, '')
    .replace(/,\s*(INC|CORP|CORPORATION|CO|LTD|LIMITED|PLC|NV|SA|SE|AG|HOLDINGS?)\b\.?/gi, ' $1')
    .replace(/\b(INC|CORP|CO|LTD|PLC)\.(?=\s|$|-|,)/gi, '$1')
    .replace(/[.,;:\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const stripped = stripShareClassSuffix(s);
  return { name: stripped || s, hasCjk: false };
}

function pickForeignStockName(candidate: string, current: string | undefined, fallbackCode: string): string {
  const cand = cleanForeignName(candidate);
  if (!current) return cand.name || fallbackCode;
  if (!cand.name) return current;
  if (current === fallbackCode && cand.name !== fallbackCode) return cand.name;
  if (cand.name === fallbackCode && current !== fallbackCode) return current;
  const curHasCjk = CJK_RE.test(current);
  if (cand.hasCjk && !curHasCjk) return cand.name;
  if (!cand.hasCjk && curHasCjk) return current;
  return cand.name.length < current.length ? cand.name : current;
}

/** 挑最短且清楚的公司簡稱（stock_dividends 官方簡稱優先，否則取各投信裡最短的名稱）。 */
function pickStockName(
  code: string,
  candidate: string,
  current: string | undefined,
  stockDivs: StockDividendData | null,
): string {
  const official = stockDivs?.stocks[code]?.n;
  if (official) return official;
  const clean = candidate.trim() || code;
  if (!current) return clean;
  return clean.length < current.length ? clean : current;
}

interface ParsedTwComponent {
  sid: string;
  name: string;
  pct: number;
  twPct: number;
  adrPct: number;
  adrCode?: string;
}

interface ParsedForeignComponent extends ParsedForeign {
  name: string;
  pct: number;
  classMap: Map<string, ShareClassPart>;
}

/** 分流展開單一 ETF 的台股普通股（另併入台灣公司美國 ADR）與海外股票（排除期貨、債券與連結型 ETF）。 */
function splitEtfComponents(
  hs: HoldingSet,
  isinLookup: Readonly<Record<string, string>> = ISIN_TICKER,
): {
  twComponents: ParsedTwComponent[];
  foreignComponents: ParsedForeignComponent[];
} {
  const twCompMap = new Map<string, ParsedTwComponent>();
  const foreignCompMap = new Map<string, ParsedForeignComponent>();

  for (const [sid, item] of hs.w) {
    if (!(item.pct > 0)) continue;
    if (holdingLinkKind(sid) === 'stock') {
      if (item.type && NON_STOCK_TYPE_RE.test(item.type)) continue;
      const prev = twCompMap.get(sid);
      if (prev) {
        prev.pct += item.pct;
        prev.twPct += item.pct;
        const trimmed = item.name.trim();
        if (trimmed && trimmed.length < prev.name.length) prev.name = trimmed;
      } else {
        twCompMap.set(sid, { sid, name: item.name, pct: item.pct, twPct: item.pct, adrPct: 0 });
      }
      continue;
    }
    const parsed = parseForeignComponent(sid, item.name, item.type, isinLookup);
    if (!parsed) continue;
    const adr = !parsed.isIsin ? resolveTwAdr(parsed.key) : null;
    if (adr) {
      const prev = twCompMap.get(adr.twCode);
      if (prev) {
        prev.pct += item.pct;
        prev.adrPct += item.pct;
        prev.adrCode = adr.adrCode;
        if (adr.twName.length < prev.name.length) prev.name = adr.twName;
      } else {
        twCompMap.set(adr.twCode, {
          sid: adr.twCode,
          name: adr.twName,
          pct: item.pct,
          twPct: 0,
          adrPct: item.pct,
          adrCode: adr.adrCode,
        });
      }
      continue;
    }
    const prev = foreignCompMap.get(parsed.key);
    if (prev) {
      prev.pct += item.pct;
      prev.name = pickForeignStockName(item.name, prev.name, parsed.displayCode);
      if (parsed.classLabel) {
        const prevCls = prev.classMap.get(parsed.rawDisplayCode);
        if (prevCls) prevCls.weight += item.pct;
        else prev.classMap.set(parsed.rawDisplayCode, { code: parsed.rawDisplayCode, label: parsed.classLabel, weight: item.pct });
      }
    } else {
      const classMap = new Map<string, ShareClassPart>();
      if (parsed.classLabel) {
        classMap.set(parsed.rawDisplayCode, { code: parsed.rawDisplayCode, label: parsed.classLabel, weight: item.pct });
      }
      foreignCompMap.set(parsed.key, {
        ...parsed,
        name: pickForeignStockName(item.name, undefined, parsed.displayCode),
        pct: item.pct,
        classMap,
      });
    }
  }

  return {
    twComponents: [...twCompMap.values()],
    foreignComponents: [...foreignCompMap.values()],
  };
}

function twShareClasses(comp: ParsedTwComponent): ShareClassPart[] | undefined {
  if (!comp.adrCode) return undefined;
  const parts: ShareClassPart[] = [];
  if (comp.twPct > 0) parts.push({ code: comp.sid, label: '台股', weight: comp.twPct });
  if (comp.adrPct > 0) parts.push({ code: comp.adrCode, label: `${comp.adrCode} ADR`, weight: comp.adrPct });
  return parts;
}

function foreignShareClasses(comp: ParsedForeignComponent): ShareClassPart[] | undefined {
  if (comp.classMap.size === 0) return undefined;
  return [...comp.classMap.values()].sort(
    (a, b) => shareClassRank(a.label) - shareClassRank(b.label) || a.code.localeCompare(b.code),
  );
}

export interface EtfHoldingRow {
  /** 依合併後佔淨值由大到小排列的名次（1 起算） */
  rank: number;
  /** 合併鍵（台股如 2330；海外對照成功如 AAPL US；無對照為原 ISIN） */
  code: string;
  /** 畫面顯示用簡短代號（台股 2330；海外 AAPL；無對照為原 ISIN） */
  displayCode: string;
  name: string;
  market: StockMarket;
  marketLabel: string;
  /** true 代表海外成分查無 ticker 對照、仍以 ISIN 呈現 */
  isIsin?: boolean;
  /** true 代表此台股列包含台灣公司美國 ADR 併入（例如 TSM→2330） */
  hasAdr?: boolean;
  /** 若含台灣公司 ADR，記錄該 ADR 簡短代號（例如 TSM） */
  adrCode?: string;
  /** 屬多股別合併標的或含台灣 ADR 時，記錄各股別／ADR 與權重 */
  shareClasses?: ShareClassPart[];
  /** 佔該 ETF 淨值（%） */
  pct: number;
  /** 你的約略曝險金額（台幣）＝這筆 ETF 持有市值 × (pct / 100)；缺市值時為 null */
  exposureAmount: number | null;
}

export interface EtfHoldingsView {
  kind: HoldingSourceKind;
  /** 每日／申購清單／美股官網為 YYYY-MM-DD；季報為 YYYYQ#；月報為 YYYY/MM */
  asof: string;
  /** 來源投信（pcf）、公會季報或美股發行商（us） */
  src?: string;
  basis?: FullHoldingBasis;
  usBasis?: UsEtfHoldingBasis;
  denom?: QtyDenom;
  /** 標示資料來源與日期，例如「投信申購買回清單 2026-11-27（全部 50 檔）」或「公會月報 2026/10，第 11 名以後未揭露」 */
  sourceLabel: string;
  /** 依合併後佔淨值由大到小取前 limit 檔（預設 10；傳 'all' 則列出全部） */
  rows: EtfHoldingRow[];
  /** 此 ETF 可展開的股票成分總檔數 */
  totalCount: number;
  /** 上列顯示持股的佔淨值合計（%） */
  shownPct: number;
  /** 上列顯示持股的約略曝險金額合計（台幣）；缺市值時為 null */
  shownAmount: number | null;
}

export type EtfHoldingsResult =
  | { status: 'ready'; view: EtfHoldingsView }
  | { status: 'empty'; reason: string };

export interface EtfTopHoldingsInput {
  code: string;
  /** ETF 所屬分區（cat-domestic / cat-foreign / cat-bond / cat-leveraged…） */
  sec?: Etf['sec'];
  /** true 代表查詢美股掛牌 ETF（從 usHoldings 讀取，不查台股投信／公會資料） */
  isUs?: boolean;
  /** 選填：美股 ETF 名稱（用於辨識商品 ETF 等無股票成分原因） */
  name?: string;
  /** 使用者持有這筆 ETF 的市值（台幣）；缺收盤價或 <= 0 時傳 null */
  holdingValue: number | null;
  top10: Top10Data | null;
  active: ActiveData | null;
  /** 選填：被動式 ETF 全部持股（投信每日申購買回清單＋公會季報 1% 以上） */
  full?: FullHoldingsData | null;
  /** 選填：美股 ETF 官網成分股（us_etf_holdings.json） */
  usHoldings?: UsEtfHoldingsData | null;
  /** 選填：提供時台股成分優先採用官方簡稱（同持股健檢） */
  stockDivs?: StockDividendData | null;
  /** 選填：執行時載入的海外 ISIN →「代號 交易所」對照（isin_ticker.json），與內建 isinTicker.ts 合併 */
  isinMap?: IsinTickerData | Readonly<Record<string, string>> | null;
  /** 最多列出前幾名，預設 10；傳 'all' 列出全部成分股 */
  limit?: number | 'all';
}

/**
 * 整理單一台灣或美股掛牌 ETF 的持股明細與約略曝險金額（配息試算「各檔明細」展開用）。
 *
 * 共用 holdingsOf()／usHoldingsOf() 與持股健檢的成分解析（市場小標籤、台灣 ADR 併回台股、
 * 同公司多股別合併、排除期貨與債券／連結型 ETF），曝險金額＝這筆 ETF 持有市值 × 佔淨值%。
 */
export function etfTopHoldings(input: EtfTopHoldingsInput): EtfHoldingsResult {
  let hs: HoldingSet | null;
  if (input.isUs) {
    if (isUsCommodityEtf(input.code, input.name)) {
      return { status: 'empty', reason: '商品 ETF 主要持有實物黃金或商品期貨，無股票持股明細。' };
    }
    if (!input.usHoldings) {
      return { status: 'empty', reason: '美股 ETF 持股明細資料暫時讀不到。' };
    }
    hs = usHoldingsOf(input.code, input.usHoldings);
    if (!hs) {
      const supported = Object.keys(input.usHoldings.etfs).sort();
      const hint = supported.length > 0 ? `（目前已收錄 ${supported.join('、')}）` : '';
      return { status: 'empty', reason: `站內尚無這檔美股 ETF 的持股明細${hint}。` };
    }
  } else {
    if (input.sec === 'cat-bond') {
      return { status: 'empty', reason: '債券 ETF 主要持有公債或公司債，無股票持股明細。' };
    }
    if (isDerivativeSec(input.sec)) {
      return { status: 'empty', reason: '槓桿／反向與期貨 ETF 主要持有期貨與現金，無股票持股明細。' };
    }
    if (!input.top10 && !input.active && !input.full) {
      return { status: 'empty', reason: '持股明細資料暫時讀不到。' };
    }
    hs = holdingsOf(input.code, input.top10, input.active, input.full ?? null);
    if (!hs) {
      return { status: 'empty', reason: '查無這檔 ETF 的持股明細（可能為新上市、不動產或平衡型 ETF）。' };
    }
  }

  const isinLookup = resolveIsinTickerMap(input.isinMap);
  const { twComponents, foreignComponents } = splitEtfComponents(hs, isinLookup);
  if (twComponents.length === 0 && foreignComponents.length === 0) {
    return { status: 'empty', reason: '這檔 ETF 的明細不含股票成分（可能為債券、期貨或連結型 ETF），無股票持股明細。' };
  }

  const validValue = input.holdingValue !== null && Number.isFinite(input.holdingValue) && input.holdingValue > 0
    ? input.holdingValue
    : null;
  const stockDivs = input.stockDivs ?? null;
  const all: Omit<EtfHoldingRow, 'rank'>[] = [];

  for (const comp of twComponents) {
    const shareClasses = twShareClasses(comp);
    all.push({
      code: comp.sid,
      displayCode: comp.sid,
      name: pickStockName(comp.sid, comp.name, undefined, stockDivs),
      market: 'tw',
      marketLabel: '台股',
      ...(comp.adrCode ? { hasAdr: true, adrCode: comp.adrCode } : {}),
      ...(shareClasses ? { shareClasses } : {}),
      pct: comp.pct,
      exposureAmount: validValue !== null ? validValue * (comp.pct / 100) : null,
    });
  }

  for (const comp of foreignComponents) {
    const shareClasses = foreignShareClasses(comp);
    all.push({
      code: comp.key,
      displayCode: comp.displayCode,
      name: comp.name,
      market: 'foreign',
      marketLabel: comp.marketLabel,
      ...(comp.isIsin ? { isIsin: true } : {}),
      ...(shareClasses ? { shareClasses } : {}),
      pct: comp.pct,
      exposureAmount: validValue !== null ? validValue * (comp.pct / 100) : null,
    });
  }

  all.sort((a, b) => b.pct - a.pct || a.code.localeCompare(b.code));
  const slice = input.limit === 'all'
    ? all
    : all.slice(
      0,
      input.limit !== undefined && Number.isFinite(input.limit) ? Math.max(1, Math.floor(input.limit)) : 10,
    );
  const rows: EtfHoldingRow[] = slice.map((r, i) => ({ rank: i + 1, ...r }));
  const shownPct = rows.reduce((s, r) => s + r.pct, 0);
  const shownAmount = validValue !== null
    ? rows.reduce((s, r) => s + (r.exposureAmount ?? 0), 0)
    : null;

  let sourceLabel: string;
  if (hs.kind === 'daily') {
    sourceLabel = hs.asof ? `主動式每日持股 ${hs.asof}` : '主動式每日持股';
  } else if (hs.kind === 'pcf') {
    const qtyNote = hs.basis === 'qty'
      ? (hs.denom === 'stock' ? '，股數換算、股票部位合計 100%' : '，股數×收盤價換算')
      : '';
    sourceLabel = `投信申購買回清單${hs.asof ? ` ${hs.asof}` : ''}（全部 ${all.length} 檔${qtyNote}）`;
  } else if (hs.kind === 'quarterly') {
    sourceLabel = `公會季報${hs.asof ? ` ${hs.asof}` : ''}（持股 1% 以上，共 ${all.length} 檔）`;
  } else if (hs.kind === 'us') {
    sourceLabel = formatUsHoldingsSource(hs.src ?? '官網', hs.asof, hs.usBasis ?? 'full', all.length);
  } else {
    sourceLabel = hs.asof ? `公會月報 ${hs.asof}，第 11 名以後未揭露` : '公會月報，第 11 名以後未揭露';
  }

  return {
    status: 'ready',
    view: {
      kind: hs.kind,
      asof: hs.asof,
      ...(hs.src ? { src: hs.src } : {}),
      ...(hs.basis ? { basis: hs.basis } : {}),
      ...(hs.usBasis ? { usBasis: hs.usBasis } : {}),
      ...(hs.denom ? { denom: hs.denom } : {}),
      sourceLabel,
      rows,
      totalCount: all.length,
      shownPct,
      shownAmount,
    },
  };
}

/**
 * 執行持股穿透計算。
 *
 * 口徑說明：
 * - 所有已取得最新收盤價的持股（含債券／美股／海外 ETF）均計入總市值分母，
 *   單一個股佔比＝（直接持股市值 ＋ Σ 各 ETF 市值 × 該股佔 ETF 淨值% ）÷ 投組總市值。
 * - 台股 ETF、海外 ETF 與跨市場主動式 ETF 皆展開台股與海外股票成分；公會月報／季報的海外 ISIN 透過
 *   內建 ISIN_TICKER 與執行時載入的 isin_ticker.json 合併對照轉成「代號 交易所」與主動式持股合併，再經 SHARE_CLASS_ALIAS 將同公司不同股別
 *   （如 GOOG／GOOGL、BRK.A／BRK.B、005935／005930）合併至代表鍵並保留來源股別明細，查無對照時仍以 ISIN 保留。
 * - 台灣公司的美國 ADR（TW_ADR_TO_TW：TSM→2330、UMC→2303、ASX→3711、CHT→2412）一律併回對應台股列，
 *   套用於月報 ISIN、主動式每日持股與直接持有美股個股，金額歸入台股類別並保留 ADR 來源標示（市值曝險不受 ADR 換算股數影響）。
 * - 其餘直接持有的美股個股（m='us' 且 k='stock'）計入海外個股曝險之直接持有（鍵「CODE US」並套用股別合併），
 *   與 ETF 穿透之同一家公司合併；美股掛牌商品 ETF（黃金、白銀、原油等）另歸為「商品」，其餘美股 ETF 維持無法穿透。
 * - 債券 ETF（cat-bond）、非商品美股掛牌 ETF、槓桿／反向／期貨 ETF 及無股票明細者無法穿透。
 * - 主動式 ETF 的期貨部位（含 TX／WTX 等）與公會月報的債券／國外掛牌 ETF 不計為個股曝險。
 */
export function buildPortfolioXray(input: PortfolioXrayInput): PortfolioXrayResult {
  const merged = mergeByCode(input.holdings);
  const etfMap = new Map(input.etfs.map(e => [e.code, e] as const));
  const isinLookup = resolveIsinTickerMap(input.isinMap);

  interface ResolvedHolding {
    code: string;
    name: string;
    kind: HoldingKind;
    shares: number;
    price: number | null;
    value: number | null;
    etfMeta: Etf | undefined;
  }

  const resolved: ResolvedHolding[] = [];
  const unpriced: UnpricedHolding[] = [];

  for (const h of merged) {
    if (!(h.shares > 0)) continue;
    if (h.m === 'us') {
      const isStock = h.k === 'stock';
      const kind: HoldingKind = isStock ? 'us-stock' : 'us';
      const name = isStock
        ? (input.usStockNames?.get(h.code) ?? input.usNames?.get(h.code) ?? h.code)
        : (input.usNames?.get(h.code) ?? h.code);
      const price = input.usPricesTwd?.get(h.code) ?? null;
      const validPrice = price !== null && Number.isFinite(price) && price > 0 ? price : null;
      const value = validPrice !== null ? validPrice * h.shares : null;
      if (value === null) {
        unpriced.push({ code: h.code, name, kind, shares: h.shares, reason: '美股報價或匯率暫時讀不到' });
      }
      resolved.push({ code: h.code, name, kind, shares: h.shares, price: validPrice, value, etfMeta: undefined });
      continue;
    }

    const etfMeta = etfMap.get(h.code);
    const isEtf = Boolean(etfMeta) || ETF_CODE_RE.test(h.code);
    if (isEtf) {
      const name = etfMeta?.name ?? input.active?.etfs[h.code]?.name ?? h.code;
      const rawPx = input.yields?.yields[h.code]?.price ?? null;
      const validPrice = rawPx !== null && Number.isFinite(rawPx) && rawPx > 0 ? rawPx : null;
      const value = validPrice !== null ? validPrice * h.shares : null;
      if (value === null) {
        unpriced.push({ code: h.code, name, kind: 'etf', shares: h.shares, reason: '收盤價暫時讀不到' });
      }
      resolved.push({ code: h.code, name, kind: 'etf', shares: h.shares, price: validPrice, value, etfMeta });
    } else {
      const stockInfo = input.stockDivs?.stocks[h.code];
      const name = stockInfo?.n ?? h.code;
      const rawPx = stockInfo?.c
        ?? input.yields?.yields[h.code]?.price
        ?? input.active?.last?.px[h.code]
        ?? null;
      const validPrice = rawPx !== null && Number.isFinite(rawPx) && rawPx > 0 ? rawPx : null;
      const value = validPrice !== null ? validPrice * h.shares : null;
      if (value === null) {
        unpriced.push({ code: h.code, name, kind: 'stock', shares: h.shares, reason: '收盤價暫時讀不到' });
      }
      resolved.push({ code: h.code, name, kind: 'stock', shares: h.shares, price: validPrice, value, etfMeta: undefined });
    }
  }

  const totalValue = resolved.reduce((s, r) => s + (r.value ?? 0), 0);
  const pricedCount = resolved.filter(r => r.value !== null).length;

  let directStockValue = 0;
  let penetratedEtfValue = 0;
  let foreignStockValue = 0;
  let commodityValue = 0;
  let unrevealedEtfValue = 0;
  let unpenetrableValue = 0;

  const dailyDateSet = new Set<string>();
  const pcfDateSet = new Set<string>();
  const usDateSet = new Set<string>();
  let quarterlyAsof: string | null = null;
  let monthlyAsof: string | null = null;
  let hasUsTop25 = false;
  let hasQtyStockOnly = false;
  let directStockCount = 0;

  interface AccExposure {
    code: string;
    displayCode: string;
    name: string;
    market: StockMarket;
    marketLabel: string;
    isIsin: boolean;
    hasAdr: boolean;
    amount: number;
    directAmount: number;
    etfAmount: number;
    isDirect: boolean;
    fromMonthly: boolean;
    sources: ExposureSource[];
  }
  const expMap = new Map<string, AccExposure>();
  const breakdown: HoldingBreakdownRow[] = [];
  const directWeights = new Map<string, { name: string; kind: HoldingKind; pct: number }>();

  const addExposure = (
    stockCode: string,
    rawName: string,
    source: ExposureSource,
    meta: { displayCode: string; market: StockMarket; marketLabel: string; isIsin: boolean },
  ) => {
    const prev = expMap.get(stockCode);
    const name = meta.market === 'tw'
      ? pickStockName(stockCode, rawName, prev?.name, input.stockDivs)
      : pickForeignStockName(rawName, prev?.name, meta.displayCode);
    if (!prev) {
      expMap.set(stockCode, {
        code: stockCode,
        displayCode: meta.displayCode,
        name,
        market: meta.market,
        marketLabel: meta.marketLabel,
        isIsin: meta.isIsin,
        hasAdr: Boolean(source.adrCode),
        amount: source.amount,
        directAmount: source.kind === 'direct' ? source.amount : 0,
        etfAmount: source.kind === 'direct' ? 0 : source.amount,
        isDirect: source.kind === 'direct',
        fromMonthly: source.kind === 'monthly',
        sources: [source],
      });
    } else {
      prev.name = name;
      if (prev.isIsin && !meta.isIsin) {
        prev.displayCode = meta.displayCode;
        prev.marketLabel = meta.marketLabel;
        prev.isIsin = false;
      }
      if (source.adrCode) prev.hasAdr = true;
      prev.amount += source.amount;
      if (source.kind === 'direct') {
        prev.directAmount += source.amount;
        prev.isDirect = true;
      } else {
        prev.etfAmount += source.amount;
        if (source.kind === 'monthly') prev.fromMonthly = true;
      }
      prev.sources.push(source);
    }
  };

  for (const r of resolved) {
    const pctOfPortfolio = totalValue > 0 && r.value !== null ? (r.value / totalValue) * 100 : 0;
    if (r.kind !== 'us' && r.kind !== 'us-stock') {
      directWeights.set(r.code, { name: r.name, kind: r.kind, pct: pctOfPortfolio });
    }

    if (r.kind === 'us-stock') {
      directStockCount += 1;
      const norm = normalizeForeignTicker(r.code, 'US') ?? {
        key: `${r.code} US`,
        displayCode: r.code,
        rawDisplayCode: r.code,
        classLabel: undefined,
        marketLabel: '美股',
      };
      const adr = resolveTwAdr(norm.key);
      if (adr) {
        // 台灣公司的美國 ADR 併回台股列計算；金額已是台幣市值，不受 ADR 與普通股換算股數影響
        if (r.value !== null) {
          directStockValue += r.value;
          addExposure(
            adr.twCode,
            adr.twName,
            {
              code: r.code,
              name: r.name,
              kind: 'direct',
              weightInSource: 100,
              amount: r.value,
              pctOfPortfolio,
              asof: null,
              adrCode: adr.adrCode,
              shareClasses: [{ code: adr.adrCode, label: `${adr.adrCode} ADR`, weight: 100 }],
            },
            {
              displayCode: adr.twCode,
              market: 'tw',
              marketLabel: '台股',
              isIsin: false,
            },
          );
        }
        breakdown.push({
          code: r.code,
          name: r.name,
          kind: 'us-stock',
          shares: r.shares,
          price: r.price,
          value: r.value,
          pctOfPortfolio,
          status: 'direct',
          asof: null,
          coveredPct: 100,
          stockCount: 1,
          twStockCount: 1,
          foreignStockCount: 0,
          note: `美股 ADR（直接持有，併入台股 ${adr.twCode}）`,
        });
        continue;
      }

      const rawUsName = input.usStockNames?.get(r.code) ?? input.usNames?.get(r.code) ?? '';
      if (r.value !== null) {
        foreignStockValue += r.value;
        addExposure(
          norm.key,
          rawUsName,
          {
            code: r.code,
            name: r.name,
            kind: 'direct',
            weightInSource: 100,
            amount: r.value,
            pctOfPortfolio,
            asof: null,
            ...(norm.classLabel
              ? { shareClasses: [{ code: norm.rawDisplayCode, label: norm.classLabel, weight: 100 }] }
              : {}),
          },
          {
            displayCode: norm.displayCode,
            market: 'foreign',
            marketLabel: norm.marketLabel,
            isIsin: false,
          },
        );
      }
      breakdown.push({
        code: r.code,
        name: r.name,
        kind: 'us-stock',
        shares: r.shares,
        price: r.price,
        value: r.value,
        pctOfPortfolio,
        status: 'direct',
        asof: null,
        coveredPct: 100,
        stockCount: 1,
        twStockCount: 0,
        foreignStockCount: 1,
        note: '美股個股（直接持有）',
      });
      continue;
    }

    if (r.kind === 'us') {
      if (isUsCommodityEtf(r.code, r.name)) {
        if (r.value !== null) commodityValue += r.value;
        breakdown.push({
          code: r.code, name: r.name, kind: 'us', shares: r.shares, price: r.price, value: r.value,
          pctOfPortfolio, status: 'unpenetrable', asof: null, coveredPct: 0, stockCount: 0,
          note: '商品 ETF（持有實物黃金／商品期貨，沒有個股）', unpenetrableKind: 'commodity',
        });
        continue;
      }
      const hs = usHoldingsOf(r.code, input.usHoldings);
      if (!hs) {
        if (r.value !== null) unpenetrableValue += r.value;
        breakdown.push({
          code: r.code, name: r.name, kind: 'us', shares: r.shares, price: r.price, value: r.value,
          pctOfPortfolio, status: 'unpenetrable', asof: null, coveredPct: 0, stockCount: 0,
          note: '美股 ETF（站內無成分股資料，無法穿透）', unpenetrableKind: 'us',
        });
        continue;
      }

      const { twComponents, foreignComponents } = splitEtfComponents(hs, isinLookup);
      if (twComponents.length === 0 && foreignComponents.length === 0) {
        if (r.value !== null) unpenetrableValue += r.value;
        breakdown.push({
          code: r.code, name: r.name, kind: 'us', shares: r.shares, price: r.price, value: r.value,
          pctOfPortfolio, status: 'unpenetrable', asof: hs.asof || null, coveredPct: 0, stockCount: 0,
          note: '美股 ETF（明細中無可展開股票成分，無法穿透）', unpenetrableKind: 'us',
        });
        continue;
      }

      const stockCount = twComponents.length + foreignComponents.length;
      const coveredPct =
        twComponents.reduce((s, c) => s + c.pct, 0)
        + foreignComponents.reduce((s, c) => s + c.pct, 0);
      if (hs.asof) usDateSet.add(hs.asof);
      if (hs.usBasis === 'top25') hasUsTop25 = true;

      if (r.value !== null) {
        let etfTwPenetrated = 0;
        for (const comp of twComponents) {
          const amt = r.value * (comp.pct / 100);
          etfTwPenetrated += amt;
          const shareClasses = twShareClasses(comp);
          addExposure(
            comp.sid,
            comp.name,
            {
              code: r.code,
              name: r.name,
              kind: 'us',
              weightInSource: comp.pct,
              amount: amt,
              pctOfPortfolio: totalValue > 0 ? (amt / totalValue) * 100 : 0,
              asof: hs.asof || null,
              ...(hs.src ? { src: hs.src } : {}),
              ...(hs.usBasis ? { usBasis: hs.usBasis } : {}),
              sourceCount: stockCount,
              ...(comp.adrCode ? { adrCode: comp.adrCode } : {}),
              ...(shareClasses ? { shareClasses } : {}),
            },
            { displayCode: comp.sid, market: 'tw', marketLabel: '台股', isIsin: false },
          );
        }

        let etfForeignPenetrated = 0;
        for (const comp of foreignComponents) {
          const amt = r.value * (comp.pct / 100);
          etfForeignPenetrated += amt;
          const shareClasses = foreignShareClasses(comp);
          addExposure(
            comp.key,
            comp.name,
            {
              code: r.code,
              name: r.name,
              kind: 'us',
              weightInSource: comp.pct,
              amount: amt,
              pctOfPortfolio: totalValue > 0 ? (amt / totalValue) * 100 : 0,
              asof: hs.asof || null,
              ...(hs.src ? { src: hs.src } : {}),
              ...(hs.usBasis ? { usBasis: hs.usBasis } : {}),
              sourceCount: stockCount,
              ...(shareClasses ? { shareClasses } : {}),
            },
            {
              displayCode: comp.displayCode,
              market: 'foreign',
              marketLabel: comp.marketLabel,
              isIsin: comp.isIsin,
            },
          );
        }

        penetratedEtfValue += etfTwPenetrated;
        foreignStockValue += etfForeignPenetrated;
        unrevealedEtfValue += Math.max(0, r.value - etfTwPenetrated - etfForeignPenetrated);
      }

      const hasTwAdr = twComponents.some(c => c.adrPct > 0);
      const srcLabel = formatUsHoldingsSource(hs.src ?? '官網', hs.asof, hs.usBasis ?? 'full', stockCount);
      breakdown.push({
        code: r.code,
        name: r.name,
        kind: 'us',
        shares: r.shares,
        price: r.price,
        value: r.value,
        pctOfPortfolio,
        status: 'us',
        asof: hs.asof || null,
        ...(hs.src ? { src: hs.src } : {}),
        ...(hs.usBasis ? { usBasis: hs.usBasis } : {}),
        coveredPct,
        stockCount,
        twStockCount: twComponents.length,
        foreignStockCount: foreignComponents.length,
        note: hasTwAdr ? `${srcLabel}・含台灣 ADR 併入台股` : srcLabel,
      });
      continue;
    }

    if (r.kind === 'stock') {
      directStockCount += 1;
      if (r.value !== null) {
        directStockValue += r.value;
        addExposure(
          r.code,
          r.name,
          {
            code: r.code, name: r.name, kind: 'direct', weightInSource: 100,
            amount: r.value, pctOfPortfolio, asof: null,
          },
          { displayCode: r.code, market: 'tw', marketLabel: '台股', isIsin: false },
        );
      }
      breakdown.push({
        code: r.code, name: r.name, kind: 'stock', shares: r.shares, price: r.price, value: r.value,
        pctOfPortfolio, status: 'direct', asof: null, coveredPct: 100, stockCount: 1, twStockCount: 1, foreignStockCount: 0, note: null,
      });
      continue;
    }

    // 台灣掛牌 ETF：先排除債券與槓反／期貨，再透過既有 holdingsOf() 展開台股與海外股票成分
    const sec = r.etfMeta?.sec;
    if (sec === 'cat-bond') {
      if (r.value !== null) unpenetrableValue += r.value;
      breakdown.push({
        code: r.code, name: r.name, kind: 'etf', shares: r.shares, price: r.price, value: r.value,
        pctOfPortfolio, status: 'unpenetrable', asof: null, coveredPct: 0, stockCount: 0,
        note: '債券 ETF（持有公債／公司債，無法穿透至股票）', unpenetrableKind: 'bond',
      });
      continue;
    }

    if (isDerivativeSec(sec)) {
      if (r.value !== null) unpenetrableValue += r.value;
      breakdown.push({
        code: r.code, name: r.name, kind: 'etf', shares: r.shares, price: r.price, value: r.value,
        pctOfPortfolio, status: 'unpenetrable', asof: null, coveredPct: 0, stockCount: 0,
        note: '槓桿／反向／期貨 ETF（主要持有期貨與現金，無法穿透）', unpenetrableKind: 'derivative',
      });
      continue;
    }

    const hs = holdingsOf(r.code, input.top10, input.active, input.full ?? null);
    if (!hs) {
      if (r.value !== null) unpenetrableValue += r.value;
      const isForeign = sec === 'cat-foreign';
      breakdown.push({
        code: r.code, name: r.name, kind: 'etf', shares: r.shares, price: r.price, value: r.value,
        pctOfPortfolio, status: 'unpenetrable', asof: null, coveredPct: 0, stockCount: 0,
        note: isForeign
          ? '海外 ETF（尚無持股明細，無法穿透）'
          : '尚無持股明細（新上市、不動產或平衡型 ETF）',
        unpenetrableKind: isForeign ? 'foreign' : 'missing',
      });
      continue;
    }

    // 分流展開台股普通股（另併入台灣公司美國 ADR）與海外股票（排除期貨 TX／WTX、債券 ISIN 與國外掛牌 ETF）
    const { twComponents, foreignComponents } = splitEtfComponents(hs, isinLookup);

    if (twComponents.length === 0 && foreignComponents.length === 0) {
      if (r.value !== null) unpenetrableValue += r.value;
      breakdown.push({
        code: r.code, name: r.name, kind: 'etf', shares: r.shares, price: r.price, value: r.value,
        pctOfPortfolio, status: 'unpenetrable', asof: hs.asof, coveredPct: 0, stockCount: 0,
        note: sec === 'cat-foreign'
          ? '海外 ETF（明細中無可展開股票成分，無法穿透）'
          : '明細中無可展開股票成分，無法穿透',
        unpenetrableKind: sec === 'cat-foreign' ? 'foreign' : 'missing',
      });
      continue;
    }

    const coveredPct =
      twComponents.reduce((s, c) => s + c.pct, 0)
      + foreignComponents.reduce((s, c) => s + c.pct, 0);
    if (hs.kind === 'daily') {
      dailyDateSet.add(hs.asof);
    } else if (hs.kind === 'pcf') {
      if (hs.asof) pcfDateSet.add(hs.asof);
      if (hs.basis === 'qty' && hs.denom === 'stock') hasQtyStockOnly = true;
    } else if (hs.kind === 'quarterly') {
      quarterlyAsof = hs.asof;
    } else {
      monthlyAsof = hs.asof;
    }

    if (r.value !== null) {
      let etfTwPenetrated = 0;
      for (const comp of twComponents) {
        const amt = r.value * (comp.pct / 100);
        etfTwPenetrated += amt;
        const shareClasses = twShareClasses(comp);
        addExposure(
          comp.sid,
          comp.name,
          {
            code: r.code,
            name: r.name,
            kind: hs.kind,
            weightInSource: comp.pct,
            amount: amt,
            pctOfPortfolio: totalValue > 0 ? (amt / totalValue) * 100 : 0,
            asof: hs.asof,
            ...(hs.basis ? { basis: hs.basis } : {}),
            ...(hs.denom ? { denom: hs.denom } : {}),
            ...(comp.adrCode ? { adrCode: comp.adrCode } : {}),
            ...(shareClasses ? { shareClasses } : {}),
          },
          { displayCode: comp.sid, market: 'tw', marketLabel: '台股', isIsin: false },
        );
      }

      let etfForeignPenetrated = 0;
      for (const comp of foreignComponents) {
        const amt = r.value * (comp.pct / 100);
        etfForeignPenetrated += amt;
        const shareClasses = foreignShareClasses(comp);
        addExposure(
          comp.key,
          comp.name,
          {
            code: r.code,
            name: r.name,
            kind: hs.kind,
            weightInSource: comp.pct,
            amount: amt,
            pctOfPortfolio: totalValue > 0 ? (amt / totalValue) * 100 : 0,
            asof: hs.asof,
            ...(hs.basis ? { basis: hs.basis } : {}),
            ...(hs.denom ? { denom: hs.denom } : {}),
            ...(shareClasses ? { shareClasses } : {}),
          },
          {
            displayCode: comp.displayCode,
            market: 'foreign',
            marketLabel: comp.marketLabel,
            isIsin: comp.isIsin,
          },
        );
      }

      penetratedEtfValue += etfTwPenetrated;
      foreignStockValue += etfForeignPenetrated;
      unrevealedEtfValue += Math.max(0, r.value - etfTwPenetrated - etfForeignPenetrated);
    }

    const hasTwDirect = twComponents.some(c => c.twPct > 0);
    const hasTwAdr = twComponents.some(c => c.adrPct > 0);
    const hasForeign = foreignComponents.length > 0;
    const qtyNote = hs.kind === 'pcf' && hs.basis === 'qty'
      ? (hs.denom === 'stock' ? '・股數換算，以股票部位合計為 100%' : '・股數×收盤價換算')
      : '';
    let note: string | null = null;
    if (hasTwDirect && hasForeign) {
      note = hs.kind === 'daily'
        ? '跨市場 ETF，台股與海外成分皆已展開（每日持股）'
        : hs.kind === 'pcf'
          ? `跨市場 ETF，台股與海外成分皆已展開（投信申購買回清單${qtyNote}）`
          : hs.kind === 'quarterly'
            ? '跨市場 ETF，台股與海外成分皆已展開（公會季報持股 1% 以上）'
            : '跨市場 ETF，台股與海外成分皆已展開（月報前十大，第 11 名以後未揭露）';
    } else if (hasForeign || (!hasTwDirect && hasTwAdr)) {
      if (hs.kind === 'monthly') {
        note = hasTwAdr
          ? '海外 ETF，已展開月報前十大（含台灣 ADR 併入台股，第 11 名以後未揭露）'
          : '海外 ETF，已展開月報前十大（第 11 名以後未揭露）';
      } else if (hs.kind === 'quarterly') {
        note = hasTwAdr
          ? '海外 ETF，已展開公會季報持股 1% 以上（含台灣 ADR 併入台股）'
          : '海外 ETF，已展開公會季報持股 1% 以上';
      } else if (hs.kind === 'pcf') {
        note = hasTwAdr
          ? `海外 ETF，已展開投信申購買回清單（含台灣 ADR 併入台股${qtyNote}）`
          : `海外 ETF，已展開投信申購買回清單${qtyNote ? `（${qtyNote.slice(1)}）` : ''}`;
      } else {
        note = hasTwAdr
          ? '海外 ETF，已展開每日完整持股（含台灣 ADR 併入台股）'
          : '海外 ETF，已展開每日完整持股';
      }
    } else if (sec === 'cat-foreign') {
      const kindTag = hs.kind === 'daily'
        ? '每日持股'
        : hs.kind === 'pcf'
          ? `投信申購買回清單${qtyNote}`
          : hs.kind === 'quarterly'
            ? '公會季報持股 1% 以上'
            : '月報前十大';
      note = `跨市場 ETF，已展開台股成分（${kindTag}）`;
    } else if (hs.kind === 'monthly') {
      note = '公會月報前十大（已知下限，第 11 名以後未揭露）';
    } else if (hs.kind === 'quarterly') {
      note = '公會季報持股 1% 以上（未滿 1% 未揭露）';
    } else if (hs.kind === 'pcf' && hs.basis === 'qty') {
      note = hs.denom === 'stock'
        ? '投信申購買回清單（股數換算，以股票部位合計為 100%）'
        : '投信申購買回清單（股數×收盤價換算）';
    }

    breakdown.push({
      code: r.code,
      name: r.name,
      kind: 'etf',
      shares: r.shares,
      price: r.price,
      value: r.value,
      pctOfPortfolio,
      status: hs.kind,
      asof: hs.asof,
      ...(hs.src ? { src: hs.src } : {}),
      ...(hs.basis ? { basis: hs.basis } : {}),
      ...(hs.denom ? { denom: hs.denom } : {}),
      coveredPct,
      stockCount: twComponents.length + foreignComponents.length,
      twStockCount: twComponents.length,
      foreignStockCount: foreignComponents.length,
      note,
    });
  }

  const exposures: ExposureRow[] = [...expMap.values()]
    .map(e => {
      e.sources.sort((a, b) => b.amount - a.amount);
      return {
        code: e.code,
        displayCode: e.displayCode,
        name: e.name,
        market: e.market,
        marketLabel: e.marketLabel,
        ...(e.isIsin ? { isIsin: true } : {}),
        ...(e.hasAdr ? { hasAdr: true } : {}),
        amount: e.amount,
        pct: totalValue > 0 ? (e.amount / totalValue) * 100 : 0,
        directAmount: e.directAmount,
        directPct: totalValue > 0 ? (e.directAmount / totalValue) * 100 : 0,
        etfAmount: e.etfAmount,
        etfPct: totalValue > 0 ? (e.etfAmount / totalValue) * 100 : 0,
        isDirect: e.isDirect,
        fromMonthly: e.fromMonthly,
        sources: e.sources,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code));

  breakdown.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.code.localeCompare(b.code));

  const pctOf = (v: number) => (totalValue > 0 ? (v / totalValue) * 100 : 0);
  const directStockPct = pctOf(directStockValue);
  const penetratedEtfPct = pctOf(penetratedEtfValue);
  const foreignStockPct = pctOf(foreignStockValue);
  const commodityPct = pctOf(commodityValue);
  const unrevealedEtfPct = pctOf(unrevealedEtfValue);
  const unpenetrablePct = pctOf(unpenetrableValue);
  const top5Pct = exposures.slice(0, 5).reduce((s, e) => s + e.pct, 0);
  const dailyDates = [...dailyDateSet].sort();
  const pcfDates = [...pcfDateSet].sort();
  const usDates = [...usDateSet].sort();
  const allDailyDates = new Set([...dailyDates, ...pcfDates, ...usDates]);
  const hasLowerBound = monthlyAsof !== null;
  const hasOlderPeriod = monthlyAsof !== null || quarterlyAsof !== null;
  const hasDateMismatch = (allDailyDates.size > 0 && hasOlderPeriod)
    || allDailyDates.size > 1
    || (monthlyAsof !== null && quarterlyAsof !== null)
    || (hasOlderPeriod && directStockCount > 0);

  return {
    holdingCount: resolved.length,
    pricedCount,
    totalValue,
    directStockValue,
    directStockPct,
    penetratedEtfValue,
    penetratedEtfPct,
    foreignStockValue,
    foreignStockPct,
    commodityValue,
    commodityPct,
    unrevealedEtfValue,
    unrevealedEtfPct,
    unpenetrableValue,
    unpenetrablePct,
    knownTwPct: directStockPct + penetratedEtfPct,
    top5Pct,
    hasLowerBound,
    dailyDates,
    pcfDates,
    quarterlyAsof,
    monthlyAsof,
    usDates,
    hasUsTop25,
    hasQtyStockOnly,
    hasDateMismatch,
    exposures,
    breakdown,
    unpriced,
    directWeights,
  };
}

/* ── 風險與事件健檢（低維持率／可轉債轉換賣壓／未來 14 天行程／近期重大訊息） ── */

export type HealthFilterMode = 'major' | 'direct' | 'all';

export function matchesHealthFilter(
  item: { isDirect: boolean; exposurePct: number },
  mode: HealthFilterMode,
  minPct = MINOR_EXPOSURE_PCT,
): boolean {
  if (mode === 'direct') return item.isDirect;
  if (mode === 'major') return item.isDirect || item.exposurePct >= minPct;
  return true;
}

/* 1. 個股融資維持率警戒（margin_state.json） */

export type MarginLevel = 'danger' | 'watch' | 'normal';

export interface MarginAlertRow {
  code: string;
  name: string;
  /** 融資維持率（%，XQ 平均成本推算） */
  maint: number;
  level: MarginLevel;
  isDirect: boolean;
  exposurePct: number;
  viaEtfs: string[];
}

export interface MarginCheckResult {
  available: boolean;
  date: string | null;
  /** 所有有融資維持率資料的關聯個股（由低到高排） */
  all: MarginAlertRow[];
  /** 低於警戒門檻（預設 < 150%）的標的 */
  flagged: MarginAlertRow[];
  below130Count: number;
  below150Count: number;
  lowest: MarginAlertRow | null;
}

export function checkPortfolioMargin(
  xray: PortfolioXrayResult,
  margin: MarginStateLite | null,
  threshold = 150,
): MarginCheckResult {
  if (!margin || !margin.m) {
    return { available: false, date: null, all: [], flagged: [], below130Count: 0, below150Count: 0, lowest: null };
  }
  const all: MarginAlertRow[] = [];
  for (const e of xray.exposures) {
    // 融資維持率僅適用台股，避免海外代號（例如 6857 JP）誤配
    if (e.market !== 'tw') continue;
    const v = margin.m[e.code];
    if (v === undefined || !Number.isFinite(v)) continue;
    const level: MarginLevel = v < 130 ? 'danger' : v < 150 ? 'watch' : 'normal';
    all.push({
      code: e.code,
      name: e.name,
      maint: v,
      level,
      isDirect: e.isDirect,
      exposurePct: e.pct,
      viaEtfs: e.sources.filter(s => s.kind !== 'direct').map(s => s.code),
    });
  }
  all.sort((a, b) => a.maint - b.maint || b.exposurePct - a.exposurePct || a.code.localeCompare(b.code));
  const flagged = all.filter(r => r.maint < threshold);
  return {
    available: true,
    date: margin.d || null,
    all,
    flagged,
    below130Count: all.filter(r => r.maint < 130).length,
    below150Count: all.filter(r => r.maint < 150).length,
    lowest: all[0] ?? null,
  };
}

/* 2. 可轉債轉換賣壓（cb.json；嚴格排除交換債 exch: true） */

export type CbPressureLevel = 0 | 1 | 2;

export interface CbPressureRow {
  bond: CbBond;
  stockCode: string;
  stockName: string;
  isDirect: boolean;
  exposurePct: number;
  viaEtfs: string[];
  /** 2＝顯著轉換中或強制贖回；1＝已可轉換且價內／負溢價／近月有轉換；0＝一般掛牌 */
  pressureLevel: CbPressureLevel;
  /** 近一月餘額減少佔原始發行比例（%） */
  conv1Pct: number | null;
  /** 剩餘餘額佔原始發行比例（%） */
  remainPct: number | null;
  isConvertible: boolean;
  reasons: string[];
}

export interface CbUpcomingHit {
  item: CbUpcoming;
  isDirect: boolean;
  exposurePct: number;
}

export interface CbCheckResult {
  available: boolean;
  date: string | null;
  boardDate: string | null;
  /** 所有關聯掛牌可轉債（排除交換債） */
  all: CbPressureRow[];
  /** 具轉換賣壓或價內留意訊號的可轉債（pressureLevel >= 1） */
  pressured: CbPressureRow[];
  /** 關聯公司的待發行可轉債 */
  upcoming: CbUpcomingHit[];
}

export function checkPortfolioCb(
  xray: PortfolioXrayResult,
  cb: CbData | null,
): CbCheckResult {
  if (!cb) {
    return { available: false, date: null, boardDate: null, all: [], pressured: [], upcoming: [] };
  }
  const asOf = cb.meta.date;
  // 可轉債僅針對台股標的
  const expByCode = new Map(
    xray.exposures.filter(e => e.market === 'tw').map(e => [e.code, e] as const),
  );
  const all: CbPressureRow[] = [];

  for (const b of cb.bonds) {
    // 規則（docs/claude/cb.md）：交換債標的不是代號前四碼的發行公司股票，不可對應
    if (b.exch) continue;
    const exp = expByCode.get(b.s);
    if (!exp) continue;

    const c1p = convPct(b);
    const rem = outPct(b);
    const isConv = convertible(b, asOf);
    const reasons: string[] = [];
    let level: CbPressureLevel = 0;

    if (b.callS) {
      level = 2;
      reasons.push(`公告強制贖回（${b.callS}）`);
    }
    if (b.cv1 != null && b.cv1 > 0) {
      const high = (c1p !== null && c1p >= 5) || b.cv1 >= 500;
      if (high) level = 2;
      else if (level < 1) level = 1;
      reasons.push(
        `近月餘額減少 ${Math.round(b.cv1).toLocaleString('zh-TW')} 張`
        + (c1p !== null ? `（佔發行 ${c1p.toFixed(1)}%）` : ''),
      );
    }
    if (isConv && b.prem !== null && b.prem < 0) {
      if (level < 1) level = 1;
      reasons.push(`負溢價 ${b.prem.toFixed(1)}%（已可轉換）`);
    }
    if (isConv && b.cv !== null && b.cv >= 120) {
      if (level < 1) level = 1;
      reasons.push(`轉換價值 ${b.cv.toFixed(1)}${b.cv >= 130 ? '（達強贖門檻區）' : '（深度價內）'}`);
    }
    if (rem !== null && rem < 80 && reasons.length === 0) {
      reasons.push(`餘額剩 ${rem.toFixed(1)}%`);
    }

    all.push({
      bond: b,
      stockCode: exp.code,
      stockName: exp.name,
      isDirect: exp.isDirect,
      exposurePct: exp.pct,
      viaEtfs: exp.sources.filter(s => s.kind !== 'direct').map(s => s.code),
      pressureLevel: level,
      conv1Pct: c1p,
      remainPct: rem,
      isConvertible: isConv,
      reasons,
    });
  }

  all.sort((a, b) =>
    b.pressureLevel - a.pressureLevel
    || (b.isDirect ? 1 : 0) - (a.isDirect ? 1 : 0)
    || b.exposurePct - a.exposurePct
    || (b.conv1Pct ?? -1) - (a.conv1Pct ?? -1)
    || a.bond.c.localeCompare(b.bond.c));

  const upcoming: CbUpcomingHit[] = [];
  for (const u of cb.upcoming) {
    const exp = expByCode.get(u.s);
    if (!exp) continue;
    upcoming.push({ item: u, isDirect: exp.isDirect, exposurePct: exp.pct });
  }
  upcoming.sort((a, b) => (a.item.list || a.item.issue || '').localeCompare(b.item.list || b.item.issue || ''));

  return {
    available: true,
    date: cb.meta.date || null,
    boardDate: cb.meta.board || null,
    all,
    pressured: all.filter(r => r.pressureLevel >= 1),
    upcoming,
  };
}

/* 3. 未來 14 天除息／法說／股東會（calendar.json） */

export interface UpcomingEventRow {
  event: CalEvent;
  code: string;
  daysLeft: number;
  isDirect: boolean;
  /** 標的類型：直接持有的 ETF 或台股個股 */
  targetKind: 'etf' | 'stock';
  exposurePct: number;
  viaEtfs: string[];
}

export function checkPortfolioEvents(
  xray: PortfolioXrayResult,
  calendar: CalendarData | null,
  today: string,
  days = 14,
): UpcomingEventRow[] {
  if (!calendar) return [];
  const until = addDays(today, days);
  // 除息／法說／股東會行事曆僅針對台股標的
  const expByCode = new Map(
    xray.exposures.filter(e => e.market === 'tw').map(e => [e.code, e] as const),
  );
  const list = allEvents(calendar, today, until);
  const out: UpcomingEventRow[] = [];

  for (const event of list) {
    if (event.kind !== 'exdiv' && event.kind !== 'call' && event.kind !== 'meeting') continue;
    const code = event.code;
    if (!code) continue;

    const direct = xray.directWeights.get(code);
    const exp = expByCode.get(code);
    if (!direct && !exp) continue;

    const isDirect = Boolean(direct) || Boolean(exp?.isDirect);
    const targetKind: 'etf' | 'stock' = direct?.kind === 'etf' ? 'etf' : 'stock';
    const exposurePct = exp ? exp.pct : (direct?.pct ?? 0);
    const viaEtfs = exp ? exp.sources.filter(s => s.kind !== 'direct').map(s => s.code) : [];

    out.push({
      event,
      code,
      daysLeft: daysUntil(event.d, today),
      isDirect,
      targetKind,
      exposurePct,
      viaEtfs,
    });
  }

  return out.sort((a, b) =>
    a.event.d.localeCompare(b.event.d)
    || (b.isDirect ? 1 : 0) - (a.isDirect ? 1 : 0)
    || b.exposurePct - a.exposurePct
    || a.code.localeCompare(b.code));
}

/* 4. 近期重大訊息（news.json 的 filings） */

export interface FilingAlertRow {
  filing: Filing;
  isDirect: boolean;
  targetKind: 'etf' | 'stock';
  exposurePct: number;
  viaEtfs: string[];
}

export function checkPortfolioFilings(
  xray: PortfolioXrayResult,
  news: NewsData | null,
): FilingAlertRow[] {
  if (!news) return [];
  // 公開資訊觀測站重大訊息僅針對台股標的
  const expByCode = new Map(
    xray.exposures.filter(e => e.market === 'tw').map(e => [e.code, e] as const),
  );
  const out: FilingAlertRow[] = [];

  for (const filing of news.filings) {
    const direct = xray.directWeights.get(filing.code);
    const exp = expByCode.get(filing.code);
    if (!direct && !exp) continue;

    out.push({
      filing,
      isDirect: Boolean(direct) || Boolean(exp?.isDirect),
      targetKind: direct?.kind === 'etf' ? 'etf' : 'stock',
      exposurePct: exp ? exp.pct : (direct?.pct ?? 0),
      viaEtfs: exp ? exp.sources.filter(s => s.kind !== 'direct').map(s => s.code) : [],
    });
  }

  return out.sort((a, b) =>
    (b.filing.at ?? '').localeCompare(a.filing.at ?? '')
    || (b.isDirect ? 1 : 0) - (a.isDirect ? 1 : 0)
    || b.exposurePct - a.exposurePct);
}
