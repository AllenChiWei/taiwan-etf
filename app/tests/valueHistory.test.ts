/* 持股每日總市值與累計損益（lib/valueHistory.ts）測試：
 * 紀錄切換、前值補價、美股當日匯率與降級匯率、損益扣掉加減碼、估算區間、清倉與配息估算。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assetKey, type HoldingsSnapshot } from '../src/lib/holdingsLog.ts';
import { buildValueHistory, shiftMonths, type DailyFx, type DailyPrice } from '../src/lib/valueHistory.ts';

test('手算核對：估算區間 + 實際紀錄切換 + 美股匯率 + 休市補價 + 加減碼不含於損益', () => {
  const log: HoldingsSnapshot[] = [
    {
      date: '2026-11-25',
      holdings: [
        { code: '0050', shares: 1000, acct: '帳戶A' },
        { code: 'VOO', shares: 10, m: 'us', acct: '帳戶B' },
      ],
    },
    {
      date: '2026-11-26',
      holdings: [
        { code: '0050', shares: 2000, acct: '帳戶A' },
        { code: 'VOO', shares: 10, m: 'us', acct: '帳戶B' },
      ],
    },
  ];
  const twPrices = new Map<string, DailyPrice[]>([
    ['0050', [
      { date: '2026-11-24', close: 100 },
      { date: '2026-11-25', close: 102 },
      { date: '2026-11-26', close: 105 },
      { date: '2026-11-27', close: 104 },
    ]],
  ]);
  // 2026-11-26 模擬美股休市缺價 → 以 2026-11-25 收盤 510 補齊，仍乘當日匯率 32.0
  const usPrices = new Map<string, DailyPrice[]>([
    ['VOO', [
      { date: '2026-11-24', close: 500 },
      { date: '2026-11-25', close: 510 },
      { date: '2026-11-27', close: 520 },
    ]],
  ]);
  const fxHistory: DailyFx[] = [
    { date: '2026-11-24', rate: 32.0 },
    { date: '2026-11-25', rate: 32.5 },
    { date: '2026-11-26', rate: 32.0 },
    { date: '2026-11-27', rate: 32.0 },
  ];

  const res = buildValueHistory({ log, twPrices, usPrices, fxHistory, range: '1y' });
  assert.equal(res.rows.length, 4);
  assert.equal(res.hasEstimated, true);
  assert.equal(res.allEstimated, false);
  assert.equal(res.logStartDate, '2026-11-25');

  // 2026-11-24（估算起點）：1000*100 + 10*(500*32) = 260,000
  assert.equal(res.rows[0].estimated, true);
  assert.equal(res.rows[0].totalValue, 260_000);
  assert.equal(res.rows[0].dailyPnl, 0);
  assert.equal(res.rows[0].cumPnl, 0);

  // 2026-11-25（實際第 1 天）：1000*102 + 10*(510*32.5) = 267,750；損益 +7,750
  assert.equal(res.rows[1].estimated, false);
  assert.equal(res.rows[1].totalValue, 267_750);
  assert.equal(res.rows[1].dailyPnl, 7_750);
  assert.equal(res.rows[1].cumPnl, 7_750);
  assert.equal(res.rows[1].changes.length, 0);

  // 2026-11-26（加碼 0050 +1000 股 + VOO 補前價 510 × 匯率 32 = 16,320）
  // 總市值 2000*105 + 10*16320 = 373,200
  // 當日損益（用前日持股）= 1000*(105-102) + 10*(16320-16575) = 3000 - 2550 = +450
  // 估算加減碼 = +1000*105 = +105,000；恆等式：373200 - 267750 = 105450 = 450 + 105000
  assert.equal(res.rows[2].totalValue, 373_200);
  assert.equal(res.rows[2].dailyPnl, 450);
  assert.equal(res.rows[2].netFlow, 105_000);
  assert.equal(res.rows[2].cumPnl, 8_200);
  assert.deepEqual(res.rows[2].filledCodes, ['VOO']);
  assert.equal(res.rows[2].changes.length, 1);
  assert.equal(res.rows[2].changes[0].code, '0050');
  assert.equal(res.rows[2].changes[0].delta, 1000);

  // 2026-11-27（以 11-26 新持股算損益）：2000*(104-105) + 10*(16640-16320) = -2000 + 3200 = +1,200
  assert.equal(res.rows[3].totalValue, 374_400);
  assert.equal(res.rows[3].dailyPnl, 1_200);
  assert.equal(res.rows[3].cumPnl, 9_400);
  assert.equal(res.changeDays.length, 1);
  assert.equal(res.filledAssets.length, 1);
  assert.equal(res.filledAssets[0].code, 'VOO');
  assert.equal(res.filledAssets[0].filledDays, 1);
});

test('週末修改持股對齊到下個交易日；晚於最新交易日的紀錄標記 pendingLogDate', () => {
  const log: HoldingsSnapshot[] = [
    { date: '2026-11-20', holdings: [{ code: '0050', shares: 1000 }] },
    { date: '2026-11-21', holdings: [{ code: '0050', shares: 2000 }] }, // 週六加碼
    { date: '2026-11-28', holdings: [{ code: '0050', shares: 3000 }] }, // 尚未開盤的週六加碼
  ];
  const twPrices = new Map<string, DailyPrice[]>([
    ['0050', [
      { date: '2026-11-20', close: 100 },
      { date: '2026-11-23', close: 102 },
      { date: '2026-11-27', close: 105 },
    ]],
  ]);
  const res = buildValueHistory({ log, twPrices, usPrices: new Map(), fxHistory: [] });
  assert.equal(res.rows[0].totalValue, 100_000);
  assert.equal(res.rows[1].totalValue, 204_000);
  assert.equal(res.rows[1].dailyPnl, 2_000);
  assert.equal(res.rows[1].changes.length, 1);
  assert.equal(res.rows[2].totalValue, 210_000);
  assert.equal(res.pendingLogDate, '2026-11-28');
});

test('清倉賣光日仍依前日持股算當日損益，清倉後隔日損益歸零', () => {
  const log: HoldingsSnapshot[] = [
    { date: '2026-11-25', holdings: [{ code: '0050', shares: 1000 }] },
    { date: '2026-11-26', holdings: [] },
  ];
  const twPrices = new Map<string, DailyPrice[]>([
    ['0050', [
      { date: '2026-11-25', close: 100 },
      { date: '2026-11-26', close: 98 },
      { date: '2026-11-27', close: 110 },
    ]],
  ]);
  const res = buildValueHistory({ log, twPrices, usPrices: new Map(), fxHistory: [] });
  assert.equal(res.rows[1].totalValue, 0);
  assert.equal(res.rows[1].dailyPnl, -2_000);
  assert.equal(res.rows[1].netFlow, -98_000);
  assert.equal(res.rows[2].totalValue, 0);
  assert.equal(res.rows[2].dailyPnl, 0);
  assert.equal(res.rows[2].cumPnl, -2_000);
});

test('上市較晚的標的在首次有價前不計入且不誤算暴賺；完全無價標的表列於 missingAssets', () => {
  const log: HoldingsSnapshot[] = [
    {
      date: '2026-11-26',
      holdings: [
        { code: '0050', shares: 1000 },
        { code: '00999', shares: 1000 },
        { code: '9999', shares: 500 },
      ],
    },
  ];
  const twPrices = new Map<string, DailyPrice[]>([
    ['0050', [
      { date: '2026-11-24', close: 100 },
      { date: '2026-11-25', close: 101 },
      { date: '2026-11-26', close: 102 },
    ]],
    ['00999', [
      { date: '2026-11-25', close: 20 },
      { date: '2026-11-26', close: 21 },
    ]],
  ]);
  const res = buildValueHistory({
    log,
    twPrices,
    usPrices: new Map(),
    fxHistory: [],
    errors: new Map([[assetKey('9999'), 'FinMind 查無資料']]),
  });

  // 11-24 只有 0050；11-25 00999 上市首日不應算入 +20,000 假損益
  assert.equal(res.rows[0].totalValue, 100_000);
  assert.equal(res.rows[1].totalValue, 121_000);
  assert.equal(res.rows[1].dailyPnl, 1_000);
  assert.equal(res.rows[2].totalValue, 123_000);
  assert.equal(res.rows[2].dailyPnl, 2_000);
  assert.equal(res.rows[2].cumPnl, 3_000);

  assert.equal(res.missingAssets.length, 1);
  assert.equal(res.missingAssets[0].code, '9999');
  assert.equal(res.missingAssets[0].reason, 'FinMind 查無資料');
  assert.equal(res.filledAssets.length, 1);
  assert.equal(res.filledAssets[0].code, '00999');
  assert.equal(res.filledAssets[0].missingBefore, '2026-11-25');
});

test('歷史匯率抓不到時退回最近一筆備援匯率並標註 usedFxFallback', () => {
  const log: HoldingsSnapshot[] = [
    { date: '2026-11-25', holdings: [{ code: 'SPY', shares: 10, m: 'us' }] },
  ];
  const usPrices = new Map<string, DailyPrice[]>([
    ['SPY', [
      { date: '2026-11-25', close: 600 },
      { date: '2026-11-26', close: 610 },
    ]],
  ]);
  const res = buildValueHistory({
    log,
    twPrices: new Map(),
    usPrices,
    fxHistory: [],
    fallbackFx: { date: '2026-11-26', rate: 32.5 },
  });
  assert.equal(res.usedFxFallback, true);
  assert.equal(res.rows[0].totalValue, 195_000);
  assert.equal(res.rows[1].totalValue, 198_250);
  assert.equal(res.rows[1].dailyPnl, 3_250);
});

test('期間切換（3m/6m/1y）歸零視窗損益，頂部 1D/1M/YTD 仍以完整歷史計算', () => {
  assert.equal(shiftMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(shiftMonths('2024-02-29', -12), '2023-02-28');

  const log: HoldingsSnapshot[] = [
    { date: '2026-11-27', holdings: [{ code: '0050', shares: 1000 }] },
  ];
  const twPrices = new Map<string, DailyPrice[]>([
    ['0050', [
      { date: '2025-12-31', close: 100 },
      { date: '2026-06-01', close: 110 },
      { date: '2026-10-27', close: 115 },
      { date: '2026-11-26', close: 120 },
      { date: '2026-11-27', close: 123 },
    ]],
  ]);
  const res3m = buildValueHistory({ log, twPrices, usPrices: new Map(), fxHistory: [], range: '3m' });
  // 視窗只有近 3 月（10/27, 11/26, 11/27），起點歸零
  assert.deepEqual(res3m.rows.map(r => r.date), ['2026-10-27', '2026-11-26', '2026-11-27']);
  assert.deepEqual(res3m.rows.map(r => r.cumPnl), [0, 5_000, 8_000]);
  assert.equal(res3m.allEstimated, false); // 11-27 當天即為記錄日

  // 頂部 1D / 1M / YTD 由完整歷史計算
  assert.equal(res3m.change1d?.pnl, 3_000);
  assert.ok(Math.abs((res3m.change1d?.retPct ?? 0) - 2.5) < 1e-9);
  assert.equal(res3m.change1m?.fromDate, '2026-10-27');
  assert.equal(res3m.change1m?.pnl, 8_000);
  assert.equal(res3m.changeYtd?.fromDate, '2025-12-31');
  assert.equal(res3m.changeYtd?.pnl, 23_000);
  assert.ok(Math.abs((res3m.changeYtd?.retPct ?? 0) - 23) < 1e-9);
});

test('配息不算進市值與損益，另以除息日前一日持股估算區間已領配息', () => {
  const log: HoldingsSnapshot[] = [
    { date: '2026-11-25', holdings: [{ code: '0056', shares: 2000 }] },
    { date: '2026-11-26', holdings: [{ code: '0056', shares: 3000 }] },
  ];
  const twPrices = new Map<string, DailyPrice[]>([
    ['0056', [
      { date: '2026-11-25', close: 40 },
      { date: '2026-11-26', close: 39 },
    ]],
  ]);
  const dividends = new Map<string, ReadonlyArray<readonly [string, number]>>([
    [assetKey('0056'), [['2026-11-26', 1.0]]],
  ]);
  const res = buildValueHistory({ log, twPrices, usPrices: new Map(), fxHistory: [], dividends });
  // 市值與損益不含配息：11-26 市值 3000*39=117,000，當日損益 2000*(39-40)=-2,000
  assert.equal(res.rows[1].totalValue, 117_000);
  assert.equal(res.rows[1].dailyPnl, -2_000);
  // 除息日 11-26 前一日（11-25）持有 2000 股 → 估算已領配息 2,000 元
  assert.equal(res.estDividends, 2_000);
});
