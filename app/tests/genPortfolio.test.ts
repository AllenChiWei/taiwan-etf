/* #/GEN 開關策略後重算組合的測試 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCombo, toDaily, corr, type StratLike } from '../src/lib/genPortfolio.ts';

const seg = (net: number, trades: number, win: number, gp: number, gl: number) =>
  ({ net, mdd: 0, nd: null, pf: gl > 0 ? gp / gl : null, trades, win, gp, gl });

function strat(eq: number[], trades: number, win: number, gp: number, gl: number): StratLike {
  return {
    eq,
    stats: { all: seg(0, trades, win, gp, gl), is: seg(0, trades, win, gp, gl), os: seg(0, 0, 0, 0, 0) },
    years: [{ y: 2022, ...seg(0, trades, win, gp, gl) }],
  };
}

test('累計 → 每日', () => {
  assert.deepEqual(toDaily([5, 8, 6]), [5, 3, -2]);
});

test('兩支相加：淨利、MDD、獲利因子、勝率加權', () => {
  const dates = ['2022-01-03', '2022-01-04', '2022-12-30', '2023-01-03'];
  const a = strat([10, 6, 12, 10], 4, 50, 16, 6);       // 每日 +10 −4 +6 −2
  const b = strat([0, 2, 2, 4], 6, 100 / 3, 6, 2);       // 每日 0 +2 0 +2
  const c = buildCombo([a, b], dates, '2022-12-31');
  assert.equal(c.stats.all.net, 14);
  assert.deepEqual(c.eq, [10, 8, 14, 14]);
  assert.equal(c.stats.all.mdd, 2, '10 → 8');
  assert.equal(c.stats.all.nd, 7);
  assert.equal(c.stats.is.net, 14, '樣本內三天');
  assert.equal(c.stats.os.net, 0, '樣本外 −2＋2');
  assert.equal(c.stats.all.pf, 22 / 8, '獲利因子＝Σgp÷Σgl');
  assert.equal(c.stats.all.trades, 10);
  assert.equal(c.stats.all.win, 40, '(2＋2)÷10');
  assert.equal(c.years.length, 2);
  assert.equal(c.years[0].net, 14);
  assert.equal(c.n, 2);
});

test('只開一支＝那一支自己', () => {
  const dates = ['2022-01-03', '2022-01-04', '2022-01-05'];
  const a = strat([1, 3, 2], 3, 66.7, 3, 1);
  const c = buildCombo([a], dates, '2022-12-31');
  assert.deepEqual(c.eq, [1, 3, 2]);
  assert.equal(c.stats.all.mdd, 1);
  assert.equal(c.corrMax, 0, '一支沒有兩兩相關');
});

test('舊資料沒有 gp／gl：獲利因子是 null，不要亂算', () => {
  const dates = ['2022-01-03', '2022-01-04'];
  const a: StratLike = { eq: [1, 2], stats: { all: { net: 2, mdd: 0, nd: null, pf: 2, trades: 2, win: 50 }, is: { net: 2, mdd: 0, nd: null, pf: 2, trades: 2, win: 50 }, os: { net: 0, mdd: 0, nd: null, pf: null, trades: 0, win: null } }, years: [] };
  assert.equal(buildCombo([a], dates, '2022-12-31').stats.all.pf, null);
});

test('相關', () => {
  assert.equal(corr([1, 2, 3], [2, 4, 6]), 1);
  assert.ok(Math.abs(corr([1, 2, 3], [3, 2, 1]) + 1) < 1e-12);
});
