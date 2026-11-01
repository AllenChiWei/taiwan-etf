/* 支出預估：頻率攤到各月、全年與分類合計、壞資料的清理。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  paysIn, payMonths, scheduleText, perYear, monthTotals, yearTotal, byCategory, categories, cleanBudget, type BudgetItem,
} from '../src/lib/budget.ts';

const item = (o: Partial<BudgetItem>): BudgetItem => ({ id: 'x', name: 'x', cat: '其他', amount: 100, every: 1, month: 1, ...o });

test('每年一次只落在指定月份；每季從第一次的月份往後每三個月', () => {
  const tax = item({ every: 12, month: 5 });
  assert.deepEqual([...Array(12)].map((_, i) => paysIn(tax, i + 1)).flatMap((v, i) => (v ? [i + 1] : [])), [5]);
  const q = item({ every: 3, month: 2 });
  assert.deepEqual([...Array(12)].map((_, i) => paysIn(q, i + 1)).flatMap((v, i) => (v ? [i + 1] : [])), [2, 5, 8, 11]);
  const half = item({ every: 6, month: 9 });
  assert.deepEqual([...Array(12)].map((_, i) => paysIn(half, i + 1)).flatMap((v, i) => (v ? [i + 1] : [])), [3, 9]);
});

test('頻率文字', () => {
  assert.equal(scheduleText(item({})), '每月');
  assert.equal(scheduleText(item({ every: 12, month: 11 })), '每年 11 月');
  assert.equal(scheduleText(item({ every: 3, month: 2 })), '每季（2、5、8、11 月）');
  assert.deepEqual(payMonths(item({ every: 2, month: 2 })), [2, 4, 6, 8, 10, 12]);
});

test('各月合計加起來等於全年合計，暫停的不算', () => {
  const items = [
    item({ id: 'a', amount: 20000 }),                       // 房租 每月
    item({ id: 'b', amount: 1500, every: 2, month: 1 }),    // 水電 單月
    item({ id: 'c', amount: 12000, every: 12, month: 5 }),  // 房屋稅
    item({ id: 'd', amount: 99999, every: 12, month: 3, off: true }),
  ];
  const months = monthTotals(items);
  assert.equal(months.reduce((a, x) => a + x.total, 0), yearTotal(items));
  assert.equal(yearTotal(items), 20000 * 12 + 1500 * 6 + 12000);
  assert.equal(months[4].total, 20000 + 1500 + 12000);       // 5 月
  assert.equal(months[4].fixed, 20000);
  assert.equal(months[2].total, 20000 + 1500);               // 3 月：暫停的那筆不算
  assert.equal(perYear(items[1]), 9000);
});

test('分類依全年金額排序、占比加總為 1', () => {
  const items = [
    item({ cat: '稅費', amount: 30000, every: 12 }),
    item({ cat: '居住', amount: 10000 }),
    item({ cat: '稅費', amount: 5000, every: 12, month: 11 }),
  ];
  const cats = byCategory(items);
  assert.deepEqual(cats.map(c => c.cat), ['居住', '稅費']);
  assert.equal(cats[1].year, 35000);
  assert.equal(cats[1].n, 2);
  assert.ok(Math.abs(cats.reduce((a, c) => a + c.share, 0) - 1) < 1e-9);
  assert.deepEqual(byCategory([]), []);
});

test('自己加的分類補在預設分類後面', () => {
  const c = categories([item({ cat: '寵物' }), item({ cat: '居住' })]);
  assert.equal(c[0], '居住');
  assert.equal(c[c.length - 1], '寵物');
  assert.equal(c.filter(x => x === '居住').length, 1);
});

test('清理：壞的項目丟掉、缺的欄位補預設', () => {
  const d = cleanBudget({
    generated: '2026-11-01 12:00:00',
    items: [
      { id: 'ok', name: ' 房租 ', cat: '居住', amount: 20000, every: 1, month: 1 },
      { name: '沒分類', amount: 100, every: 12, month: 13 },
      { name: '', amount: 1, every: 1 },
      { name: '負數', amount: -5, every: 1 },
      { name: '頻率不對', amount: 5, every: 5 },
      { name: '暫停', amount: 5, every: 1, off: true, note: '  ' },
      null, 'x',
    ],
  });
  assert.equal(d.generated, '2026-11-01 12:00:00');
  assert.deepEqual(d.items.map(x => x.name), ['房租', '沒分類', '暫停']);
  assert.equal(d.items[1].cat, '其他');
  assert.equal(d.items[1].month, 1);
  assert.ok(d.items[1].id);
  assert.equal(d.items[2].off, true);
  assert.equal('note' in d.items[2], false);
  assert.deepEqual(cleanBudget(null), { v: 1, generated: '', items: [] });
});
