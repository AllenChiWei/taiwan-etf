/* 篩選與排序 —— 全部是純函式，不碰 React 也不碰 DOM，所以能直接用 Node 測。
   由 vanilla 版移植，行為刻意保持一致（測試也一起帶過來了）。

   注意：src/lib 與 types.ts 的相對匯入刻意帶 .ts 副檔名。
   Vite 兩種寫法都能解析，但 Node 的 ESM 要求明確副檔名，
   而 tests/ 是用 node --test 直接載入這些原始檔跑的。 */

import type { Etf, Filters, NumericKey, Section } from '../types.ts';

export const NA = 'N/A';
export const DASH = '—';

/**
 * 搜尋只比對 代號／名稱／保管銀行。
 *
 * 刻意不比對數字欄位：最早的版本比對整列文字，結果輸入任何數字都會命中
 * 殖利率或報酬率裡的零散數值，搜尋等於失效。這是回歸測試守著的行為。
 */
export function matchesQuery(etf: Etf, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return etf.code.toLowerCase().includes(needle)
      || etf.name.toLowerCase().includes(needle)
      || etf.cust.toLowerCase().includes(needle);
}

/** 五個條件是 AND；下拉選單一律完全相等比對（值來自資料本身）。 */
export function filterEtfs(
  etfs: readonly Etf[],
  { q = '', cust = '', freq = '', sec = '', act = '' }: Partial<Filters>,
  onlyCodes?: readonly string[] | null,
): Etf[] {
  const allow = onlyCodes ? new Set(onlyCodes) : null;
  return etfs.filter(e =>
    (!allow || allow.has(e.code)) &&
    (!cust || e.cust === cust) &&
    (!freq || e.freq === freq) &&
    (!sec || e.sec === sec) &&
    // 主動與分區是兩個維度：選了「債券ETF」+「主動」會得到主動債券 ETF，
    // 而不是兩者擇一。做成第七個分區的時候就做不到這件事。
    (!act || (act === 'active' ? e.act : !e.act)) &&
    matchesQuery(e, q));
}

/** 'N/A'、空字串、破折號、無法解析的值一律回 null，排序時沉到最底。 */
export function toNumber(v: string | null | undefined): number | null {
  if (v == null || v === '' || v === NA || v === DASH) return null;
  const n = Number.parseFloat(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 比較兩個數值欄位。N/A 無論升冪降冪都排最後。
 *
 * 回傳的是「升冪」語意的比較結果；TanStack Table 會在降冪時自己取負號，
 * 但那樣會把 N/A 翻到最上面，所以 sortEtfs 另外處理方向。
 */
export function compareNumeric(a: string, b: string): number {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x - y;
}

export type SortDir = 'asc' | 'desc';
export interface SortSpec { key: NumericKey; dir: SortDir; }

/** 排序。N/A 永遠沉底，數值相同時維持代號順序（穩定）。 */
export function sortEtfs(etfs: readonly Etf[], spec: SortSpec | null): Etf[] {
  const out = [...etfs];
  if (!spec) return out.sort((a, b) => a.code.localeCompare(b.code));

  const original = new Map(out.map((e, i) => [e.code, i]));
  const sign = spec.dir === 'asc' ? 1 : -1;

  return out.sort((a, b) => {
    const x = toNumber(a[spec.key]);
    const y = toNumber(b[spec.key]);
    if (x === null && y === null) return original.get(a.code)! - original.get(b.code)!;
    if (x === null) return 1;            // N/A 沉底，不隨方向翻轉
    if (y === null) return -1;
    if (x !== y) return (x - y) * sign;
    return original.get(a.code)! - original.get(b.code)!;
  });
}

export interface SectionGroup extends Section { rows: Etf[]; }

/** 依 sections 定義的順序分組，空的分區略過。 */
export function groupBySection(etfs: readonly Etf[], sections: readonly Section[]): SectionGroup[] {
  const buckets = new Map<string, Etf[]>(sections.map(s => [s.id, []]));
  for (const e of etfs) buckets.get(e.sec)?.push(e);
  return sections
    .map(s => ({ ...s, rows: buckets.get(s.id) ?? [] }))
    .filter(s => s.rows.length > 0);
}

/** 目前套用了幾個下拉條件（搜尋不計入，它有自己的清除鈕）。 */
export function activeFilterCount(f: Partial<Filters>, sort?: SortSpec | null): number {
  return [f.cust, f.freq, f.sec, sort ? 'y' : ''].filter(Boolean).length;
}
