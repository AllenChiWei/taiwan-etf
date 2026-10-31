/* 低本益比篩選：預估本益比跟個股頁同一算法、基期近零與倍增擋掉、金融股排除、排序。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enrich, screen, median, type PeRow } from '../src/lib/cheap.ts';
import { revenueEstimate } from '../src/lib/valuation.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const row = (o: Partial<PeRow>): PeRow => ({
  c: '0000', n: '', m: '上市', i: '半導體業', p: 100, pe: 20, pb: 2, y: 3, v: 1e9,
  r: [['2026-08', 1_000_000, 10], ['2026-09', 1_000_000, 10]], ...o,
});

// 台積電 2026-10-30 的真實數字（pe.json）
const tsmc = row({
  c: '2330', n: '台積電', p: 2370, pe: 27.47,
  r: [['2026-08', 514805337, 53.32], ['2026-09', 511857399, 54.65]],
});

test('台積電：預估本益比 = 收盤 ÷ 個股頁 revenueEstimate 的 EPS', () => {
  const [r] = enrich([tsmc]);
  const est = revenueEstimate([{ p: '2026-08', rev: 514805337, yoy: 53.32 },
    { p: '2026-09', rev: 511857399, yoy: 54.65 }], 2370 / 27.47)!;
  near(r.fpe, 2370 / est.eps);
  near(r.growth, est.growth);
  near(r.fpe, 27.47 * est.prev / est.cur);       // 等價寫法：本益比 ÷ 成長倍數
  assert.ok(r.fpe > 17.7 && r.fpe < 17.9, `${r.fpe}`);
  assert.deepEqual(r.months, ['2026-08', '2026-09']);
});

test('虧損（本益比空）、沒有可用月營收的不列', () => {
  assert.equal(enrich([row({ pe: 0 }), row({ r: [] })]).length, 0);
});

test('基期近零：本期與基期都要過營收門檻', () => {
  // 坤悅：本期 8.9 億、去年同月只剩幾十萬，成長 +2,630,241%
  const k = row({ c: '5206', i: '建材營造', pe: 7.89, r: [['2026-09', 894_000, 2630241.2]] });
  const [r] = enrich([k]);
  assert.ok(r.fpe < 0.01);
  assert.equal(screen([r], { maxFpe: 20, minRev: 100_000 }).length, 0, '基期不到 1 億');
  assert.equal(screen([r], { maxFpe: 20, exExtreme: true }).length, 0, '成長超過 100%');
  assert.equal(screen([r], { maxFpe: 20 }).length, 1);
});

test('金融股、景氣循環股、市場、成交金額', () => {
  const rows = enrich([
    row({ c: '2881', i: '金融保險業' }), row({ c: '2603', i: '航運業' }),
    row({ c: '6488', m: '上櫃' }), row({ c: '1234', v: 1e6 }),
  ]);
  const codes = (o: Parameters<typeof screen>[1]) => screen(rows, o).map(r => r.c);
  assert.deepEqual(codes({ maxFpe: 20, exFinancial: true }), ['1234', '2603', '6488']);
  assert.deepEqual(codes({ maxFpe: 20, exCyclical: true }), ['1234', '2881', '6488']);
  assert.deepEqual(codes({ maxFpe: 20, market: '上櫃' }), ['6488']);
  assert.deepEqual(codes({ maxFpe: 20, minValue: 1e7 }), ['2603', '2881', '6488']);
});

test('上限不含、排序方向', () => {
  const rows = enrich([
    row({ c: 'A', pe: 20, y: 1, r: [['2026-09', 100, 0]] }),      // 預估剛好 20
    row({ c: 'B', pe: 11, y: null, r: [['2026-09', 100, 0]] }),   // 預估 11
    row({ c: 'C', pe: 15, y: 5, r: [['2026-09', 100, 50]] }),     // 預估 10
  ]);
  assert.deepEqual(screen(rows, { maxFpe: 20 }).map(r => r.c), ['C', 'B'], '20.0 不列');
  assert.deepEqual(screen(rows, { maxFpe: 30 }).map(r => r.c), ['C', 'B', 'A']);
  assert.deepEqual(screen(rows, { maxFpe: 30, sort: 'growth' }).map(r => r.c), ['C', 'A', 'B']);
  assert.deepEqual(screen(rows, { maxFpe: 30, sort: 'yield' }).map(r => r.c), ['C', 'A', 'B'], '沒有殖利率排最後');
  assert.deepEqual(screen(rows, { maxFpe: 30, sort: 'pe' }).map(r => r.c), ['B', 'C', 'A']);
});

test('中位數', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});
