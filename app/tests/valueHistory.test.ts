/* 持股每日總市值與累計損益（lib/valueHistory.ts）測試：
 * 紀錄切換、前值補價、美股當日匯率與降級匯率、損益扣掉加減碼、估算區間、清倉與配息估算。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assetKey, type HoldingsSnapshot } from '../src/lib/holdingsLog.ts';
import {
  buildBenchmarkComparison,
  buildValueHistory,
  computeMaxDrawdown,
  shiftMonths,
  type DailyFx,
  type DailyPrice,
} from '../src/lib/valueHistory.ts';

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

test('報酬比較手算核對：交易日補前值 + 起點歸零 + TWR 扣加減碼 + 超額報酬與最大回撤', () => {
  // 0050 1000 股 + VOO 10 股，固定匯率 25；11-25 模擬台股休市（0050 與 TAIEX 皆缺價）
  // 11-26 加碼 0050 +1000 股（不應扭曲 TWR）
  const log: HoldingsSnapshot[] = [
    {
      date: '2026-11-24',
      holdings: [
        { code: '0050', shares: 1000 },
        { code: 'VOO', shares: 10, m: 'us' },
      ],
    },
    {
      date: '2026-11-26',
      holdings: [
        { code: '0050', shares: 2000 },
        { code: 'VOO', shares: 10, m: 'us' },
      ],
    },
  ];
  const twPrices = new Map<string, DailyPrice[]>([
    ['0050', [
      { date: '2026-11-24', close: 100 },
      { date: '2026-11-26', close: 122 },
      { date: '2026-11-27', close: 103.8 },
    ]],
  ]);
  const usPrices = new Map<string, DailyPrice[]>([
    ['VOO', [
      { date: '2026-11-24', close: 400 },
      { date: '2026-11-25', close: 480 },
      { date: '2026-11-26', close: 480 },
      { date: '2026-11-27', close: 480 },
    ]],
  ]);
  const fxHistory: DailyFx[] = [
    { date: '2026-11-24', rate: 25 },
    { date: '2026-11-25', rate: 25 },
    { date: '2026-11-26', rate: 25 },
    { date: '2026-11-27', rate: 25 },
  ];
  const taiex: DailyPrice[] = [
    { date: '2026-11-24', close: 20_000 },
    // 2026-11-25 台股休市缺價 → 應以 11-24 收盤 20,000 補齊
    { date: '2026-11-26', close: 22_000 },
    { date: '2026-11-27', close: 18_700 },
  ];

  const hist = buildValueHistory({ log, twPrices, usPrices, fxHistory, range: '1y' });
  const cmp = buildBenchmarkComparison(hist.rows, taiex);

  assert.equal(cmp.points.length, 4);
  assert.equal(cmp.startDate, '2026-11-24');
  assert.equal(cmp.endDate, '2026-11-27');
  assert.equal(cmp.filledDays, 1);
  assert.equal(cmp.trimmedLeadingDays, 0);

  // 11-24 起點歸零：我的 0%、大盤 0%、超額 0%
  assert.equal(cmp.points[0].portfolioRetPct, 0);
  assert.equal(cmp.points[0].benchmarkRetPct, 0);
  assert.equal(cmp.points[0].excessRetPct, 0);
  assert.equal(cmp.points[0].benchmarkFilled, false);

  // 11-25 台股休市：VOO +20,000 / 200,000 = +10%；TAIEX 補前值 20,000 → 0%；超額 +10%
  assert.equal(cmp.points[1].benchmarkFilled, true);
  assert.equal(cmp.points[1].benchmarkClose, 20_000);
  assert.ok(Math.abs(cmp.points[1].portfolioRetPct - 10) < 1e-9);
  assert.equal(cmp.points[1].benchmarkRetPct, 0);
  assert.ok(Math.abs(cmp.points[1].excessRetPct - 10) < 1e-9);

  // 11-26 加碼日（扣加減碼日報酬 = 22,000 / 220,000 = +10% → TWR 1.1*1.1-1 = +21%）
  // TAIEX 22,000 / 20,000 - 1 = +10%；超額 = +11%
  assert.equal(cmp.points[2].benchmarkFilled, false);
  assert.ok(Math.abs(cmp.points[2].portfolioRetPct - 21) < 1e-9);
  assert.ok(Math.abs(cmp.points[2].benchmarkRetPct - 10) < 1e-9);
  assert.ok(Math.abs(cmp.points[2].excessRetPct - 11) < 1e-9);

  // 11-27 回檔（日報酬 = -36,400 / 364,000 = -10% → TWR 1.21*0.9-1 = +8.9%）
  // TAIEX 18,700 / 20,000 - 1 = -6.5%；超額 = 8.9 - (-6.5) = +15.4%
  assert.ok(Math.abs((cmp.portfolioRetPct ?? 0) - 8.9) < 1e-9);
  assert.ok(Math.abs((cmp.benchmarkRetPct ?? 0) - (-6.5)) < 1e-9);
  assert.ok(Math.abs((cmp.excessRetPct ?? 0) - 15.4) < 1e-9);

  // 最大回撤：我 1.21 → 1.089 = -10%；大盤 22,000 → 18,700 = -15%
  assert.ok(Math.abs((cmp.portfolioMaxDrawdownPct ?? 0) - (-10)) < 1e-9);
  assert.ok(Math.abs((cmp.benchmarkMaxDrawdownPct ?? 0) - (-15)) < 1e-9);
});

test('報酬比較：切換區間同步起點歸零；基準資料較晚開始時於共同起點重歸零', () => {
  const log: HoldingsSnapshot[] = [
    { date: '2026-11-27', holdings: [{ code: '0050', shares: 1000 }] },
  ];
  const twPrices = new Map<string, DailyPrice[]>([
    ['0050', [
      { date: '2026-01-02', close: 100 },
      { date: '2026-06-01', close: 110 },
      { date: '2026-10-01', close: 120 },
      { date: '2026-11-27', close: 132 },
    ]],
  ]);
  const fullTaiex: DailyPrice[] = [
    { date: '2026-01-02', close: 20_000 },
    { date: '2026-06-01', close: 21_000 },
    { date: '2026-10-01', close: 24_000 },
    { date: '2026-11-27', close: 25_200 },
  ];

  // 近 3 月視窗（10/01 → 11/27）：我的 120→132 (+10%)，大盤 24,000→25,200 (+5%)，超額 +5%
  const h3m = buildValueHistory({ log, twPrices, usPrices: new Map(), fxHistory: [], range: '3m' });
  const c3m = buildBenchmarkComparison(h3m.rows, fullTaiex);
  assert.equal(c3m.startDate, '2026-10-01');
  assert.equal(c3m.points[0].portfolioRetPct, 0);
  assert.equal(c3m.points[0].benchmarkRetPct, 0);
  assert.ok(Math.abs((c3m.portfolioRetPct ?? 0) - 10) < 1e-9);
  assert.ok(Math.abs((c3m.benchmarkRetPct ?? 0) - 5) < 1e-9);
  assert.ok(Math.abs((c3m.excessRetPct ?? 0) - 5) < 1e-9);

  // 基準從 2026-06-01 才開始 → 1y 視窗略過 01-02，雙方於 06-01 共同歸零
  // 我的 110→132 (+20%)，大盤 21,000→25,200 (+20%)，超額 0%，且 rowIndex 對應原 rows[1..3]
  const h1y = buildValueHistory({ log, twPrices, usPrices: new Map(), fxHistory: [], range: '1y' });
  const lateTaiex = fullTaiex.slice(1);
  const cLate = buildBenchmarkComparison(h1y.rows, lateTaiex);
  assert.equal(cLate.trimmedLeadingDays, 1);
  assert.equal(cLate.startDate, '2026-06-01');
  assert.deepEqual(cLate.points.map(p => p.rowIndex), [1, 2, 3]);
  assert.equal(cLate.points[0].portfolioRetPct, 0);
  assert.equal(cLate.points[0].benchmarkRetPct, 0);
  assert.ok(Math.abs((cLate.portfolioRetPct ?? 0) - 20) < 1e-9);
  assert.ok(Math.abs((cLate.benchmarkRetPct ?? 0) - 20) < 1e-9);
  assert.ok(Math.abs(cLate.excessRetPct ?? 1) < 1e-9);
});

test('最大回撤與缺基準資料邊界驗證', () => {
  assert.equal(computeMaxDrawdown([]), 0);
  assert.equal(computeMaxDrawdown([0]), 0);
  assert.equal(computeMaxDrawdown([0, 5, 12, 18]), 0);
  // 財富倍數 1.0 → 1.2 → 1.08 → 1.15：相對高點回撤 = (1.08 / 1.2 - 1) * 100 = -10%（非 8 - 20 = -12%）
  assert.ok(Math.abs(computeMaxDrawdown([0, 20, 8, 15]) - (-10)) < 1e-9);
  assert.ok(Math.abs(computeMaxDrawdown([0, -10, -25, -5]) - (-25)) < 1e-9);

  // 基準無資料時安全回空結果
  const log: HoldingsSnapshot[] = [
    { date: '2026-11-27', holdings: [{ code: '0050', shares: 1000 }] },
  ];
  const twPrices = new Map<string, DailyPrice[]>([
    ['0050', [
      { date: '2026-11-26', close: 100 },
      { date: '2026-11-27', close: 105 },
    ]],
  ]);
  const hist = buildValueHistory({ log, twPrices, usPrices: new Map(), fxHistory: [] });
  const emptyCmp = buildBenchmarkComparison(hist.rows, []);
  assert.equal(emptyCmp.points.length, 0);
  assert.equal(emptyCmp.excessRetPct, null);
  assert.equal(emptyCmp.portfolioMaxDrawdownPct, null);
  assert.equal(emptyCmp.benchmarkMaxDrawdownPct, null);
});
