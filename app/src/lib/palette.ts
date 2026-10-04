/* 多檔並列比較用的類別色（配息月曆、年配息來源圓餅、績效比較線）。
 *
 * 原本兩張圖各有一份色表（12 色與 8 色），而且配息圖依代號雜湊挑色：
 * 相鄰的扇形常常落在同一色系（兩種藍、兩種桃紅、兩種藍綠），超過 12 檔還會重複。
 * 改成一份依「重要性排序」給色的色表：第 1 名拿第 1 色，依序往下，
 * 排在後面的統一用灰階（它們本來就是小片，不需要各自辨認，清單裡有名稱與金額）。
 *
 * 實際色值在 styles.css 的 --cat-*（淺色／深色各一組）。六色的順序經過 dataviz 驗證器：
 * 色盲（紅綠、藍黃）相鄰兩色都分得開、亮度與彩度在可讀範圍。刻意不含紅綠 ——
 * 台股語境紅綠代表漲跌，用在這裡會被誤讀。黃、青、粉在淺色底對比不到 3:1，
 * 所以每張圖旁邊一定有文字清單（代號＋數字），不能只靠顏色辨識。
 */

export const CATEGORY_COLORS = [
  'var(--cat-1)', // 藍
  'var(--cat-2)', // 橘
  'var(--cat-3)', // 青
  'var(--cat-4)', // 黃
  'var(--cat-5)', // 粉
  'var(--cat-6)', // 紫
] as const;

/** 第 7 名之後：兩種灰交替，相鄰的小扇形仍分得開 */
const TAIL_COLORS = ['var(--cat-tail-a)', 'var(--cat-tail-b)'] as const;

/** 依名次（0 起算）給色 */
export function rankColor(i: number): string {
  if (i < CATEGORY_COLORS.length) return CATEGORY_COLORS[i];
  return TAIL_COLORS[(i - CATEGORY_COLORS.length) % TAIL_COLORS.length];
}

/** 依排好的代號清單建立 代號 -> 顏色 */
export function rankColorMap(codesInRankOrder: string[]): Map<string, string> {
  return new Map(codesInRankOrder.map((c, i) => [c, rankColor(i)]));
}
