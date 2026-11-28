/* 持股變動紀錄（twetf.holdingsLog）：純邏輯模組，沒有 React、沒有 DOM、沒有 localStorage 存取。
 *
 * 配息試算每次新增／修改／刪除持股（含各帳戶操作）時，附加一筆當日（台北日期）的完整持股快照；
 * 同一天多次修改只保留最後一筆，並隨私人持股一起加密寫進 holdings.enc。
 * 舊格式沒有 log 時，以目前持股當成第一筆紀錄（ensureHoldingsLog / resolveHoldingsLog）。
 *
 * 相對匯入保留 .ts 副檔名，讓 tests/holdingsLog.test.ts 直接在 Node 下驗證。
 */

import { mergeByCode, type AcctEntry } from './accounts.ts';

export const HOLDINGS_KEY = 'twetf.holdings';
export const HOLDINGS_LOG_KEY = 'twetf.holdingsLog';

export interface HoldingsSnapshot {
  /** 台北日期 YYYY-MM-DD */
  date: string;
  /** 與 twetf.holdings 相同的持股格式（保留 acct、m、k） */
  holdings: AcctEntry[];
}

export type HoldingChangeKind = 'add' | 'increase' | 'decrease' | 'remove';

export interface HoldingDelta {
  /** 正規化資產鍵：tw:CODE 或 us:CODE */
  key: string;
  code: string;
  m?: 'us';
  k?: 'stock';
  before: number;
  after: number;
  delta: number;
  kind: HoldingChangeKind;
}

export interface AssetRef {
  key: string;
  code: string;
  m?: 'us';
  k?: 'stock';
}

export interface HoldingsSyncPayload {
  holdings: AcctEntry[];
  accounts: string[];
  log: HoldingsSnapshot[];
  generated: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 台北日期（YYYY-MM-DD），以 UTC+8 計算，不依賴瀏覽器或系統 locale。 */
export function taipeiDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 驗證是否為真實存在的 YYYY-MM-DD 日期字串。 */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) return false;
  const parsed = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === v;
}

/** 資產唯一鍵（區分台股與美股，代號統一大寫）。 */
export function assetKey(code: string, m?: 'us'): string {
  return `${m === 'us' ? 'us' : 'tw'}:${code.trim().toUpperCase()}`;
}

/** 清理並深拷貝持股陣列，略過無效欄位或非正股數，保留 m / k / acct。 */
export function cleanHoldingEntries(raw: unknown): AcctEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: AcctEntry[] = [];
  for (const x of raw) {
    if (typeof x !== 'object' || x === null) continue;
    const o = x as Record<string, unknown>;
    const code = typeof o.code === 'string' ? o.code.trim().toUpperCase() : '';
    const shares = typeof o.shares === 'number' ? o.shares : Number.NaN;
    if (!code || !Number.isFinite(shares) || shares <= 0) continue;
    const item: AcctEntry = { code, shares };
    if (o.m === 'us') {
      item.m = 'us';
      if (o.k === 'stock') item.k = 'stock';
    }
    if (typeof o.acct === 'string' && o.acct.trim()) item.acct = o.acct.trim();
    out.push(item);
  }
  return out;
}

/**
 * 清理並正規化持股變動紀錄：
 * - 略過日期無效或 holdings 非陣列的項目（容許空陣列，代表當日清倉）。
 * - 同一天出現多筆時保留最後一筆。
 * - 結果依日期由舊到新排列。
 */
export function cleanHoldingsLog(raw: unknown): HoldingsSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const byDate = new Map<string, AcctEntry[]>();
  for (const x of raw) {
    if (typeof x !== 'object' || x === null) continue;
    const o = x as Record<string, unknown>;
    if (!isIsoDate(o.date) || !Array.isArray(o.holdings)) continue;
    byDate.set(o.date, cleanHoldingEntries(o.holdings));
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, holdings]) => ({ date, holdings }));
}

/** 解析 localStorage 的 twetf.holdingsLog 字串；損毀或空值回空陣列。 */
export function parseHoldingsLog(raw: string | null): HoldingsSnapshot[] {
  if (!raw) return [];
  try {
    return cleanHoldingsLog(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * 記錄一筆指定日期的持股快照（純函式，回傳新陣列）。
 * 同一天重複寫入時只留最後一筆；結果按日期由舊到新排序。
 */
export function recordHoldingsLog(
  log: readonly HoldingsSnapshot[],
  holdings: readonly AcctEntry[],
  date: string,
): HoldingsSnapshot[] {
  const cleaned = cleanHoldingsLog(log);
  if (!isIsoDate(date)) return cleaned;
  const byDate = new Map<string, AcctEntry[]>(cleaned.map(s => [s.date, s.holdings]));
  byDate.set(date, cleanHoldingEntries(holdings));
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([d, list]) => ({ date: d, holdings: list }));
}

/**
 * 舊格式相容：若尚無變動紀錄但已有持股，將目前持股記為第一筆；
 * 若已有紀錄則原樣保留。
 */
export function ensureHoldingsLog(
  log: readonly HoldingsSnapshot[],
  currentHoldings: readonly AcctEntry[],
  today: string,
): HoldingsSnapshot[] {
  const cleaned = cleanHoldingsLog(log);
  if (cleaned.length > 0) return cleaned;
  const cur = cleanHoldingEntries(currentHoldings);
  if (cur.length === 0 || !isIsoDate(today)) return [];
  return [{ date: today, holdings: cur }];
}

const KIND_ORDER: Record<HoldingChangeKind, number> = {
  add: 0,
  increase: 1,
  decrease: 2,
  remove: 3,
};

/**
 * 比較兩份持股快照的實質股數變動（跨帳戶先合併同市場＋同代號）。
 * 僅搬移帳戶或帳戶改名但總股數未變時回傳空陣列，避免誤標加減碼日。
 */
export function diffHoldings(
  prev: readonly AcctEntry[],
  next: readonly AcctEntry[],
): HoldingDelta[] {
  const prevMerged = mergeByCode(cleanHoldingEntries(prev));
  const nextMerged = mergeByCode(cleanHoldingEntries(next));
  const prevMap = new Map(prevMerged.map(r => [assetKey(r.code, r.m), r] as const));
  const nextMap = new Map(nextMerged.map(r => [assetKey(r.code, r.m), r] as const));
  const keys = new Set<string>([...prevMap.keys(), ...nextMap.keys()]);

  const out: HoldingDelta[] = [];
  for (const key of keys) {
    const a = prevMap.get(key);
    const b = nextMap.get(key);
    const before = a?.shares ?? 0;
    const after = b?.shares ?? 0;
    const delta = after - before;
    if (delta === 0) continue;
    const src = b ?? a!;
    const kind: HoldingChangeKind = before === 0
      ? 'add'
      : after === 0
        ? 'remove'
        : delta > 0
          ? 'increase'
          : 'decrease';
    const row: HoldingDelta = {
      key,
      code: src.code,
      before,
      after,
      delta,
      kind,
    };
    if (src.m === 'us') {
      row.m = 'us';
      if (src.k === 'stock') row.k = 'stock';
    }
    out.push(row);
  }
  out.sort((x, y) => KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || x.key.localeCompare(y.key));
  return out;
}

/**
 * 讀取與檢視市值走勢時的相容整理：
 * - 沒有 log 時以目前持股作為第一筆。
 * - 若有 log 但最後一筆合併持股與目前持股不同（例如外部改過 twetf.holdings），
 *   於 today 補上一筆最新快照，確保與配息試算頁一致。
 */
export function resolveHoldingsLog(
  log: readonly HoldingsSnapshot[],
  currentHoldings: readonly AcctEntry[],
  today: string,
): HoldingsSnapshot[] {
  const base = ensureHoldingsLog(log, currentHoldings, today);
  if (base.length === 0) return [];
  const last = base[base.length - 1];
  if (diffHoldings(last.holdings, currentHoldings).length === 0) return base;
  return recordHoldingsLog(base, currentHoldings, today);
}

/** 收集整份變動紀錄裡所有曾經出現過的標的（含後來已清倉者，供抓取完整歷史價格）。 */
export function collectLogAssets(log: readonly HoldingsSnapshot[]): AssetRef[] {
  const map = new Map<string, AssetRef>();
  for (const snap of log) {
    for (const e of cleanHoldingEntries(snap.holdings)) {
      const key = assetKey(e.code, e.m);
      const prev = map.get(key);
      if (!prev) {
        const ref: AssetRef = { key, code: e.code };
        if (e.m === 'us') {
          ref.m = 'us';
          if (e.k === 'stock') ref.k = 'stock';
        }
        map.set(key, ref);
      } else if (e.m === 'us' && e.k === 'stock') {
        prev.k = 'stock';
      }
    }
  }
  return [...map.values()];
}

/**
 * 清理私人持股加密同步檔（holdings.enc）內容。
 * 相容舊版 v1（無 log 欄位）與新版 v2（含 log 欄位）。
 */
export function cleanHoldingsSyncPayload(raw: unknown): HoldingsSyncPayload {
  if (typeof raw !== 'object' || raw === null) {
    return { holdings: [], accounts: [], log: [], generated: '' };
  }
  const p = raw as Record<string, unknown>;
  const holdings = cleanHoldingEntries(p.holdings);
  const accounts = (Array.isArray(p.accounts) ? p.accounts : [])
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map(x => x.trim());
  const log = cleanHoldingsLog(p.log);
  const generated = typeof p.generated === 'string' ? p.generated : '';
  return { holdings, accounts, log, generated };
}
