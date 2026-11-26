/* 撲克快速試算與練習：底池賠率、出路、對範圍勝率、測驗答案。
 * 數字都用手算得出來的例子釘住。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  requiredEquity, callEv, countOuts, hitChance, ruleOfTwoFour,
  expandHand, rangeEquity, rangeStandardError, allHandKeys, rfiAnswer,
  defenseAnswer, makeQuestion, hasQuizSpots, parseMissMeta, filterMisses,
  questionFromMiss, recordMiss, removeMiss, pickMissQuestion,
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

  await t.test('保留勝平負次數且可依實際結果算標準誤', () => {
    const r = rangeEquity(cards('As Ah'), ['KK'], [], 4_000, rand)!;
    assert.equal(r.win + r.tie + r.lose, r.trials);
    assert.ok(Math.abs(r.equity - ((r.win + r.tie / 2) / r.trials) * 100) < 1e-9);
    const se = rangeStandardError(r);
    assert.ok(se > 0 && se < 1.5, `標準誤 ${se}`);

    // 公牌已是皇家同花順時必平手，標準誤必須是 0
    const allTie = rangeEquity(cards('2c 3d'), ['76o'], cards('As Ks Qs Js Ts'), 500, rand)!;
    assert.equal(allTie.win, 0);
    assert.equal(allTie.tie, 500);
    assert.equal(allTie.lose, 0);
    assert.equal(allTie.equity, 50);
    assert.equal(rangeStandardError(allTie), 0);
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

test('測驗分類篩選與錯題重做', async (t) => {
  let seed = 19;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  await t.test('位置與動作分類合法性檢查', () => {
    assert.equal(hasQuizSpots({ position: 'BB', spotType: 'rfi' }), false);
    assert.equal(hasQuizSpots({ position: 'UTG', spotType: 'vs' }), false);
    assert.equal(hasQuizSpots({ position: 'UTG', spotType: 'rfi' }), true);
    assert.equal(hasQuizSpots({ position: 'BB', spotType: 'vs' }), true);
    assert.equal(hasQuizSpots({ position: 'CO', spotType: 'all' }), true);
  });

  await t.test('依位置與動作分類出題', () => {
    for (let i = 0; i < 30; i++) {
      const utg = makeQuestion(rand, { position: 'UTG' });
      assert.equal(utg.position, 'UTG');
      assert.equal(utg.spotType, 'rfi');

      const bb = makeQuestion(rand, { position: 'BB' });
      assert.equal(bb.position, 'BB');
      assert.equal(bb.spotType, 'vs');

      const coVs = makeQuestion(rand, { position: 'CO', spotType: 'vs' });
      assert.equal(coVs.position, 'CO');
      assert.equal(coVs.spotType, 'vs');
      assert.deepEqual(coVs.choices, ['3bet', 'call', 'fold']);

      const rfiOnly = makeQuestion(rand, { spotType: 'rfi' });
      assert.equal(rfiOnly.spotType, 'rfi');
      assert.deepEqual(rfiOnly.choices, ['open', 'fold']);
    }
    assert.throws(() => makeQuestion(rand, { position: 'BB', spotType: 'rfi' }));
    assert.throws(() => makeQuestion(rand, { position: 'UTG', spotType: 'vs' }));
  });

  await t.test('舊版錯題紀錄可解析、篩選、還原與訂正移出', () => {
    const m1 = { spot: 'CO（關煞位），前面的人都蓋牌', hand: 'A9o', answer: 'open' as const, picked: 'fold' as const };
    const m2 = { spot: '你在 BB，UTG 開牌加注，輪到你', hand: 'KJs', answer: '3bet' as const, picked: 'call' as const };

    assert.deepEqual(parseMissMeta(m1), { position: 'CO', spotType: 'rfi', opener: null });
    assert.deepEqual(parseMissMeta(m2), { position: 'BB', spotType: 'vs', opener: 'UTG' });

    const list = recordMiss(recordMiss([], m1), m2);
    assert.equal(list.length, 2);
    assert.equal(filterMisses(list, { position: 'CO' }).length, 1);
    assert.equal(filterMisses(list, { spotType: 'vs' }).length, 1);
    assert.equal(filterMisses(list, { position: 'UTG' }).length, 0);

    // 同題重錯不重複堆積
    const dup = recordMiss(list, { ...m1, picked: 'fold' });
    assert.equal(dup.length, 2);
    assert.equal(dup[0].hand, 'A9o');

    // 還原成完整題目
    const q = questionFromMiss(m2);
    assert.equal(q.position, 'BB');
    assert.equal(q.spotType, 'vs');
    assert.deepEqual(q.choices, ['3bet', 'call', 'fold']);
    assert.ok(q.why.includes('3-bet'));

    // 超過一題時盡量避開剛做過的那題
    const picked = pickMissQuestion(list, rand, m2)!;
    assert.equal(picked.hand, 'A9o');

    // 答對移出後若清空則回 null
    const after = removeMiss(removeMiss(list, m1), m2);
    assert.equal(after.length, 0);
    assert.equal(pickMissQuestion(after, rand), null);
  });
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
