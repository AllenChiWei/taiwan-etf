/* 撲克頁的快速試算與練習：跟注值不值、聽牌出路、對範圍的勝率、翻前範圍測驗。
 *
 * 純函式，沒有 React。牌的表示法與評分沿用 lib/equity.ts（0..51 的整數）。
 */

import {
  evaluate7, categoryOf, CATEGORY_NAMES, makeCard, RANK_CHARS, CARD_COUNT,
  standardError,
} from './equity.ts';
import { handAt } from './poker.ts';
import { POSITIONS, VS_OPEN, resolve, resolveDefense } from './ranges.ts';

/* ── 1. 跟注值不值（底池賠率與 EV） ────────────────────────────
 *
 * pot 是「輪到你時桌上已經有的錢」（含對手剛下的注），call 是你要跟的金額。
 * 跟注之後底池變成 pot + call：贏了拿回全部，輸了損失 call。
 *
 *   需要的勝率 = call ÷ (pot + call)
 *   EV        = 勝率 × pot − (1 − 勝率) × call
 *
 * 這裡算的是「只看這一條街」的 EV，不含之後還會下的注（隱含賠率）。
 */

export function requiredEquity(pot: number, call: number): number | null {
  if (!(pot >= 0) || !(call > 0)) return null;
  return (call / (pot + call)) * 100;
}

/** equity 是百分比（0–100）。 */
export function callEv(equity: number, pot: number, call: number): number | null {
  if (!(pot >= 0) || !(call > 0) || !Number.isFinite(equity)) return null;
  const p = equity / 100;
  return p * pot - (1 - p) * call;
}

/* ── 3. 聽牌出路 ─────────────────────────────────────────────
 *
 * 一張沒看過的牌算「出路」的條件：
 *   1. 加上它之後你的牌型變大，而且
 *   2. 變大後的牌型比「只看公牌加這張」還大 —— 也就是你的手牌有出力。
 * 第 2 條是為了排除「公牌自己成對」這種假出路：你拿 AK、公牌 7-7-2，
 * 再來一張 2 讓你變兩對，但對手人人都有這兩對，那不是你的出路。
 *
 * 這是一般講「出路」的算法：不考慮對手手牌，也不扣掉「中了但對手更大」的情況。
 */

export interface Outs {
  /** 目前的牌型名稱 */
  current: string;
  /** 出路的牌 */
  cards: number[];
  /** 依中了之後的牌型分組：{同花: [牌…], 順子: [牌…]} */
  byCategory: Record<string, number[]>;
  /** 還沒看過的牌數（翻牌圈 47、轉牌圈 46） */
  unseen: number;
}

export function countOuts(hero: readonly number[], board: readonly number[]): Outs | null {
  if (hero.length !== 2 || (board.length !== 3 && board.length !== 4)) return null;
  const known = new Set([...hero, ...board]);
  const now = categoryOf(evaluate7([...hero, ...board]));
  const cards: number[] = [];
  const byCategory: Record<string, number[]> = {};
  for (let c = 0; c < CARD_COUNT; c++) {
    if (known.has(c)) continue;
    const mine = categoryOf(evaluate7([...hero, ...board, c]));
    const boardOnly = categoryOf(evaluate7([...board, c]));
    if (mine > now && mine > boardOnly) {
      cards.push(c);
      const name = CATEGORY_NAMES[mine];
      (byCategory[name] ??= []).push(c);
    }
  }
  return { current: CATEGORY_NAMES[now], cards, byCategory, unseen: CARD_COUNT - known.size };
}

/** 從 n 張出路、unseen 張沒看過的牌裡，接下來 draws 張（1 或 2）至少中一張的機率（%）。 */
export function hitChance(outs: number, unseen: number, draws: 1 | 2): number {
  if (outs <= 0 || unseen <= 0) return 0;
  if (draws === 1) return (outs / unseen) * 100;
  const miss = ((unseen - outs) / unseen) * ((unseen - 1 - outs) / (unseen - 1));
  return (1 - miss) * 100;
}

/** 2／4 法則：翻牌圈看兩張 ≈ 出路 × 4，只看一張 ≈ 出路 × 2。 */
export function ruleOfTwoFour(outs: number, draws: 1 | 2): number {
  return Math.min(100, outs * (draws === 2 ? 4 : 2));
}

/* ── 2. 對範圍的勝率 ─────────────────────────────────────────
 *
 * 對手不是一手固定的牌，而是一個範圍（例如「UTG 開牌範圍」）。做法是蒙地卡羅：
 * 每一輪從範圍裡抽一手（依組合數，AA 有 6 種、AKs 有 4 種），再把公牌補齊比大小。
 * 跟你的牌或公牌撞牌的組合先剔除 —— 你拿著 A♠，對手就不可能有 A♠K♠。
 */

/** 'AKs' / 'AKo' / 'QQ' -> 所有具體的兩張牌組合。 */
export function expandHand(key: string): [number, number][] {
  const r1 = RANK_CHARS.indexOf(key[0]);
  const r2 = RANK_CHARS.indexOf(key[1]);
  if (r1 < 0 || r2 < 0) return [];
  const out: [number, number][] = [];
  if (r1 === r2) {
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) out.push([makeCard(r1, a), makeCard(r1, b)]);
  } else if (key[2] === 's') {
    for (let s = 0; s < 4; s++) out.push([makeCard(r1, s), makeCard(r2, s)]);
  } else {
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) out.push([makeCard(r1, a), makeCard(r2, b)]);
  }
  return out;
}

export interface RangeEquity {
  win: number;
  tie: number;
  lose: number;
  equity: number;
  /** 撞牌剔除後，範圍裡還剩幾個組合 */
  combos: number;
  trials: number;
}

/** 對範圍勝率抽樣的標準誤（百分點），與 equity.ts 共用三值樣本變異公式。 */
export function rangeStandardError(result: RangeEquity): number {
  return standardError({
    win: result.win,
    tie: result.tie,
    iterations: result.trials,
    exact: false,
  });
}

/** 可以注入亂數產生器，測試才能重現。 */
export function rangeEquity(hero: readonly number[], range: Iterable<string>,
                            board: readonly number[], trials = 40_000,
                            rand: () => number = Math.random): RangeEquity | null {
  const dead = new Set([...hero, ...board]);
  const combos = [...range].flatMap(expandHand).filter(([a, b]) => !dead.has(a) && !dead.has(b));
  if (hero.length !== 2 || combos.length === 0) return null;

  let win = 0;
  let tie = 0;
  let lose = 0;
  const need = 5 - board.length;
  const deck: number[] = [];
  for (let t = 0; t < trials; t++) {
    const [v1, v2] = combos[Math.floor(rand() * combos.length)];
    deck.length = 0;
    for (let c = 0; c < CARD_COUNT; c++) if (!dead.has(c) && c !== v1 && c !== v2) deck.push(c);
    // 從剩下的牌抽 need 張（部分洗牌）
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rand() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const full = [...board, ...deck.slice(0, need)];
    const h = evaluate7([...hero, ...full]);
    const v = evaluate7([v1, v2, ...full]);
    if (h > v) win++;
    else if (h === v) tie++;
    else lose++;
  }
  return {
    win,
    tie,
    lose,
    equity: trials > 0 ? ((win + tie / 2) / trials) * 100 : 0,
    combos: combos.length,
    trials,
  };
}

/* ── 4. 翻前範圍測驗 ─────────────────────────────────────────
 *
 * 隨機出一個情境與一手牌，讓使用者選動作，跟範圍表對答案。
 * 不依組合數抽 —— 那樣大半是 72o 這種一眼就蓋的牌，練不到邊界；抽法見 makeQuestion。
 */

export type QuizAction = 'open' | 'fold' | '3bet' | 'call';
export type QuizPosition = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type QuizSpotType = 'rfi' | 'vs';

export const QUIZ_POSITIONS: readonly QuizPosition[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export const QUIZ_LABEL: Record<QuizAction, string> = {
  open: '開牌', fold: '蓋牌', '3bet': '3-bet', call: '跟注',
};

export const QUIZ_SPOT_LABEL: Record<QuizSpotType, string> = {
  rfi: '開牌（RFI）',
  vs: '面對開牌（3-bet／跟注）',
};

export interface QuizFilter {
  position?: QuizPosition | 'all';
  spotType?: QuizSpotType | 'all';
}

export interface QuizQuestion {
  /** 情境說明，例如「CO（關煞位），前面的人都蓋牌」 */
  spot: string;
  /** 手牌代號，例如 'AJo' */
  hand: string;
  choices: QuizAction[];
  answer: QuizAction;
  /** 玩家所在位置 */
  position: QuizPosition;
  /** 題型分類：開牌或面對開牌 */
  spotType: QuizSpotType;
}

export interface QuizMiss {
  spot: string;
  hand: string;
  answer: QuizAction;
  picked: QuizAction;
}

/** 169 種手牌的代號。 */
export function allHandKeys(): string[] {
  const out: string[] = [];
  for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) out.push(handAt(r, c).key);
  return out;
}

/** 開牌題：open 是那個位置的開牌範圍。 */
export function rfiAnswer(hand: string, open: Set<string>): QuizAction {
  return open.has(hand) ? 'open' : 'fold';
}

/** 應對題：3-bet 優先於跟注（跟 resolveDefense 同一條規則）。 */
export function defenseAnswer(hand: string, threeBet: Set<string>, call: Set<string>): QuizAction {
  if (threeBet.has(hand)) return '3bet';
  if (call.has(hand)) return 'call';
  return 'fold';
}

/** 檢查某個位置與動作分類的組合是否存在題目（BB 沒有開牌題、UTG 沒有面對開牌題）。 */
export function hasQuizSpots(filter?: QuizFilter): boolean {
  const pos = filter?.position && filter.position !== 'all' ? filter.position : null;
  const spotType = filter?.spotType && filter.spotType !== 'all' ? filter.spotType : null;
  if (pos === 'BB' && spotType === 'rfi') return false;
  if (pos === 'UTG' && spotType === 'vs') return false;
  return true;
}

/**
 * 出一題。答案要平均分布：開牌題一半從範圍內抽、一半從範圍外抽；應對題 3-bet／
 * 跟注／蓋牌各三分之一。否則大半題目都是「72o 蓋牌」，練不到邊界。
 * 可依位置與動作分類（開牌／面對開牌）限定練習範圍。
 */
export function makeQuestion(
  rand: () => number = Math.random,
  filter?: QuizFilter,
): QuizQuestion & { why: string } {
  const pickFrom = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const keys = allHandKeys();
  const posFilter = filter?.position && filter.position !== 'all' ? filter.position : null;
  const spotFilter = filter?.spotType && filter.spotType !== 'all' ? filter.spotType : null;

  const rfiPositions = spotFilter === 'vs'
    ? []
    : POSITIONS.filter(p => p.rfi && (!posFilter || p.label === posFilter));

  const vsScenarios = spotFilter === 'rfi'
    ? []
    : posFilter
      ? VS_OPEN.flatMap(v => v.defenses
          .filter(d => (posFilter === 'SB' ? d.hero === 'sb'
            : posFilter === 'BB' ? d.hero === 'bb'
              : d.hero === 'ip' && v.ipPositions.includes(posFilter)))
          .map(d => ({ v, d, heroLabel: posFilter })))
      : null;

  const canRfi = rfiPositions.length > 0;
  const canVs = spotFilter !== 'rfi' && (vsScenarios === null || vsScenarios.length > 0);
  if (!canRfi && !canVs) {
    throw new Error('這個位置與動作分類沒有對應題目');
  }

  const doRfi = canRfi && (!canVs || rand() < 0.5);
  if (doRfi) {
    const pos = pickFrom(rfiPositions);
    const open = resolve(pos.rfi!);
    const inRange = rand() < 0.5;
    const pool = keys.filter(k => open.hands.has(k) === inRange);
    const hand = pickFrom(pool);
    const answer = rfiAnswer(hand, open.hands);
    return {
      spot: `${pos.label}（${pos.name}），前面的人都蓋牌`,
      hand, choices: ['open', 'fold'], answer,
      position: pos.label as QuizPosition,
      spotType: 'rfi',
      why: `${pos.label} 的開牌範圍是 ${open.percent.toFixed(1)}% 的手牌，${hand} ${answer === 'open' ? '在' : '不在'}裡面。`,
    };
  }

  let v: (typeof VS_OPEN)[number];
  let d: (typeof VS_OPEN)[number]['defenses'][number];
  let heroLabel: QuizPosition;
  if (vsScenarios) {
    const picked = pickFrom(vsScenarios);
    v = picked.v;
    d = picked.d;
    heroLabel = picked.heroLabel;
  } else {
    v = pickFrom(VS_OPEN);
    d = pickFrom(v.defenses);
    heroLabel = (d.hero === 'ip' ? pickFrom(v.ipPositions) : d.hero === 'sb' ? 'SB' : 'BB') as QuizPosition;
  }
  const r = resolveDefense(d);
  const want = pickFrom<QuizAction>(['3bet', 'call', 'fold']);
  const pool = keys.filter(k => defenseAnswer(k, r.threeBet.hands, r.call.hands) === want);
  const hand = pickFrom(pool.length ? pool : keys);
  const answer = defenseAnswer(hand, r.threeBet.hands, r.call.hands);
  const opener = POSITIONS.find(p => p.id === v.vs)!;
  return {
    spot: `你在 ${heroLabel}，${opener.label} 開牌加注，輪到你`,
    hand, choices: ['3bet', 'call', 'fold'], answer,
    position: heroLabel,
    spotType: 'vs',
    why: `這個情況 3-bet ${r.threeBet.percent.toFixed(1)}%、跟注 ${r.call.percent.toFixed(1)}%，其餘蓋牌；${hand} 屬於「${QUIZ_LABEL[answer]}」。`,
  };
}

/** 從錯題紀錄的情境文字解析位置與題型，相容既有的 localStorage 格式。 */
export function parseMissMeta(miss: Pick<QuizMiss, 'spot' | 'answer' | 'picked'>): {
  position: QuizPosition | null;
  spotType: QuizSpotType;
  opener: QuizPosition | null;
} {
  const rfi = /^(UTG|HJ|CO|BTN|SB|BB)（/.exec(miss.spot);
  if (rfi) {
    return { position: rfi[1] as QuizPosition, spotType: 'rfi', opener: null };
  }
  const vs = /^你在 (UTG|HJ|CO|BTN|SB|BB)，(UTG|HJ|CO|BTN|SB|BB) 開牌加注/.exec(miss.spot);
  if (vs) {
    return {
      position: vs[1] as QuizPosition,
      spotType: 'vs',
      opener: vs[2] as QuizPosition,
    };
  }
  const spotType: QuizSpotType =
    miss.answer === 'open' || miss.picked === 'open' ? 'rfi' : 'vs';
  return { position: null, spotType, opener: null };
}

/** 依位置與動作分類篩選錯題清單。 */
export function filterMisses(misses: readonly QuizMiss[], filter?: QuizFilter): QuizMiss[] {
  const posFilter = filter?.position && filter.position !== 'all' ? filter.position : null;
  const spotFilter = filter?.spotType && filter.spotType !== 'all' ? filter.spotType : null;
  return misses.filter(m => {
    const meta = parseMissMeta(m);
    if (posFilter && meta.position !== posFilter) return false;
    if (spotFilter && meta.spotType !== spotFilter) return false;
    return true;
  });
}

/** 將錯題紀錄還原成可重做的題目與範圍解析。 */
export function questionFromMiss(miss: QuizMiss): QuizQuestion & { why: string } {
  const meta = parseMissMeta(miss);
  if (meta.spotType === 'rfi') {
    const pos = meta.position ? POSITIONS.find(p => p.label === meta.position) : undefined;
    const open = pos?.rfi ? resolve(pos.rfi) : null;
    return {
      spot: miss.spot,
      hand: miss.hand,
      choices: ['open', 'fold'],
      answer: miss.answer,
      position: meta.position ?? 'UTG',
      spotType: 'rfi',
      why: open && pos
        ? `${pos.label} 的開牌範圍是 ${open.percent.toFixed(1)}% 的手牌，${miss.hand} ${miss.answer === 'open' ? '在' : '不在'}裡面。`
        : `這題的正確動作是「${QUIZ_LABEL[miss.answer]}」。`,
    };
  }

  const v = meta.opener ? VS_OPEN.find(x => x.vs === meta.opener!.toLowerCase()) : undefined;
  const heroSpot = meta.position === 'SB' ? 'sb' : meta.position === 'BB' ? 'bb' : 'ip';
  const d = v?.defenses.find(x => x.hero === heroSpot);
  const r = d ? resolveDefense(d) : null;
  return {
    spot: miss.spot,
    hand: miss.hand,
    choices: ['3bet', 'call', 'fold'],
    answer: miss.answer,
    position: meta.position ?? 'BB',
    spotType: 'vs',
    why: r
      ? `這個情況 3-bet ${r.threeBet.percent.toFixed(1)}%、跟注 ${r.call.percent.toFixed(1)}%，其餘蓋牌；${miss.hand} 屬於「${QUIZ_LABEL[miss.answer]}」。`
      : `這題的正確動作是「${QUIZ_LABEL[miss.answer]}」。`,
  };
}

/** 新增錯題到最前面；同一情境與手牌只保留最新一筆，最多保留 limit 筆。 */
export function recordMiss(misses: readonly QuizMiss[], next: QuizMiss, limit = 20): QuizMiss[] {
  const deduped = misses.filter(m => !(m.spot === next.spot && m.hand === next.hand));
  return [next, ...deduped].slice(0, limit);
}

/** 將已訂正的錯題從清單移出。 */
export function removeMiss(
  misses: readonly QuizMiss[],
  target: Pick<QuizMiss, 'spot' | 'hand'>,
): QuizMiss[] {
  return misses.filter(m => !(m.spot === target.spot && m.hand === target.hand));
}

/** 從錯題清單挑一題重做；超過一題時盡量避開剛做過的那題。 */
export function pickMissQuestion(
  misses: readonly QuizMiss[],
  rand: () => number = Math.random,
  exclude?: Pick<QuizMiss, 'spot' | 'hand'>,
): (QuizQuestion & { why: string }) | null {
  if (misses.length === 0) return null;
  const pool = exclude && misses.length > 1
    ? misses.filter(m => !(m.spot === exclude.spot && m.hand === exclude.hand))
    : misses;
  const list = pool.length > 0 ? pool : misses;
  const picked = list[Math.floor(rand() * list.length)];
  return questionFromMiss(picked);
}
