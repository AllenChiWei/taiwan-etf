/* 撲克快速試算與練習：底池賠率、出路、對範圍勝率、測驗答案。
 * 數字都用手算得出來的例子釘住。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  requiredEquity, callEv, countOuts, hitChance, ruleOfTwoFour,
  expandHand, rangeEquity, allHandKeys, rfiAnswer, defenseAnswer, makeQuestion,
} from '../src/lib/pokerTools.ts';
import { parseCard } from '../src/lib/equity.ts';
import { actionRank, SEAT_ORDER, PREFLOP_ORDER, POSTFLOP_ORDER } from '../src/lib/ranges.ts';

const cards = (s: string) => s.split(' ').map(parseCard);

test('底池賠率與 EV', async (t) => {
  await t.test('底池 100、跟 50：要 33.3% 勝率', () => {
    assert.equal(requiredEquity(100, 50)!.toFixed(1), '33.3');
  });
  await t.test('勝率剛好等於門檻時 EV 是 0', () => {
    assert.equal(callEv(100 / 3, 100, 50)!.toFixed(6), '0.000000');
  });
  await t.test('勝率 50%、底池 100、跟 50：EV = 50 − 25 = +25', () => {
    assert.equal(callEv(50, 100, 50), 25);
  });
  await t.test('跟注金額是 0 或負的沒有意義', () => {
    assert.equal(requiredEquity(100, 0), null);
    assert.equal(callEv(50, 100, 0), null);
  });
});

test('聽牌出路', async (t) => {
  await t.test('同花聽：9 張出路', () => {
    const o = countOuts(cards('Ah Kh'), cards('7h 2h 9c'))!;
    assert.equal(o.byCategory['同花'].length, 9);
    assert.equal(o.unseen, 47);
  });

  await t.test('兩頭順聽：8 張出路', () => {
    const o = countOuts(cards('9s 8d'), cards('7c 6h 2s'))!;
    assert.equal(o.byCategory['順子'].length, 8);
  });

  await t.test('公牌自己成對不算你的出路', () => {
    // AK 在 7-7-2：再來一張 2，公牌自己變兩對，你沒有出力
    const o = countOuts(cards('Ac Kd'), cards('7s 7h 2c'))!;
    assert.ok(!o.cards.some(c => c === parseCard('2d')), '2 不該算出路');
    // 中 A 或 K 會讓你變兩對（手牌有出力），這才是出路
    assert.ok(o.cards.includes(parseCard('Ah')));
  });

  await t.test('翻牌圈 9 張出路：看兩張 35.0%，2／4 法則說 36%', () => {
    assert.equal(hitChance(9, 47, 2).toFixed(1), '35.0');
    assert.equal(ruleOfTwoFour(9, 2), 36);
    assert.equal(hitChance(9, 46, 1).toFixed(1), '19.6');
  });

  await t.test('河牌圈或手牌不完整時不算', () => {
    assert.equal(countOuts(cards('Ah Kh'), cards('7h 2h 9c 3d 4s')), null);
  });
});

test('手牌代號展開成組合', () => {
  assert.equal(expandHand('AA').length, 6);
  assert.equal(expandHand('AKs').length, 4);
  assert.equal(expandHand('AKo').length, 12);
  assert.equal(allHandKeys().length, 169);
});

test('對範圍的勝率', async (t) => {
  // 固定種子的亂數，測試才能重現
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  await t.test('AA 對 {KK} 大約 82%', () => {
    const r = rangeEquity(cards('As Ah'), ['KK'], [], 20_000, rand)!;
    assert.equal(r.combos, 6);
    assert.ok(r.equity > 79 && r.equity < 85, `得到 ${r.equity}`);
  });

  await t.test('撞牌的組合剔除：你拿 K♠ 時 KK 只剩 3 種', () => {
    const r = rangeEquity(cards('Ks Qd'), ['KK'], [], 1000, rand)!;
    assert.equal(r.combos, 3);
  });

  await t.test('範圍整個被擋掉時回 null', () => {
    assert.equal(rangeEquity(cards('As Ah'), ['AKs'].filter(() => false), []), null);
  });
});

test('測驗答案：3-bet 優先於跟注', () => {
  assert.equal(rfiAnswer('AKo', new Set(['AKo'])), 'open');
  assert.equal(rfiAnswer('72o', new Set(['AKo'])), 'fold');
  assert.equal(defenseAnswer('AKs', new Set(['AKs']), new Set(['AKs', 'KQs'])), '3bet');
  assert.equal(defenseAnswer('KQs', new Set(['AKs']), new Set(['AKs', 'KQs'])), 'call');
  assert.equal(defenseAnswer('72o', new Set(['AKs']), new Set(['KQs'])), 'fold');
});

test('出題：答案平均分布，而且都在選項裡', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const counts: Record<string, number> = {};
  for (let i = 0; i < 600; i++) {
    const q = makeQuestion(rand);
    assert.ok(q.choices.includes(q.answer), `答案 ${q.answer} 不在選項裡`);
    counts[q.answer] = (counts[q.answer] ?? 0) + 1;
  }
  // 蓋牌不該壓倒性多（依組合數隨便抽的話會超過七成）
  assert.ok((counts.fold ?? 0) / 600 < 0.5, `蓋牌佔 ${counts.fold}/600`);
  for (const a of ['open', '3bet', 'call']) assert.ok((counts[a] ?? 0) > 50, `${a} 太少：${counts[a]}`);
});

test('六人桌的行動順序', () => {
  // 翻牌前 UTG 先、BB 最後；翻牌後 SB 先、BTN 最後
  assert.equal(actionRank('utg', 'preflop'), 1);
  assert.equal(actionRank('bb', 'preflop'), 6);
  assert.equal(actionRank('sb', 'postflop'), 1);
  assert.equal(actionRank('btn', 'postflop'), 6);
  // 兩條街都是從座位順序（順時針）的某一點開始繞一圈
  const rotate = (from: string) => {
    const i = SEAT_ORDER.indexOf(from as typeof SEAT_ORDER[number]);
    return [...SEAT_ORDER.slice(i), ...SEAT_ORDER.slice(0, i)];
  };
  assert.deepEqual([...PREFLOP_ORDER], rotate('utg'));
  assert.deepEqual([...POSTFLOP_ORDER], rotate('sb'));
});
