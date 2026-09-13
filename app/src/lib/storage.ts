/* localStorage 包裝。
   無痕模式、封鎖 cookie、或儲存空間已滿時每個存取都可能丟例外，
   所以一律 try/catch，失敗就退回記憶體內的值，頁面照常運作。 */

const KEY_FAVORITES = 'twetf.favorites';
const KEY_THEME = 'twetf.theme';

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
