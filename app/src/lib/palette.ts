/* 多檔並列比較用的類別色（配息月曆、年配息來源圓餅、績效比較線）。
 *
 * 原本兩張圖各有一份色表（12 色與 8 色），而且配息圖依代號雜湊挑色：
 * 相鄰的扇形常常落在同一色系（兩種藍、兩種桃紅、兩種藍綠），超過 12 檔還會重複。
 * 改成一份依「重要性排序」給色的色表：第 1 名拿第 1 色，依序往下，
 * 前 8 名的顏色色相彼此拉開，排在後面的統一用灰階（它們本來就是小片，不需要各自辨認）。
 *
 * 刻意避開紅綠 —— 台股語境紅綠代表漲跌，用在這裡會被誤讀。
 */

export const CATEGORY_COLORS = [
  '#2563eb', // 藍
  '#f59e0b', // 琥珀
  '#8b5cf6', // 紫
  '#0d9488', // 深青
  '#db2777', // 桃紅
  '#8b5a2b', // 棕
  '#38bdf8', // 天藍
  '#3730a3', // 靛
] as const;

/** 第 9 名之後：兩種灰交替，相鄰的小扇形仍分得開 */
const TAIL_COLORS = ['#94a3b8', '#cbd5e1'] as const;

/** 依名次（0 起算）給色 */
export function rankColor(i: number): string {
  if (i < CATEGORY_COLORS.length) return CATEGORY_COLORS[i];
  return TAIL_COLORS[(i - CATEGORY_COLORS.length) % TAIL_COLORS.length];
}

/** 依排好的代號清單建立 代號 -> 顏色 */
export function rankColorMap(codesInRankOrder: string[]): Map<string, string> {
  return new Map(codesInRankOrder.map((c, i) => [c, rankColor(i)]));
}
