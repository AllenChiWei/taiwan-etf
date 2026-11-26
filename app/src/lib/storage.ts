/* localStorage 包裝。
   無痕模式、封鎖 cookie、或儲存空間已滿時每個存取都可能丟例外，
   所以一律 try/catch，失敗就退回記憶體內的值，頁面照常運作。 */

import type { DefRow } from './defensive.ts';

const KEY_FAVORITES = 'twetf.favorites';
const KEY_THEME = 'twetf.theme';
const KEY_CHANGELOG = 'twetf.changelogSeen';
const KEY_FUTURES = 'twetf.futuresPrefs';
const KEY_DEFENSIVE_CUSTOM = 'twetf.defensiveCustom';
const KEY_DEFENSIVE_CACHE = 'twetf.defensiveCache';

/** 自選存股上限：每檔要打 3 次 FinMind，設上限避免重抓時一次耗盡免費額度（每小時 300 次）。 */
export const MAX_DEFENSIVE_CUSTOM = 20;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 寫不進去就算了，這一輪仍然有效 */
  }
}

export function loadFavorites(): string[] {
  const v = read<unknown>(KEY_FAVORITES, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function saveFavorites(codes: readonly string[]): void {
  write(KEY_FAVORITES, [...codes]);
}

/** 上次看過的更新日誌最新日期（YYYY-MM-DD）。沒有紀錄時回 null。 */
export function loadChangelogSeen(): string | null {
  const v = read<unknown>(KEY_CHANGELOG, null);
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function saveChangelogSeen(date: string): void {
  write(KEY_CHANGELOG, date);
}

export type ThemeChoice = 'light' | 'dark' | 'system';

export function loadTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY_THEME);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY_THEME);
    else localStorage.setItem(KEY_THEME, choice);
  } catch {
    /* 忽略 */
  }
}

/** 套用到 <html data-theme>；index.html 裡的行內腳本開頁時也做同一件事。 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
}

/** 對帳單頁的偏好：選擇權賣方的價格區間、手動改過的分類。
 *  **不含任何交易內容** —— 手動分類的 key 是那一列的雜湊，不是原文。 */
export interface FuturesPrefs {
  sellMin: number;
  sellMax: number;
  overrides: Record<string, '賣方' | '避險'>;
}

export function loadFuturesPrefs(fallback: FuturesPrefs): FuturesPrefs {
  const v = read<Partial<FuturesPrefs> | null>(KEY_FUTURES, null);
  if (!v || typeof v !== 'object') return fallback;
  const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const overrides: FuturesPrefs['overrides'] = {};
  if (v.overrides && typeof v.overrides === 'object') {
    for (const [k, kind] of Object.entries(v.overrides)) {
      if (kind === '賣方' || kind === '避險') overrides[k] = kind;
    }
  }
  return {
    sellMin: ok(v.sellMin) ? v.sellMin : fallback.sellMin,
    sellMax: ok(v.sellMax) ? v.sellMax : fallback.sellMax,
    overrides,
  };
}

export function saveFuturesPrefs(p: FuturesPrefs): void {
  write(KEY_FUTURES, p);
}

/** 民生股頁「自選存股」代號清單（存在瀏覽器本機，不回傳伺服器）。 */
export function loadDefensiveCustom(): string[] {
  const v = read<unknown>(KEY_DEFENSIVE_CUSTOM, []);
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const c = x.trim().toUpperCase();
    if (/^[0-9A-Z]{4,6}$/.test(c) && !out.includes(c)) out.push(c);
    if (out.length >= MAX_DEFENSIVE_CUSTOM) break;
  }
  return out;
}

export function saveDefensiveCustom(codes: readonly string[]): void {
  write(KEY_DEFENSIVE_CUSTOM, codes.slice(0, MAX_DEFENSIVE_CUSTOM));
}

export interface CachedDefensiveRow {
  /** 抓取的台北日期（YYYY-MM-DD） */
  fetched: string;
  row: DefRow;
}

/** 自選存股計算結果快取（每檔約 600 bytes，同日重開頁不重打 FinMind，失敗時也可降級沿用）。 */
export function loadDefensiveCache(): Record<string, CachedDefensiveRow> {
  const v = read<unknown>(KEY_DEFENSIVE_CACHE, null);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, CachedDefensiveRow> = {};
  for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Partial<CachedDefensiveRow>;
    if (typeof rec.fetched === 'string' && rec.row && typeof rec.row === 'object' && typeof rec.row.c === 'string') {
      out[k] = { fetched: rec.fetched, row: rec.row };
    }
  }
  return out;
}

export function saveDefensiveCache(cache: Record<string, CachedDefensiveRow>): void {
  write(KEY_DEFENSIVE_CACHE, cache);
}
