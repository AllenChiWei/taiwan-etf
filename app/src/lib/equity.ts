/* 德州撲克勝率計算：七張牌評分 + 權益列舉／抽樣。
 *
 * 純函式，沒有 React —— tests/equity.test.ts 直接對真的邏輯驗證已知牌型與已知勝率。
 *
 * ## 牌的表示法
 *
 * 一張牌是 0..51 的整數：`rank = card >> 2`（0=2 … 12=A），`suit = card & 3`。
 * 用整數而不是物件，是因為最壞情況要跑上百萬次評分，物件配置會變成瓶頸。
 *
 * ## 精確列舉 vs 蒙地卡羅
 *
 * 未知的牌少的時候直接窮舉，答案是精確的：
 *
 *   雙方手牌已知 + 翻牌圈  C(45,2) = 990 種
 *   雙方手牌已知 + 轉牌圈  44 種
 *   雙方手牌已知 + 翻牌前  C(48,5) = 1,712,304 種 —— 還在可算的範圍
 *
 * 對手未知（隨機兩張）時，要再乘上 C(剩牌,2)：翻牌前是 1225 × 171 萬 ≈ 21 億，
 * 不可能窮舉，改用蒙地卡羅。結果會標明用的是哪一種，精確就是精確，
 * 抽樣就講清楚是抽樣以及誤差多大。
 */

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'shdc';           // 黑桃 紅心 方塊 梅花
export const SUIT_LABELS = ['♠', '♥', '♦', '♣'];

export const CARD_COUNT = 52;

export function makeCard(rank: number, suit: number): number {
  return (rank << 2) | suit;
}

export function cardRank(card: number): number {
  return card >> 2;
}

export function cardSuit(card: number): number {
  return card & 3;
}

/** 0..51 -> 'As'、'Td'。 */
export function cardName(card: number): string {
  return RANK_CHARS[cardRank(card)] + SUIT_CHARS[cardSuit(card)];
}

/** 'As' -> 0..51；看不懂就丟例外。 */
export function parseCard(text: string): number {
  const t = text.trim();
  if (t.length !== 2) throw new Error(`看不懂的牌：${text}`);
  const r = RANK_CHARS.indexOf(t[0].toUpperCase());
  const s = SUIT_CHARS.indexOf(t[1].toLowerCase());
  if (r < 0 || s < 0) throw new Error(`看不懂的牌：${text}`);
  return makeCard(r, s);
}

/* ── 牌型評分 ────────────────────────────────────────────────
 *
 * 回傳一個整數，越大越好。高 3 位是牌型類別，低位是同類別內的比大小依據
 * （踢腳以 13 進位打包）。跨類別時類別項一定壓過低位，所以直接比大小就對。
 */

const P = 13 ** 5;                          // 371293，低位最大值 371292

export const CATEGORY_NAMES = [
  '高牌', '一對', '兩對', '三條', '順子', '同花', '葫蘆', '四條', '同花順',
] as const;

export function categoryOf(score: number): number {
  return Math.floor(score / P);
}

/** 給一個 13 位元的點數遮罩，回傳最大順子的頂端點數；沒有就 -1。 */
function straightHigh(mask: number): number {
  for (let hi = 12; hi >= 4; hi--) {
    const need = 0b11111 << (hi - 4);
    if ((mask & need) === need) return hi;
  }
  // A2345：A 是 12，5432 是 3210，頂端算 5（索引 3）
  const wheel = (1 << 12) | 0b1111;
  return (mask & wheel) === wheel ? 3 : -1;
}

/**
 * 七張牌的最佳五張分數。
 *
 * 不真的去列舉 C(7,5)=21 種組合再挑最好的 —— 那樣每次評分要做 21 次工作。
 * 直接從點數分布與花色分布判斷牌型，快一個數量級，而最壞情況要跑上百萬次。
 */
export function evaluate7(cards: readonly number[]): number {
  const rankCount = new Int8Array(13);
  const suitCount = new Int8Array(4);
  const suitMask = new Int32Array(4);

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    rankCount[r]++;
    suitCount[s]++;
    suitMask[s] |= 1 << r;
  }

  // 同花／同花順。七張牌最多只有一門能湊到五張，所以找到就是它
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] < 5) continue;
    const mask = suitMask[s];
    const sf = straightHigh(mask);
    if (sf >= 0) return 8 * P + sf;
    let v = 0;
    let taken = 0;
    for (let r = 12; r >= 0 && taken < 5; r--) {
      if (mask & (1 << r)) { v = v * 13 + r; taken++; }
    }
    return 5 * P + v;
  }

  let mask = 0;
  let quad = -1;
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 12; r >= 0; r--) {
    const n = rankCount[r];
    if (n === 0) continue;
    mask |= 1 << r;
    if (n === 4) { if (quad < 0) quad = r; }
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
  }

  if (quad >= 0) {
    let k = -1;
    for (let r = 12; r >= 0; r--) if (r !== quad && rankCount[r]) { k = r; break; }
    return 7 * P + quad * 13 + k;
  }

  // 葫蘆：一組三條 + 另一組三條或對子。七張牌可能有兩組三條
  if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
    const top = trips[0];
    const second = trips.length > 1
      ? Math.max(trips[1], pairs.length ? pairs[0] : -1)
      : pairs[0];
    return 6 * P + top * 13 + second;
  }

  const st = straightHigh(mask);
  if (st >= 0) return 4 * P + st;

  if (trips.length > 0) {
    const t = trips[0];
    let v = 0;
    let taken = 0;
    for (let r = 12; r >= 0 && taken < 2; r--) {
      if (r !== t && rankCount[r]) { v = v * 13 + r; taken++; }
    }
    return 3 * P + t * 169 + v;
  }

  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    let k = -1;
    for (let r = 12; r >= 0; r--) if (r !== p1 && r !== p2 && rankCount[r]) { k = r; break; }
    return 2 * P + p1 * 169 + p2 * 13 + k;
  }

  if (pairs.length === 1) {
    const p = pairs[0];
    let v = 0;
    let taken = 0;
    for (let r = 12; r >= 0 && taken < 3; r--) {
      if (r !== p && rankCount[r]) { v = v * 13 + r; taken++; }
    }
    return 1 * P + p * 2197 + v;
  }

  let v = 0;
  let taken = 0;
  for (let r = 12; r >= 0 && taken < 5; r--) {
    if (rankCount[r]) { v = v * 13 + r; taken++; }
  }
  return v;
}

/* ── 權益計算 ────────────────────────────────────────────── */

export interface EquityInput {
  /** 你的兩張牌 */
  hero: readonly number[];
  /** 對手的兩張牌；null 代表隨機（未知） */
  villain: readonly number[] | null;
  /** 已翻開的公牌，0 / 3 / 4 / 5 張 */
  board: readonly number[];
  /** 需要抽樣時跑幾次 */
  trials?: number;
}

export interface EquityResult {
  win: number;
  tie: number;
  lose: number;
  /** 勝率（平手算半勝），百分比 */
  equity: number;
  /** true 表示窮舉，結果是精確的 */
  exact: boolean;
  /** 實際算了幾種情況 */
  iterations: number;
}

/** 超過這個數量就改用抽樣。1,712,304 是翻牌前雙方已知的窮舉量，要放得進來。 */
const EXACT_LIMIT = 2_000_000;
const DEFAULT_TRIALS = 120_000;

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

function validate(input: EquityInput): number[] {
  const { hero, villain, board } = input;
  if (hero.length !== 2) throw new Error('你的手牌要剛好兩張');
  if (villain && villain.length !== 2) throw new Error('對手手牌要剛好兩張');
  if (![0, 3, 4, 5].includes(board.length)) {
    throw new Error('公牌只能是 0、3、4 或 5 張');
  }
  const used = [...hero, ...(villain ?? []), ...board];
  const seen = new Set(used);
  if (seen.size !== used.length) throw new Error('有重複的牌');
  for (const c of used) {
    if (!Number.isInteger(c) || c < 0 || c >= CARD_COUNT) throw new Error('牌超出範圍');
  }
  return used;
}

export function computeEquity(input: EquityInput): EquityResult {
  const used = validate(input);
  const { hero, villain, board } = input;

  const deck: number[] = [];
  const blocked = new Set(used);
  for (let c = 0; c < CARD_COUNT; c++) if (!blocked.has(c)) deck.push(c);

  const need = 5 - board.length;
  const total = villain
    ? combinations(deck.length, need)
    : combinations(deck.length, 2) * combinations(deck.length - 2, need);

  if (total <= EXACT_LIMIT) {
    return villain
      ? exactKnownVillain(hero, villain, board, deck, need)
      : exactRandomVillain(hero, board, deck, need);
  }
  return sample(hero, villain, board, deck, need, input.trials ?? DEFAULT_TRIALS);
}

function tally(heroScore: number, villainScore: number,
               acc: { w: number; t: number; l: number }): void {
  if (heroScore > villainScore) acc.w++;
  else if (heroScore === villainScore) acc.t++;
  else acc.l++;
}

function finish(acc: { w: number; t: number; l: number },
                exact: boolean): EquityResult {
  const n = acc.w + acc.t + acc.l;
  return {
    win: acc.w,
    tie: acc.t,
    lose: acc.l,
    equity: n ? ((acc.w + acc.t / 2) / n) * 100 : 0,
    exact,
    iterations: n,
  };
}

/** 對手手牌已知：只要窮舉還沒發的公牌。 */
function exactKnownVillain(
  hero: readonly number[], villain: readonly number[],
  board: readonly number[], deck: number[], need: number,
): EquityResult {
  const acc = { w: 0, t: 0, l: 0 };
  const h = [hero[0], hero[1], ...board, 0, 0, 0, 0, 0].slice(0, 7);
  const v = [villain[0], villain[1], ...board, 0, 0, 0, 0, 0].slice(0, 7);
  const base = board.length;

  const pick = new Array<number>(need);
  const walk = (start: number, depth: number) => {
    if (depth === need) {
      for (let i = 0; i < need; i++) {
        h[2 + base + i] = pick[i];
        v[2 + base + i] = pick[i];
      }
      tally(evaluate7(h), evaluate7(v), acc);
      return;
    }
    for (let i = start; i <= deck.length - (need - depth); i++) {
      pick[depth] = deck[i];
      walk(i + 1, depth + 1);
    }
  };
  walk(0, 0);
  return finish(acc, true);
}

/** 對手隨機：先窮舉對手的兩張，再窮舉公牌。 */
function exactRandomVillain(
  hero: readonly number[], board: readonly number[], deck: number[], need: number,
): EquityResult {
  const acc = { w: 0, t: 0, l: 0 };
  for (let a = 0; a < deck.length; a++) {
    for (let b = a + 1; b < deck.length; b++) {
      const rest = deck.filter((_, i) => i !== a && i !== b);
      const r = exactKnownVillain(hero, [deck[a], deck[b]], board, rest, need);
      acc.w += r.win;
      acc.t += r.tie;
      acc.l += r.lose;
    }
  }
  return finish(acc, true);
}

/** 蒙地卡羅。每一輪部分洗牌，取出需要的張數。 */
function sample(
  hero: readonly number[], villain: readonly number[] | null,
  board: readonly number[], deck: number[], need: number, trials: number,
): EquityResult {
  const acc = { w: 0, t: 0, l: 0 };
  const d = deck.slice();
  const draw = need + (villain ? 0 : 2);
  const h = new Array<number>(7);
  const v = new Array<number>(7);
  h[0] = hero[0]; h[1] = hero[1];
  if (villain) { v[0] = villain[0]; v[1] = villain[1]; }
  for (let i = 0; i < board.length; i++) { h[2 + i] = board[i]; v[2 + i] = board[i]; }

  for (let t = 0; t < trials; t++) {
    // 只洗出需要的前 draw 張，不必洗整副
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(Math.random() * (d.length - i));
      const tmp = d[i]; d[i] = d[j]; d[j] = tmp;
    }
    let k = 0;
    if (!villain) { v[0] = d[k++]; v[1] = d[k++]; }
    for (let i = 0; i < need; i++) {
      const c = d[k++];
      h[2 + board.length + i] = c;
      v[2 + board.length + i] = c;
    }
    tally(evaluate7(h), evaluate7(v), acc);
  }
  return finish(acc, false);
}

/**
 * 抽樣結果的標準誤（百分點）。
 *
 * 讓畫面能說「65.3% ± 0.2%」而不是假裝抽樣出來的數字是精確值。
 */
export function standardError(result: EquityResult): number {
  if (result.exact || !result.iterations) return 0;
  const p = result.equity / 100;
  return Math.sqrt((p * (1 - p)) / result.iterations) * 100;
}
