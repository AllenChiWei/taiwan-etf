/* localStorage 包裝。
   無痕模式、封鎖 cookie、或儲存空間已滿時每個存取都可能丟例外，
   所以一律 try/catch，失敗就退回記憶體內的值，頁面照常運作。 */

const KEY_FAVORITES = 'twetf.favorites';
const KEY_THEME = 'twetf.theme';
const KEY_CHANGELOG = 'twetf.changelogSeen';
const KEY_FUTURES = 'twetf.futuresPrefs';

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
