/* 美股 ETF 的配息反推與匯率換算。數字取自 FinMind USStockPrice 的真實回應。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveUsDividends, latestMidRate, seriesFromUs, type UsPriceRow } from '../src/lib/usDividend.ts';
import { projectHolding } from '../src/lib/dividend.ts';

// SCHD 2026-03 除息前後（2026-03-25 除息）
const schd: UsPriceRow[] = [
  { date: '2026-03-20', Close: 30.39, Adj_Close: 29.9 },
  { date: '2026-03-23', Close: 30.54, Adj_Close: 30.04 },
  { date: '2026-03-24', Close: 30.64, Adj_Close: 30.14 },
  { date: '2026-03-25', Close: 30.54, Adj_Close: 30.3 },
  { date: '2026-03-26', Close: 30.62, Adj_Close: 30.38 },
];

test('Close 與 Adj_Close 的比值跳動 = 除息日，幅度 = 配息', () => {
  const ev = deriveUsDividends(schd);
  assert.equal(ev.length, 1);
  assert.equal(ev[0][0], '2026-03-25');
  assert.ok(Math.abs(ev[0][1] - 0.2613) < 0.001, `算出 ${ev[0][1]}`);
});

test('分割與反分割不當成配息', () => {
  // 1 拆 2：Close 腰斬、Adj_Close 早已還原 → 比值翻倍，y 是負的
  const split: UsPriceRow[] = [
    { date: '2026-01-02', Close: 100, Adj_Close: 50 },
    { date: '2026-01-05', Close: 50.5, Adj_Close: 50.5 },
  ];
  assert.deepEqual(deriveUsDividends(split), []);
  // 2 併 1：比值砍半，y ≈ 0.5，超過上限
  const reverse: UsPriceRow[] = [
    { date: '2026-01-02', Close: 10, Adj_Close: 20 },
    { date: '2026-01-05', Close: 20.2, Adj_Close: 20.2 },
  ];
  assert.deepEqual(deriveUsDividends(reverse), []);
});

test('匯率取最新一天的即期中價，跳過假日的空值', () => {
  const fx = latestMidRate([
    { date: '2026-09-22', spot_buy: 31.65, spot_sell: 31.75 },
    { date: '2026-09-23', spot_buy: 31.65, spot_sell: 31.75 },
    { date: '2026-09-24', spot_buy: 0, spot_sell: 0 },
  ]);
  assert.deepEqual(fx, { date: '2026-09-23', rate: 31.7 });
  assert.equal(latestMidRate([]), null);
});

test('換成台幣後，年配息與市值都乘上匯率，殖利率不變', () => {
  const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
  const usd = projectHolding(seriesFromUs('SCHD', 'Schwab', schd, 1, months), months, 100);
  const twd = projectHolding(seriesFromUs('SCHD', 'Schwab', schd, 31.7, months), months, 100);
  assert.ok(Math.abs(twd.annual - usd.annual * 31.7) < 1e-6);
  assert.ok(Math.abs(twd.value - 30.62 * 31.7 * 100) < 1e-6);
  assert.ok(Math.abs(twd.yieldPct - usd.yieldPct) < 1e-9);
  assert.equal(twd.exact, false);                    // 反推的，一律是約略值
});
