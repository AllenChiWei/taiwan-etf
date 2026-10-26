/* 月領試算（2026-10-26）。數字和短影音樣片同一套：0056 近四次 0.866＋1＋1.35＋1.72＝4.936。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { incomeRow, perYearOf } from '../src/lib/monthlyIncome.ts';

const ev0056: [string, number, number][] = [
  ['2025-10-23', 0.866, 1], ['2026-01-22', 0.866, 1], ['2026-04-23', 1.0, 1], ['2026-07-21', 1.35, 1], ['2026-10-22', 1.72, 1],
];

test('季配取最近 4 次：0056 月領 1 萬要 25 張、本金約 141 萬、每次 4.3 萬會被扣二代健保', () => {
  const r = incomeRow('0056', '元大高股息', '季配', ev0056, 56.3, 10000)!;
  assert.ok(Math.abs(r.annual - 4.936) < 1e-9, '不含 2025-10 那次');
  assert.equal(r.lots, 25);
  assert.equal(Math.round(r.capital / 1e4), 141);
  assert.equal(r.perPayment, 25000 * 1.72);
  assert.ok(r.nhi && Math.abs(r.nhiYear - 25000 * 4.936 * 0.0211) < 1e-6);
  assert.ok(Math.abs(r.yieldPct - 4.936 / 56.3 * 100) < 1e-9);
});

test('月配每次不到 2 萬不扣；資料不足回 null；頻率不明數近一年次數', () => {
  const ev = Array.from({ length: 12 }, (_, i) => [`2026-${String(i + 1).padStart(2, '0')}-15`, 0.2, 1] as [string, number, number]);
  const r = incomeRow('00X', 'X', '月配', ev, 20, 10000)!;
  assert.equal(r.lots, 50);
  assert.equal(r.perPayment, 10000);
  assert.equal(r.nhi, false);
  assert.equal(incomeRow('00X', 'X', '月配', [], 20, 10000), null);
  assert.equal(incomeRow('00X', 'X', '月配', ev, 0, 10000), null);
  assert.equal(perYearOf('—', ev), 12);
});
