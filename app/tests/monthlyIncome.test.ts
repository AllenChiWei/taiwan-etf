/* 月領試算（2026-10-26）。數字和短影音樣片同一套：0056 近四次 0.866＋1＋1.35＋1.72＝4.936。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { incomeRow, perYearOf } from '../src/lib/monthlyIncome.ts';

const ev0056: [string, number, number][] = [
  ['2025-10-23', 0.866, 1], ['2026-01-22', 0.866, 1], ['2026-04-23', 1.0, 1], ['2026-07-21', 1.35, 1], ['2026-10-22', 1.72, 1],
];

test('季配取最近 4 次：0056 月領 1 萬要 25 張、本金約 141 萬', () => {
  const r = incomeRow('0056', '元大高股息', '季配', ev0056, 56.3, 10000)!;
  assert.ok(Math.abs(r.annual - 4.936) < 1e-9, '不含 2025-10 那次');
  assert.equal(r.lots, 25);
  assert.equal(Math.round(r.capital / 1e4), 141);
  assert.equal(r.perPayment, 25000 * 1.72);
  assert.ok(Math.abs(r.yieldPct - 4.936 / 56.3 * 100) < 1e-9);
  assert.equal(r.nhi, null, '沒有配息組成就不猜');
  assert.equal(r.taxPct, null);
});

test('二代健保只算股利＋利息所得（2026-10-27 站主：00406A 不用扣）', () => {
  // 0056 2026-10-22 公告：股利 17.97%、資本利得 82.03% → 每次 4.3 萬裡股利約 7,700，沒到 2 萬
  const r = incomeRow('0056', '元大高股息', '季配', ev0056, 56.3, 10000, { date: '2026-10-22', d: [17.97, 0, 0, 82.03, 0] })!;
  assert.equal(r.nhi, false);
  assert.equal(r.nhiYear, 0);
  assert.ok(Math.abs(r.taxPct! - 17.97) < 1e-9);
  // 月領 5 萬：122 張，每次約 21 萬、股利約 3.8 萬 → 只扣股利那部分
  const big = incomeRow('0056', '元大高股息', '季配', ev0056, 56.3, 50000, { date: '2026-10-22', d: [17.97, 0, 0, 82.03, 0] })!;
  assert.equal(big.lots, 122);
  assert.equal(big.nhi, true);
  assert.ok(Math.abs(big.nhiYear - 122000 * 4.936 * 0.1797 * 0.0211) < 1e-6);
  // 全是資本利得（00919、00981A）：多大筆都不扣
  const cg = incomeRow('00919', 'X', '季配', ev0056, 22, 100000, { date: '2026-09-16', d: [0, 0, 0, 100, 0] })!;
  assert.equal(cg.nhi, false);
  assert.equal(cg.taxPct, 0);
  // 股利、利息分開看門檻：各 1.5 萬都不到 2 萬 → 不扣
  const ev: [string, number, number][] = [['2026-10-01', 3, 1]];
  const split = incomeRow('00X', 'X', '年配', ev, 30, 2500, { date: '2026-10-01', d: [50, 50, 0, 0, 0] })!;
  assert.equal(split.perPayment, 30000);
  assert.equal(split.nhi, false);
});

test('月配每次不到 2 萬不扣；資料不足回 null；頻率不明數近一年次數', () => {
  const ev = Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, '0')}-15`, 0.2, 1] as [string, number, number]);
  const r = incomeRow('00X', 'X', '月配', ev, 20, 10000, { date: '2026-12-15', d: [100, 0, 0, 0, 0] })!;
  assert.equal(r.lots, 50);
  assert.equal(r.perPayment, 10000);
  assert.equal(r.nhi, false);
  assert.equal(incomeRow('00X', 'X', '月配', [], 20, 10000), null);
  assert.equal(incomeRow('00X', 'X', '月配', ev, 0, 10000), null);
  assert.equal(perYearOf('—', ev), 12);
  assert.equal(r.estimated, false);
});

test('上市未滿一年：用平均每次 × 一年次數推估，不把幾個月的配息當成一年', () => {
  // 00400A：月配、只配過 4 次 0.12 → 年 1.44（不是 0.48）
  const ev: [string, number, number][] = [['2026-07-09', 0.12, 1], ['2026-08-05', 0.12, 1], ['2026-09-07', 0.12, 1], ['2026-10-08', 0.12, 1]];
  const r = incomeRow('00400A', 'X', '月配', ev, 14.41, 10000)!;
  assert.ok(r.estimated);
  assert.equal(r.paid, 4);
  assert.ok(Math.abs(r.annual - 1.44) < 1e-9);
  assert.equal(r.lots, Math.ceil(120000 / 1.44 / 1000));
});
