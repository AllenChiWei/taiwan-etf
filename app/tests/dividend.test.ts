/* 持股配息試算的測試。用手算得出來的小資料，斷言失敗時知道是哪一步。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectHolding, buildPortfolio, inferFrequency, payoutsPerYear, expectedMonths,
  SHARES_PER_LOT, donutSlices,
} from '../src/lib/dividend.ts';
import type { CalcSeries } from '../src/lib/backtest.ts';

/** 2025-01 ~ 2025-12 共 12 個月。 */
const MONTHS = Array.from({ length: 12 },
  (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);

function series(over: Partial<CalcSeries> = {}): CalcSeries {
  return {
    code: 'TEST',
    name: '測試',
    freq: '季配',
    first: 0,
    p: new Array(12).fill(20),
    d: new Array(12).fill(0),
    q: new Array(12).fill(null),
    last: { date: '2025-12-31', close: 20 },
    splits: [],
    ...over,
  };
}

test('以股為單位，不再換算張數', () => {
  assert.equal(SHARES_PER_LOT, 1000, '常數仍留著，只用在畫面上的「幾張」提示');
  const d = new Array(12).fill(0); d[0] = 1;
  const r = projectHolding(series({ freq: '年配', d }), MONTHS, 5000);
  assert.equal(r.shares, 5000, '傳進去多少股就是多少股');
  assert.equal(r.annual, 5000, '年配、每股 1 元 × 5000 股');
});

test('年配息 = 最近一次 × 一年幾次，不是把過去一年加總', () => {
  const d = new Array(12).fill(0);
  d[0] = 0.5;   // 1月
  d[3] = 0.6;   // 4月
  d[6] = 0.5;   // 7月
  d[9] = 0.8;   // 10月 ← 最近一次，剛調高
  const r = projectHolding(series({ freq: '季配', d }), MONTHS, 10_000);

  assert.equal(r.payouts, 4);
  assert.equal(r.freq, '季配');
  assert.equal(r.perYear, 4);
  assert.equal(r.latest, 0.8);
  assert.equal(r.latestMonth, '2025-10');
  // 0.8 × 4 = 3.2，而不是實際的 2.4
  assert.ok(Math.abs(r.perShare - 3.2) < 1e-9);
  assert.ok(Math.abs(r.annual - 3.2 * 10_000) < 1e-6);

  // 對照值仍然是真實發生的合計
  assert.ok(Math.abs(r.perShareTtm - 2.4) < 1e-9);
  assert.ok(Math.abs(r.annualTtm - 2.4 * 10_000) < 1e-6);
  assert.ok(r.annual > r.annualTtm, '剛調高配息時推估會高於過去一年實際');
});

test('配息落在實際發生的月份，不是機械式平均分配', () => {
  const d = new Array(12).fill(0);
  d[1] = 0.5;   // 2月
  d[4] = 0.5;   // 5月
  d[7] = 0.5;   // 8月
  d[10] = 0.5;  // 11月
  const r = projectHolding(series({ freq: '季配', d }), MONTHS, 1000);
  assert.deepEqual(r.payoutMonths, [1, 4, 7, 10], '2/5/8/11 月，不是 1/4/7/10');
  assert.equal(r.byMonth[1], 0.5);
  assert.equal(r.byMonth[0], 0, '1月沒有');
  assert.equal(r.byMonth.filter(v => v > 0).length, 4);
});

test('月份加總等於年配息', () => {
  const d = new Array(12).fill(0);
  d[2] = 1.2; d[8] = 1.5;                       // 半年配，最近一次 1.5
  const r = projectHolding(series({ freq: '半年配', d }), MONTHS, 3000);
  const sum = r.byMonth.reduce((a, b) => a + b, 0) * r.shares;
  assert.ok(Math.abs(sum - r.annual) < 1e-6,
    `月份加總 ${sum} 應等於年配息 ${r.annual}`);
});

test('月配 12 個月都有', () => {
  const r = projectHolding(series({ freq: '月配', d: new Array(12).fill(0.1) }), MONTHS, 2000);
  assert.equal(r.payouts, 12);
  assert.equal(r.freq, '月配');
  assert.equal(r.byMonth.filter(v => v > 0).length, 12);
  assert.ok(Math.abs(r.perShare - 1.2) < 1e-9);
  assert.ok(Math.abs(r.annual - 2400) < 1e-6);
});

test('記錄到的月份不足時，按間隔往後補而不是隨便挑空月', () => {
  // 季配但只記錄到 9 月一次 -> 應該補成 3/6/9/12 月，不是 1/2/3/9
  assert.deepEqual(expectedMonths([8], 4), [2, 5, 8, 11]);
  // 半年配只記錄到 3 月 -> 3 月與 9 月
  assert.deepEqual(expectedMonths([2], 2), [2, 8]);
  // 月配只記錄到 7 月 -> 十二個月都有
  assert.equal(expectedMonths([6], 12).length, 12);
  // 已經記滿就照原樣
  assert.deepEqual(expectedMonths([0, 3, 6, 9], 4), [0, 3, 6, 9]);
  // 沒有配息就沒有月份
  assert.deepEqual(expectedMonths([], 0), []);
});

test('公告頻率認不得時才退回用實際次數推', () => {
  const d = new Array(12).fill(0);
  d[0] = 1; d[6] = 1;
  const r = projectHolding(series({ freq: '—', d }), MONTHS, 1000);
  assert.equal(r.freq, '半年配', '公告是 — 就用實際兩次推');
  assert.equal(r.perYear, 2);
});

test('殖利率用推估的年配息除以最新股價', () => {
  const d = new Array(12).fill(0); d[5] = 2.0;
  const r = projectHolding(series({ freq: '年配', d, last: { date: '2025-12-31', close: 25 } }),
    MONTHS, 1000);
  assert.equal(r.freq, '年配');
  assert.ok(Math.abs(r.perShare - 2.0) < 1e-9);
  assert.ok(Math.abs(r.yieldPct - 8) < 1e-9, '2 / 25 = 8%');
  assert.equal(r.value, 25_000);
});

test('只看最後 12 個月', () => {
  const months24 = [
    ...Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, '0')}`),
    ...MONTHS,
  ];
  const d = [...new Array(12).fill(1), ...new Array(12).fill(0.1)];
  const r = projectHolding(series({
    d, p: new Array(24).fill(20), q: new Array(24).fill(null),
  }), months24, 1000);
  assert.equal(r.latest, 0.1, '最近一次是 0.1，不是更早的 1');
  assert.ok(Math.abs(r.perShareTtm - 1.2) < 1e-9);
});

test('資料不滿一年時據實回報月數，頻率仍以公告為準', () => {
  const r = projectHolding(series({
    freq: '半年配', first: 8, d: [0.3, 0, 0, 0.4],
    p: new Array(4).fill(20), q: new Array(4).fill(null),
  }), MONTHS, 1000);
  assert.equal(r.monthsListed, 4);
  assert.equal(r.payouts, 2);
  assert.equal(r.freq, '半年配');
  assert.equal(r.latest, 0.4);
  assert.deepEqual(r.actualMonths, [8, 11]);
});

test('新上市的月配 ETF 不會被當成半年配 —— 00406A 的情況', () => {
  // 00406A 2026-06 上市，宣告月配，但到 2026-09 只有兩筆除息紀錄
  // （2026-07 配 0.13、2026-09 配 0.14）。用實際次數推會判成半年配，
  // 年配息因此只剩實際的六分之一。
  const r = projectHolding(series({
    freq: '月配', first: 5,
    d: [0, 0.13, 0, 0.14],
    p: new Array(4).fill(9.34), q: new Array(4).fill(null),
    last: { date: '2026-09-16', close: 9.34 },
  }), MONTHS, 10_000);

  assert.equal(r.freq, '月配', '要用公告頻率，不是從兩次除息推');
  assert.equal(r.perYear, 12);
  assert.equal(r.payouts, 2, '實際次數仍然據實記錄');
  assert.ok(Math.abs(r.latest - 0.14) < 1e-9);
  assert.ok(Math.abs(r.perShare - 0.14 * 12) < 1e-9, '0.14 × 12 = 1.68');
  assert.ok(Math.abs(r.annual - 1.68 * 10_000) < 1e-6);
  // 月配的月曆應該十二個月都有
  assert.equal(r.payoutMonths.length, 12);
  assert.equal(r.byMonth.filter(v => v > 0).length, 12);
});

test('投資組合把各檔加總到同一份月曆', () => {
  const dA = new Array(12).fill(0); dA[0] = 1; dA[6] = 1;        // 半年配
  const dB = new Array(12).fill(0.05);                          // 月配
  const a = projectHolding(series({ code: 'A', freq: '半年配', d: dA }), MONTHS, 1000);
  const b = projectHolding(
    series({ code: 'B', freq: '月配', d: dB, last: { date: '2025-12-31', close: 10 } }),
    MONTHS, 2000);
  const p = buildPortfolio([a, b]);

  // 1月：A 配 1 × 1000 = 1000，B 配 0.05 × 2000 = 100
  assert.ok(Math.abs(p.byMonth[0] - 1100) < 1e-9);
  assert.ok(Math.abs(p.byMonth[1] - 100) < 1e-9, '2月只有 B');
  // A 年配息 1×2×1000 = 2000，B 0.05×12×2000 = 1200
  assert.ok(Math.abs(p.annual - 3200) < 1e-6);
  const sum = p.byMonth.reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum - p.annual) < 1e-6, '月份加總必須等於年配息');
  assert.equal(p.value, 20_000 + 20_000);
  assert.ok(Math.abs(p.yieldPct - 8) < 1e-9);
  assert.ok(Math.abs(p.monthlyAverage - 3200 / 12) < 1e-9);
});

test('空投資組合不會變成 NaN', () => {
  const p = buildPortfolio([]);
  assert.equal(p.annual, 0);
  assert.equal(p.yieldPct, 0);
  assert.equal(p.monthlyAverage, 0);
  assert.deepEqual(p.byMonth, new Array(12).fill(0));
});

test('近一年沒配息的標的不會產生假數字', () => {
  const r = projectHolding(series({ freq: '—', d: new Array(12).fill(0) }), MONTHS, 10_000);
  assert.equal(r.payouts, 0);
  assert.equal(r.freq, '近一年未配息');
  assert.equal(r.perYear, 0);
  assert.equal(r.perShare, 0);
  assert.equal(r.annual, 0);
  assert.equal(r.yieldPct, 0);
  assert.deepEqual(r.byMonth, new Array(12).fill(0));
});

test('股價為 0 時殖利率不會爆掉', () => {
  const d = new Array(12).fill(0); d[0] = 1;
  const r = projectHolding(series({ d, last: { date: '2025-12-31', close: 0 } }),
    MONTHS, 1000);
  assert.equal(r.yieldPct, 0);
  assert.ok(Number.isFinite(r.annual));
});

test('頻率與次數的對應', () => {
  assert.equal(inferFrequency(12), '月配');
  assert.equal(inferFrequency(6), '雙月配');
  assert.equal(inferFrequency(4), '季配');
  assert.equal(inferFrequency(2), '半年配');
  assert.equal(inferFrequency(1), '年配');
  assert.equal(inferFrequency(0), '近一年未配息');

  assert.equal(payoutsPerYear('月配'), 12);
  assert.equal(payoutsPerYear('季配'), 4);
  assert.equal(payoutsPerYear('近一年未配息'), 0);
});

test('「約略值」只看最近一次那筆的來源，不是整檔', () => {
  // 舊的配息是回推的，最近一次是交易所公告的 —— 畫面顯示的是最近那筆，
  // 所以應該標成精確。整檔有一筆回推就全部標約略，會讓正確的數字看起來不可信。
  const d = new Array(12).fill(0);
  d[0] = 1.0; d[6] = 1.5;
  const r = projectHolding(series({
    freq: '半年配', d,
    dSrc: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  }), MONTHS, 1000);
  assert.equal(r.latestMonth, '2025-07');
  assert.equal(r.exact, true, '最近一次是官方值');

  // 反過來：最近一次是回推的
  const r2 = projectHolding(series({
    freq: '半年配', d,
    dSrc: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  }), MONTHS, 1000);
  assert.equal(r2.exact, false);
});

test('沒有 dSrc 時一律當成約略值', () => {
  // 舊版的資料檔沒有這個欄位。寧可標成約略，不要假裝精確。
  const d = new Array(12).fill(0); d[0] = 1;
  const r = projectHolding(series({ freq: '年配', d }), MONTHS, 1000);
  assert.equal(r.exact, false);
});

test('年配息佔比的甜甜圈', async (t) => {
  await t.test('百分比加起來是 100，順序與輸入一致', () => {
    const s = donutSlices([50, 30, 20]);
    assert.deepEqual(s.map(x => x.i), [0, 1, 2]);
    assert.deepEqual(s.map(x => x.pct), [50, 30, 20]);
  });

  await t.test('只有一檔有配息時回整圈旗標 —— 起終點重合畫不出扇形', () => {
    const s = donutSlices([100, 0, 0]);
    assert.equal(s.length, 1);
    assert.equal(s[0].full, true);
    assert.equal(s[0].pct, 100);
    assert.equal(s[0].d, '');
  });

  await t.test('金額 0 的不佔角度，但保留原本的索引', () => {
    const s = donutSlices([60, 0, 40]);
    assert.deepEqual(s.map(x => x.i), [0, 2]);
  });

  await t.test('全部是 0 或負數就沒有圖', () => {
    assert.deepEqual(donutSlices([0, 0]), []);
    assert.deepEqual(donutSlices([-5]), []);
  });

  await t.test('超過半圈的扇形要打開 large-arc-flag', () => {
    const [big, small] = donutSlices([80, 20]);
    assert.match(big.d, /A42 42 0 1 1/, '80% 的那片要用長弧');
    assert.match(small.d, /A42 42 0 0 1/, '20% 的那片要用短弧');
  });

  await t.test('從十二點鐘方向開始', () => {
    const [first] = donutSlices([50, 50]);
    assert.ok(first.d.startsWith('M50.00 8.00'), first.d.slice(0, 20));
  });
});
