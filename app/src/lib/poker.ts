/* 德州撲克手牌範圍：13×13 矩陣、標準記號解析、組合數計算。
 *
 * 純函式，沒有 React —— tests/poker.test.ts 直接對真的邏輯跑。
 *
 * ## 13×13 矩陣怎麼讀
 *
 * 橫豎都是 A K Q J T 9 8 7 6 5 4 3 2。
 *
 *   對角線     = 對子（AA、KK…），每種 6 種組合
 *   右上三角   = 同花（AKs、AQs…），每種 4 種組合
 *   左下三角   = 不同花（AKo、AQo…），每種 12 種組合
 *
 * 13 × 13 = 169 種起手牌，合計 6×13 + 4×78 + 12×78 = 1326 種組合。
 * 範圍的百分比講的是組合數佔 1326 的比例，不是 169 分之幾 ——
 * 這兩個數字差很多（AA 是 169 分之 1 = 0.6%，但組合上只有 6/1326 = 0.45%）。
 */

/** 由大到小。矩陣的列與欄都用這個順序。 */
export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;

export type Rank = typeof RANKS[number];

const RANK_INDEX: Record<string, number> = Object.fromEntries(
  RANKS.map((r, i) => [r, i]));

export const TOTAL_COMBOS = 1326;

export type HandKind = 'pair' | 'suited' | 'offsuit';

export interface Hand {
  /** 'AA' | 'AKs' | 'AKo' */
  key: string;
  kind: HandKind;
  /** 這手牌有幾種組合：對子 6、同花 4、不同花 12 */
  combos: number;
  /** 在矩陣裡的位置 */
  row: number;
  col: number;
}

export function combosOf(kind: HandKind): number {
  return kind === 'pair' ? 6 : kind === 'suited' ? 4 : 12;
}

/** (列, 欄) -> 手牌。列欄都是 RANKS 的索引。 */
export function handAt(row: number, col: number): Hand {
  const hi = RANKS[Math.min(row, col)];
  const lo = RANKS[Math.max(row, col)];
  if (row === col) {
    return { key: `${hi}${hi}`, kind: 'pair', combos: 6, row, col };
  }
  // 右上是同花：列索引比欄索引小，代表列的牌比較大
  const kind: HandKind = row < col ? 'suited' : 'offsuit';
  return {
    key: `${hi}${lo}${kind === 'suited' ? 's' : 'o'}`,
    kind,
    combos: combosOf(kind),
    row,
    col,
  };
}

/** 整個 13×13，逐列。 */
export function allHands(): Hand[][] {
  return RANKS.map((_, r) => RANKS.map((__, c) => handAt(r, c)));
}

/* ── 範圍記號解析 ──────────────────────────────────────────────
 *
 * 支援業界標準寫法，用逗號分隔：
 *
 *   AA            單一手牌
 *   77+           77 以上的對子（77, 88, … AA）
 *   ATs+          同一張高牌、低牌往上（ATs, AJs, AQs, AKs）
 *   A5s-A2s       明確區間
 *   KTo+          不同花也一樣
 *   22-55         對子區間
 *
 * 寫不出來的東西（例如 "AKs:0.5" 這種混合頻率）刻意不支援：
 * 這頁是給人看的開牌表，不是求解器輸出。
 */

const PAIR = /^([AKQJT2-9])\1(\+)?$/;
const PAIR_RANGE = /^([AKQJT2-9])\1-([AKQJT2-9])\2$/;
const HAND = /^([AKQJT2-9])([AKQJT2-9])([so])(\+)?$/;
const HAND_RANGE = /^([AKQJT2-9])([AKQJT2-9])([so])-([AKQJT2-9])([AKQJT2-9])([so])$/;

function pairKey(i: number): string {
  return `${RANKS[i]}${RANKS[i]}`;
}

function handKey(hi: number, lo: number, suit: 's' | 'o'): string {
  return `${RANKS[hi]}${RANKS[lo]}${suit}`;
}

/**
 * 把範圍字串展開成手牌集合。
 *
 * 看不懂的片段會丟出例外而不是安靜忽略 —— 開牌表打錯一個字就少一手牌，
 * 而少掉的那手牌在畫面上看不出來，只會讓人照著錯的表打。
 */
export function parseRange(notation: string): Set<string> {
  const out = new Set<string>();
  for (const raw of notation.split(',')) {
    const t = raw.trim();
    if (!t) continue;

    const pr = PAIR_RANGE.exec(t);
    if (pr) {
      const a = RANK_INDEX[pr[1]];
      const b = RANK_INDEX[pr[2]];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(pairKey(i));
      continue;
    }

    const p = PAIR.exec(t);
    if (p) {
      const i = RANK_INDEX[p[1]];
      // '+' 代表更大的對子，而索引越小牌越大
      if (p[2]) for (let k = 0; k <= i; k++) out.add(pairKey(k));
      else out.add(pairKey(i));
      continue;
    }

    const hr = HAND_RANGE.exec(t);
    if (hr) {
      if (hr[1] !== hr[4] || hr[3] !== hr[6]) {
        throw new Error(`範圍兩端的高牌與花色必須一致：${t}`);
      }
      const hi = RANK_INDEX[hr[1]];
      const a = RANK_INDEX[hr[2]];
      const b = RANK_INDEX[hr[5]];
      const suit = hr[3] as 's' | 'o';
      for (let lo = Math.min(a, b); lo <= Math.max(a, b); lo++) {
        if (lo === hi) continue;
        out.add(handKey(hi, lo, suit));
      }
      continue;
    }

    const h = HAND.exec(t);
    if (h) {
      const hi = RANK_INDEX[h[1]];
      const lo = RANK_INDEX[h[2]];
      const suit = h[3] as 's' | 'o';
      if (hi === lo) throw new Error(`同一張牌不能組成 ${h[3]}：${t}`);
      if (hi > lo) throw new Error(`高牌要寫在前面：${t}`);
      if (h[4]) {
        // 低牌往上走到高牌的下一張
        for (let k = lo; k > hi; k--) out.add(handKey(hi, k, suit));
      } else {
        out.add(handKey(hi, lo, suit));
      }
      continue;
    }

    throw new Error(`看不懂的範圍寫法：${t}`);
  }
  return out;
}

/** 這個範圍佔全部 1326 種組合的百分比。 */
export function rangePercent(hands: Set<string>): number {
  let combos = 0;
  for (const key of hands) combos += combosOfKey(key);
  return (combos / TOTAL_COMBOS) * 100;
}

export function combosOfKey(key: string): number {
  if (key.length === 2) return 6;
  return key.endsWith('s') ? 4 : 12;
}

/** 這個範圍一共幾種組合。 */
export function rangeCombos(hands: Set<string>): number {
  let n = 0;
  for (const key of hands) n += combosOfKey(key);
  return n;
}
