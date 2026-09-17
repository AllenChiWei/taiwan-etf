/* 評牌器與權益計算的測試。
 *
 * 評牌器錯了不會當掉，只會安靜地把勝率算歪 —— 所以牌型判斷要一條一條驗，
 * 特別是那幾個經典陷阱：A2345 的順子、兩組三條湊成葫蘆、同花大於順子、
 * 七張裡最好的五張不一定包含手牌。 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCard, cardName, evaluate7, categoryOf, computeEquity, standardError,
  CATEGORY_NAMES,
} from '../src/lib/equity.ts';

const H = (s: string) => s.split(' ').map(parseCard);
const cat = (s: string) => CATEGORY_NAMES[categoryOf(evaluate7(H(s)))];

describe('牌的表示法', () => {
  test('來回轉換', () => {
    for (const t of ['As', 'Kh', 'Td', '2c', '9s']) {
      assert.equal(cardName(parseCard(t)), t);
    }
  });

  test('大小寫都吃，看不懂的丟例外', () => {
    assert.equal(parseCard('as'), parseCard('As'));
    assert.equal(parseCard('AS'), parseCard('As'));
    assert.throws(() => parseCard('Xs'), /看不懂/);
    assert.throws(() => parseCard('Az'), /看不懂/);
    assert.throws(() => parseCard('A'), /看不懂/);
  });
});

describe('牌型判斷', () => {
  test('九種牌型都認得出來', () => {
    assert.equal(cat('As Ks Qs Js Ts 2c 3d'), '同花順');
    assert.equal(cat('Ah Ad Ac As Kh 2c 3d'), '四條');
    assert.equal(cat('Ah Ad Ac Kh Kd 2c 3d'), '葫蘆');
    assert.equal(cat('As Ks 9s 5s 2s 3d 4h'), '同花');
    assert.equal(cat('9h 8d 7c 6s 5h 2c 3d'), '順子');
    assert.equal(cat('Ah Ad Ac Kh Qd 2c 3s'), '三條');
    assert.equal(cat('Ah Ad Kh Kd Qc 2s 3h'), '兩對');
    assert.equal(cat('Ah Ad Kh Qd Jc 2s 3h'), '一對');
    assert.equal(cat('Ah Kd Qh Jd 9c 3s 2h'), '高牌');
  });

  test('A2345 算順子，而且是最小的順子', () => {
    assert.equal(cat('Ah 2d 3c 4s 5h Kd Qc'), '順子');
    // 5 高的順子輸給 6 高的順子
    const wheel = evaluate7(H('Ah 2d 3c 4s 5h Kd Qc'));
    const six = evaluate7(H('2d 3c 4s 5h 6d Kd Qc'));
    assert.ok(six > wheel, '6 高順子應該大於 A2345');
  });

  test('A2345 同花也算同花順', () => {
    assert.equal(cat('As 2s 3s 4s 5s Kd Qc'), '同花順');
    const wheelSF = evaluate7(H('As 2s 3s 4s 5s Kd Qc'));
    const sixSF = evaluate7(H('2s 3s 4s 5s 6s Kd Qc'));
    assert.ok(sixSF > wheelSF);
  });

  test('AKQJT 同花是最大的牌', () => {
    const royal = evaluate7(H('As Ks Qs Js Ts 2c 3d'));
    const quads = evaluate7(H('Ah Ad Ac As Kh Kd Kc'));
    assert.ok(royal > quads, '皇家同花順要大於四條');
  });

  test('兩組三條湊成葫蘆，取大的當三條', () => {
    // AAA + KKK -> A 滿 K
    const s = evaluate7(H('Ah Ad Ac Kh Kd Kc 2s'));
    assert.equal(CATEGORY_NAMES[categoryOf(s)], '葫蘆');
    const aOverK = evaluate7(H('Ah Ad Ac Kh Kd Kc 2s'));
    const kOverA = evaluate7(H('Kh Kd Kc Ah Ad 2s 3d'));
    assert.ok(aOverK > kOverA, 'A 滿 K 應大於 K 滿 A');
  });

  test('同花大於順子，葫蘆大於同花', () => {
    const straight = evaluate7(H('9h 8d 7c 6s 5h 2c 3d'));
    const flush = evaluate7(H('As 9s 7s 5s 2s 3d 4h'));
    const boat = evaluate7(H('2h 2d 2c 3h 3d 9s Kc'));
    assert.ok(flush > straight);
    assert.ok(boat > flush);
  });

  test('同點數時比踢腳', () => {
    const aceKing = evaluate7(H('Ah Ad Kh 7d 5c 3s 2h'));
    const aceQueen = evaluate7(H('Ah Ad Qh 7d 5c 3s 2h'));
    assert.ok(aceKing > aceQueen, 'AA 帶 K 應大於 AA 帶 Q');
  });

  test('七張裡最好的五張不一定用到手牌', () => {
    // 公牌本身就是 AKQJT 同花，兩家都只能打公牌，平手
    const board = 'As Ks Qs Js Ts';
    const a = evaluate7(H(`${board} 2c 3d`));
    const b = evaluate7(H(`${board} 7h 8h`));
    assert.equal(a, b, '公牌成牌時兩家應該一樣大');
  });

  test('同花只取最大的五張', () => {
    // 六張黑桃：A K Q 9 5 2，最好的五張是 A K Q 9 5
    const six = evaluate7(H('As Ks Qs 9s 5s 2s 3d'));
    const five = evaluate7(H('As Ks Qs 9s 5s 3d 4h'));
    assert.equal(six, five, '多出來的小同花牌不該影響分數');
  });
});

describe('權益計算', () => {
  test('河牌圈只有一種結果，而且是精確的', () => {
    const r = computeEquity({
      hero: H('As Ac'), villain: H('Kd Kh'), board: H('2s 7d 9c Jh 3s'),
    });
    assert.equal(r.exact, true);
    assert.equal(r.iterations, 1);
    assert.equal(r.equity, 100);
    assert.equal(r.win, 1);
  });

  test('平手算半勝', () => {
    // 公牌是 AKQJT 同花，兩家都打公牌
    const r = computeEquity({
      hero: H('2c 3d'), villain: H('7h 8h'), board: H('As Ks Qs Js Ts'),
    });
    assert.equal(r.tie, 1);
    assert.equal(r.equity, 50);
  });

  test('翻牌圈雙方已知：窮舉 990 種轉牌河牌', () => {
    const r = computeEquity({
      hero: H('As Ks'), villain: H('Qh Qd'), board: H('Js Ts 2c'),
    });
    assert.equal(r.exact, true);
    assert.equal(r.iterations, 990, 'C(45,2) = 990');
    // A♠K♠ 在 J♠T♠2♣ 上是超級聽牌：9 張同花、Q♣ 補順（Q♠ 是皇家同花順）、
    // 再加上 A 或 K 成對就贏過 QQ。但 QQ 也能補成三條，所以落在五成多，
    // 不會像「16 個補牌 × 4」那樣接近七成。
    assert.ok(r.equity > 50 && r.equity < 70,
      `AKs 在這個牌面應該小幅領先，算出 ${r.equity.toFixed(1)}%`);
  });

  test('轉牌圈窮舉 44 張', () => {
    const r = computeEquity({
      hero: H('As Ac'), villain: H('Kd Kh'), board: H('2s 7d 9c Jh'),
    });
    assert.equal(r.exact, true);
    assert.equal(r.iterations, 44);
    // 只有兩張 K 能救對手
    assert.equal(r.lose, 2);
    assert.ok(Math.abs(r.equity - (42 / 44) * 100) < 1e-9);
  });

  test('翻牌前雙方已知會窮舉 1,712,304 種公牌', () => {
    const r = computeEquity({ hero: H('As Ah'), villain: H('Ks Kh'), board: [] });
    assert.equal(r.exact, true);
    assert.equal(r.iterations, 1_712_304, 'C(48,5)');
    // AA 對 KK 的公認數字約 82%
    assert.ok(Math.abs(r.equity - 82.4) < 1.5,
      `AA vs KK 算出 ${r.equity.toFixed(2)}%，預期約 82%`);
  });

  test('經典對決的數字要對得上公認值', () => {
    const cases: Array<[string, string, number, number]> = [
      ['As Ah', 'Ks Kh', 82.4, 1.5],
      ['As Ks', 'Qh Qd', 46.2, 1.5],     // AKs 對 QQ 的翻銅板
      ['Ah Kd', '2s 2c', 47.0, 1.5],     // AKo 對小對子
      ['As Ah', '7d 2c', 87.7, 1.5],
    ];
    for (const [a, b, expect, tol] of cases) {
      const r = computeEquity({ hero: H(a), villain: H(b), board: [] });
      assert.ok(Math.abs(r.equity - expect) <= tol,
        `${a} vs ${b} 算出 ${r.equity.toFixed(2)}%，預期 ${expect}% ±${tol}`);
    }
  });

  test('對手未知時，翻牌圈仍然窮舉得完', () => {
    const r = computeEquity({ hero: H('As Ks'), villain: null, board: H('Js Ts 2c') });
    assert.equal(r.exact, true);
    // 扣掉自己兩張與三張公牌，還剩 47 張：C(47,2) 種對手手牌 × C(45,2) 種轉牌河牌
    assert.equal(r.iterations, 1081 * 990);
  });

  test('對手未知時，翻牌前改用抽樣並給得出誤差', () => {
    const r = computeEquity({ hero: H('As Ah'), villain: null, board: [], trials: 40_000 });
    assert.equal(r.exact, false);
    assert.equal(r.iterations, 40_000);
    // AA 對隨機手牌約 85%
    assert.ok(Math.abs(r.equity - 85.2) < 1.5,
      `AA 對隨機手牌算出 ${r.equity.toFixed(2)}%，預期約 85%`);
    const se = standardError(r);
    assert.ok(se > 0 && se < 0.5, `標準誤 ${se}`);
  });

  test('精確結果的標準誤是 0', () => {
    const r = computeEquity({
      hero: H('As Ac'), villain: H('Kd Kh'), board: H('2s 7d 9c Jh'),
    });
    assert.equal(standardError(r), 0);
  });

  test('勝負平三者相加等於總次數，勝率算式一致', () => {
    const r = computeEquity({
      hero: H('As Ks'), villain: H('Qh Qd'), board: H('Js Ts 2c'),
    });
    assert.equal(r.win + r.tie + r.lose, r.iterations);
    assert.ok(Math.abs(r.equity - ((r.win + r.tie / 2) / r.iterations) * 100) < 1e-9);
  });

  test('輸入不合法要擋下來', () => {
    assert.throws(() => computeEquity({ hero: H('As'), villain: null, board: [] }),
      /剛好兩張/);
    assert.throws(
      () => computeEquity({ hero: H('As Ks'), villain: H('As Qd'), board: [] }),
      /重複/);
    assert.throws(
      () => computeEquity({ hero: H('As Ks'), villain: null, board: H('2c 3d') }),
      /0、3、4 或 5/);
    assert.throws(
      () => computeEquity({ hero: H('As Ks'), villain: null, board: H('As 3d 4h') }),
      /重複/);
  });
});
