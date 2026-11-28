/* 持股每日總市值與累計損益計算（/dividend?view=value）。純函式，沒有 React 或 DOM 依賴。
 *
 * 口徑與規則：
 * 1. 每個交易日取「該日以前最近一筆持股紀錄」× 該日收盤價加總（美股乘上當日美元匯率；
 *    台灣放假無牌告時取前一個營業日匯率；若歷史匯率抓不到則退回最近一筆匯率並標註）。
 * 2. 開始記錄（log[0].date）之前：以第一筆持股往回估算，標記 estimated = true。
 * 3. 某檔在某日缺收盤價時，沿用該檔前一個有價格的交易日補齊並記錄於 filledAssets；
 *    若該日早於此檔最早有價日（例如尚未上市）或整檔無報價，當日不計入市值且不誤算暴賺損益。
 * 4. 扣掉加減碼的每日損益＝前一天生效持股 ×（今天台幣價 − 昨天台幣價），美股自然含匯率變動；
 *    累計損益為視窗內每日損益加總（起點歸零），加減碼資金進出不影響損益曲線。
 * 5. 配息不算進市值與損益；若提供配息事件清單，另以除息日前一日生效持股估算區間已領配息（稅前）。
 *
 * 相對匯入保留 .ts 副檔名，供 tests/valueHistory.test.ts 直接在 Node 下執行。
 */

import { mergeByCode } from './accounts.ts';
import {
  assetKey,
  cleanHoldingsLog,
  collectLogAssets,
  diffHoldings,
  type AssetRef,
  type HoldingDelta,
  type HoldingsSnapshot,
} from './holdingsLog.ts';

export type ValueRange = '3m' | '6m' | '1y' | 'all';

export interface DailyPrice {
  date: string;
  close: number;
}

export interface DailyFx {
  date: string;
  rate: number;
}

export interface ValueHoldingChange extends HoldingDelta {
  name: string;
  /** 當日台幣收盤價（缺價時為 null） */
  priceTwd: number | null;
  /** 估算加減碼金額（台幣，正＝加碼、負＝減碼；缺價時為 null） */
  estAmount: number | null;
}

export interface ValueDayRow {
  date: string;
  /** 當日總市值（台幣） */
  totalValue: number;
  /** 當日損益（扣掉加減碼，台幣）＝前一日持股 × (今價 − 昨價) */
  dailyPnl: number;
  /** 當日報酬率（%，dailyPnl ÷ 前一日總市值 × 100；首日或前日市值為 0 時為 null） */
  dailyRetPct: number | null;
  /** 顯示視窗內累計損益（扣掉加減碼，台幣；視窗首日為 0） */
  cumPnl: number;
  /** 顯示視窗內時間加權累計報酬（%；視窗首日為 0） */
  cumRetPct: number;
  /** 估算加減碼金額（Σ Δ股數 × 當日台幣價，正＝加碼、負＝減碼） */
  netFlow: number;
  /** true 代表早於開始記錄日，以第一筆持股回推估算 */
  estimated: boolean;
  /** 當日有報價的持股檔數／當日總持股檔數 */
  pricedCount: number;
  holdingCount: number;
  /** 相較前一交易日的實質持股變動（無變動為空陣列） */
  changes: ValueHoldingChange[];
  /** 當日以先前收盤價補齊的標的代號 */
  filledCodes: string[];
  /** 當日無任何先前價格而未計入市值的標的代號 */
  missingCodes: string[];
  /** 當日美股採用的美元匯率（無美股時為 null） */
  fxRate: number | null;
  /** 是否使用降級備援匯率 */
  fxFallback: boolean;
}

export interface PeriodChange {
  /** 基準交易日 */
  fromDate: string;
  /** 期間累計損益（扣掉加減碼，台幣） */
  pnl: number;
  /** 期間時間加權報酬（%） */
  retPct: number | null;
  /** 期間總市值差額（含加減碼，台幣） */
  valueDiff: number;
  /** 期間是否包含估算日 */
  hasEstimated: boolean;
  /** 期間內是否有加減碼 */
  hasFlow: boolean;
}

export interface MissingAssetNote {
  key: string;
  code: string;
  name: string;
  m?: 'us';
  reason: string;
}

export interface FilledAssetNote {
  key: string;
  code: string;
  name: string;
  m?: 'us';
  /** 視窗內使用前日收盤價補齊的交易日數 */
  filledDays: number;
  /** 若此檔在視窗前段尚無報價（例：上市較晚），標明首次有價日期 */
  missingBefore?: string;
}

export interface ValueHistoryInput {
  log: readonly HoldingsSnapshot[];
  /** 台股歷史收盤價：代號（大寫）→ DailyPrice[] */
  twPrices: ReadonlyMap<string, readonly DailyPrice[]>;
  /** 美股歷史收盤價：代號（大寫）→ DailyPrice[] */
  usPrices: ReadonlyMap<string, readonly DailyPrice[]>;
  /** 美元兌台幣歷史每日即期中價 */
  fxHistory: readonly DailyFx[];
  /** 歷史匯率缺漏或抓不到時的備援匯率（最近一筆） */
  fallbackFx?: DailyFx | null;
  /** 標的名稱對照（key = assetKey(code, m) → 名稱） */
  names?: ReadonlyMap<string, string>;
  /** 歷史配息事件（key = assetKey(code, m) → [除息日, 每股現金(原幣別)]），可選 */
  dividends?: ReadonlyMap<string, ReadonlyArray<readonly [string, number]>>;
  /** 顯示期間，預設 '1y' */
  range?: ValueRange;
  /** 抓價失敗原因對照（key → 錯誤訊息） */
  errors?: ReadonlyMap<string, string>;
}

export interface ValueHistoryResult {
  range: ValueRange;
  /** 視窗內每日資料（由舊到新） */
  rows: ValueDayRow[];
  /** 視窗內有加減碼的交易日（由舊到新） */
  changeDays: ValueDayRow[];
  /** 開始記錄日（log[0].date） */
  logStartDate: string | null;
  /** 若最新一筆持股變動晚於最後交易日（例：週末調整），記錄該日期 */
  pendingLogDate: string | null;
  latestValue: number | null;
  latestDate: string | null;
  latestPricedCount: number;
  latestHoldingCount: number;
  /** 頂部指標（從完整歷史計算，不受切換 3m/6m 視窗影響） */
  change1d: PeriodChange | null;
  change1m: PeriodChange | null;
  changeYtd: PeriodChange | null;
  hasEstimated: boolean;
  allEstimated: boolean;
  hasOverOneYear: boolean;
  /** 視窗內估計已領配息（稅前台幣；未提供 dividends 時為 null） */
  estDividends: number | null;
  missingAssets: MissingAssetNote[];
  filledAssets: FilledAssetNote[];
  usedFxFallback: boolean;
}

/** YYYY-MM-DD 安全加減月數（避免月底如 3/31 減 1 個月溢出成 3/03）。 */
export function shiftMonths(iso: string, deltaMonths: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** YYYY-MM-DD 加減日曆天數（UTC）。 */
function shiftCalDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 在依 date 升序排列的陣列中，二分搜尋 <= date 的最後一筆。 */
function lookupOnOrBefore<T extends { date: string }>(
  arr: readonly T[],
  date: string,
): { row: T; exact: boolean } | null {
  if (arr.length === 0 || date < arr[0].date) return null;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid].date <= date) lo = mid;
    else hi = mid - 1;
  }
  const row = arr[lo];
  return { row, exact: row.date === date };
}

function normalizePrices(raw: readonly DailyPrice[] | undefined): DailyPrice[] {
  if (!raw || raw.length === 0) return [];
  const byDate = new Map<string, number>();
  for (const r of raw) {
    if (typeof r.date !== 'string' || r.date.length < 10) continue;
    const c = Number(r.close);
    if (Number.isFinite(c) && c > 0) byDate.set(r.date.slice(0, 10), c);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, close]) => ({ date, close }));
}

function normalizeFx(raw: readonly DailyFx[]): DailyFx[] {
  const byDate = new Map<string, number>();
  for (const r of raw) {
    if (typeof r.date !== 'string' || r.date.length < 10) continue;
    const rate = Number(r.rate);
    if (Number.isFinite(rate) && rate > 0) byDate.set(r.date.slice(0, 10), rate);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, rate]) => ({ date, rate }));
}

function resolveFx(
  date: string,
  fxSorted: readonly DailyFx[],
  fallbackFx: DailyFx | null,
): { rate: number; fallback: boolean } | null {
  if (fxSorted.length > 0) {
    const hit = lookupOnOrBefore(fxSorted, date);
    if (hit) return { rate: hit.row.rate, fallback: false };
    return { rate: fxSorted[0].rate, fallback: true };
  }
  if (fallbackFx && Number.isFinite(fallbackFx.rate) && fallbackFx.rate > 0) {
    return { rate: fallbackFx.rate, fallback: true };
  }
  return null;
}

interface PriceLookup {
  price: number | null;
  filled: boolean;
  fxRate: number | null;
  fxFallback: boolean;
  noFx: boolean;
}

function lookupPriceTwd(
  asset: Pick<AssetRef, 'code' | 'm'>,
  date: string,
  twMap: ReadonlyMap<string, DailyPrice[]>,
  usMap: ReadonlyMap<string, DailyPrice[]>,
  fxSorted: readonly DailyFx[],
  fallbackFx: DailyFx | null,
): PriceLookup {
  const code = asset.code.toUpperCase();
  if (asset.m === 'us') {
    const hit = lookupOnOrBefore(usMap.get(code) ?? [], date);
    if (!hit) return { price: null, filled: false, fxRate: null, fxFallback: false, noFx: false };
    const fx = resolveFx(date, fxSorted, fallbackFx);
    if (!fx) return { price: null, filled: !hit.exact, fxRate: null, fxFallback: true, noFx: true };
    return {
      price: hit.row.close * fx.rate,
      filled: !hit.exact,
      fxRate: fx.rate,
      fxFallback: fx.fallback,
      noFx: false,
    };
  }
  const hit = lookupOnOrBefore(twMap.get(code) ?? [], date);
  if (!hit) return { price: null, filled: false, fxRate: null, fxFallback: false, noFx: false };
  return { price: hit.row.close, filled: !hit.exact, fxRate: null, fxFallback: false, noFx: false };
}

function summarizePeriod(
  fullRows: readonly ValueDayRow[],
  baseIdx: number,
): PeriodChange | null {
  if (baseIdx < 0 || baseIdx >= fullRows.length - 1) return null;
  const base = fullRows[baseIdx];
  const last = fullRows[fullRows.length - 1];
  let pnl = 0;
  let twr = 1;
  let hasValidRet = false;
  let hasEstimated = base.estimated;
  let hasFlow = false;
  for (let i = baseIdx + 1; i < fullRows.length; i++) {
    const r = fullRows[i];
    pnl += r.dailyPnl;
    if (r.dailyRetPct !== null) {
      twr *= 1 + r.dailyRetPct / 100;
      hasValidRet = true;
    }
    if (r.estimated) hasEstimated = true;
    if (r.changes.length > 0) hasFlow = true;
  }
  return {
    fromDate: base.date,
    pnl,
    retPct: hasValidRet ? (twr - 1) * 100 : null,
    valueDiff: last.totalValue - base.totalValue,
    hasEstimated,
    hasFlow,
  };
}

const RANGE_MONTHS: Record<Exclude<ValueRange, 'all'>, number> = {
  '3m': 3,
  '6m': 6,
  '1y': 12,
};

/** 依持股變動紀錄、歷史收盤價與匯率計算每日總市值與扣加減碼損益。 */
export function buildValueHistory(input: ValueHistoryInput): ValueHistoryResult {
  const range: ValueRange = input.range ?? '1y';
  const log = cleanHoldingsLog(input.log);
  const nameOf = (key: string, code: string) => input.names?.get(key) ?? code;

  const empty = (missingAssets: MissingAssetNote[] = []): ValueHistoryResult => ({
    range,
    rows: [],
    changeDays: [],
    logStartDate: log.length > 0 ? log[0].date : null,
    pendingLogDate: null,
    latestValue: null,
    latestDate: null,
    latestPricedCount: 0,
    latestHoldingCount: log.length > 0 ? mergeByCode(log[log.length - 1].holdings).length : 0,
    change1d: null,
    change1m: null,
    changeYtd: null,
    hasEstimated: false,
    allEstimated: false,
    hasOverOneYear: false,
    estDividends: null,
    missingAssets,
    filledAssets: [],
    usedFxFallback: false,
  });

  if (log.length === 0) return empty();

  const allAssets = collectLogAssets(log);
  const twMap = new Map<string, DailyPrice[]>();
  const usMap = new Map<string, DailyPrice[]>();
  const dateSet = new Set<string>();

  for (const a of allAssets) {
    if (a.m === 'us') {
      if (!usMap.has(a.code)) {
        const list = normalizePrices(input.usPrices.get(a.code));
        usMap.set(a.code, list);
        for (const p of list) dateSet.add(p.date);
      }
    } else if (!twMap.has(a.code)) {
      const list = normalizePrices(input.twPrices.get(a.code));
      twMap.set(a.code, list);
      for (const p of list) dateSet.add(p.date);
    }
  }

  const fxSorted = normalizeFx(input.fxHistory);
  const fallbackFx = input.fallbackFx ?? null;
  const allDates = [...dateSet].sort();

  if (allDates.length === 0) {
    const missing: MissingAssetNote[] = allAssets.map(a => ({
      key: a.key,
      code: a.code,
      name: nameOf(a.key, a.code),
      ...(a.m ? { m: a.m } : {}),
      reason: input.errors?.get(a.key) ?? '查無歷史收盤價',
    }));
    return empty(missing);
  }

  const logStartDate = log[0].date;
  const mergedSnaps = log.map(s => ({
    snap: s,
    merged: mergeByCode(s.holdings).map(item => ({
      ...item,
      key: assetKey(item.code, item.m),
    })),
  }));

  const snapForDate = (date: string) => {
    if (date < logStartDate) return { entry: mergedSnaps[0], estimated: true };
    const hit = lookupOnOrBefore(log, date);
    if (!hit) return { entry: mergedSnaps[0], estimated: true };
    const idx = log.indexOf(hit.row);
    return { entry: mergedSnaps[idx >= 0 ? idx : 0], estimated: false };
  };

  // 先對完整交易日計算，再切出視窗（確保前值補價與 1D/1M/YTD 統計不受視窗截斷影響）
  const fullRows: ValueDayRow[] = [];
  const fullMeta: Array<{
    merged: typeof mergedSnaps[number]['merged'];
    filledKeys: Set<string>;
    missingKeys: Set<string>;
    noFxKeys: Set<string>;
  }> = [];

  let prevEntry: typeof mergedSnaps[number] | null = null;
  let prevPrices = new Map<string, number>();
  let prevTotalValue = 0;

  for (let i = 0; i < allDates.length; i++) {
    const date = allDates[i];
    const { entry, estimated } = snapForDate(date);
    const curPrices = new Map<string, number>();
    const filledCodes: string[] = [];
    const missingCodes: string[] = [];
    const filledKeys = new Set<string>();
    const missingKeys = new Set<string>();
    const noFxKeys = new Set<string>();

    let totalValue = 0;
    let pricedCount = 0;
    let dayFxRate: number | null = null;
    let dayFxFallback = false;

    for (const item of entry.merged) {
      const px = lookupPriceTwd(item, date, twMap, usMap, fxSorted, fallbackFx);
      if (px.price !== null) {
        totalValue += item.shares * px.price;
        pricedCount += 1;
        curPrices.set(item.key, px.price);
        if (px.filled) {
          filledCodes.push(item.code);
          filledKeys.add(item.key);
        }
        if (px.fxRate !== null) {
          dayFxRate = px.fxRate;
          if (px.fxFallback) dayFxFallback = true;
        }
      } else {
        missingCodes.push(item.code);
        missingKeys.add(item.key);
        if (px.noFx) {
          noFxKeys.add(item.key);
          dayFxFallback = true;
        }
      }
    }

    let dailyPnl = 0;
    let dailyRetPct: number | null = null;
    let netFlow = 0;
    const changes: ValueHoldingChange[] = [];

    if (i > 0 && prevEntry) {
      // 每日損益＝前一天生效持股 ×（今天價 − 昨天價）；賣光清倉的標的也要查今天價格
      for (const prevItem of prevEntry.merged) {
        const pPrev = prevPrices.get(prevItem.key);
        if (pPrev === undefined) continue;
        let pCur = curPrices.get(prevItem.key);
        if (pCur === undefined) {
          const looked = lookupPriceTwd(prevItem, date, twMap, usMap, fxSorted, fallbackFx);
          if (looked.price !== null) pCur = looked.price;
        }
        if (pCur !== undefined) {
          dailyPnl += prevItem.shares * (pCur - pPrev);
        }
      }
      if (prevTotalValue > 0) {
        dailyRetPct = (dailyPnl / prevTotalValue) * 100;
      }

      if (prevEntry !== entry) {
        const diffs = diffHoldings(prevEntry.snap.holdings, entry.snap.holdings);
        for (const d of diffs) {
          let pCur = curPrices.get(d.key);
          if (pCur === undefined) {
            const looked = lookupPriceTwd(d, date, twMap, usMap, fxSorted, fallbackFx);
            if (looked.price !== null) pCur = looked.price;
          }
          const priceTwd = pCur ?? null;
          const estAmount = priceTwd !== null ? d.delta * priceTwd : null;
          if (estAmount !== null) netFlow += estAmount;
          changes.push({
            ...d,
            name: nameOf(d.key, d.code),
            priceTwd,
            estAmount,
          });
        }
      }
    }

    fullRows.push({
      date,
      totalValue,
      dailyPnl,
      dailyRetPct,
      cumPnl: 0,
      cumRetPct: 0,
      netFlow,
      estimated,
      pricedCount,
      holdingCount: entry.merged.length,
      changes,
      filledCodes,
      missingCodes,
      fxRate: dayFxRate,
      fxFallback: dayFxFallback,
    });
    fullMeta.push({ merged: entry.merged, filledKeys, missingKeys, noFxKeys });

    prevEntry = entry;
    prevPrices = curPrices;
    prevTotalValue = totalValue;
  }

  const lastRow = fullRows[fullRows.length - 1];
  const lastDate = lastRow.date;
  const oneYearAgo = shiftMonths(lastDate, -12);
  const hasOverOneYear = fullRows[0].date < oneYearAgo;

  // 頂部統計：從完整歷史計算，不受下方切換 3m / 6m 影響
  const change1d = fullRows.length >= 2 ? summarizePeriod(fullRows, fullRows.length - 2) : null;

  const target1m = shiftMonths(lastDate, -1);
  let idx1m = -1;
  for (let i = fullRows.length - 2; i >= 0; i--) {
    if (fullRows[i].date <= target1m) { idx1m = i; break; }
  }
  const change1m = idx1m >= 0 ? summarizePeriod(fullRows, idx1m) : null;

  const yearStart = `${lastDate.slice(0, 4)}-01-01`;
  let idxYtd = -1;
  for (let i = fullRows.length - 2; i >= 0; i--) {
    if (fullRows[i].date < yearStart) { idxYtd = i; break; }
  }
  if (idxYtd < 0) {
    for (let i = 0; i < fullRows.length - 1; i++) {
      if (fullRows[i].date >= yearStart) { idxYtd = i; break; }
    }
  }
  const changeYtd = idxYtd >= 0 ? summarizePeriod(fullRows, idxYtd) : null;

  // 切出顯示視窗，並以視窗首日為基準將累計損益／累計報酬歸零
  const winStart = range === 'all' ? fullRows[0].date : shiftMonths(lastDate, -RANGE_MONTHS[range]);
  let startIdx = 0;
  for (let i = 0; i < fullRows.length; i++) {
    if (fullRows[i].date >= winStart) { startIdx = i; break; }
  }

  const rows: ValueDayRow[] = [];
  let cumPnl = 0;
  let twr = 1;
  let usedFxFallback = false;
  let hasEstimated = false;
  let allEstimated = true;

  for (let i = startIdx; i < fullRows.length; i++) {
    const src = fullRows[i];
    if (i > startIdx) {
      cumPnl += src.dailyPnl;
      if (src.dailyRetPct !== null) twr *= 1 + src.dailyRetPct / 100;
    }
    if (src.fxFallback) usedFxFallback = true;
    if (src.estimated) hasEstimated = true;
    else allEstimated = false;

    rows.push({
      ...src,
      cumPnl: i === startIdx ? 0 : cumPnl,
      cumRetPct: i === startIdx ? 0 : (twr - 1) * 100,
    });
  }

  const changeDays = rows.filter(r => r.changes.length > 0);

  // 彙總視窗內的缺價與補價標的
  const assetStats = new Map<string, {
    ref: AssetRef;
    heldDays: number;
    pricedDays: number;
    filledDays: number;
    missingDays: number;
    firstPricedDate?: string;
    hadNoFx: boolean;
  }>();

  for (let i = startIdx; i < fullRows.length; i++) {
    const d = fullRows[i].date;
    const meta = fullMeta[i];
    for (const item of meta.merged) {
      let st = assetStats.get(item.key);
      if (!st) {
        st = {
          ref: { key: item.key, code: item.code, ...(item.m ? { m: item.m } : {}), ...(item.k ? { k: item.k } : {}) },
          heldDays: 0,
          pricedDays: 0,
          filledDays: 0,
          missingDays: 0,
          hadNoFx: false,
        };
        assetStats.set(item.key, st);
      }
      st.heldDays += 1;
      if (meta.missingKeys.has(item.key)) {
        st.missingDays += 1;
        if (meta.noFxKeys.has(item.key)) st.hadNoFx = true;
      } else {
        st.pricedDays += 1;
        if (!st.firstPricedDate) st.firstPricedDate = d;
        if (meta.filledKeys.has(item.key)) st.filledDays += 1;
      }
    }
  }

  const missingAssets: MissingAssetNote[] = [];
  const filledAssets: FilledAssetNote[] = [];
  for (const st of assetStats.values()) {
    const name = nameOf(st.ref.key, st.ref.code);
    if (st.pricedDays === 0) {
      const reason = input.errors?.get(st.ref.key)
        ?? (st.hadNoFx ? '缺少美元匯率' : '查無歷史收盤價');
      missingAssets.push({
        key: st.ref.key,
        code: st.ref.code,
        name,
        ...(st.ref.m ? { m: st.ref.m } : {}),
        reason,
      });
    } else if (st.filledDays > 0 || st.missingDays > 0) {
      filledAssets.push({
        key: st.ref.key,
        code: st.ref.code,
        name,
        ...(st.ref.m ? { m: st.ref.m } : {}),
        filledDays: st.filledDays,
        ...(st.missingDays > 0 && st.firstPricedDate ? { missingBefore: st.firstPricedDate } : {}),
      });
    }
  }

  // 選填：估算視窗內已領配息（稅前，以除息日前一曆日生效持股計算，不計入市值與損益）
  let estDividends: number | null = null;
  if (input.dividends && rows.length > 0) {
    const winFirstDate = rows[0].date;
    let totalDiv = 0;
    for (const [key, st] of assetStats) {
      const events = input.dividends.get(key);
      if (!events || events.length === 0) continue;
      for (const [exDate, cash] of events) {
        if (!exDate || exDate < winFirstDate || exDate > lastDate || !(cash > 0)) continue;
        const holdDay = shiftCalDays(exDate, -1);
        const { entry } = snapForDate(holdDay);
        const held = entry.merged.find(x => x.key === key);
        if (!held || !(held.shares > 0)) continue;
        if (st.ref.m === 'us') {
          const fx = resolveFx(exDate, fxSorted, fallbackFx);
          if (fx) totalDiv += held.shares * cash * fx.rate;
        } else {
          totalDiv += held.shares * cash;
        }
      }
    }
    estDividends = totalDiv;
  }

  const latestSnapDate = log[log.length - 1].date;
  const pendingLogDate = latestSnapDate > lastDate ? latestSnapDate : null;

  return {
    range,
    rows,
    changeDays,
    logStartDate,
    pendingLogDate,
    latestValue: lastRow.totalValue,
    latestDate: lastDate,
    latestPricedCount: lastRow.pricedCount,
    latestHoldingCount: lastRow.holdingCount,
    change1d,
    change1m,
    changeYtd,
    hasEstimated,
    allEstimated: rows.length > 0 ? allEstimated : false,
    hasOverOneYear,
    estDividends,
    missingAssets,
    filledAssets,
    usedFxFallback,
  };
}

export type BenchmarkMode = 'price' | 'tr';

export interface BenchmarkDayPoint {
  date: string;
  /** 對應到 ValueDayRow[] 的索引（與總市值／累計損益圖同步游標與點選鎖定） */
  rowIndex: number;
  /** 我的持股視窗內時間加權累計報酬（%，起點歸零） */
  portfolioRetPct: number;
  /** 基準指數視窗內累計報酬（%，起點歸零） */
  benchmarkRetPct: number;
  /** 超額報酬＝我的持股報酬 − 基準指數報酬（百分點） */
  excessRetPct: number;
  /** 當日基準指數收盤值（或補前值） */
  benchmarkClose: number;
  /** true 代表當日基準指數缺交易日（例如台股休市但美股開盤），以前一筆補齊 */
  benchmarkFilled: boolean;
  /** 沿用對應 ValueDayRow 的估算標記 */
  estimated: boolean;
}

export interface BenchmarkComparison {
  points: BenchmarkDayPoint[];
  startDate: string | null;
  endDate: string | null;
  /** 區間我的持股時間加權報酬（%） */
  portfolioRetPct: number | null;
  /** 區間基準指數累計報酬（%） */
  benchmarkRetPct: number | null;
  /** 區間超額報酬＝我的報酬 − 基準報酬（百分點） */
  excessRetPct: number | null;
  /** 區間我的持股最大回撤（%，非正數，例如 -8.2 代表自高點最大回跌 8.2%） */
  portfolioMaxDrawdownPct: number | null;
  /** 區間基準指數最大回撤（%，非正數） */
  benchmarkMaxDrawdownPct: number | null;
  /** 視窗內基準指數使用前一交易日補齊的天數 */
  filledDays: number;
  /** 若基準資料起點晚於持股視窗首日，前面略過的天數 */
  trimmedLeadingDays: number;
}

/**
 * 由累計報酬序列（%，如 0, +20, +8）計算區間最大回撤（%，非正數）。
 * 轉為財富倍數 W = 1 + r/100，追蹤歷史高點 peak，每日回撤 = (W / peak − 1) × 100。
 */
export function computeMaxDrawdown(retPcts: readonly number[]): number {
  if (retPcts.length === 0) return 0;
  let peak = -Infinity;
  let maxDd = 0;
  for (const r of retPcts) {
    if (!Number.isFinite(r)) continue;
    const w = Math.max(0, 1 + r / 100);
    if (w > peak) peak = w;
    if (peak > 0) {
      const dd = (w / peak - 1) * 100;
      if (dd < maxDd) maxDd = dd;
    }
  }
  return Object.is(maxDd, -0) ? 0 : maxDd;
}

/**
 * 將持股視窗內的時間加權報酬與基準指數（加權指數／加權報酬指數）對齊比較：
 * - 以持股視窗交易日為主軸，基準缺交易日時以前一筆收盤補齊。
 * - 自雙方皆有資料的首日為共同起點，兩條曲線同步歸零成 0%。
 * - 計算區間超額報酬（我的報酬 − 基準報酬）與兩者區間最大回撤。
 */
export function buildBenchmarkComparison(
  rows: readonly ValueDayRow[],
  benchmarkPrices: readonly DailyPrice[],
): BenchmarkComparison {
  const empty: BenchmarkComparison = {
    points: [],
    startDate: null,
    endDate: null,
    portfolioRetPct: null,
    benchmarkRetPct: null,
    excessRetPct: null,
    portfolioMaxDrawdownPct: null,
    benchmarkMaxDrawdownPct: null,
    filledDays: 0,
    trimmedLeadingDays: 0,
  };
  if (rows.length < 2) return empty;
  const benchSorted = normalizePrices(benchmarkPrices);
  if (benchSorted.length === 0) return empty;

  let firstIdx = -1;
  let baseBench = 0;
  for (let i = 0; i < rows.length; i++) {
    const hit = lookupOnOrBefore(benchSorted, rows[i].date);
    if (hit) {
      firstIdx = i;
      baseBench = hit.row.close;
      break;
    }
  }
  if (firstIdx < 0 || rows.length - firstIdx < 2 || !(baseBench > 0)) return empty;

  const basePortWealth = 1 + rows[firstIdx].cumRetPct / 100;
  if (!(basePortWealth > 0)) return empty;

  const points: BenchmarkDayPoint[] = [];
  let filledDays = 0;

  for (let i = firstIdx; i < rows.length; i++) {
    const row = rows[i];
    const hit = lookupOnOrBefore(benchSorted, row.date);
    if (!hit) continue;
    const isStart = i === firstIdx;
    const portRetPct = isStart
      ? 0
      : basePortWealth === 1
        ? row.cumRetPct
        : ((1 + row.cumRetPct / 100) / basePortWealth - 1) * 100;
    const benchRetPct = isStart ? 0 : (hit.row.close / baseBench - 1) * 100;
    const excessRetPct = portRetPct - benchRetPct;
    const benchmarkFilled = !hit.exact;
    if (benchmarkFilled) filledDays += 1;

    points.push({
      date: row.date,
      rowIndex: i,
      portfolioRetPct: Object.is(portRetPct, -0) ? 0 : portRetPct,
      benchmarkRetPct: Object.is(benchRetPct, -0) ? 0 : benchRetPct,
      excessRetPct: Object.is(excessRetPct, -0) ? 0 : excessRetPct,
      benchmarkClose: hit.row.close,
      benchmarkFilled,
      estimated: row.estimated,
    });
  }

  if (points.length < 2) return empty;
  const last = points[points.length - 1];
  return {
    points,
    startDate: points[0].date,
    endDate: last.date,
    portfolioRetPct: last.portfolioRetPct,
    benchmarkRetPct: last.benchmarkRetPct,
    excessRetPct: last.excessRetPct,
    portfolioMaxDrawdownPct: computeMaxDrawdown(points.map(p => p.portfolioRetPct)),
    benchmarkMaxDrawdownPct: computeMaxDrawdown(points.map(p => p.benchmarkRetPct)),
    filledDays,
    trimmedLeadingDays: firstIdx,
  };
}
