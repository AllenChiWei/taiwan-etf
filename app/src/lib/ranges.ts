/* 6 人桌 100bb 現金局的開牌範圍（RFI, raise first in）。
 *
 * ## 這些數字哪裡來的、可信到什麼程度
 *
 * 這是**常見的 GTO 近似範圍**，不是求解器輸出。真正的 solver 解會給混合頻率
 * （例如 KTo 有 38% 的時候開牌、62% 蓋牌），那種東西做成表格反而難用。
 * 這裡每一手牌只有「開」或「不開」，是把混合策略四捨五入成純策略的結果。
 *
 * 所以：**當成起點，不是標準答案。** 實際該開多寬取決於對手多鬆、
 * 後面位置的人多常 3-bet、桌上的動態如何。
 *
 * 範圍寫法見 lib/poker.ts 的 parseRange()，解析不出來的會直接丟例外 ——
 * 打錯一個字就少一手牌，而少掉的那手在畫面上看不出來。
 *
 * ## 為什麼 BB 沒有開牌範圍
 *
 * 大盲注是最後行動的位置。輪到 BB 時若前面全部蓋牌，BB 已經放了大盲，
 * 直接免費看翻牌，沒有「開牌」這件事 —— 那是 walk。BB 要的是防守範圍
 * （面對某個位置的開牌要跟還是 3-bet），那是另一張表。
 */

import { parseRange, rangePercent, rangeCombos } from './poker';

export interface Position {
  id: string;
  /** 桌上的簡稱 */
  label: string;
  /** 中文說明 */
  name: string;
  /** 距離按鈕還有幾個位置，用來排序與說明 */
  hint: string;
  /** RFI 範圍；BB 沒有 */
  rfi?: string;
}

export const POSITIONS: Position[] = [
  {
    id: 'utg',
    label: 'UTG',
    name: '槍口位',
    hint: '第一個行動，後面還有五個人',
    rfi: '22+, ATs+, A5s-A4s, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo',
  },
  {
    id: 'hj',
    label: 'HJ',
    name: '劫持位',
    hint: '後面還有四個人',
    rfi: '22+, A9s+, A5s-A2s, K9s+, QTs+, J9s+, T9s, 98s, 87s, ATo+, KJo+, QJo',
  },
  {
    id: 'co',
    label: 'CO',
    name: '關煞位',
    hint: '後面還有三個人',
    rfi: '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, 65s, '
       + 'A9o+, KTo+, QTo+, JTo',
  },
  {
    id: 'btn',
    label: 'BTN',
    name: '按鈕位',
    hint: '翻牌後一定最後行動，最有利的位置',
    rfi: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, '
       + 'A2o+, K7o+, Q8o+, J8o+, T8o+, 98o, 87o',
  },
  {
    id: 'sb',
    label: 'SB',
    name: '小盲注',
    hint: '翻牌後永遠先行動，位置最差',
    rfi: '22+, A2s+, K5s+, Q7s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, '
       + 'A2o+, K9o+, Q9o+, J9o+, T9o',
  },
  {
    id: 'bb',
    label: 'BB',
    name: '大盲注',
    hint: '前面都蓋牌時直接免費看翻牌，沒有開牌這回事',
  },
];

export interface ResolvedRange {
  hands: Set<string>;
  percent: number;
  combos: number;
}

/** 解析並算好百分比。範圍寫錯會在這裡就爆掉，而不是畫出一張少牌的表。 */
export function resolve(notation: string): ResolvedRange {
  const hands = parseRange(notation);
  return { hands, percent: rangePercent(hands), combos: rangeCombos(hands) };
}
