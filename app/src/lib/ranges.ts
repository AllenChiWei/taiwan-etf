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

import { parseRange, rangePercent, rangeCombos } from './poker.ts';

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

/* ── 面對開牌的應對 ──────────────────────────────────────────
 *
 * 前面有人開牌時，輪到你的選擇是 3-bet／跟注／蓋牌。沒列進 3-bet 或 call
 * 的就是蓋牌 —— 蓋牌範圍是剩下的部分，不另外寫，否則兩邊會對不起來。
 *
 * ## 為什麼用「位置類型」而不是 15 組獨立的表
 *
 * 六人桌裡「開牌者 × 應對者」有 15 種組合。但決定應對範圍的其實只有兩件事：
 * 開牌者的範圍有多寬，以及你翻牌後有沒有位置。所以按這兩個維度整理：
 *
 *   ip  有位置（HJ/CO/BTN 面對更早的位置）—— 可以跟注較寬，翻牌後好打
 *   sb  小盲            —— 翻牌後永遠先行動，而且身後還有 BB 沒講話，
 *                          所以跟注要窄、傾向 3-bet 或蓋牌
 *   bb  大盲            —— 已經投入一個大盲，底池賠率最好，而且行動到你就結束，
 *                          所以跟注可以非常寬
 *
 * 這樣分是有根據的，不是為了省事：SB 跟 BB 面對同一個開牌者的正確打法本來就
 * 差很多，而 HJ 與 CO 面對 UTG 的打法差別小到不值得分開列。
 */

export type HeroSpot = 'ip' | 'sb' | 'bb';

export interface Defense {
  hero: HeroSpot;
  /** 3-bet（再加注）範圍 */
  threeBet: string;
  /** 跟注範圍。沒進這兩個範圍的就是蓋牌 */
  call: string;
}

export interface ResolvedDefense {
  threeBet: ResolvedRange;
  /** 已經扣掉 3-bet 的跟注範圍 */
  call: ResolvedRange;
  /** 3-bet + 跟注，也就是不蓋牌的比例 */
  defendPercent: number;
}

/**
 * 解析一組防守範圍，並讓 **3-bet 優先於跟注**。
 *
 * 跟注範圍幾乎都寫成 `K2s+` 這種大區間，而 3-bet 範圍裡的 `KTs+` 一定落在
 * 那個區間內。硬要兩邊手寫互斥，得把跟注拆成 `K2s-K9s` 這種不自然的寫法，
 * 而且每次調整 3-bet 都要回頭改跟注 —— 十三組範圍這樣維護必錯。
 *
 * 所以規則是：一手牌同時出現在兩邊時算 3-bet。跟注範圍因此可以照直覺寫成
 * 「我會繼續打的所有牌」，不必先扣掉要再加注的部分。
 */
export function resolveDefense(d: Defense): ResolvedDefense {
  const threeBet = resolve(d.threeBet);
  const raw = parseRange(d.call);
  const call = new Set([...raw].filter(h => !threeBet.hands.has(h)));
  const callRange: ResolvedRange = {
    hands: call,
    percent: rangePercent(call),
    combos: rangeCombos(call),
  };
  return {
    threeBet,
    call: callRange,
    defendPercent: threeBet.percent + callRange.percent,
  };
}

export interface VsOpen {
  /** 開牌者的位置 id */
  vs: string;
  /** 哪些位置可以用 ip 這組（開牌者之後、盲注之前） */
  ipPositions: string[];
  defenses: Defense[];
}

export const HERO_SPOT_LABEL: Record<HeroSpot, string> = {
  ip: '有位置（翻牌後後行動）',
  sb: '小盲注',
  bb: '大盲注',
};

export const VS_OPEN: VsOpen[] = [
  {
    vs: 'utg',
    ipPositions: ['HJ', 'CO', 'BTN'],
    defenses: [
      { hero: 'ip',
        threeBet: 'QQ+, AKs, AKo, A5s-A4s',
        call: 'JJ-77, AQs, AJs, ATs, KQs, KJs, QJs, JTs, T9s, AQo' },
      { hero: 'sb',
        threeBet: 'QQ+, AKs, AKo, A5s',
        call: 'JJ-99, AQs, AJs, KQs' },
      { hero: 'bb',
        threeBet: 'QQ+, AKs, AKo, A5s-A4s, KJs',
        call: 'JJ-22, AQs-ATs, KQs-KTs, QTs+, J9s+, T9s, 98s, 87s, AQo-AJo, KQo' },
    ],
  },
  {
    vs: 'hj',
    ipPositions: ['CO', 'BTN'],
    defenses: [
      { hero: 'ip',
        threeBet: 'JJ+, AQs+, AKo, A5s-A4s',
        call: 'TT-66, AJs-ATs, KQs-KJs, QJs, JTs, T9s, 98s, AQo' },
      { hero: 'sb',
        threeBet: 'JJ+, AQs+, AKo, A5s-A4s',
        call: 'TT-88, AJs, KQs, QJs' },
      { hero: 'bb',
        threeBet: 'JJ+, AQs+, AKo, A5s-A3s, KJs',
        call: 'TT-22, ATs-A6s, KQs-K9s, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, '
            + 'AQo-ATo, KQo-KJo, QJo' },
    ],
  },
  {
    vs: 'co',
    ipPositions: ['BTN'],
    defenses: [
      { hero: 'ip',
        threeBet: 'TT+, AJs+, AQo+, A5s-A3s, KJs+',
        call: '99-55, ATs-A8s, KTs, QTs, JTs, T9s, 98s, 87s, AJo, KQo' },
      { hero: 'sb',
        threeBet: 'TT+, AJs+, AQo+, A5s-A3s',
        call: '99-77, ATs, KQs, QJs, JTs' },
      { hero: 'bb',
        threeBet: 'TT+, AJs+, AQo+, A5s-A2s, KTs+',
        call: '99-22, A9s-A6s, K9s+, Q9s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, '
            + 'AJo-A9o, KQo-KTo, QJo-QTo, JTo' },
    ],
  },
  {
    vs: 'btn',
    ipPositions: [],
    defenses: [
      { hero: 'sb',
        threeBet: '88+, ATs+, AJo+, A5s-A2s, KTs+, QTs+',
        call: '77-22, A9s-A6s, K9s, Q9s, J9s, T9s, 98s, ATo, KQo' },
      { hero: 'bb',
        threeBet: '88+, ATs+, AJo+, A5s-A2s, KTs+, QJs, JTs',
        call: '77-22, A9s-A2s, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, '
            + 'A9o-A2o, K8o+, Q9o+, J9o+, T9o, 98o' },
    ],
  },
  {
    vs: 'sb',
    ipPositions: [],
    defenses: [
      { hero: 'bb',
        threeBet: '77+, A9s+, ATo+, A5s-A2s, K9s+, QTs+, JTs',
        call: '66-22, A8s-A2s, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, '
            + 'A9o-A2o, K8o+, Q9o+, J9o+, T9o, 98o' },
    ],
  },
];

/* ── 座位與行動順序 ─────────────────────────────────────────
 *
 * 六人桌順時針依序坐 BTN → SB → BB → UTG → HJ → CO，行動也是順時針。
 * 差別只在從誰開始：
 *   翻牌前  UTG 先講話（大小盲已經被迫下注了），BB 最後
 *   翻牌後  SB 先講話（按鈕左手邊第一個還在的人），BTN 最後
 * 所以 BTN 翻牌後永遠最後行動，這就是它能開最寬範圍的原因。
 */

/** 順時針的座位順序（從按鈕開始）。 */
export const SEAT_ORDER = ['btn', 'sb', 'bb', 'utg', 'hj', 'co'] as const;

export const PREFLOP_ORDER = ['utg', 'hj', 'co', 'btn', 'sb', 'bb'] as const;
export const POSTFLOP_ORDER = ['sb', 'bb', 'utg', 'hj', 'co', 'btn'] as const;

/** 某個位置在這條街第幾個行動（1 起算）。 */
export function actionRank(pos: string, street: 'preflop' | 'postflop'): number {
  const order: readonly string[] = street === 'preflop' ? PREFLOP_ORDER : POSTFLOP_ORDER;
  return order.indexOf(pos) + 1;
}
