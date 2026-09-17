/* 手牌矩陣與範圍記號的測試。
   範圍寫錯一個字，畫面上看不出來，只會讓人照著錯的表打 —— 所以解析要有測試。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RANKS, TOTAL_COMBOS, handAt, allHands, parseRange,
  rangePercent, rangeCombos, combosOfKey,
} from '../src/lib/poker.ts';

test('矩陣的三個區域各自對應對子、同花、不同花', () => {
  assert.deepEqual(handAt(0, 0).key, 'AA');
  assert.equal(handAt(0, 0).kind, 'pair');
  assert.equal(handAt(12, 12).key, '22');

  // 右上是同花
  assert.equal(handAt(0, 1).key, 'AKs');
  assert.equal(handAt(0, 1).kind, 'suited');
  // 左下是不同花，而且高牌一樣寫在前面
  assert.equal(handAt(1, 0).key, 'AKo');
  assert.equal(handAt(1, 0).kind, 'offsuit');
});

test('169 種起手牌合計 1326 種組合', () => {
  const grid = allHands();
  assert.equal(grid.length, 13);
  assert.equal(grid.flat().length, 169);
  const combos = grid.flat().reduce((n, h) => n + h.combos, 0);
  assert.equal(combos, TOTAL_COMBOS);

  const keys = new Set(grid.flat().map(h => h.key));
  assert.equal(keys.size, 169, '169 種起手牌不該有重複');
});

test('組合數：對子 6、同花 4、不同花 12', () => {
  assert.equal(combosOfKey('AA'), 6);
  assert.equal(combosOfKey('AKs'), 4);
  assert.equal(combosOfKey('AKo'), 12);
  assert.equal(6 * 13 + 4 * 78 + 12 * 78, TOTAL_COMBOS);
});

test('單一手牌', () => {
  assert.deepEqual([...parseRange('AA')], ['AA']);
  assert.deepEqual([...parseRange('AKs')], ['AKs']);
  assert.deepEqual([...parseRange('72o')], ['72o']);
});

test('對子的 + 是往大的方向', () => {
  const r = parseRange('TT+');
  assert.deepEqual([...r].sort(), ['AA', 'JJ', 'KK', 'QQ', 'TT'].sort());
  assert.equal(parseRange('22+').size, 13, '22+ 是全部 13 種對子');
  assert.equal(parseRange('AA').size, 1);
});

test('對子區間兩個方向都可以寫', () => {
  assert.deepEqual([...parseRange('22-55')].sort(), ['22', '33', '44', '55']);
  assert.deepEqual([...parseRange('55-22')].sort(), ['22', '33', '44', '55']);
});

test('同花／不同花的 + 是低牌往上，停在高牌下面一張', () => {
  assert.deepEqual([...parseRange('ATs+')].sort(), ['AJs', 'AKs', 'AQs', 'ATs'].sort());
  assert.deepEqual([...parseRange('KTo+')].sort(), ['KJo', 'KQo', 'KTo'].sort());
  // A2s+ 應該是 A2s 到 AKs，共 12 手
  assert.equal(parseRange('A2s+').size, 12);
  // T8s+ 只有 T8s 與 T9s
  assert.deepEqual([...parseRange('T8s+')].sort(), ['T8s', 'T9s']);
});

test('明確區間', () => {
  assert.deepEqual([...parseRange('A5s-A2s')].sort(), ['A2s', 'A3s', 'A4s', 'A5s']);
  assert.deepEqual([...parseRange('A2s-A5s')].sort(), ['A2s', 'A3s', 'A4s', 'A5s']);
});

test('逗號分隔會合併，重複不會算兩次', () => {
  const r = parseRange('AA, KK, AA, AKs');
  assert.equal(r.size, 3);
  assert.ok(r.has('AA') && r.has('KK') && r.has('AKs'));
});

test('空白與空片段會被忽略', () => {
  assert.equal(parseRange('  AA ,, KK ,  ').size, 2);
  assert.equal(parseRange('').size, 0);
});

test('寫錯的範圍要丟例外，不能安靜忽略', () => {
  assert.throws(() => parseRange('XX'), /看不懂/);
  assert.throws(() => parseRange('AKx'), /看不懂/);
  assert.throws(() => parseRange('KAs'), /高牌要寫在前面/);
  assert.throws(() => parseRange('AAs'), /同一張牌/);
  assert.throws(() => parseRange('A5s-K2s'), /高牌與花色必須一致/);
  assert.throws(() => parseRange('A5s-A2o'), /高牌與花色必須一致/);
});

test('百分比算的是組合數佔 1326，不是 169 分之幾', () => {
  // AA 是 169 種起手牌之一（0.59%），但組合上只有 6/1326
  const aa = parseRange('AA');
  assert.equal(rangeCombos(aa), 6);
  assert.ok(Math.abs(rangePercent(aa) - (6 / 1326) * 100) < 1e-9);
  assert.ok(Math.abs(rangePercent(aa) - 0.4525) < 0.001);

  // 全部 169 手就是 100%
  const every = new Set(allHands().flat().map(h => h.key));
  assert.equal(rangeCombos(every), TOTAL_COMBOS);
  assert.ok(Math.abs(rangePercent(every) - 100) < 1e-9);
});

test('同花與不同花的權重不同 —— AKs 只有 AKo 的三分之一', () => {
  assert.equal(rangeCombos(parseRange('AKo')), 12);
  assert.equal(rangeCombos(parseRange('AKs')), 4);
  assert.ok(rangePercent(parseRange('AKo')) > rangePercent(parseRange('AKs')));
});

test('RANKS 由大到小，索引越小牌越大', () => {
  assert.equal(RANKS[0], 'A');
  assert.equal(RANKS[12], '2');
  assert.equal(RANKS.length, 13);
});
