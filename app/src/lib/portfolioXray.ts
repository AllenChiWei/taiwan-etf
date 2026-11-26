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
import type { Top10Data } from './top10.ts';
import { holdingsOf } from './overlap.ts';
import type { StockDividendData, YieldData } from './dividend.ts';
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
      if (obj.m === 'us') entry.m = 'us';
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
  yields: YieldData | null;
  stockDivs: StockDividendData | null;
  /** 美股 ETF 最新收盤價（已換算為台幣，代號 → 台幣股價） */
  usPricesTwd?: ReadonlyMap<string, number>;
  /** 美股 ETF 名稱對照（代號 → 名稱） */
  usNames?: ReadonlyMap<string, string>;
}

export type HoldingKind = 'stock' | 'etf' | 'us';
export type PenetrationStatus = 'direct' | 'daily' | 'monthly' | 'unpenetrable';
export type UnpenetrableReasonKind = 'bond' | 'us' | 'foreign' | 'derivative' | 'missing';

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
  /** 每日持股 YYYY-MM-DD 或月報 YYYY/MM；直接持股與無法穿透時為 null */
  asof: string | null;
  /** 可穿透至台股個股的權重合計（佔該 ETF 淨值 %）；直接個股為 100，無法穿透為 0 */
  coveredPct: number;
  /** 實際展開出的台股個股檔數 */
  stockCount: number;
  /** 無法穿透或僅部分展開（例如海外跨國 ETF 含台股）之說明 */
  note: string | null;
  unpenetrableKind?: UnpenetrableReasonKind;
}

export interface ExposureSource {
  /** 來源代號（直接持股即為該股本身，ETF 為 ETF 代號） */
  code: string;
  name: string;
  kind: 'direct' | 'daily' | 'monthly';
  /** 該股在此來源中的權重（%）；直接持股為 100 */
  weightInSource: number;
  /** 此來源貢獻的曝險金額（台幣） */
  amount: number;
  /** 此來源貢獻的投組權重（%） */
  pctOfPortfolio: number;
  asof: string | null;
}

export interface ExposureRow {
  code: string;
  name: string;
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
  /** 可穿透 ETF 中未揭露（前十大以外）／海外成分／期貨與現金部分 */
  unrevealedEtfValue: number;
  unrevealedEtfPct: number;
  /** 無法穿透標的（債券、美股、純海外、槓反／期貨、尚無明細 ETF）市值與佔比 */
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
  /** 投組中公會月報前十大使用到的月份（YYYY/MM），未使用則 null */
  monthlyAsof: string | null;
  /** 投組內各持股權重資料日期是否不一致（例如每日持股與月報並存，或直接持股與月報並存） */
  hasDateMismatch: boolean;
  /** 單一個股真實曝險排行（金額由大到小） */
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

/**
 * 執行持股穿透計算。
 *
 * 口徑說明：
 * - 所有已取得最新收盤價的持股（含債券／美股／海外 ETF）均計入總市值分母，
 *   單一個股佔比＝（直接持股市值 ＋ Σ 各 ETF 市值 × 該股佔 ETF 淨值% ）÷ 投組總市值。
 * - 債券 ETF（cat-bond）、美股 ETF（m='us'）、槓桿／反向／期貨 ETF 與純海外股 ETF 不穿透至台股。
 * - 跨國 ETF（如 00420A、00735）若明細中含台股 4 碼普通股，僅展開台股部分，其餘歸入未揭露／海外。
 * - 主動式 ETF 的期貨部位（含 TX／WTX 等）透過 holdingLinkKind 排除，不計為個股曝險。
 */
export function buildPortfolioXray(input: PortfolioXrayInput): PortfolioXrayResult {
  const merged = mergeByCode(input.holdings);
  const etfMap = new Map(input.etfs.map(e => [e.code, e] as const));

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
      const name = input.usNames?.get(h.code) ?? h.code;
      const price = input.usPricesTwd?.get(h.code) ?? null;
      const validPrice = price !== null && Number.isFinite(price) && price > 0 ? price : null;
      const value = validPrice !== null ? validPrice * h.shares : null;
      if (value === null) {
        unpriced.push({ code: h.code, name, kind: 'us', shares: h.shares, reason: '美股報價或匯率暫時讀不到' });
      }
      resolved.push({ code: h.code, name, kind: 'us', shares: h.shares, price: validPrice, value, etfMeta: undefined });
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
  let unrevealedEtfValue = 0;
  let unpenetrableValue = 0;

  const dailyDateSet = new Set<string>();
  let monthlyAsof: string | null = null;
  let directStockCount = 0;

  interface AccExposure {
    code: string;
    name: string;
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
  ) => {
    const prev = expMap.get(stockCode);
    const name = pickStockName(stockCode, rawName, prev?.name, input.stockDivs);
    if (!prev) {
      expMap.set(stockCode, {
        code: stockCode,
        name,
        amount: source.amount,
        directAmount: source.kind === 'direct' ? source.amount : 0,
        etfAmount: source.kind === 'direct' ? 0 : source.amount,
        isDirect: source.kind === 'direct',
        fromMonthly: source.kind === 'monthly',
        sources: [source],
      });
    } else {
      prev.name = name;
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
    if (r.kind !== 'us') {
      directWeights.set(r.code, { name: r.name, kind: r.kind, pct: pctOfPortfolio });
    }

    if (r.kind === 'us') {
      if (r.value !== null) unpenetrableValue += r.value;
      breakdown.push({
        code: r.code, name: r.name, kind: 'us', shares: r.shares, price: r.price, value: r.value,
        pctOfPortfolio, status: 'unpenetrable', asof: null, coveredPct: 0, stockCount: 0,
        note: '美股 ETF（站內無成分股資料，無法穿透）', unpenetrableKind: 'us',
      });
      continue;
    }

    if (r.kind === 'stock') {
      directStockCount += 1;
      if (r.value !== null) {
        directStockValue += r.value;
        addExposure(r.code, r.name, {
          code: r.code, name: r.name, kind: 'direct', weightInSource: 100,
          amount: r.value, pctOfPortfolio, asof: null,
        });
      }
      breakdown.push({
        code: r.code, name: r.name, kind: 'stock', shares: r.shares, price: r.price, value: r.value,
        pctOfPortfolio, status: 'direct', asof: null, coveredPct: 100, stockCount: 1, note: null,
      });
      continue;
    }

    // 台股 ETF：先排除債券與槓反／期貨，再透過既有 holdingsOf() 展開台股成分股
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

    const hs = holdingsOf(r.code, input.top10, input.active);
    if (!hs) {
      if (r.value !== null) unpenetrableValue += r.value;
      const isForeign = sec === 'cat-foreign';
      breakdown.push({
        code: r.code, name: r.name, kind: 'etf', shares: r.shares, price: r.price, value: r.value,
        pctOfPortfolio, status: 'unpenetrable', asof: null, coveredPct: 0, stockCount: 0,
        note: isForeign
          ? '海外 ETF（無台股成分股明細，無法穿透）'
          : '尚無持股明細（新上市、不動產或平衡型 ETF）',
        unpenetrableKind: isForeign ? 'foreign' : 'missing',
      });
      continue;
    }

    // 只展開台股個股（排除海外股 ISIN／國別後綴與主動式期貨部位 TX／WTX）
    const twComponents: Array<{ sid: string; name: string; pct: number }> = [];
    for (const [sid, item] of hs.w) {
      if (holdingLinkKind(sid) !== 'stock') continue;
      if (!(item.pct > 0)) continue;
      twComponents.push({ sid, name: item.name, pct: item.pct });
    }

    if (twComponents.length === 0) {
      if (r.value !== null) unpenetrableValue += r.value;
      breakdown.push({
        code: r.code, name: r.name, kind: 'etf', shares: r.shares, price: r.price, value: r.value,
        pctOfPortfolio, status: 'unpenetrable', asof: hs.asof, coveredPct: 0, stockCount: 0,
        note: sec === 'cat-foreign'
          ? '海外股票 ETF（成分非台股，無法穿透至台股個股）'
          : '明細中無台股普通股成分，無法穿透',
        unpenetrableKind: sec === 'cat-foreign' ? 'foreign' : 'missing',
      });
      continue;
    }

    const coveredPct = twComponents.reduce((s, c) => s + c.pct, 0);
    if (hs.kind === 'daily') dailyDateSet.add(hs.asof);
    else monthlyAsof = hs.asof;

    if (r.value !== null) {
      let etfPenetrated = 0;
      for (const comp of twComponents) {
        const amt = r.value * (comp.pct / 100);
        etfPenetrated += amt;
        addExposure(comp.sid, comp.name, {
          code: r.code,
          name: r.name,
          kind: hs.kind,
          weightInSource: comp.pct,
          amount: amt,
          pctOfPortfolio: totalValue > 0 ? (amt / totalValue) * 100 : 0,
          asof: hs.asof,
        });
      }
      penetratedEtfValue += etfPenetrated;
      unrevealedEtfValue += Math.max(0, r.value - etfPenetrated);
    }

    const note = sec === 'cat-foreign'
      ? `跨市場 ETF，僅展開台股成分（${hs.kind === 'daily' ? '每日持股' : '月報前十大'}）`
      : hs.kind === 'monthly'
        ? '公會月報前十大（已知下限，第 11 名以後未揭露）'
        : null;

    breakdown.push({
      code: r.code, name: r.name, kind: 'etf', shares: r.shares, price: r.price, value: r.value,
      pctOfPortfolio, status: hs.kind, asof: hs.asof, coveredPct, stockCount: twComponents.length, note,
    });
  }

  const exposures: ExposureRow[] = [...expMap.values()]
    .map(e => {
      e.sources.sort((a, b) => b.amount - a.amount);
      return {
        code: e.code,
        name: e.name,
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
  const unrevealedEtfPct = pctOf(unrevealedEtfValue);
  const unpenetrablePct = pctOf(unpenetrableValue);
  const top5Pct = exposures.slice(0, 5).reduce((s, e) => s + e.pct, 0);
  const dailyDates = [...dailyDateSet].sort();
  const hasLowerBound = monthlyAsof !== null;
  const hasDateMismatch = (dailyDates.length > 0 && monthlyAsof !== null)
    || dailyDates.length > 1
    || (monthlyAsof !== null && directStockCount > 0);

  return {
    holdingCount: resolved.length,
    pricedCount,
    totalValue,
    directStockValue,
    directStockPct,
    penetratedEtfValue,
    penetratedEtfPct,
    unrevealedEtfValue,
    unrevealedEtfPct,
    unpenetrableValue,
    unpenetrablePct,
    knownTwPct: directStockPct + penetratedEtfPct,
    top5Pct,
    hasLowerBound,
    dailyDates,
    monthlyAsof,
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
  const expByCode = new Map(xray.exposures.map(e => [e.code, e] as const));
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
  const expByCode = new Map(xray.exposures.map(e => [e.code, e] as const));
  const list = allEvents(calendar, today, until);
  const out: UpcomingEventRow[] = [];

  for (const event of list) {
    if (event.kind !== 'exdiv' && event.kind !== 'call' && event.kind !== 'meeting') continue;
    const code = event.code;
    if (!code) continue;

    const direct = xray.directWeights.get(code);
    const exp = expByCode.get(code);
    if (!direct && !exp) continue;

    const isDirect = Boolean(direct);
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
  const expByCode = new Map(xray.exposures.map(e => [e.code, e] as const));
  const out: FilingAlertRow[] = [];

  for (const filing of news.filings) {
    const direct = xray.directWeights.get(filing.code);
    const exp = expByCode.get(filing.code);
    if (!direct && !exp) continue;

    out.push({
      filing,
      isDirect: Boolean(direct),
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
