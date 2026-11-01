/* 支出預估（#/budget，私人頁）的純計算：每一項開銷照頻率攤到 12 個月，算全年、每月與分類合計。
 * 2026-11-01 使用者要求：記錄每月／每年的各種開銷、可新增修改，看每個月可能要付多少、預抓一年的花費。
 * 這裡只是「預估」，不是記帳：一項開銷記一次金額與頻率，不記每一次實際付款。 */

/** 每幾個月付一次：1＝每月、12＝每年。 */
export type Every = 1 | 2 | 3 | 6 | 12;

export interface BudgetItem {
  id: string;
  name: string;
  cat: string;
  /** 每次付的金額（元） */
  amount: number;
  every: Every;
  /** 第一次付款的月份 1～12；每月付的不看這欄 */
  month: number;
  note?: string;
  /** 暫停：留著但不算進合計（例如已經繳清、還沒確定要不要） */
  off?: boolean;
}

export interface BudgetData { v: 1; generated: string; items: BudgetItem[] }

export const EVERY: readonly { every: Every; label: string }[] = [
  { every: 1, label: '每月' },
  { every: 2, label: '每兩個月' },
  { every: 3, label: '每季' },
  { every: 6, label: '每半年' },
  { every: 12, label: '每年' },
];

export const everyLabel = (e: Every) => EVERY.find(x => x.every === e)?.label ?? `每 ${e} 個月`;

/** 分類下拉的預設選項；使用者自己打的新分類也照樣能用。 */
export const DEFAULT_CATS = ['居住', '生活', '飲食', '交通', '保險', '稅費', '電信網路', '教育', '醫療', '孝親', '娛樂旅遊', '訂閱', '投資', '其他'];

/** 快速新增的常見項目（台灣的稅單月份：牌照稅 4 月、房屋稅與所得稅 5 月、燃料費 7 月、地價稅 11 月）。 */
export const PRESETS: readonly Omit<BudgetItem, 'id' | 'amount'>[] = [
  { name: '房租／房貸', cat: '居住', every: 1, month: 1 },
  { name: '管理費', cat: '居住', every: 1, month: 1 },
  { name: '水電瓦斯', cat: '居住', every: 2, month: 1 },
  { name: '手機網路', cat: '電信網路', every: 1, month: 1 },
  { name: '生活費', cat: '生活', every: 1, month: 1 },
  { name: '雜費', cat: '其他', every: 1, month: 1 },
  { name: '伙食', cat: '飲食', every: 1, month: 1 },
  // 學費一學期繳一次：上學期 8 月、下學期 2 月（2026-11-01 使用者要求加學費／生活費／雜費／投資）
  { name: '學費', cat: '教育', every: 6, month: 2 },
  { name: '投資', cat: '投資', every: 1, month: 1 },
  { name: '油錢／交通', cat: '交通', every: 1, month: 1 },
  { name: '汽機車保險', cat: '保險', every: 12, month: 1 },
  { name: '壽險／醫療險', cat: '保險', every: 12, month: 1 },
  { name: '牌照稅', cat: '稅費', every: 12, month: 4 },
  { name: '房屋稅', cat: '稅費', every: 12, month: 5 },
  { name: '所得稅', cat: '稅費', every: 12, month: 5 },
  { name: '燃料費', cat: '稅費', every: 12, month: 7 },
  { name: '地價稅', cat: '稅費', every: 12, month: 11 },
  { name: '孝親費', cat: '孝親', every: 1, month: 1 },
  { name: '旅遊', cat: '娛樂旅遊', every: 12, month: 7 },
  { name: '紅包／年節', cat: '其他', every: 12, month: 2 },
];

/** 這一項在第 m 月（1～12）要不要付。 */
export function paysIn(item: BudgetItem, m: number): boolean {
  if (item.every === 1) return true;
  return (((m - item.month) % item.every) + item.every) % item.every === 0;
}

/** 這一項一年中付款的月份。 */
export const payMonths = (item: BudgetItem) => Array.from({ length: 12 }, (_, i) => i + 1).filter(m => paysIn(item, m));

/** 頻率的文字：「每月」「每年 5 月」「每季（2、5、8、11 月）」。 */
export function scheduleText(item: BudgetItem): string {
  if (item.every === 1) return '每月';
  if (item.every === 12) return `每年 ${item.month} 月`;
  return `${everyLabel(item.every)}（${payMonths(item).join('、')} 月）`;
}

/** 一年付幾次。 */
export const timesPerYear = (item: BudgetItem) => 12 / item.every;

/** 換算成一年的金額。 */
export const perYear = (item: BudgetItem) => item.amount * timesPerYear(item);

const active = (items: readonly BudgetItem[]) => items.filter(x => !x.off);

/** 1～12 月各月要付的金額；`fixed` 是每月都付的部分，其餘是集中在某幾個月的。 */
export function monthTotals(items: readonly BudgetItem[]): { m: number; total: number; fixed: number }[] {
  const on = active(items);
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    let total = 0, fixed = 0;
    for (const x of on) {
      if (!paysIn(x, m)) continue;
      total += x.amount;
      if (x.every === 1) fixed += x.amount;
    }
    return { m, total, fixed };
  });
}

export const yearTotal = (items: readonly BudgetItem[]) => active(items).reduce((a, x) => a + perYear(x), 0);

/** 各分類的全年金額與占比，大的在前。 */
export function byCategory(items: readonly BudgetItem[]): { cat: string; year: number; share: number; n: number }[] {
  const total = yearTotal(items);
  const map = new Map<string, { year: number; n: number }>();
  for (const x of active(items)) {
    const c = map.get(x.cat) ?? { year: 0, n: 0 };
    c.year += perYear(x); c.n += 1;
    map.set(x.cat, c);
  }
  return [...map].map(([cat, c]) => ({ cat, year: c.year, n: c.n, share: total > 0 ? c.year / total : 0 }))
    .sort((a, b) => b.year - a.year);
}

/** 分類清單：預設的在前，使用者自己加的補在後。 */
export function categories(items: readonly BudgetItem[]): string[] {
  const out = [...DEFAULT_CATS];
  for (const x of items) if (x.cat && !out.includes(x.cat)) out.push(x.cat);
  return out;
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const EVERY_SET = new Set<number>(EVERY.map(x => x.every));

/** 從加密檔解出來的資料逐欄檢查；格式不對的項目丟掉，不讓一筆壞資料弄壞整頁。 */
export function cleanBudget(raw: unknown): BudgetData {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as { generated?: unknown; items?: unknown };
  const items: BudgetItem[] = [];
  for (const x of Array.isArray(r.items) ? r.items : []) {
    if (typeof x !== 'object' || x === null) continue;
    const o = x as Record<string, unknown>;
    const amount = Number(o.amount), every = Number(o.every), month = Number(o.month);
    if (typeof o.name !== 'string' || !o.name.trim() || !Number.isFinite(amount) || amount < 0 || !EVERY_SET.has(every)) continue;
    items.push({
      id: typeof o.id === 'string' && o.id ? o.id : newId(),
      name: o.name.trim(),
      cat: typeof o.cat === 'string' && o.cat.trim() ? o.cat.trim() : '其他',
      amount,
      every: every as Every,
      month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1,
      ...(typeof o.note === 'string' && o.note.trim() ? { note: o.note.trim() } : {}),
      ...(o.off === true ? { off: true } : {}),
    });
  }
  return { v: 1, generated: typeof r.generated === 'string' ? r.generated : '', items };
}
