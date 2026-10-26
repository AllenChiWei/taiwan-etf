/* ETF 受益人數（2026-10-27）。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { holdersFor, type EtfHoldersData } from '../src/lib/etfHolders.ts';

const d: EtfHoldersData = {
  meta: { source: '', asof: '2026-11-19', weeks: 6 },
  dates: ['2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19'],
  etfs: {
    '0056': [[100, 10], [110, 12], [120, 11], [130, 15], [140, 15], [150, 20]],
    NEW: [null, null, null, null, [5, 1], [8, 2]],
    GAP: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], null],
  },
};

test('最新一週與週、4 週變化', () => {
  const v = holdersFor('0056', d)!;
  assert.equal(v.asof, '2026-11-19');
  assert.deepEqual([v.holders, v.lots], [150, 20]);
  assert.deepEqual(v.w1, { holders: 10, lots: 5 });
  assert.deepEqual(v.w4, { holders: 40, lots: 8 });
  assert.equal(v.series.length, 6);
});

test('新上市沒有 4 週前；最後一週缺資料就退回有資料的那週', () => {
  const n = holdersFor('NEW', d)!;
  assert.deepEqual(n.w1, { holders: 3, lots: 1 });
  assert.equal(n.w4, null);
  assert.equal(n.series.length, 2);
  const g = holdersFor('GAP', d)!;
  assert.equal(g.asof, '2026-11-12');
  assert.deepEqual(g.w4, { holders: 4, lots: 4 });
  assert.equal(holdersFor('NONE', d), null);
  assert.equal(holdersFor('0056', null), null);
});

test('只有一週：沒有變化', () => {
  const one: EtfHoldersData = { meta: { source: '', asof: '2026-10-22', weeks: 1 }, dates: ['2026-10-22'], etfs: { A: [[9, 3]] } };
  const v = holdersFor('A', one)!;
  assert.equal(v.w1, null);
  assert.equal(v.holders, 9);
});
